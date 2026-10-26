// lessloc keeps the clone it runs from current. At most once a day a session's start has one detached process fast-forward
// this clone to the newest published release, and when this clone's version is not the one that last wrote lessloc's
// entries in the agent tools' files, the same process writes them again. `lessloc.update` false in the clone's git settings
// turns the check off; `LESSLOC_OFF=update` turns both off.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, TOOLS, refresh } from './install.mjs';
import { VERSION, gitOrNull, load, save, stateDir } from './repo.mjs';

const SELF = fileURLToPath(import.meta.url), DAY = 864e5;
// Where the published releases come from. get.lessloc.org serves lessloc's GitHub repository unchanged and counts each check in
// its download total; GitHub is asked when it cannot be reached.
export const REMOTES = ['https://get.lessloc.org/update/lessloc.git', 'https://github.com/rextail-ai/lessloc'];
// The addresses lessloc's own install clones from, its repair clone included. A clone from an agent tool's address
// (get.lessloc.org/claude/...) is the tool's.
const ORIGIN = /^https:\/\/(?:get\.lessloc\.org(?:\/repair)?|github\.com\/rextail-ai)\/lessloc(?:\.git)?\/?$/i;
// What the last check and the last rewrite of the entries did, in this clone's folder of lessloc's state.
export const updateFile = (root = ROOT) => path.join(stateDir(root), 'update.json');

// At a session's start: the daily check when it is due, and the rewrite when this version did not write the entries or could
// not write some of them. A copy an agent tool installed is the tool's to update, so it gets no check. The check is stamped in
// the record before the process starts, so sessions starting together start it once; the version, once the entries are written.
// git asks no one for a password: no terminal prompt, and no askpass program, which editors' terminals and desktops set.
export function keepCurrent(off) {
  if (off.has('update')) return;
  const f = updateFile(), r = load(f), due = !(Math.abs(Date.now() - (r.checked || 0)) < DAY) && !toolOf(ROOT), stale = r.wrote !== VERSION || !!r.failed?.length;
  if (!due && !stale) return;
  if (due) save(f, { ...r, checked: Date.now() });
  const tasks = [due && 'update', stale && 'refresh'].filter(Boolean);
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' };
  // A process that cannot start (no free process slot, a sandbox) changes nothing; a later session start starts it again.
  spawn(process.execPath, [SELF, ...tasks], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true, env }).on('error', () => {}).unref();
}

// The detached process's work, one process per clone at a time: a lock that a process which died left behind is taken over
// after ten minutes. Returns false when another process holds the lock.
export function run(root, tasks) {
  const lock = path.join(stateDir(root), 'update.lock');
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs > 6e5) fs.rmSync(lock, { force: true });
  } catch { /* no lock */ }
  try { fs.closeSync(fs.openSync(lock, 'wx')); } catch { return false; }
  const note = done => save(updateFile(root), { ...load(updateFile(root)), ...done });
  // The update comes first, so a release whose rewrite throws still updates to its fix.
  try {
    if (tasks.includes('update')) note(fastForward(root));
    if (tasks.includes('refresh')) note({ failed: refresh(), wrote: VERSION });
    return true;
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

// Whether version a (X.Y.Z) is newer than b.
const newer = (a, b) => {
  const [x, y] = [a, b].map(v => v.split('.').map(Number)), i = x.findIndex((n, k) => n !== y[k]);
  return i >= 0 && x[i] > y[i];
};
// Whether f is the folder dir or inside it.
const inside = (dir, f) => {
  const r = path.relative(dir, f);
  return !r.startsWith(`..${path.sep}`) && r !== '..' && !path.isAbsolute(r);
};

// The agent tool whose copy of lessloc a folder is: that tool updates it.
export const toolOf = root => TOOLS.find(t => t.dirs().some(d => inside(d, root)));
// Whether the daily check is turned off in the clone's git settings (`git config lessloc.update false`), which reach the
// background process however the agent tool was started, unlike the environment.
export const turnedOff = root => gitOrNull(root, ['config', '--bool', 'lessloc.update'])?.trim() === 'false';
// Whether a folder is lessloc's own clone, the one it may update: the top of a clone of lessloc's addresses, and no agent tool's
// copy.
export function own(root) {
  const top = gitOrNull(root, ['rev-parse', '--show-toplevel'])?.trim(), origin = gitOrNull(root, ['config', 'remote.origin.url'])?.trim();
  return !!top && path.resolve(top) === path.resolve(root) && ORIGIN.test(origin) && !toolOf(root);
}

// Fast-forwards a clone of lessloc to the newest published release when it is newer than the clone and descends from it. A
// release is published once the release workflow has published it and tagged it released/vX.Y.Z on the commit of its version
// tag; a version tag alone, or a pre-release, is not one. A checkout that is not lessloc's own clone, holds changes or commits of its own, or is not on a
// branch that tracks lessloc's is left as it is. Git runs here without hooks, filters, submodules or credential helpers,
// whatever the user's git settings say. Returns what happened.
export function fastForward(root) {
  if (turnedOff(root)) return { result: 'off (lessloc.update false)' };
  // Each filter the settings define is emptied: a .gitattributes in the fetched code could name it.
  const drivers = new Set((gitOrNull(root, ['config', '--name-only', '--get-regexp', '^filter\\.']) || '').match(/(?<=^filter\.).+(?=\.[^.\n]+$)/gm));
  const safe = [
    '-c', 'core.hooksPath=/dev/null', '-c', 'submodule.recurse=false', '-c', 'credential.helper=',
    ...[...drivers].flatMap(d => ['clean=', 'smudge=', 'process=', 'required=false'].flatMap(k => ['-c', `filter.${d}.${k}`])),
  ];
  const git = (args, timeout) => gitOrNull(root, [...safe, ...args], timeout), skip = why => ({ result: `skipped: ${why}` });
  if (!own(root)) return skip("not lessloc's own clone");
  if (git(['status', '--porcelain']) !== '') return skip('local changes');
  if (git(['rev-parse', '--abbrev-ref', '@{upstream}']) == null) return skip("not on a branch that tracks lessloc's");
  if (!git(['for-each-ref', '--contains', 'HEAD', '--count=1', 'refs/remotes/', 'refs/tags/v*', 'refs/tags/released/'])) return skip('commits of its own');
  const version = load(path.join(root, 'package.json')).version || '';
  for (const url of REMOTES) {
    const tags = git(['ls-remote', url, 'refs/tags/v*', 'refs/tags/released/v*'], 60e3);
    if (tags == null) continue;
    // Each tag's commit: an annotated tag's peeled line (^{}) comes after it. released/vX.Y.Z counts only on the commit the
    // version tag names, which only the maintainers can create, so a released/ tag made by anyone else moves nobody.
    const at = new Map([...tags.matchAll(/^(\w+)\trefs\/tags\/(\S+?)(?:\^\{\})?$/gm)].map(m => [m[2], m[1]]));
    const newest = [...at.keys()].map(t => /^released\/v(\d+\.\d+\.\d+)$/.exec(t)?.[1]).filter(v => v && at.get(`released/v${v}`) === at.get(`v${v}`)).reduce((a, b) => (newer(b, a) ? b : a), version);
    if (newest === version) return { result: 'up to date' };
    const tag = `refs/tags/released/v${newest}`;
    if (git(['fetch', '--quiet', '--no-tags', '--no-recurse-submodules', url, `+${tag}:${tag}`], 120e3) == null) continue;
    if (git(['merge-base', '--is-ancestor', 'HEAD', `${tag}^{commit}`]) == null) return skip(`v${newest} does not descend from this checkout`);
    if (git(['merge', '--ff-only', '--quiet', `${tag}^{commit}`]) == null) return { result: `the fast-forward to v${newest} failed` };
    return { result: `updated from ${version} to ${newest}`, from: version, to: newest, updated: Date.now() };
  }
  return { result: 'no answer from get.lessloc.org or github.com' };
}

if (process.argv[1] === SELF) run(ROOT, process.argv.slice(2));
