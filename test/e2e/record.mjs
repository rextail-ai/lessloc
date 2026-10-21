// The hook wrapper of the end-to-end tests. It takes the place of hook.mjs in the copy of the checkout a tool loads, runs the
// real hook (hook.real.mjs) with the same arguments, input and environment, gives back its output and exit code unchanged,
// and writes a start and an end line for each call to the recording. lessloc's state folder and switches are baked in, so a
// tool that scrubs its hooks' environment can move neither. Only calls about the work repository are recorded: doctor's and
// init's own checks run the hook elsewhere.
import fs from 'node:fs';
import path from 'node:path';

const main = C => {
  const { spawn } = C.spawn, line = o => C.fs.appendFileSync(C.record, `${JSON.stringify({ pid: process.pid, ...o })}\n`);
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
    line(ours ? { end: Date.now(), stdin, stdout, stderr, code } : { end: Date.now(), elsewhere: true });
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

// The recording's calls in the order they started, each with its end once it has one, and the payload parsed.
export function calls(file) {
  const open = new Map(), out = [];
  for (const l of fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []) {
    if (l.start) out.push(open.set(l.pid, { ...l, ended: false }).get(l.pid));
    else if (open.has(l.pid)) Object.assign(open.get(l.pid), l, { ended: true }), open.delete(l.pid);
  }
  return out.map(c => ({ ...c, input: (() => { try { return JSON.parse(c.stdin || '{}'); } catch { return {}; } })() }));
}
