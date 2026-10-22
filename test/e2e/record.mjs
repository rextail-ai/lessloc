// The hook wrapper of the end-to-end tests. It takes the place of hook.mjs in the copy of the checkout a tool loads, runs the
// real hook (hook.real.mjs) with the same arguments, input and environment, gives back its output and exit code unchanged,
// and writes a start and an end line for each call to the recording. lessloc's state folder and switches are baked in, so a
// tool that scrubs its hooks' environment can move neither. Only calls about the work repository are recorded: doctor's and
// init's own checks run the hook elsewhere. Each call keeps the work repository's files as the hook found them and the variables
// the tool set for it (never one that looks like a secret), so the replay in npm test can rebuild what each call saw.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const main = C => {
  const { spawn } = C.spawn, line = o => C.fs.appendFileSync(C.record, `${JSON.stringify({ pid: process.pid, ...o })}\n`);
  const files = (d, pre = '', out = {}) => {
    for (const e of C.fs.readdirSync(d, { withFileTypes: true })) {
      try {
        if (e.isDirectory() && e.name !== '.git') files(`${d}/${e.name}`, `${pre}${e.name}/`, out);
        else if (e.isFile()) out[`${pre}${e.name}`] = C.fs.readFileSync(`${d}/${e.name}`, 'utf8');
      } catch { /* removed by the tool meanwhile */ }
    }
    return out;
  };
  const tree = files(C.work), env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !C.given.includes(k) && !/KEY|TOKEN|SECRET|AUTH|PASSWORD|CREDENTIAL/i.test(k)));
  line({ start: Date.now(), argv: process.argv.slice(2) });
  const child = spawn(process.execPath, [C.real, ...process.argv.slice(2)], { env: { ...process.env, LESSLOC_STATE: C.state, LESSLOC_OFF: C.off }, stdio: 'pipe' });
  let stdin = '', stdout = '', stderr = '';
  process.stdin.on('data', d => ((stdin += d), child.stdin.write(d))).on('end', () => child.stdin.end());
  child.stdin.on('error', () => {});
  child.stdout.on('data', d => (stdout += d));
  child.stderr.on('data', d => (stderr += d));
  child.on('close', code => {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    const ours = `${process.cwd()}\n${stdin}`.includes(C.work);
    line(ours ? { end: Date.now(), env, tree, stdin, stdout, stderr, code } : { end: Date.now(), elsewhere: true });
    process.exit(code ?? 1);
  });
};

// Puts the wrapper in place in `dir`, a copy of the checkout. It runs the real hook beside it, so a tool that copies the folder
// (Claude Code's and Codex's plugin installs) runs its own copy.
export function wrap(dir, cfg) {
  fs.renameSync(path.join(dir, 'hook.mjs'), path.join(dir, 'hook.real.mjs'));
  fs.writeFileSync(path.join(dir, 'hook.mjs'), `import * as spawn from 'node:child_process';\nimport fs from 'node:fs';\nimport { fileURLToPath } from 'node:url';\n(${main})({ spawn, fs, real: fileURLToPath(new URL('./hook.real.mjs', import.meta.url)), ...${JSON.stringify(cfg)} });\n`);
}

// A value of a tool's answer at a fixture's answer path. The path may end in `|field=value`: then it is read only when the
// answer's field has that value.
const get = (o, p) => p?.split('.').reduce((x, k) => x?.[k], o);
export const at = (o, p) => {
  const [where, when] = String(p).split('|'), [field, value] = (when || '').split('=');
  return !when || String(get(o, field)) === value ? get(o, where) : undefined;
};

// JSON a tool or a hook wrote, or nothing when it wrote none.
export const parse = s => {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
};

// The recording's calls in the order they started, each with its end once it has one, and the payload parsed. A line a hook is
// still writing is skipped.
export function calls(file) {
  const open = new Map(), out = [];
  for (const l of fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').map(parse) : []) {
    if (l.start) out.push(open.set(l.pid, { ...l, ended: false }).get(l.pid));
    else if (open.has(l.pid)) Object.assign(open.get(l.pid), l, { ended: true }), open.delete(l.pid);
  }
  return out.map(c => ({ ...c, input: parse(c.stdin) }));
}

// Nothing lessloc says may name it or show its command, a kind tag or a citation (the unit tests' pattern).
export const QUIET = /lessloc|\bnode\s|\.mjs\b|\[[a-z]+(?:-[a-z]+)*\]|\(CWE-|et al\./i;
// What lessloc says at each moment of the scenario, the same in what reaches the model and in the hook's answer.
export const SAYS = { placeholder: /Not applied: it adds a placeholder/, note: /shop\/load\.js:\d+: swallowed error/, hold: /Before you finish[\s\S]*shop\/load\.js/ };

// The checks that read lessloc's state (the repository's folder in it) and the work repository, the same after a real session
// and after its replay. `cli` is lessloc.mjs, `env` runs it with that state. A tool may wrap the request (OpenCode's `run`
// quotes it), and the handoff keeps it as the tool passed it on.
export const outcomes = ({ state, work, env, cli, sid, prompt }) => ({
  A5: () => {
    const ev = path.join(state, 'evidence');
    assert.ok(fs.readdirSync(ev).map(f => JSON.parse(fs.readFileSync(path.join(ev, f), 'utf8'))).some(r => r.ok === false && r.test.includes('npm test')));
  },
  A7: () => {
    execFileSync('git', ['add', '-A'], { cwd: work, env, stdio: 'ignore' });
    assert.match(spawnSync(process.execPath, [cli, 'check', '--staged'], { cwd: work, env, encoding: 'utf8' }).stdout, /tests passed at this exact state/);
  },
  A8: () => {
    const f = path.join(state, 'ledger', `${sid}.json`), e = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    assert.ok(e.prompt?.includes(prompt), `the request, as the tool passed it on: ${e.prompt}`);
    assert.ok(e.files?.includes('shop/load.js'));
    assert.equal(e.verified, 'tests passed');
  },
});

// Writes the recording the replay in npm test plays: a header (the tool, its version, the answer paths, the checks the session
// passed), the work repository's first commit, then each hook call with the files changed since the call before. The run's
// folders, and the slugs tools make of them, become $REPO, $HOME, $TMP and $RUN, and the tools' cache $CACHE; a recording that still
// names a machine path, its user, its host or a key is refused.
export function save(file, header, first, calls, t) {
  let before = first;
  const lines = [header, { step: 'the repository at its last commit', files: first, commit: true }, ...calls.map(c => {
    const files = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(c.tree)])].filter(f => before[f] !== c.tree[f]).map(f => [f, c.tree[f] ?? null]));
    before = c.tree;
    return { step: c.input.hook_event_name ?? c.argv.at(-1), argv: c.argv, env: c.env, files, hook: c.input, stdout: c.stdout, stderr: c.stderr, code: c.code };
  })];
  const slug = p => p.replace(/[^a-zA-Z0-9]/g, '-');
  let text = lines.map(l => `${JSON.stringify(l)}\n`).join('');
  for (const [p, name] of [[t.work, '$REPO'], [t.home, '$HOME'], [t.tmp, '$TMP'], [t.dir, '$RUN'], [t.cache, '$CACHE']]) text = text.replaceAll(p, name).replaceAll(slug(p), slug(name));
  const leak = new RegExp(`(?<!\\w)[/-](?:tmp|home)[/-]|sk-test|x-api-key|\\b(${os.userInfo().username}|${os.hostname()})\\b`, 'i').exec(text);
  if (leak) throw new Error(`${file} would hold ${leak[0]}: ${text.slice(Math.max(0, leak.index - 80), leak.index + 80)}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
