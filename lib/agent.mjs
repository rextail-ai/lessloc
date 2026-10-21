// Agent hooks: what an agent is told, stopped from and asked to finish, event by event. lessloc only watches what the agent
// already does (its prompt, its writes, its own test runs, its last message) and steps in where acting is cheapest; every word
// the agent reads comes from lib/voice.mjs. lib/hosts.mjs maps each agent tool's protocol onto these handlers.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { classify, clip, isCode, relevant, typeLines } from './text.mjs';
import { DEFAULTS, GENERATED, POLICY, SKIP, changes, config, evidence, git, gitOrNull, glob, headTree, index, junk, load, logError, mentioned, posix, pruneStates, record, recordCost, save, snapshot, stateDir, testCommand, topOf, trim } from './repo.mjs';
import { changedDefinitions, coversEvery, familiesFor, outcome, readOnly, testDefinition, testRun, testRuns } from './evidence.mjs';
import { anchors, present, unfinished } from './requirements.mjs';
import { RULES_MARK, parse } from './hosts.mjs';
import { review, summary } from './review.mjs';
import * as V from './voice.mjs';

const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
// Writes whose files are known from the snapshots around them: patches, deletions, and writes whose input lessloc cannot read.
const SNAPSHOTTED = /^(Write|Edit|MultiEdit|NotebookEdit|apply_patch|Delete)$/;
const MCP_WRITE = /^mcp__.*(write|edit|create|patch|move|rename|delete|apply)/i;
// Commands that skip the project's own checks (git hooks, lessloc): the user decides that, never the agent alone.
const GIT = String.raw`\bgit(?:\s+(?:-[cC]\s+\S+|-(?![cC]\s)\w[\w-]*(?:=\S+)?|--[\w-]+(?:=\S+)?))*\s+`;
const BYPASS = new RegExp(String.raw`${GIT}(?:commit|push|merge|rebase|am|cherry-pick)\b[^\n|;&]*\s(--no-veri(?:fy?)?)\b|${GIT}commit\b[^\n|;&]*\s(-[a-zA-Z]*n[a-zA-Z]*)\b|(?:^|[\s;&|])(HUSKY=0|SKIP=\S+|LESSLOC=off|LESSLOC_OFF=\S+)\s+\S|\bgit\s[^\n|;&]*?(core\.hooksPath)\b`);
// Problems worth the agent's attention right after the write that made them, while the code is still open: a credential, a
// swallowed error, an import the project forbids. They are found in the written lines alone; copies need the whole codebase,
// which takes seconds per write on a large repository, so they wait for the end of the turn with everything else.
const NOTE_NOW = new Set(['secret', 'swallowed-error', 'boundary']);

const sessions = top => path.join(stateDir(top), 'sessions');
const safe = s => String(s).replace(/[^\w-]/g, '_').slice(0, 80);
const stateOf = (top, sid) => path.join(sessions(top), `${safe(sid)}.json`);
const logOf = (top, sid) => path.join(sessions(top), `${safe(sid)}.log`);
const sidecar = (top, sid, kind, id) => path.join(sessions(top), `${safe(sid)}.${kind}.${safe(id || 'none')}`);
const logSize = (top, sid) => {
  try { return fs.statSync(logOf(top, sid)).size; } catch { return 0; }
};
// The session journal is append-only, so hooks running at once (parallel tools, background subagents) never lose each other's lines.
const note = (top, sid, ...lines) => {
  fs.mkdirSync(sessions(top), { recursive: true });
  fs.appendFileSync(logOf(top, sid), lines.map(l => l + '\n').join(''));
};
function journal(top, sid, from = 0) {
  let buf = Buffer.alloc(0);
  try { buf = fs.readFileSync(logOf(top, sid)); } catch { /* no journal yet */ }
  const j = { touched: new Set(), by: new Map(), asked: [], noted: new Set(), held: new Set() };
  let at = 0;
  for (const line of buf.toString('utf8').split('\n')) {
    const turn = at >= from, [op, who, ...rest] = line.split(' '), arg = rest.join(' ');
    at += Buffer.byteLength(line) + 1;
    if (op === 'noted' || op === 'held') j[op].add(`${who} ${arg}`.trim());
    else if (op === 'ask' && turn) j.asked.push(`${who} ${arg}`.trim());
    else if (op === 'touch') {
      if (!j.by.has(who)) j.by.set(who, new Set());
      j.by.get(who).add(arg);
      if (turn) j.touched.add(arg);
    }
  }
  return j;
}
const rel = (root, f) => posix(path.relative(root, path.resolve(root, f)));
const readSafe = f => {
  try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
};

// The working standard is in the agent's memory already when `init --rules` put this version's text in AGENTS.md, and Claude
// Code loads AGENTS.md itself unless a CLAUDE.md shadows it without importing it.
const RULES_BLOCK = /<!-- lessloc -->\n?([\s\S]*?)\n?<!-- \/lessloc -->/;
const rulesInMemory = root => {
  const read = f => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf8') : null), current = t => RULES_BLOCK.exec(t || '')?.[1]?.trim() === V.STANDARD;
  const agents = read('AGENTS.md'), claude = read('CLAUDE.md');
  return current(claude) || (current(agents) && (claude == null || claude.includes('@AGENTS.md')));
};
// A host whose session start reaches no model reads the standard from the user-level rules file `init` wrote for it.
const inUserRules = caps => !!caps.rules && RULES_MARK.exec(readSafe(caps.rules()))?.[1]?.trim() === V.STANDARD;
// The session start text such a host has not yet delivered, taken once by the first channel that reaches the model.
function takeStart(c) {
  const st = c.top ? load(stateOf(c.top, c.sid)) : {};
  if (!st.pendingStart) return '';
  save(stateOf(c.top, c.sid), { ...st, pendingStart: '' });
  return st.pendingStart;
}
// A host whose tool and stop hooks name no session: they belong to the session that started last in this checkout.
function lastSession(top, sid) {
  const f = path.join(sessions(top), 'last');
  if (sid !== 'default') return save(f, { sid }), sid;
  return load(f).sid || sid;
}
// Existing code a task may need, found by name, only when a specific word of a name matches.
const hints = (top, text) => (text && !/^\s*</.test(text) ? V.existing(relevant(index(top), text, 5, true)) : '');

// What the last session left uncommitted: its task, files, verification and open problems, in its own words.
const ledger = top => path.join(stateDir(top), 'ledger');
const mtime = f => {
  try { return fs.statSync(f).mtimeMs; } catch { return 0; }
};
function handoff(top, sid) {
  const e = safeList(ledger(top)).map(f => load(path.join(ledger(top), f))).filter(x => x.sid && x.sid !== sid).sort((a, b) => a.at - b.at).at(-1);
  return e && Date.now() - e.at < 14 * 864e5 && git(top, ['status', '--porcelain', '--', ...e.files]) ? V.handoff(e, Math.round((Date.now() - e.at) / 36e5)) : '';
}

// The edit gate: placeholders, commented-out code and junk files never land; lessloc policy and protected paths go to the
// user for approval.
function gate(root, cfg, prompt = '', writes) {
  const deny = [], ask = [];
  for (const w of writes) {
    const f = rel(root, w.file);
    if (f.startsWith('..') || path.isAbsolute(f) || SKIP.test(f) || cfg.allow.some(g => glob(g).test(f))) continue;
    if (POLICY.test(f) || cfg.protect.some(g => glob(g).test(f))) ask.push({ file: f });
    if (!fs.existsSync(path.resolve(root, w.file)) && junk(f, x => fs.existsSync(path.join(root, x))) && !mentioned(f, prompt)) deny.push({ kind: 'junk', file: f });
    if (!isCode(f) || GENERATED.test(w.after.slice(0, 400))) continue;
    const old = new Map();
    for (const s of w.before.split('\n')) old.set(s.trim(), (old.get(s.trim()) || 0) + 1);
    for (const l of typeLines(f, w.after)) {
      if (old.get(l.t) > 0) { old.set(l.t, old.get(l.t) - 1); continue; }
      const k = classify(l);
      if (k === 'placeholder' || k === 'commented-out') deny.push({ kind: k, file: f, text: l.t });
    }
  }
  return { deny, ask };
}
function toolWrites(tool, ti) {
  const file = ti.file_path || ti.notebook_path;
  if (!file) return [];
  if (tool === 'Write') return [{ file, before: readSafe(file), after: String(ti.content ?? '') }];
  if (tool === 'NotebookEdit') return [{ file, before: '', after: '' }];
  return (ti.edits || [ti]).map(e => ({ file, before: String(e.old_string ?? ''), after: String(e.new_string ?? '') }));
}
// Files a shell command writes from a heredoc (`cat > f <<EOF`, `tee f <<EOF`): agents write code this way too.
function heredocWrites(cmd, cwd) {
  const res = [];
  for (const m of cmd.matchAll(/<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/g)) {
    const eol = cmd.indexOf('\n', m.index);
    if (eol < 0) continue;
    const line = cmd.slice(cmd.lastIndexOf('\n', m.index) + 1, eol).replace(m[0], ' '), rest = cmd.slice(eol + 1), end = new RegExp(`^[\\t ]*${m[2]}[\\t ]*$`, 'm').exec(rest);
    const target = /(?:^|[\s;&|])(>>?)\s*(['"]?)([^\s'"<>|;&]+)\2/.exec(line) || /\btee\s+(?:(-a)\s+)?(['"]?)([^\s'"<>|;&]+)\2/.exec(line);
    if (!end || !target) continue;
    const file = path.resolve(cwd, target[3]), before = readSafe(file), body = rest.slice(0, end.index);
    res.push({ file, before, after: target[1] === '>>' || target[1] === '-a' ? `${before}\n${body}` : body });
  }
  return res;
}

// The files a patch writes, in the format Codex's apply_patch and OpenCode's patch tool share: `*** Add File:`, `*** Update File:`
// (optionally `*** Move to:`) and `*** Delete File:` sections of +/- lines.
function patchWrites(text, cwd) {
  const res = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const h = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line), to = /^\*\*\* Move to: (.+)$/.exec(line);
    if (h) res.push((cur = { file: path.resolve(cwd, h[2].trim()), del: h[1] === 'Delete', before: [], after: [] }));
    else if (to && cur) cur.file = path.resolve(cwd, to[1].trim());
    else if (cur && /^[+-]/.test(line)) cur[line[0] === '+' ? 'after' : 'before'].push(line.slice(1));
  }
  return res.map(w => ({ file: w.file, before: w.del ? readSafe(w.file) : w.before.join('\n'), after: w.after.join('\n') }));
}
// Where a host cannot put a decision to the user, the agent is told to ask instead of the call going through unasked.
const askUser = (c, words) => {
  if (c.caps.ask) c.out.ask = words.user;
  else c.out.deny = words.agent;
};

const H = {
  SessionStart(c) {
    const { top, cfg, sid, input, off } = c, source = input.source || 'startup';
    if (top && source !== 'compact') {
      prune(top);
      save(stateOf(top, sid), { ...(source === 'resume' ? load(stateOf(top, sid)) : {}), base: snapshot(top, sid), from: logSize(top, sid) });
    }
    c.out.context = [
      !off.has('rules') && !rulesInMemory(top || c.cwd) && !inUserRules(c.caps) && V.STANDARD,
      top && V.constraints(cfg),
      top && source !== 'compact' && !off.has('handoff') && handoff(top, sid),
    ].filter(Boolean).join('\n\n');
    if (c.caps.start === false) {
      if (top) save(stateOf(top, sid), { ...load(stateOf(top, sid)), pendingStart: c.out.context });
      c.out.context = '';
    }
  },
  UserPromptSubmit(c) {
    const { top, sid, input, off } = c, prompt = String(input.prompt || ''), system = /^\s*</.test(prompt);
    if (!top) return;
    const st = load(stateOf(top, sid)), context = off.has('reuse') ? '' : hints(top, prompt);
    // The turn starts here: its changes are measured from this state, and how the tests run is pinned to what it is now. A host
    // whose prompts take no context gets the hints with the first tool result of the turn.
    save(stateOf(top, sid), { ...st, base: snapshot(top, sid), from: logSize(top, sid), defs: testDefinition(top, testCommand(top, c.cfg)), run: null, heldTurn: false, heldAgents: {}, steps: 0, prompt: system && st.prompt ? st.prompt : clip(prompt, 2000), later: c.caps.prompt ? '' : context });
    if (c.caps.prompt) c.out.context = context;
    if (c.caps.start === false && c.caps.prompt) c.out.context = [takeStart(c), c.out.context].filter(Boolean).join('\n\n');
  },
  PreToolUse(c) {
    const { top, sid, input, cfg, off } = c, tool = input.tool_name || '', ti = input.tool_input || {}, root = top || c.cwd;
    if (c.caps.start === false && c.caps.preContext) c.out.context = takeStart(c);
    if (/^(Agent|Task)$/.test(tool)) {
      // The hints go into the subagent's own prompt, so parallel subagents can never receive each other's.
      const h = top && !off.has('reuse') && typeof ti.prompt === 'string' && hints(top, ti.prompt);
      if (h) c.out.input = { ...ti, prompt: `${ti.prompt}\n\n${h}` };
      return;
    }
    const cmd = String(ti.command || ''), here = input.cwd || root, gated = cfg.mode === 'block' && !off.has('gate') && c.caps.gate !== false;
    const writes = WRITE_TOOLS.test(tool) ? toolWrites(tool, ti) : tool === 'Bash' ? heredocWrites(cmd, here) : tool === 'apply_patch' ? patchWrites(cmd, here) : [];
    const skip = tool === 'Bash' && gated && BYPASS.exec(cmd);
    if (skip) askUser(c, V.bypass(skip.slice(1).find(Boolean)));
    if (writes.length && gated) {
      const g = gate(root, cfg, top ? load(stateOf(top, sid)).prompt : '', writes);
      if (g.deny.length) return void (c.out.deny = V.refusal(g.deny));
      if (g.ask.length) {
        askUser(c, V.guarded(g.ask));
        if (top && c.out.ask) note(top, sid, ...g.ask.map(a => `ask ${a.file}`));
      }
    }
    if (!top) return;
    const who = input.agent_id ? safe(input.agent_id) : '-';
    if (WRITE_TOOLS.test(tool) && writes.length) note(top, sid, ...writes.map(w => `touch ${who} ${rel(top, w.file)}`));
    else if (c.caps.track !== 'turn' && (SNAPSHOTTED.test(tool) || (tool === 'Bash' && (!readOnly(cmd) || testRun(cmd, testCommand(top, cfg)))) || MCP_WRITE.test(tool))) save(sidecar(top, sid, 'pending', input.tool_use_id || cmd), snapshot(top, sid));
  },
  PostToolUse: afterTool,
  PostToolUseFailure: afterTool,
  SubagentStart(c) {
    if (c.top && c.input.agent_id) save(sidecar(c.top, c.sid, 'agent', c.input.agent_id), snapshot(c.top, c.sid));
    if (!c.off.has('rules')) c.out.context = V.SUBAGENT;
  },
  SubagentStop: c => c.top && c.input.agent_id && finishWork(c, safe(c.input.agent_id)),
  Stop: c => c.top && (c.caps.turnStart === 'stop' ? nextTurn(c) : finishWork(c, null)),
};
function safeList(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}
// Session files older than a week are leftovers of sessions that ended, as are handoff records older than two weeks; evidence
// keeps the 50 newest trees, the logs their recent lines.
function prune(top) {
  const aged = (dir, days) => safeList(dir).map(f => path.join(dir, f)).filter(p => mtime(p) && Date.now() - mtime(p) > days * 864e5);
  const ev = path.join(stateDir(top), 'evidence'), trees = safeList(ev).map(f => path.join(ev, f)).sort((a, b) => mtime(b) - mtime(a)).slice(50);
  for (const p of [...aged(sessions(top), 7), ...aged(ledger(top), 14), ...trees]) {
    try { fs.rmSync(p, { force: true }); } catch { /* already gone */ }
  }
  trim(top, 'cost.log', 2000);
  trim(top, 'errors.log', 50);
  pruneStates();
}

const LANG = { pytest: 'py', unittest: 'py', tox: 'py', nox: 'py', jest: 'js', vitest: 'js', mocha: 'js', 'node-test': 'js', bun: 'js', deno: 'js', go: 'go', cargo: 'rs', mvn: 'jvm', gradle: 'jvm', dotnet: 'cs', rspec: 'rb', phpunit: 'php', mix: 'ex' };
const EXT_LANG = [[/\.py$/, 'py'], [/\.(m?[jt]sx?|cjs)$/, 'js'], [/\.go$/, 'go'], [/\.rs$/, 'rs'], [/\.(java|kt|kts|scala|groovy)$/, 'jvm'], [/\.cs$/, 'cs'], [/\.rb$/, 'rb'], [/\.php$/, 'php'], [/\.exs?$/, 'ex']];
// The languages of the code a turn changed up to `tree`.
function changedLanguages(top, base, tree) {
  const names = base && tree ? (gitOrNull(top, ['diff', '--name-only', '-z', base, tree]) ?? '').split('\0').filter(Boolean) : [];
  return new Set(names.map(f => EXT_LANG.find(([re]) => re.test(f))?.[1]).filter(Boolean));
}

// The agent's own test runs are the evidence: each recognized run is kept with the tree it ran on and its result as the host
// reported it. The tree is the one before the command when nothing ahead of the runner can change files or leave this
// checkout, the one after it when nothing behind the runner can, and otherwise unknown. A pass counts when the whole suite
// of the project's own runner ran; a failure always counts. The hook writes it, outside any sandbox the agent's commands run in.
function observeTests(c, cmd, before, after) {
  const { top, sid, input, cfg } = c, conf = testCommand(top, cfg), runs = testRuns(cmd, conf);
  if (!runs.length) return;
  // Where each run ran: the host's folder, every `cd` before it, and any folder option of the runner. Outside this checkout
  // it proves nothing here; in one of its subfolders (a package of a monorepo) it ran a part. The state it ran on: the one
  // before the command when only reading commands precede it, the one after when only reading commands follow it.
  const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }, home = real(top);
  let py;
  const pyFiles = () => (py ??= (gitOrNull(top, ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.py']) ?? '').split('\n').filter(Boolean));
  const placed = runs.map(run => {
    let dir = real(input.cwd || top);
    for (const st of run.before) {
      if (!/^\s*(cd|pushd)(\s|$)/.test(st)) continue;
      const to = (st.trim().match(/'[^']*'|"(?:\\.|[^"\\])*"|\S+/g) || [])[1]?.replace(/^(['"])([\s\S]*)\1$/, '$2');
      dir = !to || to.startsWith('~') ? '' : /^\$\(\s*git rev-parse --show-toplevel\s*\)$/.test(to) ? home : to.includes('$') ? '' : real(path.resolve(dir, to));
    }
    for (const d of run.dirs || []) dir = dir && !d.includes('$') ? real(path.resolve(dir, d)) : '';
    const where = dir && path.relative(home, dir), inside = dir && !where.startsWith('..') && !path.isAbsolute(where);
    if (inside && where && !/^(tests?|specs?|testing)$/.test(where)) run.scope = 'targeted';
    else if (inside && !where && run.scope === 'targeted' && coversEvery(run, pyFiles())) run.scope = 'full';
    return { run, tree: !inside ? null : run.before.every(st => readOnly(st)) ? before : run.after.every(st => readOnly(st)) ? after : null };
  });
  // A command may run the tests more than once (stash the fix, watch them fail, restore it, run them again): the latest
  // whole-suite run that can be tied to a state speaks for it.
  const full = placed.filter(x => x.run.scope === 'full'), { run, tree } = [...full].reverse().find(x => x.tree) ?? full[0] ?? placed[0];
  // A configured command lessloc cannot read (a project script) may run more than any one runner: only it verifies. A
  // discovered one is a guess in a repository with tests in several languages, so there the run must test the language the
  // turn changed: a jest run says nothing about a Python change, and a pytest run counts for one even beside `npm test`.
  const families = familiesFor(top, conf), langs = c.cfg.test ? null : changedLanguages(top, load(stateOf(top, sid)).base, before);
  let ours = run.family === 'configured' || (families.length ? families.includes(run.family) : !conf);
  if (langs?.size && LANG[run.family]) ours = langs.has(LANG[run.family]);
  if (families.several && run.family !== families.own) run.scope = 'targeted';
  const ti = input.tool_input || {}, failure = String(input.failure_type || input.error_type || '');
  const same = runs.filter(r => r.family === run.family);
  const ok = !tree ? null : outcome({ ...run, index: same.indexOf(run), count: same.length, failed: c.failed, passed: c.passed, response: input.tool_response ?? input.tool_output, error: input.error ?? input.error_message, interrupted: run.background || ti.run_in_background === true || input.is_interrupt === true || /timeout|permission|denied|abort|interrupt/i.test(failure) });
  const counted = ok === false || (ok === true && run.scope === 'full' && ours);
  if (counted) record(top, tree, { test: clip(cmd, 200), ok, at: new Date().toISOString(), where: 'working tree (run by the agent)' });
  save(stateOf(top, sid), { ...load(stateOf(top, sid)), run: { cmd: clip(cmd, 200), tree: tree || after, ok, masked: run.masked, scope: run.scope, counted, other: !ours, unclear: !tree || (same.length > 1 && ok == null) }, ...(counted ? { full: { tree, ok, test: clip(cmd, 200) } } : {}) });
}

// Tool calls in one turn after which the agent is told, once, to finish what works: past what almost every task takes
// (sessions' 99th percentile is about 44 turns), and well before a run that never ends.
const PACE = 40;

// Right after each write (Write, Edit, a shell command, a writing MCP tool): which files changed, and whether the lines just
// written hold a problem that is cheapest to fix now.
function afterTool(c) {
  const { top, sid, input, cfg, off } = c, tool = input.tool_name || '', ti = input.tool_input || {}, cmd = String(ti.command || '');
  if (!top) return;
  const st = load(stateOf(top, sid)), writes = WRITE_TOOLS.test(tool) ? toolWrites(tool, ti) : [], steps = (st.steps || 0) + 1;
  save(stateOf(top, sid), { ...st, steps, later: '' });
  const now = [st.later, steps === PACE && !off.has('pace') && V.pace].filter(Boolean).join('\n\n');
  if (now) c.out.feedback = now;
  let list, from, to;
  if (writes.length) {
    if (c.failed || !st.base || off.has('lines') || c.caps.feedback === false) return;
    [from, to] = [st.base, snapshot(top, sid)];
    list = changes(top, from, to, new Set(writes.map(w => rel(top, w.file))));
  } else {
    const pending = sidecar(top, sid, 'pending', input.tool_use_id || cmd), before = readSafe(pending);
    if (!before) return;
    fs.rmSync(pending, { force: true });
    const after = snapshot(top, sid);
    if (tool === 'Bash') observeTests(c, cmd, before, after);
    const names = after && after !== before ? git(top, ['diff', '--name-only', '-z', before, after]).split('\0').filter(Boolean) : [];
    if (!names.length) return;
    note(top, sid, ...names.map(f => `touch ${input.agent_id ? safe(input.agent_id) : '-'} ${f}`));
    if (off.has('shell') || c.caps.feedback === false) return;
    [from, to] = [before, after];
    list = changes(top, from, to);
  }
  const j = journal(top, sid), F = review(top, list, cfg, { prompt: st.prompt, agent: true, quick: true, asked: j.asked, from, to }).filter(f => NOTE_NOW.has(f.kind) && !j.noted.has(f.fp)).slice(0, 3);
  if (!F.length) return;
  note(top, sid, ...F.map(f => `noted ${f.fp}`));
  c.out.feedback = [c.out.feedback, V.writeNote(F)].filter(Boolean).join('\n\n');
}

// Whether two trees hold the same code: a test run's caches and a README edit after it do not make it a different state. A
// failed comparison means different.
function sameCode(top, a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const names = gitOrNull(top, ['diff', '--name-only', '-z', a, b]);
  return names != null && !names.split('\0').filter(Boolean).some(isCode);
}

// What the tests say about the final state, and what holds the turn: a failure, or a change to what the tests run (held even
// when no code changed, since that is how checks get weakened). A final state no run verified is only recorded, never held:
// holding for missing evidence costs a turn without changing the code.
function verification(c, st, list, cur) {
  const { top, cfg } = c, cmd = testCommand(top, cfg) || st.full?.test || st.run?.cmd || '';
  // Only this turn's own change to what the tests run counts, and not one the request asked for.
  const mine = new Set(list.map(x => x.file)), redefined = st.defs ? changedDefinitions(st.defs, testDefinition(top, testCommand(top, cfg))).filter(f => mine.has(f) && !mentioned(f, st.prompt || '')) : [], code = list.some(x => isCode(x.file));
  if (!redefined.length && (!code || !cmd)) return { verified: cmd ? 'no code changed' : 'no test command', items: [] };
  const ev = evidence(top, cur) || (sameCode(top, st.full?.tree, cur) ? evidence(top, st.full.tree) : null), items = [];
  // The fingerprint names the reason too, so the session log shows why a turn was held.
  const item = (kind, why, msg) => ({ kind, tier: kind === 'tests-failed' ? 0 : 1, file: '', line: 0, msg, fp: `${kind}|${cur}|${why}` });
  if (ev && !ev.ok) items.push(item('tests-failed', 'failed', V.tests.failed(ev.test)));
  if (redefined.length) items.push(item('unverified', 'redefined', V.tests.redefined(redefined)));
  return { verified: ev && !ev.ok ? 'tests failed' : redefined.length ? 'tests changed' : ev ? 'tests passed' : 'tests not run', items };
}

// Names the turn's request asked to exist that neither the start nor the end of the turn has anywhere in the repository.
export function unaddressed(top, st, cur, list) {
  if (!st.base) return [];
  const added = list.flatMap(c => (c.text || '').split('\n').filter((_, i) => c.added.has(i + 1)));
  return anchors(st.prompt).filter(a => !present(top, cur, a.names, gitOrNull, added) && !present(top, st.base, a.names, gitOrNull))
    .map(a => ({ kind: 'unaddressed', tier: 1, file: '', line: 0, msg: V.missing(a.names), fp: `unaddressed|${a.names.join('|')}` }));
}

// What the agent's last reply says it left failing of the request itself: the reported bug on a sibling path or on the
// report's own input, the same problem suspected elsewhere and not checked. Its own words are the evidence. Only a turn
// that changed code is asked to finish it (an explanation or a plan is the agent's to give), and an item is known by what
// it concerns, the names it quotes, so the same admission reworded in a later turn is not held again.
const leftFailing = (st, said, list) => (list.some(x => isCode(x.file)) ? unfinished(st.prompt, said) : []).map(u => ({ kind: 'unfinished', tier: 1, file: '', line: 0, msg: V.unfinished[u.how](u.quote), fp: `unfinished|${u.how}|${[...new Set(u.quote.match(/`[^`\n]+`/g) || [u.quote.replace(/\W+/g, '_').slice(0, 48)])].sort().join('|').replace(/\s+/g, '_').slice(0, 120)}` }));

// The end of a turn or of a subagent's task: review exactly the files this session (or this subagent) changed and what its
// tests showed, hold the turn once if work is left that the agent can finish, and leave a handoff record. Problems that do not
// hold a turn are not shown; the record keeps them for the next session that finds the changes uncommitted.
function finishWork(c, agent) {
  const { top, sid, input, cfg, off } = c, st = load(stateOf(top, sid)), base = agent ? readSafe(sidecar(top, sid, 'agent', agent)) : st.base;
  if (!base || off.has('review')) return;
  const j = journal(top, sid, agent ? 0 : st.from || 0), cur = snapshot(top, sid);
  const touched = agent ? j.by.get(agent) || new Set() : c.caps.track === 'turn' ? null : j.touched;
  const list = touched?.size === 0 ? [] : changes(top, base, cur, touched);
  const F = list.length ? review(top, list, cfg, { prompt: st.prompt, agent: true, complete: !agent, asked: j.asked, from: base, to: cur }) : [];
  // A subagent's work is often one part of a change, verified when the turn that holds it ends.
  const t = agent || off.has('tests') ? { verified: 'tests not checked', items: [] } : verification(c, st, list, cur);
  F.unshift(...t.items, ...(agent || off.has('requests') ? [] : unaddressed(top, st, cur, list)), ...(agent || off.has('unfinished') ? [] : leftFailing(st, input.last_assistant_message, list)));
  // Each agent is held at most once per turn, whatever its host reports: by the host's own flag, and by lessloc's record.
  const interrupt = new Set(cfg.interrupt), left = F.filter(f => interrupt.has(f.kind) && !j.held.has(f.fp));
  const heldBefore = agent ? st.heldAgents?.[agent] : st.heldTurn, stopped = input.status && input.status !== 'completed';
  if (left.length && !heldBefore && !stopped && !input.stop_hook_active && !(input.loop_count > 0)) {
    note(top, sid, ...left.map(f => `held ${f.fp}`));
    save(stateOf(top, sid), { ...load(stateOf(top, sid)), ...(agent ? { heldAgents: { ...st.heldAgents, [agent]: true } } : { heldTurn: true }) });
    c.out.block = V.hold(summary(list), left);
  }
  if (!agent && list.length) {
    // The record speaks of the session in the third person; what its tests showed is in `verified`, not repeated in `open`.
    const net = list.reduce((s, x) => s + x.added.size - x.removed, 0), open = F.filter(f => f.file).slice(0, 5).map(f => clip(V.line(f), 140));
    save(path.join(ledger(top), `${safe(sid)}.json`), { v: 10, at: Date.now(), sid, prompt: clip(st.prompt || '', 300), files: list.map(x => x.file).slice(0, 20), net, tree: cur, verified: t.verified, open, said: clip(String(input.last_assistant_message || ''), 600) });
  }
}

// The end of a turn for a host with no prompt event: the turn's request comes with its end, and the next turn starts here
// unless this one was held.
function nextTurn(c) {
  if (c.input.prompt) save(stateOf(c.top, c.sid), { ...load(stateOf(c.top, c.sid)), prompt: clip(String(c.input.prompt), 2000) });
  finishWork(c, null);
  if (!c.out.block) H.UserPromptSubmit({ ...c, input: {}, out: {} });
}

const stdin = ms => new Promise(resolve => {
  let data = '';
  const done = () => {
    clearTimeout(timer);
    process.stdin.destroy();
    resolve(data);
  };
  // Some hosts never close stdin: give up waiting after `ms` instead of hanging the agent.
  const timer = setTimeout(done, ms);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => (data += d)).on('end', done).on('error', done);
});

// A host whose row says `twice` may run one event's hooks twice: Cursor also runs the Claude Code plugin's, and Codex both a
// plugin's and its hook file's. Their payloads name the turn or call, so the same payload again within 30 seconds is that
// second run, and gets no answer.
function repeated(top, text) {
  try {
    const dir = path.join(stateDir(top), 'once'), f = path.join(dir, createHash('sha1').update(text).digest('hex'));
    for (const n of safeList(dir)) if (Date.now() - mtime(path.join(dir, n)) > 30000) fs.rmSync(path.join(dir, n), { force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.closeSync(fs.openSync(f, 'wx'));
    return false;
  } catch (e) {
    return e.code === 'EEXIST';
  }
}

// Aider has no hooks. It runs its lint command on each file its model edited, once the edit has landed and before Aider
// commits it, and sends the model what the command prints when it exits non-zero. So what the gate refuses elsewhere, and what
// is cheapest to fix right after a write, comes back as a lint error here, measured from the last commit. The command's input
// is Aider's own terminal, so nothing is read from it.
const LINTED = new Set(['placeholder', 'commented-out', 'junk-file', ...NOTE_NOW]);
export function lint(files, cwd = process.cwd()) {
  const started = Date.now(), top = topOf(cwd);
  if (!top || !files.length || process.env.LESSLOC === 'off') return;
  try {
    const { problems, ...cfg } = config(top), off = new Set((process.env.LESSLOC_OFF || '').split(','));
    if (cfg.mode === 'off') return;
    const from = headTree(top), to = snapshot(top, 'aider'), list = changes(top, from, to, new Set(files.map(f => rel(top, path.resolve(cwd, f)))));
    const F = review(top, list, cfg, { agent: true, quick: true, from, to }).filter(f => LINTED.has(f.kind) && (NOTE_NOW.has(f.kind) ? !off.has('lines') : cfg.mode === 'block' && !off.has('gate')));
    const said = F.length ? `${V.writeNote(F)}\n` : '';
    if (said) fs.writeSync(1, said), (process.exitCode = 1);
    recordCost(top, 'Lint', Date.now() - started, Math.round(said.length / 4), 'aider');
  } catch (e) {
    logError(top, 'Lint', e);
    if (process.env.LESSLOC_DEBUG) console.error(e);
  }
}

// `named`: the event the hook command names, for a host whose payload does not (lib/hosts.mjs).
export async function hook(host, named) {
  const started = Date.now();
  let raw, text;
  try { raw = JSON.parse((text = await stdin(5000)) || '{}'); } catch { return; }
  const p = parse(raw, host, undefined, named), { input, event } = p, top = topOf(p.cwd);
  const { problems, ...cfg } = top ? config(top) : { ...DEFAULTS, problems: [] };
  if (cfg.mode === 'off' || process.env.LESSLOC === 'off') return;
  if (p.caps.twice && top && repeated(top, text)) return;
  if (p.caps.sessionless && top) p.sid = lastSession(top, p.sid);
  const c = { ...p, top, cfg, off: new Set((process.env.LESSLOC_OFF || '').split(',')), out: {} };
  try {
    if (c.caps.sessionStart === 'tool' && top && !fs.existsSync(stateOf(top, c.sid))) H.SessionStart({ ...c, input: {}, out: {} });
    H[event]?.(c);
  } catch (e) {
    // Hooks fail open: a lessloc bug must never block the agent. The error log and `lessloc doctor` make it visible.
    if (top) logError(top, event, e);
    if (process.env.LESSLOC_DEBUG) console.error(e);
  }
  const r = c.caps.reply(c.out, event);
  if (r.stdout) fs.writeSync(1, r.stdout);
  if (r.stderr) fs.writeSync(2, r.stderr);
  if (r.code) process.exitCode = r.code;
  const said = [c.out.context, c.out.block, c.out.feedback, c.out.deny, c.out.input ? c.out.input.prompt.slice(String(input.tool_input?.prompt || '').length) : ''].join('');
  if (top) try { recordCost(top, event, Date.now() - started, Math.round(said.length / 4), p.host === 'claude' ? '' : p.host); } catch { /* cost accounting is best effort */ }
}
