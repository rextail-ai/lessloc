import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { STANDARD } from '../lib/voice.mjs';
import { QUIET, SAYS, at, outcomes, parse, shape } from './e2e/record.mjs';
import { CLI, ENTRY, fill, tmp } from './helpers.mjs';

// test/golden/claude.jsonl is one Claude Code session, recorded through hook.mjs with no host flag. Each line is the
// repository's files, a file change the agent's tool made, or a hook call with Claude Code's payload and what lessloc
// answered: stdout, stderr, exit code and the change to its state. A failure here means Claude Code's behavior changed.
// The recording is never re-made to make this test pass.
const GOLDEN = new URL('./golden/claude.jsonl', import.meta.url);

// The hooks run with a clean environment and a PATH that holds only node and git, so no tool installed on this machine
// (ruff, python3) and no setting of the user's (git config, agent variables) changes what they answer. `claude` adds the
// variables Claude Code sets for a plugin's hooks, so a host check that reads them cannot move Claude Code to another row.
function sandbox(claude) {
  const root = tmp('golden-'), dir = path.join(root, 'shop'), bin = path.join(root, 'bin');
  for (const d of [dir, bin, path.join(root, 'home')]) fs.mkdirSync(d);
  const which = name => process.env.PATH.split(path.delimiter).map(d => path.join(d, name)).find(f => {
    try { return fs.statSync(f).isFile() && (fs.accessSync(f, fs.constants.X_OK), true); } catch { return false; }
  });
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  fs.symlinkSync(which('git'), path.join(bin, 'git'));
  const env = { PATH: bin, HOME: path.join(root, 'home'), TMPDIR: root, LESSLOC_STATE: path.join(root, 'state'), GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' };
  if (claude) Object.assign(env, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: path.dirname(ENTRY), CLAUDE_PLUGIN_DATA: path.join(root, 'plugin-data') });
  return { dir, env, state: env.LESSLOC_STATE };
}

// lessloc's state in a comparable form: per-run values (tree ids, times, the checkout's path and hash, the definitions
// cache, git index files, hook durations) masked; tree ids numbered in order of first appearance.
function stateOf(state, dir, trees) {
  const files = {}, out = {};
  const walk = (d, pre) => {
    for (const n of fs.readdirSync(d).sort()) fs.statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n), `${pre}${n}/`) : (files[`${pre}${n}`] = fs.readFileSync(path.join(d, n)));
  };
  if (fs.existsSync(state)) walk(state, '');
  const tree = h => `<tree ${trees.get(h) ?? trees.set(h, trees.size + 1).size}>`;
  const mask = s => s.replaceAll(dir, '$REPO').replace(/\b[0-9a-f]{40}(?:[0-9a-f]{24})?\b/g, tree).replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, '<time>').replace(/"at":\d+/g, '"at":"<time>"');
  for (const [k, buf] of Object.entries(files)) {
    const key = mask(k.replace(/^([^/]+)-[0-9a-f]{12}\//, '$1/').replace(/\/defs-\w+\.json$/, '/defs-<engine>.json')), text = () => mask(buf.toString('utf8'));
    out[key] = key.endsWith('/defs-<engine>.json') ? '<cache>' : buf.includes(0) ? '<binary>' : key.endsWith('/cost.log') ? text().replace(/^(\S+) \d+ (\d+) \d+/gm, '$1 <ms> $2 <time>') : text();
  }
  return out;
}

// Replays the session's lines in a fresh repository and hands each hook line with what the hook did now to `check`: its
// output and the state files it changed (only the new lines of a log). A line may carry the hook's arguments and the variables
// the tool set; $REPO, $HOME, $TMP and $RUN in them, and in the payload, are the sandbox's folders.
function play(lines, claude, check) {
  const { dir, env, state } = sandbox(claude), trees = new Map(), json = s => JSON.stringify(s).slice(1, -1);
  const fill = (s, q = x => x) => [['$REPO', dir], ['$HOME', env.HOME], ['$TMP', env.TMPDIR], ['$RUN', path.dirname(dir)]].reduce((t, [k, v]) => t.replaceAll(k, q(v)), s);
  let before = {};
  for (const line of lines) {
    for (const [f, text] of Object.entries(line.files || {})) {
      if (text == null) fs.rmSync(path.join(dir, f));
      else fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }), fs.writeFileSync(path.join(dir, f), text);
    }
    if (line.commit) {
      const git = (...args) => execFileSync('git', args, { cwd: dir, env: { ...env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' }, stdio: 'ignore' });
      git('-c', 'init.defaultBranch=main', 'init', '-q');
      git('add', '-A');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
    }
    if (!line.hook) continue;
    const vars = Object.fromEntries(Object.entries(line.env || {}).map(([k, v]) => [k, fill(v)]));
    const r = spawnSync(process.execPath, [ENTRY, ...(line.argv || []).map(a => fill(a))], { cwd: dir, env: { ...vars, ...env }, input: fill(JSON.stringify(line.hook), json), encoding: 'utf8' });
    const now = stateOf(state, dir, trees), changed = {};
    for (const k of new Set([...Object.keys(before), ...Object.keys(now)])) if (before[k] !== now[k]) changed[k] = before[k] && now[k]?.startsWith(before[k]) ? { append: now[k].slice(before[k].length) } : now[k] ?? null;
    before = now;
    check(line, { stdout: r.stdout.replaceAll(json(dir), '$REPO'), stderr: r.stderr.replaceAll(dir, '$REPO'), code: r.status, state: changed });
  }
  return { dir, env, state };
}

const lines = fs.readFileSync(GOLDEN, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const replay = claude => () => {
  const plugin = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.deepEqual([...new Set(lines.filter(l => l.hook).map(l => l.hook.hook_event_name))].sort(), Object.keys(plugin.hooks).sort(), 'the session covers every event Claude Code runs the hook on');
  play(lines, claude, (line, now) => {
    assert.equal(now.stdout, line.stdout, `${line.step}: stdout`);
    assert.equal(now.stderr, line.stderr, `${line.step}: stderr`);
    assert.equal(now.code, line.code, `${line.step}: exit code`);
    assert.deepEqual(now.state, line.state, `${line.step}: state`);
  });
};
test('Claude Code gets the same answers, byte for byte, and lessloc keeps the same state, on every event of a recorded session', replay(true));
test('the same holds with none of the variables Claude Code sets', replay(false));

// test/fixtures/recorded/*.jsonl are sessions of the end-to-end tests (`E2E_RECORD=1 npm run e2e`): a real tool's hook calls with
// its own arguments, variables and payloads, and the checks the session passed. Replayed offline, lessloc refuses and holds
// exactly the calls it refused and held in the session, so every recorded call after them could happen, and its answers and
// state pass the same checks. Outcomes, not bytes: a change of wording passes, a payload lessloc misreads fails. A recording is
// re-made only when the tool's pinned version moves.
const RECORDED = new URL('./fixtures/recorded/', import.meta.url);
for (const name of fs.readdirSync(RECORDED)) {
  const [head, ...session] = fs.readFileSync(new URL(name, RECORDED), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  test(`replay: ${head.tool} ${head.version}: lessloc's answers and state pass the session's checks again`, () => {
    const said = [], { dir, env, state } = play(session, false, (line, now) => said.push({ now: parse(now.stdout), then: parse(line.stdout) }));
    for (const k of ['deny', 'block']) assert.deepEqual(said.map(x => !!at(x.now, head.answer[k])), said.map(x => !!at(x.then, head.answer[k])), `the calls answered with ${k}`);
    const says = k => said.map(x => at(x.now, head.answer[k])).filter(x => typeof x === 'string');
    const o = outcomes({ state: path.join(state, fs.readdirSync(state).find(n => n.startsWith('shop-'))), work: dir, env, cli: CLI, sid: session.find(l => l.hook?.session_id)?.hook.session_id, prompt: head.prompt });
    // A9, A11, A12 and A13 are what the tool itself did (the events it fired, the network and home it left alone, its exit, its
    // setup as doctor sees it), which the recording already holds.
    const tool = () => {};
    const checks = {
      ...o, A9: tool, A11: tool, A12: tool, A13: tool,
      A1: () => assert.ok(says('context').some(x => x.includes(STANDARD.slice(0, 60)))),
      A2: () => assert.match([...says('context'), ...says('feedback')].join('\n'), /formatMoney/),
      A3: () => assert.match(says('deny').join('\n'), SAYS.placeholder),
      A4: () => assert.match([...says('context'), ...says('feedback')].join('\n'), SAYS.note),
      A6: () => assert.deepEqual(says('block').map(x => SAYS.hold.test(x)), [true]),
      A10: () => Object.keys(head.answer).flatMap(says).forEach(x => assert.doesNotMatch(x, QUIET)),
    };
    for (const c of head.checks) checks[c]();
  });
}

// A host fixture is the tool's documented payloads, which the contract test sends. Each of its events, with its placeholders
// filled, has only key paths and value types that the tool's recorded event of the same name and tool has: a fixture that
// disagrees with the real tool is corrected by hand from its recording. Events the session never fires are not compared.
for (const name of fs.readdirSync(RECORDED)) {
  const [head, ...session] = fs.readFileSync(new URL(name, RECORDED), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const file = new URL(`./fixtures/hosts/${head.host}.json`, import.meta.url);
  if (!fs.existsSync(file)) continue;
  test(`fixture shapes: test/fixtures/hosts/${head.host}.json has only what ${head.tool} ${head.version} sends`, () => {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8')), vars = { AGAIN: false, LOOP: 0, EXIT: 0, TIME_MS: 0, OUTPUT_JSON: '""', ABSFILE_JSON: '"/r/a"', CONTENT_JSON: '""' };
    const tool = e => e.tool_name ?? e.toolName;
    for (const [step, raw] of Object.entries(fx.events)) {
      const e = fill(raw, vars), event = e.hook_event_name ?? fx.argv?.[step];
      const seen = session.filter(l => l.hook && l.step === event && tool(l.hook) === tool(e)).map(l => shape(l.hook));
      if (!seen.length) continue;
      const missing = s => [...shape(e)].filter(p => !s.has(p));
      assert.deepEqual(seen.map(missing).sort((a, b) => a.length - b.length)[0], [], `${step}: key paths and types the tool does not send`);
    }
  });
}
