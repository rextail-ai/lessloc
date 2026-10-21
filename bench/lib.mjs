// What the benchmark runner needs: the command line, the agent tool each session runs in, a task's session with its
// follow-up, what lessloc did during it, and the report's statistics.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { userHooks } from '../lib/hosts.mjs';
import { esc } from '../lib/text.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
const LESSLOC = path.dirname(HERE);
// A run's temporary files (its sessions' and tests' files, lessloc's state) live in one folder of the run's own, removed
// when the run ends, however it ends. What the report points to, the results and each timeline's repository, is kept
// beside it in the system's temporary folder.
export const KEEP = os.tmpdir();
const TMP = fs.mkdtempSync(path.join(KEEP, 'lessloc-run-'));
process.env.TMPDIR = TMP;
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
// A run started from inside a Claude Code session would hand that session's identity to every agent: each would count as its
// child session and join its messaging socket. The agents start as a user's sessions do.
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|AI_AGENT|CLAUDE_CODE_(CHILD_SESSION|ENTRYPOINT|EXECPATH|MESSAGING_SOCKET|MESSAGING_TOKEN|SESSION_ATTENDED|SESSION_ID))$/.test(k)) delete process.env[k];
export const opt = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
export const HOST = opt('host', 'claude');
const MODEL = opt('model', HOST === 'claude' ? 'sonnet' : undefined);
export const RUNS = Number(opt('runs', 3)), JOBS = Number(opt('jobs', 3));
// The lessloc-old arm runs another lessloc checkout (--old <dir>), such as the release before this one, side by side with
// this one in the same run.
export const setup = name => ({
  name,
  env: name.includes('-no-') ? { LESSLOC_OFF: name.split('-no-').slice(1).join(',') } : {},
  lessloc: name.startsWith('lessloc'),
  plugin: name === 'lessloc-old' ? path.resolve(opt('old')) : name.startsWith('lessloc') ? LESSLOC : null,
});
export const sum = xs => xs.reduce((s, x) => s + x, 0);
// A session cut off at the time limit has tokens but no cost of its own: it is priced at what the run's complete sessions
// paid per input-side token, so a session that never ends never looks free.
export function priceCutOffs(xs) {
  const done = xs.filter(x => !x.failed && x.cost > 0 && x.input > 0), rate = sum(done.map(x => x.cost)) / sum(done.map(x => x.input));
  for (const x of xs) if (x.timedOut && !(x.cost > 0) && x.input > 0 && rate) Object.assign(x, { cost: x.input * rate, priced: true });
}
// A session the agent tool ended at the account's usage limit, or one that ended with no result at all (the tool crashed),
// is not a result: the task is run again later. A session that ran out of time is. The pattern leaves out "quota", which a
// full disk's "Disk quota exceeded" would match.
const LIMIT = /hit your (?:session |usage |weekly )?limit|usage limit|rate.?limit|too many requests|\b429\b|overloaded/i;
const OPENCODE_TOOLS = { read: 'Read', grep: 'Grep', glob: 'Glob', list: 'Glob', shell: 'Bash' };
// The agent tool each session runs in: its command line, a config home of its own per timeline and setup (so the user's own
// configuration never leaks in, and lessloc is on only where the arm says), and its output read back as the same measures.
const HOSTS = {
  claude: {
    bin: opt('claude', 'claude'),
    // No web tools: an agent that looks the real change up online measures the lookup, not the tool under test.
    args: (prompt, s) => ['-p', prompt, '--model', MODEL, '--setting-sources', 'project,local', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose', '--disallowedTools', 'WebFetch,WebSearch', ...(s.lessloc ? ['--plugin-dir', s.plugin] : [])],
    home: () => ({}),
    parse(events) {
      const end = events.find(e => e.type === 'result'), u = end?.usage || {};
      return end && {
        cost: end.total_cost_usd, sec: end.duration_ms / 1000, turns: end.num_turns, failed: end.is_error, limited: !!end.is_error && LIMIT.test(String(end.result ?? '')), said: String(end.result ?? ''),
        input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0,
        calls: events.filter(e => e.type === 'assistant').flatMap(e => e.message?.content || []).filter(c => c.type === 'tool_use').map(t => ({ name: t.name, command: t.input?.command, raw: JSON.stringify(t.input ?? {}) })),
      };
    },
  },
  codex: {
    bin: opt('codex', 'codex'),
    args: (prompt, s) => ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--dangerously-bypass-hook-trust', '-c', `sandbox_workspace_write.writable_roots=${JSON.stringify([s.home])}`, ...(MODEL ? ['-m', MODEL] : []), prompt],
    home(dir, s) {
      const auth = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json');
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(auth)) fs.symlinkSync(auth, path.join(dir, 'auth.json'));
      if (s.lessloc) userHooks('codex', true, path.join(dir, 'hooks.json'), path.join(s.plugin, 'hook.mjs'));
      return { CODEX_HOME: dir, ...(process.env.OPENAI_API_KEY && !process.env.CODEX_API_KEY ? { CODEX_API_KEY: process.env.OPENAI_API_KEY } : {}) };
    },
    parse(events) {
      const usage = events.filter(e => e.type === 'turn.completed').map(e => e.usage), items = events.filter(e => e.type === 'item.completed').map(e => e.item);
      const [input, cached, output] = ['input_tokens', 'cached_input_tokens', 'output_tokens'].map(k => sum(usage.map(u => u[k] || 0))), price = opt('price')?.split(',').map(Number);
      return usage.length && {
        cost: price ? ((input - cached) * price[0] + cached * price[1] + output * price[2]) / 1e6 : undefined,
        turns: items.filter(i => /^(command_execution|file_change|mcp_tool_call)$/.test(i.type)).length, failed: events.some(e => e.type === 'turn.failed' || e.type === 'error'), limited: !events.some(e => e.type === 'turn.completed') && events.some(e => /^(turn\.failed|error)$/.test(e.type) && LIMIT.test(JSON.stringify(e))),
        input, output, calls: items.filter(i => /^(command_execution|file_change|mcp_tool_call)$/.test(i.type)).map(i => ({ name: i.type === 'command_execution' ? 'Bash' : i.type, command: i.command, raw: JSON.stringify(i) })),
      };
    },
  },
  opencode: {
    bin: opt('opencode', 'opencode'),
    args: (prompt, s, session) => ['run', '--standalone', '--auto', '--format', 'json', '-m', MODEL, ...(session ? ['--session', session] : []), prompt],
    // `opencode run` shuts down within a fraction of a second of the turn's end, before the bridge plugin's turn review can
    // send the agent back. A long-running OpenCode lets the plugin do it; here the harness does the same: it asks lessloc's
    // turn review and, if the review stops the turn, continues the same session once with its findings.
    followup(cwd, s, events) {
      const sid = events.find(e => e.sessionID)?.sessionID;
      if (!s.lessloc || !sid) return null;
      const r = spawnSync('node', [path.join(s.plugin, 'hook.mjs'), '--host', 'opencode'], { cwd, input: JSON.stringify({ hook_event_name: 'Stop', session_id: sid, cwd }), env: { ...process.env, ...s.env }, encoding: 'utf8' });
      try {
        const out = JSON.parse(r.stdout || '{}');
        return out.block ? { prompt: out.block, session: sid } : null;
      } catch { return null; }
    },
    home(dir, s) {
      fs.mkdirSync(dir, { recursive: true });
      return { XDG_CONFIG_HOME: dir, OPENCODE_DISABLE_PROJECT_CONFIG: '1', ...(s.lessloc ? { OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugins: [path.join(s.plugin, 'opencode')] }) } : {}) };
    },
    parse(events) {
      const steps = events.filter(e => e.type === 'step_finish').map(e => e.part), tokens = k => sum(steps.map(k));
      return steps.length && {
        cost: tokens(p => p.cost || 0), turns: steps.length, failed: events.some(e => e.type === 'error'), limited: events.at(-1)?.type === 'error' && LIMIT.test(JSON.stringify(events.at(-1))),
        input: tokens(p => (p.tokens?.input || 0) + (p.tokens?.cache?.read || 0) + (p.tokens?.cache?.write || 0)), output: tokens(p => p.tokens?.output || 0),
        calls: events.filter(e => e.type === 'tool_use').map(e => ({ name: OPENCODE_TOOLS[e.part.tool] || e.part.tool, command: e.part.state?.input?.command, raw: JSON.stringify(e.part.state?.input ?? {}) })),
      };
    },
  },
};
export const H = HOSTS[HOST];
export function checkArms(arms) {
  const old = !arms.some(a => a.includes('lessloc-old')) || fs.existsSync(path.join(opt('old') || '', 'hook.mjs'));
  if (H && old && (HOST !== 'opencode' || MODEL)) return;
  console.error('--host is claude, codex or opencode; opencode needs --model provider/model; lessloc-old needs --old <lessloc checkout>');
  process.exit(2);
}
const sessions = new Set();
// Each agent sees only its own processes when bubblewrap is installed: an agent's `pkill -f <pattern>` would otherwise end
// other timelines' agents, their test runs, or the run itself. LESSLOC_BENCH_SHARED_PIDS turns this off.
const ISOLATE = !process.env.LESSLOC_BENCH_SHARED_PIDS && spawnSync('bwrap', ['--version']).status === 0;
// Each agent runs in a process group of its own: a signal its commands send to their group reaches no other timeline, and
// ending a session ends everything it started.
const end = p => { try { process.kill(-p.pid, 'SIGTERM'); } catch { p.kill(); } };
// A run that is stopped, or fails (as on a full disk), ends the sessions still going: no agent outlives it.
process.on('exit', () => sessions.forEach(end));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (console.error(`stopped by ${sig}`), process.exit(1)));

// One run of the agent tool: its events, parsed, and its wall time. Its output goes straight to files: the runner grades
// with blocking calls, and output left in a full pipe meanwhile can be lost when the agent exits, its result with it.
function once(cwd, args, s) {
  return new Promise(resolve => {
    const io = path.join(os.tmpdir(), `lessloc-session-${Math.random().toString(36).slice(2)}`), fds = ['out', 'err'].map(x => fs.openSync(`${io}.${x}`, 'w'));
    // PWD too: OpenCode takes its project folder from it, not from the process's folder, and would otherwise work in the
    // folder the benchmark was started from (lessloc's own checkout, with the hidden tests in it).
    const bin = H.bin, iso = ISOLATE && ['--dev-bind', '/', '/', '--unshare-pid', '--die-with-parent', '--proc', '/proc', bin, ...args];
    const started = Date.now(), p = spawn(iso ? 'bwrap' : bin, iso || args, { cwd, env: { ...process.env, ...s.env, PWD: cwd }, stdio: ['ignore', ...fds], detached: true });
    fds.forEach(fd => fs.closeSync(fd));
    sessions.add(p);
    let timedOut = false;
    const timer = setTimeout(() => ((timedOut = true), end(p)), 20 * 60e3);
    p.on('close', (code, signal) => {
      clearTimeout(timer);
      sessions.delete(p);
      // The end of what the tool printed to stderr: why a session that left no result ended.
      const [out, err] = ['out', 'err'].map(x => fs.readFileSync(`${io}.${x}`, 'utf8'));
      const events = out.split('\n').flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }), r = H.parse(events);
      // A session that left no result keeps its raw output beside the results, to see how it ended.
      if (!r) ['out', 'err'].forEach(x => fs.copyFileSync(`${io}.${x}`, path.join(KEEP, `lessloc-lost-${process.pid}-${path.basename(io)}.${x}`)));
      ['out', 'err'].forEach(x => fs.rmSync(`${io}.${x}`, { force: true }));
      resolve({ events, r, sec: (Date.now() - started) / 1000, timedOut, err: err.slice(-1000).trim() || `${signal ? `killed by ${signal}` : `exit code ${code}`}, nothing on stderr, ${events.length} events${events.length ? `, the last ${events.at(-1).type}` : ''}` });
    });
  });
}
const TEST_RUN = /unittest|pytest|npm test|node --test|make test|cargo test|go test|lessloc\.mjs"?\s+test/;
const touches = s => new RegExp([LESSLOC, s.plugin, s.env?.LESSLOC_STATE].filter(Boolean).map(esc).concat('lessloc\\.mjs').join('|'));
// The working tree as one tree object, and back: a session cut off by a usage limit is run again from where it started.
const tree = cwd => {
  const idx = path.join(os.tmpdir(), `lessloc-bench-index-${process.pid}-${Math.random().toString(36).slice(2)}`), env = { ...process.env, GIT_INDEX_FILE: idx };
  try {
    execFileSync('git', ['add', '-A'], { cwd, env, stdio: 'ignore' });
    return execFileSync('git', ['write-tree'], { cwd, env, encoding: 'utf8' }).trim();
  } finally { fs.rmSync(idx, { force: true }); }
};
function restore(cwd, t) {
  const idx = path.join(os.tmpdir(), `lessloc-bench-index-${process.pid}-${Math.random().toString(36).slice(2)}`), env = { ...process.env, GIT_INDEX_FILE: idx };
  try {
    execFileSync('git', ['read-tree', t], { cwd, env, stdio: 'ignore' });
    for (const f of execFileSync('git', ['ls-files', '-o', '--exclude-standard', '-z'], { cwd, env, encoding: 'utf8' }).split('\0').filter(Boolean)) fs.rmSync(path.join(cwd, f), { force: true });
    execFileSync('git', ['checkout-index', '-a', '-f'], { cwd, env, stdio: 'ignore' });
  } finally { fs.rmSync(idx, { force: true }); }
}
const pause = ms => new Promise(r => setTimeout(r, ms));
// How long until a limit the tool names ends ("resets 4:30pm (America/Los_Angeles)"), plus a minute; null when it names no time.
function untilReset(text, now = new Date()) {
  const m = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b(?:\s*\(([^)]+)\))?/i.exec(text || '');
  if (!m) return null;
  try {
    const at = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: m[4], hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
    const left = ((Number(m[1]) % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0)) * 60 + Number(m[2] || 0) - (Number(at.hour) * 60 + Number(at.minute));
    // A session limit lasts at most five hours: a reset further off than that has already passed.
    const mins = (left + 1440) % 1440;
    return (mins > 330 ? 1 : mins + 1) * 60e3;
  } catch { return null; }
}
// lessloc's records of a cut-off attempt go too, or the rerun would be told another session is busy in those very files.
function forget(s, since) {
  const state = s.env?.LESSLOC_STATE;
  if (!state || !fs.existsSync(state)) return;
  for (const d of fs.readdirSync(state)) for (const sub of ['sessions', 'ledger']) {
    const dir = path.join(state, d, sub);
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (fs.statSync(path.join(dir, f)).mtimeMs >= since) fs.rmSync(path.join(dir, f), { force: true });
  }
}
export async function session(cwd, prompt, s) {
  const start = tree(cwd);
  for (let attempt = 0; ; attempt++) {
    const startedAt = Date.now(), r = await attemptSession(cwd, prompt, s);
    // A full disk fails sessions and grading alike, so the scores would be wrong: the run stops.
    // Only the tool's own error counts: an agent may mention a full disk in its answer.
    if (/disk quota|no space left|EDQUOT|ENOSPC/i.test(`${r.error || ''} ${r.failed ? r.said || '' : ''}`)) throw new Error(`the disk is full: ${r.error || r.said}`);
    if (!(r.limited || (r.lost && attempt < 3)) || attempt >= 12) return { ...r, retries: attempt, startedAt };
    const backoff = Math.min(60, 2 ** (attempt + 1)) * 60e3, wait = r.limited ? untilReset(r.said) || backoff : backoff;
    console.error(`${r.limited ? 'usage limit' : `no result from the agent tool (${s.name}: ${r.error || 'it printed nothing'})`}; retrying in ${Math.round(wait / 60e3)} min`);
    restore(cwd, start);
    forget(s, startedAt);
    await pause(wait);
  }
}
// The tokens a session spent before it was cut off or left no result, from the messages it streamed: it has no cost of its
// own, so its tokens are kept for pricing it like the others (priceCutOffs).
const cutOff = runs => {
  const u = runs.flatMap(x => x.events).filter(e => e.type === 'assistant').map(e => e.message?.usage || {});
  return { input: sum(u.map(x => (x.input_tokens || 0) + (x.cache_read_input_tokens || 0) + (x.cache_creation_input_tokens || 0))), output: sum(u.map(x => x.output_tokens || 0)) };
};
// One attempt at a task's session, plus the one follow-up a host's harness sends when the host cannot send it itself.
async function attemptSession(cwd, prompt, s) {
  const runs = [await once(cwd, H.args(prompt, s), s)], next = runs[0].r && !runs[0].r.limited && H.followup?.(cwd, s, runs[0].events);
  if (next) runs.push(await once(cwd, H.args(next.prompt, s, next.session), s));
  if (runs.some(x => !x.r)) return { cost: 0, sec: sum(runs.map(x => x.sec)), turns: 0, ...cutOff(runs), timedOut: runs.some(x => x.timedOut), reads: 0, searches: 0, testRuns: 0, failed: true, lost: runs.some(x => !x.r && !x.timedOut), error: runs.find(x => !x.r)?.err.trim().split('\n').at(-1)?.slice(0, 300) };
  const calls = runs.flatMap(x => x.r.calls), bash = calls.filter(t => t.name === 'Bash').map(t => t.command || '');
  const add = k => (runs.some(x => x.r[k] !== undefined) ? sum(runs.map(x => x.r[k] || 0)) : undefined);
  // An error before any token was spent (the service failing, not the agent) is no result either: it is tried again.
  const unspent = x => x.r.failed && !(x.r.cost > 0 || x.r.input + x.r.output > 0);
  return {
    lost: runs.some(x => unspent(x) && !x.r.limited), error: runs.find(unspent)?.r.said?.slice(0, 300),
    sec: sum(runs.map(x => x.r.sec ?? x.sec)), cost: add('cost'), turns: add('turns'), input: add('input'), output: add('output'), failed: runs.some(x => x.r.failed), limited: runs.some(x => x.r.limited), said: runs.map(x => x.r.said).filter(Boolean).at(-1), followups: runs.length - 1,
    reads: calls.filter(t => t.name === 'Read').length + bash.filter(c => /\b(cat|head|tail|sed -n)\b/.test(c)).length,
    searches: calls.filter(t => /^(Grep|Glob)$/.test(t.name)).length + bash.filter(c => /\b(grep|rg|find|ls|tree)\b/.test(c)).length,
    testRuns: bash.filter(c => TEST_RUN.test(c)).length,
    // What the agent did, step by step (a tool's name, or a shell command), so a held turn or an extra turn can be traced.
    steps: calls.map(t => (t.name === 'Bash' ? `$ ${String(t.command || '').slice(0, 160)}` : t.name)),
    // Calls in which the agent touched lessloc itself: ran it, or read its plugin folder or its state. An invisible lessloc
    // scores 0. Matched by location, since the benchmark's own repositories have lessloc in their names.
    visible: calls.filter(t => touches(s).test(t.raw || t.command || '')).length,
  };
}

// What lessloc did during one session, from its own logs in the timeline's state folder: the turns its review sent back, the
// tokens it added to the agent's context, its hooks' time, and the findings it reported to the agent, by kind.
const list = dir => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
export function hookLog(state, since) {
  const r = { stops: 0, said: 0, hookMs: 0, kinds: {}, held: [] };
  for (const d of list(state).map(x => path.join(state, x))) {
    for (const [event, ms, tokens, at] of (fs.existsSync(path.join(d, 'cost.log')) ? fs.readFileSync(path.join(d, 'cost.log'), 'utf8') : '').split('\n').map(l => l.split(' '))) {
      if (!(Number(at) >= since)) continue;
      Object.assign(r, { said: r.said + Number(tokens), hookMs: r.hookMs + Number(ms), stops: r.stops + (event === 'Stop' && Number(tokens) > 0) });
    }
    for (const f of list(path.join(d, 'sessions')).filter(x => x.endsWith('.log')).map(x => path.join(d, 'sessions', x)).filter(x => fs.statSync(x).mtimeMs >= since)) {
      // What the agent was told, by kind: `noted` right after a write, `held` at the end of a turn; and what held its turns,
      // word for word.
      const log = fs.readFileSync(f, 'utf8');
      for (const m of log.matchAll(/^(?:noted|held) ([\w-]+)\|/gm)) r.kinds[m[1]] = (r.kinds[m[1]] || 0) + 1;
      r.held.push(...[...log.matchAll(/^held (.+)$/gm)].map(m => m[1]));
    }
  }
  return r;
}

const version = (cmd, args) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return 'unknown'; }
};
export const versions = {
  host: HOST,
  model: MODEL ?? `${HOST}'s default`,
  [HOST]: version(H.bin, ['--version']),
  lessloc: JSON.parse(fs.readFileSync(path.join(LESSLOC, 'package.json'), 'utf8')).version,
  ...(opt('old') ? { 'lessloc-old': JSON.parse(fs.readFileSync(path.join(opt('old'), 'package.json'), 'utf8')).version } : {}),
};
// Exactly which code ran: the harness's own commit, and for each arm its switches and, for a lessloc arm, its checkout's commit
// and a hash of its uncommitted diff. An arm's name alone never says which lessloc it was.
const commitOf = dir => { try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const dirtyOf = dir => { try { const d = execFileSync('git', ['-C', dir, 'diff', 'HEAD'], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }); return d ? createHash('sha1').update(d).digest('hex').slice(0, 12) : ''; } catch { return null; } };
export const identity = arms => ({ harness: { commit: commitOf(LESSLOC), dirty: dirtyOf(LESSLOC) }, arms: Object.fromEntries(arms.map(a => { const s = setup(a); return [a, { off: s.env.LESSLOC_OFF || '', ...(s.plugin ? { plugin: s.plugin, commit: commitOf(s.plugin), dirty: dirtyOf(s.plugin) } : {}) }]; })) });

export const med = xs => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const fmt = x => (Number.isInteger(x) ? String(x) : x.toFixed(x < 10 ? 2 : 0));
export const summarize = (runs, f) => {
  const xs = runs.map(f).filter(x => x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  if (!xs.length) return 'none passed';
  return `${fmt(med(xs))}${xs.length > 1 ? ` [${fmt(xs[0])}–${fmt(xs.at(-1))}]` : ''}${xs.length < runs.length ? ` (n=${xs.length})` : ''}`;
};
