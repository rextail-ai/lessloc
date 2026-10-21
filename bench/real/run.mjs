#!/usr/bin/env node
// The long-horizon benchmark: a real project developed through its next real changes. Every task goes to a fresh agent session
// on the code exactly as earlier agents left it, and is judged by the tests its real change added, which the agent never sees.
// After each task, every earlier task's hidden tests and the project's own suite run again. Cost is reported over the whole
// run and by third, so a cost that grows as agent-written code accumulates shows.
// usage: node bench/real/run.mjs <prepared dir> <clone> [--host claude|codex|opencode] [--model <m>] [--arms none,lessloc]
//                                [--runs 3] [--jobs 3] [--tasks <first n>] [--replay <file>] [--old <dir>]
//                                [--claude <command>] [--codex <command>] [--opencode <command>] [--price <in>,<cached in>,<out>] [--dry-run]
// --model is Claude Code's alias (default sonnet), a Codex model (default: Codex's own) or OpenCode's provider/model (required).
// --price, in dollars per million tokens, gives a cost to hosts that report only tokens (Codex).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { H, HERE, HOST, JOBS, KEEP, RUNS, checkArms, fmt, hookLog, identity, med, opt, priceCutOffs, session, setup, sum, summarize, versions } from '../lib.mjs';
import { overlay } from './hidden.mjs';

const [prepared, clone] = process.argv.slice(2, 4).map(p => path.resolve(p));
const { project: P, startCode, tasks: ALL } = JSON.parse(fs.readFileSync(path.join(prepared, 'tasks.json'), 'utf8'));
const TASKS = ALL.slice(0, Number(opt('tasks', ALL.length))), JUDGED = TASKS.filter(t => t.judged).length, ARMS = (opt('arms') || 'none,lessloc').split(',');
checkArms(ARMS);
const prompt = t => `Resolve this issue in the repository:\n\n${t.text}`;
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// A copy of the project at its start tag with no history past it: the agent can read the past, never the future.
function start(dir) {
  execFileSync('git', ['clone', '-q', '--no-local', '--no-tags', '--single-branch', '--branch', P.start, clone, dir], { stdio: 'ignore' });
  git(dir, 'remote', 'remove', 'origin');
  git(dir, 'switch', '-q', '-c', 'main');
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '.venv/\n');
  const r = runSetup(dir);
  if (r.status) throw new Error(`setup failed: ${r.stderr.slice(-400)}`);
}
// In every arm, the usual ways online fail in the agent's shell: gh, curl and wget on its PATH, git remotes, and pip and uv
// indexes. An agent that fetches the real change measures the fetch, not the tool under test.
const OFFLINE = path.join(HERE, 'real', 'offline'), NO_NETWORK = { GIT_ALLOW_PROTOCOL: 'file', PIP_NO_INDEX: '1', UV_OFFLINE: '1', GH_TOKEN: '', GITHUB_TOKEN: '' };
// The project's setup, tried three times: it fetches dependencies and submodules, and one network hiccup must not end a run.
function runSetup(dir) {
  for (let i = 1; ; i++) {
    const r = spawnSync('bash', ['-c', P.setup], { cwd: dir, encoding: 'utf8' });
    if (!r.status || i === 3) return r;
    spawnSync('sleep', [String(20 * i)]);
  }
}
// Outcome per test id, from pytest's summary; the hidden files exist only while they run. Each timeline grades in a temporary
// folder of its own, so tests that write fixed paths there never collide across timelines running at once. A fixed hash seed
// makes a test that depends on set order give the same code the same grade every time.
function pytest(dir, files, tmp) {
  const r = spawnSync(path.join(dir, P.python), ['-m', 'pytest', '-p', 'no:cacheprovider', '-rA', '-q', '--no-header', ...files], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 900e3, env: { ...process.env, PYTHONHASHSEED: '0', ...(tmp ? { TMPDIR: tmp } : {}) } });
  return { status: r.status, res: Object.fromEntries([...(r.stdout || '').matchAll(/^(PASSED|FAILED|ERROR|XFAIL|XPASS) (\S+)/gm)].map(m => [m[2], m[1]])) };
}
const retired = (e, k) => e.retiredBy && TASKS.findIndex(t => t.id === e.retiredBy) <= k;
// Hidden tests exist only while they are graded, in their real folders, where the project's own test helpers apply.
function grade(dir, k, suite = true, tmp) {
  const t = TASKS[k], earlier = TASKS.slice(0, k).filter(e => e.judged && !retired(e, k)), all = [t, ...earlier].filter(e => e.judged);
  const restore = overlay(dir, all.map(e => path.join(prepared, 'hidden', e.id)));
  const { res } = all.length ? pytest(dir, all.flatMap(e => e.hidden.map(h => h.file)), tmp) : { res: {} };
  restore();
  const ok = e => e.hidden.flatMap(h => h.ids).every(id => res[id] === 'PASSED');
  return { passed: t.judged ? ok(t) : null, regressions: earlier.filter(e => !ok(e)).map(e => e.id), suite: suite && pytest(dir, [], tmp).status === 0 };
}
// Production and test lines, counted the same way for every setup and for the human replay: non-blank lines that are not comments.
const pyCode = text => text.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
const pyFiles = (dir, roots) => roots.flatMap(r => (fs.existsSync(path.join(dir, r)) ? fs.readdirSync(path.join(dir, r), { recursive: true }).filter(f => f.endsWith('.py')).map(f => path.join(dir, r, f)) : []));
const pyLines = (dir, roots) => pyFiles(dir, roots).reduce((n, f) => n + pyCode(fs.readFileSync(f, 'utf8')).length, 0);
// Characters without whitespace: a size that packing statements onto fewer lines cannot shrink.
const pyChars = (dir, roots) => pyFiles(dir, roots).reduce((n, f) => n + pyCode(fs.readFileSync(f, 'utf8')).join('').replace(/\s/g, '').length, 0);
// The same count at a revision of the clone: where the human changes left the code.
const charsAt = rev => git(clone, 'ls-tree', '-r', '--name-only', rev, '--', ...P.source).split('\n').filter(f => f.endsWith('.py')).reduce((n, f) => n + pyCode(git(clone, 'show', `${rev}:${f}`)).join('').replace(/\s/g, '').length, 0);

// The surroundings of every session in one timeline, kept in the timeline's own folder: the tool's config home, lessloc's
// state, and a temporary folder for the agent's commands and Claude Code's own files. The offline commands come first on
// PATH, then the project's virtualenv.
function enter(s, home, repo) {
  const venv = path.join(repo, '.venv'), tmp = path.join(home, 'tmp');
  fs.mkdirSync(tmp);
  s.home = home;
  s.env = { ...s.env, ...H.home(path.join(home, HOST), s), PATH: `${OFFLINE}:${path.join(venv, 'bin')}:${process.env.PATH}`, VIRTUAL_ENV: venv, TMPDIR: tmp, CLAUDE_CODE_TMPDIR: tmp, ...NO_NETWORK, ...(s.lessloc ? { LESSLOC_STATE: path.join(home, 'state') } : {}) };
  return { venv, tmp };
}

async function timeline(arm, run) {
  const s = setup(arm), home = fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-real-home-')), repo = fs.mkdtempSync(path.join(KEEP, `lessloc-real-${arm.replace(/[^\w-]/g, '_')}-`));
  start(repo);
  const { venv, tmp } = enter(s, home, repo);
  const r = { arm, run, repo, start: { code: pyLines(repo, P.source), chars: pyChars(repo, P.source), tests: pyLines(repo, P.tests) }, tasks: [] };
  for (const [k, t] of TASKS.entries()) {
    const since = Date.now(), res = await session(repo, prompt(t), s), g = grade(repo, k, true, tmp);
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.email=bench@lessloc', '-c', 'user.name=bench', 'commit', '-qm', t.id, '--allow-empty', '--no-verify');
    r.tasks.push({ id: t.id, ...res, ...(s.lessloc ? hookLog(path.join(home, 'state'), res.startedAt ?? since) : { stops: 0, said: 0, hookMs: 0, kinds: {} }), ...g, code: pyLines(repo, P.source), chars: pyChars(repo, P.source), tests: pyLines(repo, P.tests) });
    const x = r.tasks.at(-1);
    console.error(`${arm} #${run} ${k + 1}/${TASKS.length} ${t.id}: ${x.passed === null ? 'not judged' : x.passed ? 'pass' : 'FAIL'}${x.regressions.length ? `, broke ${x.regressions.join(' ')}` : ''}, ${x.cost === undefined ? `${x.input + x.output} tokens` : `$${x.cost.toFixed(3)}`}${x.failed ? ', session failed' : ''}${x.retries ? `, ${x.retries} retries` : ''}`);
  }
  // The kept repository is for reading what the agents wrote: its virtualenv goes (the project's setup rebuilds it) and git
  // packs the loose objects, so a finished timeline leaves a few files, not thousands.
  fs.rmSync(venv, { recursive: true, force: true });
  git(repo, 'gc', '-q', '--prune=now');
  fs.rmSync(home, { recursive: true, force: true });
  return r;
}

const human = { code: TASKS.at(-1).humanCode, chars: charsAt(TASKS.at(-1).landed), startChars: charsAt(P.start) };
console.error(`${RUNS * ARMS.length} timelines x ${TASKS.length} tasks of ${P.repo} from ${P.start}; ${JSON.stringify(versions)}`);
// --dry-run checks the instrument without any session: the start fails every task's hidden tests, and the copy has no future.
if (process.argv.includes('--dry-run')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-real-dry-'));
  start(dir);
  const solved = TASKS.filter((t, k) => grade(dir, k, false).passed === true).map(t => t.id), future = git(dir, 'log', '--all', '-1', '--format=%cI');
  console.log(`would run ${RUNS * ARMS.length} timelines (${ARMS.join(', ')} x ${RUNS}) of ${TASKS.length} tasks (${JUDGED} judged) with ${H.bin}`);
  console.log(`start ${P.start}: ${solved.length ? `ALREADY PASSES ${solved.join(' ')}` : 'fails every judged task'}; newest commit in the copy ${future}; first task merged ${TASKS[0]?.merged}`);
  console.log(`production lines: start ${pyLines(dir, P.source)} (prepared: ${startCode}), after the human changes ${human.code}`);
  for (const arm of ARMS) { const st = setup(arm); if (st.lessloc) console.log(`${arm}: lessloc from ${st.plugin}`); }
  process.exit(0);
}
// --replay <file>: single tasks, each started from the state an earlier timeline reached just before it, listed as
// [{ "repo": <timeline repository>, "task": <task id> }], or as { "task": <task id> } alone to start from the project's own
// code just before the task's change landed, so no task's outcome depends on another's. Each runs once per arm and run and is
// graded like any task: for a change that acts at a few moments of a long history, where totals over a whole run would hide it.
if (opt('replay')) {
  const events = JSON.parse(fs.readFileSync(opt('replay'), 'utf8')), out = [];
  const jobs = events.flatMap(ev => ARMS.flatMap(arm => Array.from({ length: RUNS }, (_, i) => [ev, arm, i + 1])));
  const one = async (ev, arm, run) => {
    const s = setup(arm), k = TASKS.findIndex(t => t.id === ev.task), home = fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-real-home-')), repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-replay-'));
    const drop = () => [repo, home].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
    const at = ev.repo ? git(ev.repo, 'log', '--format=%H %s').split('\n').map(l => l.split(' ')).find(([, id]) => id === ev.task)[0] : TASKS[k].landed;
    execFileSync('git', ['clone', '-q', '--no-local', '--no-tags', ev.repo || clone, repo], { stdio: 'ignore' });
    git(repo, 'checkout', '-q', '-B', 'main', `${at}^`);
    for (const b of git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n')) if (b && b !== 'main') git(repo, 'branch', '-q', '-D', b);
    git(repo, 'remote', 'remove', 'origin');
    // Later commits, this task's own solution among them, must not be findable.
    git(repo, 'reflog', 'expire', '--expire=now', '--all');
    git(repo, 'gc', '-q', '--prune=now');
    fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.venv/\n');
    if (runSetup(repo).status) {
      console.error(`${ev.task} ${arm} #${run}: setup failed three times, run skipped`);
      drop();
      return null;
    }
    const before = git(repo, 'rev-parse', 'HEAD'), { tmp } = enter(s, home, repo);
    const since = Date.now(), res = await session(repo, prompt(TASKS[k]), s), g = grade(repo, k, true, tmp);
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.email=bench@lessloc', '-c', 'user.name=bench', 'commit', '-qm', ev.task, '--allow-empty', '--no-verify');
    // The change itself, for reading what a run did after its repository is gone.
    const diff = git(repo, 'diff', before, 'HEAD');
    const r = { task: ev.task, from: ev.repo, arm, run, ...res, reply: res.said, ...(s.lessloc ? hookLog(path.join(home, 'state'), res.startedAt ?? since) : { stops: 0, said: 0, hookMs: 0, kinds: {} }), ...g, diff: diff.length > 40000 ? `${diff.slice(0, 40000)}\n[cut]` : diff };
    console.error(`${ev.task} ${arm} #${run}: ${r.passed === null ? 'not judged' : r.passed ? 'pass' : 'FAIL'}${r.regressions.length ? `, broke ${r.regressions.join(' ')}` : ''}, $${(r.cost ?? 0).toFixed(3)}, noted ${Object.keys(r.kinds).join(' ') || 'nothing'}${r.failed ? ', session failed' : ''}`);
    drop();
    return r;
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, async () => {
    while (next < jobs.length) { const r = await one(...jobs[next++]); if (r) out.push(r); }
  }));
  priceCutOffs(out);
  const cell = xs => `passed ${xs.filter(r => r.passed).length}/${xs.filter(r => r.passed !== null).length}, broke ${sum(xs.map(r => r.regressions.length))}, $${sum(xs.map(r => r.cost || 0)).toFixed(3)}`;
  console.log(`| task | ${ARMS.join(' | ')} |\n|---|${ARMS.map(() => '---').join('|')}|`);
  for (const ev of events) console.log(`| ${ev.task} | ${ARMS.map(a => cell(out.filter(r => r.task === ev.task && r.arm === a))).join(' | ')} |`);
  console.log(`| all | ${ARMS.map(a => cell(out.filter(r => r.arm === a))).join(' | ')} |`);
  const file = path.join(KEEP, `lessloc-replay-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ versions, identity: identity(ARMS), events, results: out }, null, 1), { flag: 'wx', mode: 0o600 });
  console.log(`\nraw results: ${file}`);
  process.exit(0);
}
const jobs = Array.from({ length: RUNS }, (_, i) => ARMS.map(arm => [arm, i + 1])).flat(), results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, async () => {
  while (next < jobs.length) results.push(await timeline(...jobs[next++]));
}));
priceCutOffs(results.flatMap(r => r.tasks));

// Thirds of the run: whether cost per passed task grows as agent-written code accumulates.
const thirds = [[0, Math.ceil(TASKS.length / 3)], [Math.ceil(TASKS.length / 3), Math.ceil((2 * TASKS.length) / 3)], [Math.ceil((2 * TASKS.length) / 3), TASKS.length]];
const part = (r, [a, b]) => r.tasks.slice(a, b), tot = (xs, k) => sum(xs.map(x => x[k] || 0)), per = (xs, k) => (xs.filter(x => x.passed).length ? tot(xs, k) / xs.filter(x => x.passed).length : undefined);
const judgedIn = ([a, b]) => TASKS.slice(a, b).filter(t => t.judged).length;
const rows = [
  [`judged tasks passed (of ${JUDGED}; ${TASKS.length - JUDGED} more tasks have no tests to judge them)`, r => r.tasks.filter(x => x.passed).length],
  ...thirds.map((t, i) => [`  passed in third ${i + 1} (of ${judgedIn(t)} judged)`, r => part(r, t).filter(x => x.passed).length]),
  ['cost $ per passed judged task, all tasks paid for (primary)', r => per(r.tasks, 'cost')],
  ...thirds.map((t, i) => [`  cost $ per passed task, third ${i + 1}`, r => per(part(r, t), 'cost')]),
  ['total cost $', r => tot(r.tasks, 'cost')],
  ['input tokens per passed task', r => per(r.tasks, 'input')],
  ...thirds.map((t, i) => [`  input tokens per passed task, third ${i + 1}`, r => per(part(r, t), 'input')]),
  ['file reads per task', r => tot(r.tasks, 'reads') / TASKS.length],
  ['turns per task', r => tot(r.tasks, 'turns') / TASKS.length],
  ['earlier tasks broken at the end', r => r.tasks.at(-1).regressions.length],
  ["project's own suite passes at the end (1 = yes)", r => Number(r.tasks.at(-1).suite)],
  [`production lines: start ${startCode}, end (the human changes reach ${human.code})`, r => r.tasks.at(-1).code],
  ['production growth / human growth', r => (human.code - startCode ? (r.tasks.at(-1).code - startCode) / (human.code - startCode) : undefined)],
  [`production characters, no whitespace: start ${human.startChars}, end (the human changes reach ${human.chars})`, r => r.tasks.at(-1).chars],
  ['production growth / human growth, in characters', r => (human.chars - human.startChars ? (r.tasks.at(-1).chars - human.startChars) / (human.chars - human.startChars) : undefined)],
  [`test lines (start ${results[0]?.start.tests})`, r => r.tasks.at(-1).tests],
  ['minutes per task', r => tot(r.tasks, 'sec') / 60 / TASKS.length],
  ['agent calls touching lessloc (0 = invisible)', r => tot(r.tasks, 'visible')],
  ["turns lessloc's review sent back", r => tot(r.tasks, 'stops')],
  ['lessloc hook seconds per task', r => tot(r.tasks, 'hookMs') / 1000 / TASKS.length],
];
const scope = `scope: ${P.repo} from ${P.start}, ${TASKS.length} real tasks in history order, ${versions.model} via ${HOST} ${versions[HOST]}; results hold within this scope only`;
console.log(`${scope}\n${JSON.stringify(versions)}\n\n| median [min–max] of ${RUNS} run(s) | ${ARMS.join(' | ')} |\n|---|${ARMS.map(() => '--:').join('|')}|`);
for (const [name, f] of rows) console.log(`| ${name} | ${ARMS.map(arm => summarize(results.filter(r => r.arm === arm), f)).join(' | ')} |`);
// Per-task cost against the first arm, paired by task: a sign-flip test over tasks, 10,000 flips with a fixed seed.
let rng = 0x9e3779b9;
const random = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const byTask = (arm, k) => med(results.filter(r => r.arm === arm).map(r => r.tasks[k].cost || 0));
for (const arm of ARMS.slice(1)) {
  const d = TASKS.map((_, k) => byTask(arm, k) - byTask(ARMS[0], k)), obs = Math.abs(sum(d));
  let hits = 0;
  for (let i = 0; i < 10000; i++) if (Math.abs(sum(d.map(x => (random() < 0.5 ? -x : x)))) >= obs - 1e-12) hits++;
  console.log(`\n${arm} vs ${ARMS[0]}: per-task cost ${sum(d) >= 0 ? '+' : ''}${fmt(sum(d) / TASKS.length)} $ on average, sign-flip p=${((hits + 1) / 10001).toFixed(3)} over ${TASKS.length} tasks`);
}
const file = path.join(KEEP, `lessloc-real-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({ scope, versions, identity: identity(ARMS), human, results }, null, 1), { flag: 'wx', mode: 0o600 });
console.log(`\nraw results and repos: ${file}`);
