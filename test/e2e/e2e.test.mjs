// The end-to-end tests: each agent tool's real binary, set up for lessloc the documented way in a throwaway home, plays one
// scripted session against a local fake model (model.mjs) that speaks the tool's own protocol, with lessloc's real hooks behind
// a recording wrapper (record.mjs). What the tool should get comes from its row in lib/hosts.mjs, as in the contract tests.
// `npm run e2e`, never part of `npm test`. E2E_TOOLS=claude,... picks adapters (default: every one whose tool is there),
// E2E_INSTALL=1 installs missing pins, E2E_JOBS runs that many at once, E2E_KEEP=1 keeps each run's folder. The negative
// controls: E2E_OFF=gate,lines switches parts of lessloc off, E2E_BARE=1 leaves it uninstalled; each must fail what it covers.
// E2E_RECORD=1 writes each session that passes every check to test/fixtures/recorded/, which npm test replays offline.
// `npm run e2e:netns` runs the same inside a network namespace with only loopback, where the tools that try the internet
// whatever they are told run too; their pins are installed beforehand, by a run with E2E_INSTALL=1.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HOSTS } from '../../lib/hosts.mjs';
import { STANDARD } from '../../lib/voice.mjs';
import { start } from './model.mjs';
import { QUIET, SAYS, at, calls, event, outcomes, parse, save, sessionOf, wrap } from './record.mjs';
import { ADAPTERS, CACHE, bin } from './tools.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
// Run folders name nothing of lessloc, so a path a tool shows its model cannot pass for lessloc's own.
const RUNS = path.join(os.homedir(), '.cache', 'e2e-runs');
// Near lessloc's words in what a tool sends its model, the tool's own text may not name lessloc either.
const NEAR = /lessloc/i;

const PROMPT = 'Add load() to shop/load.js: it returns the parsed data.json. Then show the money totals.';
const FILES = {
  'package.json': '{"type": "module", "scripts": {"test": "node --test"}}\n',
  'shop/money.js': 'export function formatMoney(amount) {\n  return `$${amount.toFixed(2)}`;\n}\n',
  'data.json': '{"total": 3}\n',
  'test/load.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { load } from '../shop/load.js';\n\ntest('load', () => assert.deepEqual(load(), { total: 3 }));\n",
};
const PLACEHOLDER = "import { formatMoney } from './money.js';\n// ... existing code ...\nexport const total = (n) => formatMoney(n);\n";
const BAD = "import fs from 'node:fs';\n\nexport function load() {\n  try {\n    return JSON.parse(fs.readFileSync(new URL('../data.jsn', import.meta.url), 'utf8'));\n  } catch {}\n  console.log('debug');\n}\n";
const GOOD = "import fs from 'node:fs';\n\nexport function load() {\n  return JSON.parse(fs.readFileSync(new URL('../data.json', import.meta.url), 'utf8'));\n}\n";
// The session: a subagent first (where the tool has one), a placeholder write, a bad write, a failing test run, "Done.", the
// fix, a passing run, "Done.". A tool lessloc cannot hold ends its run at the first "Done.", so there the fix comes without it.
const steps = (a, work) => [
  ...(a.tools.agent ? [{ tool: 'agent', description: 'List the files', prompt: 'SUBTASK: list the files' }] : []),
  { tool: 'write', path: path.join(work, 'shop/total.js'), content: PLACEHOLDER },
  { tool: 'write', path: path.join(work, 'shop/load.js'), content: BAD },
  { tool: 'shell', command: 'npm test', description: 'Run the tests' },
  ...(a.answer.block ? [{ reply: 'Done.' }] : []),
  { tool: 'edit', path: path.join(work, 'shop/load.js'), old: BAD, new: GOOD },
  { tool: 'shell', command: 'npm test', description: 'Run the tests' },
  { reply: 'Done.' },
];

const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore', env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
function commit(dir) {
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
}
// The checkout as a clone of it would have it, with the uncommitted changes.
function copy(to) {
  for (const f of execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' }).split('\0')) {
    if (!f || !fs.existsSync(path.join(REPO, f))) continue;
    fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
    fs.copyFileSync(path.join(REPO, f), path.join(to, f));
  }
  commit(to);
}
const group = (pid, sig) => {
  try { return process.kill(-pid, sig); } catch { return false; }
};
const until = async (ok, ms) => {
  for (const end = Date.now() + ms; !(await ok()) && Date.now() < end;) await new Promise(r => setTimeout(r, 200));
  return ok();
};
const port = () => new Promise(resolve => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port: free } = s.address();
    s.close(() => resolve(free));
  });
});

// One run of one tool in the throwaway folder `dir`: lessloc's copy and wrapper, the work repository, the route, the fake model,
// the headless session. Returns what the assertions read.
async function session(a, exe, dir) {
  const d = n => path.join(dir, n);
  const t = { dir, cache: CACHE, home: d('home'), work: d('work'), tmp: d('tmp'), config: d('config'), state: d('state'), lessloc: path.join(d('home'), '.lessloc'), record: d('record.jsonl'), bare: !!process.env.E2E_BARE };
  for (const f of [t.home, t.work, t.tmp, t.config, t.lessloc, d('cache')]) fs.mkdirSync(f, { recursive: true });
  copy(t.lessloc);
  for (const [f, text] of Object.entries(FILES)) fs.mkdirSync(path.dirname(path.join(t.work, f)), { recursive: true }), fs.writeFileSync(path.join(t.work, f), text);
  commit(t.work);
  const plan = steps(a, t.work), server = await start(a, plan);
  Object.assign(t, { url: server.url, port: await port() });
  let served;
  try {
    // The environment is built from nothing, so no variable of the machine (an agent tool's own markers among them) reaches the tool.
    const env = {
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: t.home, TMPDIR: t.tmp, TERM: 'dumb', XDG_CONFIG_HOME: path.join(t.home, '.config'),
      XDG_CACHE_HOME: d('cache'), XDG_DATA_HOME: path.join(t.home, '.local/share'), XDG_STATE_HOME: path.join(t.home, '.local/state'),
      // The scenario's own `npm test` would otherwise ask the registry for a newer npm.
      npm_config_update_notifier: 'false',
      // Outside a network namespace, the fake model is also the proxy, and refuses and keeps every try to reach the internet.
      ...(!process.env.E2E_NETNS && { HTTPS_PROXY: t.url, HTTP_PROXY: t.url, ALL_PROXY: t.url, NO_PROXY: '127.0.0.1,localhost' }), ...a.env(t),
    };
    const started = Date.now();
    // The wrapper goes into lessloc's copy, and into any folder a route builds from it (an extension). Such a folder's hook.mjs is
    // the copy's wrapper, so it gets the real hook back first, or its wrapper would run itself.
    t.wrap = dir => (dir !== t.lessloc && fs.copyFileSync(path.join(t.lessloc, 'hook.real.mjs'), path.join(dir, 'hook.mjs')), wrap(dir, { record: t.record, state: t.state, off: process.env.E2E_OFF || '', work: t.work, given: Object.keys(env) }));
    t.wrap(t.lessloc);
    for (const [f, text] of Object.entries(a.files?.(t) || {})) fs.mkdirSync(path.dirname(f), { recursive: true }), fs.writeFileSync(f, text);
    // What a route runs: the tool's own commands, or lessloc's init from the copy, in the work repository.
    // A route's command runs apart from this process, so the fake model can answer, and refuse, what it asks of the network.
    const exec = (cmd, args) => new Promise(resolve => {
      const p = spawn(cmd, args, { cwd: t.work, env, stdio: 'ignore' }), timer = setTimeout(() => p.kill('SIGKILL'), 60000);
      p.on('close', code => (clearTimeout(timer), resolve(code)));
    });
    Object.assign(t, { exe, env, tool: args => exec(exe, args), init: (...args) => exec(process.execPath, [path.join(t.lessloc, 'lessloc.mjs'), 'init', ...args]) });
    const routed = t.bare || await a.route(t);
    // A tool that runs its turns in a server: the server first, in its own process group, until it answers. A request that
    // comes while it starts may never be answered (OpenCode 1.x), so each try gives up after 2 s.
    if (a.serve) {
      served = spawn(exe, a.serve(t), { cwd: t.work, env, detached: true, stdio: ['ignore', fs.openSync(d('serve.txt'), 'w'), fs.openSync(d('serve-err.txt'), 'w')] });
      await until(() => fetch(`http://127.0.0.1:${t.port}/`, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false), 30000);
    }
    const child = spawn(exe, a.run(t, PROMPT), { cwd: t.work, env, detached: true, stdio: ['ignore', fs.openSync(d('out.jsonl'), 'w'), fs.openSync(d('err.txt'), 'w')] });
    let timedOut = false;
    const timer = setTimeout(() => ((timedOut = true), group(child.pid, 'SIGTERM'), setTimeout(() => group(child.pid, 'SIGKILL'), 5000)), a.timeout * 1000);
    const code = await new Promise(r => child.on('exit', r));
    clearTimeout(timer);
    // The server goes on after its client exits: the session is over once the last step was answered and no hook call has
    // started or ended for 2 s.
    const quiet = () => Date.now() - Math.max(0, ...calls(t.record).map(c => c.end ?? c.start)) > 2000;
    if (served) await until(() => server.requests.some(r => r.main && r.step >= plan.length - 1) && quiet(), a.timeout * 1000);
    // A hook the tool started in the background may outlive it: its end line is waited for before anything is read.
    const ended = await until(() => calls(t.record).every(c => c.ended), 30000), left = group(child.pid, 0);
    if (left) group(child.pid, 'SIGKILL');
    const state = path.join(t.state, (fs.existsSync(t.state) ? fs.readdirSync(t.state) : []).find(n => n.startsWith('work-')) ?? '-');
    return { t, env, plan, server, routed, started, code, timedOut, ended, left, state, calls: calls(t.record).filter(c => !c.elsewhere) };
  } finally {
    if (served) group(served.pid, 'SIGKILL');
    await server.close();
  }
}

const read = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
// Files under the real home's `names` changed since `since` that mention the run folder: what the tool wrote outside it.
function strays(names, since, dir) {
  const out = [], walk = f => {
    const s = fs.lstatSync(f, { throwIfNoEntry: false });
    if (s?.isDirectory()) for (const n of fs.readdirSync(f)) walk(path.join(f, n));
    else if (s?.isFile() && s.mtimeMs > since && read(f).includes(dir)) out.push(f);
  };
  for (const n of names) walk(path.join(os.homedir(), n));
  return out;
}

const only = process.env.E2E_TOOLS?.split(',');
describe('end to end', { concurrency: Number(process.env.E2E_JOBS || 4) }, () => {
  for (const a of ADAPTERS.filter(x => !only || only.includes(x.id))) {
    const exe = bin(a.pin);
    // A tool that tries the internet whatever it is told (`namespace` says why) runs only in a network namespace, where A11 can
    // pass: `npm run e2e:netns`, which sets E2E_NETNS.
    test(`${a.id}: one scripted session through the real tool`, { skip: (!exe && `${a.pin} is not installed (E2E_INSTALL=1 installs it)`) || (a.namespace && !process.env.E2E_NETNS && `${a.id} runs only in a network namespace (npm run e2e:netns): ${a.namespace}`) }, async t => {
      fs.mkdirSync(RUNS, { recursive: true });
      const dir = fs.mkdtempSync(path.join(RUNS, 'run-'));
      t.after(() => (process.env.E2E_KEEP ? t.diagnostic(`kept ${dir}`) : fs.rmSync(dir, { recursive: true, force: true })));
      const s = await session(a, exe, dir), caps = HOSTS[a.host], answer = a.answer, mains = s.server.requests.filter(r => r.main);
      const main = i => mains.find(r => r.step === i), call = i => mains.flatMap(r => r.results).find(x => x.id === `call_${i}`);
      const step = (k, n = 0) => s.plan.filter(x => (k === 'reply' ? x.reply : x.tool === k)).map(x => s.plan.indexOf(x))[n];
      const sid = s.calls.map(c => sessionOf(c.input)).find(Boolean), passed = [];
      let tried = 0;
      // A check an adapter marks `todo` names the lessloc defect that fails it; it is reported on every run, and stays out of
      // the recording's checks.
      const check = (name, f, id = name.split(':')[0], todo = a.todo?.[id]) => (todo || tried++, t.test(name, { todo }, () => (f(), todo || passed.push(id))));
      const o = outcomes({ state: s.state, work: s.t.work, env: { ...s.env, LESSLOC_STATE: s.t.state }, cli: path.join(s.t.lessloc, 'lessloc.mjs'), sid, prompt: PROMPT });
      assert.ok(s.routed, 'lessloc is set up the documented way');
      assert.deepEqual(s.server.errors, [], 'every step the session asked for was offered');
      await check('A1: the standard is in the first main request', () => assert.ok(mains[0]?.text.includes(STANDARD.slice(0, 60))));
      // The hints come from the request, which only a prompt event shows lessloc; test runs only from hooks that see a
      // command's exit (the fixture's `evidence`, as in the contract tests).
      if (a.events.includes('UserPromptSubmit')) await check('A2: the hints about existing code reach the model', () => assert.match(caps.prompt ? mains[0]?.text : mains.flatMap(r => r.results.map(x => x.text)).join('\n'), /formatMoney/));
      if (caps.gate !== false) await check('A3: the placeholder is refused, and never lands', () => {
        assert.match(call(step('write'))?.text ?? '', SAYS.placeholder);
        assert.ok(!fs.existsSync(path.join(s.t.work, 'shop/total.js')));
      });
      if (caps.feedback !== false && caps.track !== 'turn') await check('A4: the swallowed error is noted right after the write, next to the tool\'s own result', () => {
        const bad = step('write', 1);
        assert.match(main(bad + 1)?.text ?? '', SAYS.note);
        assert.ok(call(bad)?.text);
        assert.match(read(path.join(s.state, 'sessions', `${sid}.log`)), /^touch \S+ shop\/load\.js$/m);
      });
      if (a.evidence !== false) await check('A5: the failing test run is recorded', o.A5);
      // A pre-tool call refuses and never holds; a host may put both answers at one path (Gemini's `reason`).
      if (answer.block) await check('A6: the turn is held once, and the next request carries the hold', () => {
        assert.equal(s.calls.filter(c => event(a.host, c.input, c.argv) !== 'PreToolUse' && at(parse(c.stdout), answer.block)).length, 1);
        assert.match(main(step('reply') + 1)?.text ?? '', SAYS.hold);
      });
      if (a.evidence == null) await check('A7: the passing run after the fix is recorded at the final state', o.A7);
      if (a.events.includes('Stop')) await check('A8: the handoff record has the request, the file and the verdict', o.A8);
      await check('A9: every event lessloc set up fired', () => {
        const fired = new Set(s.calls.map(c => event(a.host, c.input, c.argv)));
        assert.deepEqual(a.events.filter(e => !fired.has(e) && !a.unfired?.[e]), []);
      });
      await check('A10: the model never reads lessloc\'s name, from lessloc or from the tool', () => {
        const said = s.calls.flatMap(c => Object.values(answer).map(p => at(parse(c.stdout), p))).filter(x => typeof x === 'string' && x);
        for (const x of said) {
          assert.doesNotMatch(x, QUIET);
          for (const r of s.server.requests) for (let i = r.text.indexOf(x.slice(0, 60)); i >= 0; i = r.text.indexOf(x.slice(0, 60), i + 1)) assert.doesNotMatch(r.text.slice(Math.max(0, i - 200), i + x.length + 200), NEAR);
        }
      });
      await check('A11: nothing reached the internet or the real home', () => {
        assert.deepEqual([s.server.connects, s.server.unknown], [[], []]);
        assert.deepEqual(strays(a.homes, s.started, s.t.dir), []);
      });
      await check('A12: the tool ended by itself, with every hook call finished', () => assert.deepEqual({ code: s.code, timedOut: s.timedOut, ended: s.ended, left: s.left }, { code: 0, timedOut: false, ended: true, left: false }));
      if (a.doctor) await check('A13: doctor reports the tool set up, and its hooks run', () => {
        assert.match(spawnSync(process.execPath, [path.join(s.t.lessloc, 'lessloc.mjs'), 'doctor'], { cwd: s.t.work, env: { ...s.env, LESSLOC_STATE: s.t.state }, encoding: 'utf8' }).stdout, new RegExp(`^✓ ${a.doctor}: set up .*; its hooks last ran here`, 'm'));
      });
      if (process.env.E2E_RECORD && passed.length === tried) {
        const version = /\d+\.\d+\.\d+/.exec(spawnSync(exe, ['--version'], { env: s.env, encoding: 'utf8' }).stdout)?.[0];
        save(path.join(REPO, 'test/fixtures/recorded', `${a.id}.jsonl`), { tool: a.id, host: a.host, version, live: false, prompt: PROMPT, answer: a.answer, checks: passed }, FILES, s.calls, s.t);
      }
    });
  }
});
