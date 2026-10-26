import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CLI, ENV, repo, tmp, write } from './helpers.mjs';

// Every address lessloc's update asks goes, through git's own url.<base>.insteadOf, to a local repository or to one that does
// not exist, and git may use no transport but file://, so no test reaches the network. These settings are in place before
// lessloc's modules load, as they are for every process a test starts.
const GITCONFIG = path.join(tmp('gitconfig-'), 'config'), MISSING = path.join(tmp('missing-'), 'none.git');
const remotes = ({ update, github = MISSING, extra = '' }) => fs.writeFileSync(GITCONFIG, [
  `[url "file://${update}"]\n\tinsteadOf = https://get.lessloc.org/update/lessloc.git\n\tinsteadOf = https://get.lessloc.org/lessloc.git\n\tinsteadOf = https://get.lessloc.org/repair/lessloc.git`,
  `[url "file://${github}"]\n\tinsteadOf = https://github.com/rextail-ai/lessloc`,
  extra,
].join('\n'));
Object.assign(ENV, { GIT_CONFIG_GLOBAL: GITCONFIG, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
const { fastForward, run, updateFile } = await import('../lib/update.mjs');
const { load, stateDir } = await import('../lib/repo.mjs');
const { STANDARD } = await import('../lib/voice.mjs');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const until = async (ok, ms = 30000) => {
  for (const end = Date.now() + ms; !ok();) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 50));
  }
};
// lessloc's repository as get.lessloc.org serves it: `files` at `version`, released, on main. A release is tagged vX.Y.Z, and
// released/vX.Y.Z once the release workflow has published it.
function server(version, files = {}) {
  const src = tmp('src-'), bare = tmp('bare-');
  git(src, 'init', '-q', '-b', 'main');
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  const s = {
    src, bare,
    commit(more, msg = 'c') {
      write(src, more);
      git(src, 'add', '-A');
      git(src, 'commit', '-qm', msg);
      git(src, 'push', '-q', bare, 'HEAD', '--tags');
    },
    release(v, more = {}, published = true) {
      write(src, { ...more, 'package.json': `${JSON.stringify({ name: 'lessloc', version: v })}\n` });
      git(src, 'add', '-A');
      git(src, 'commit', '-qm', v);
      git(src, 'tag', '-a', '-m', v, `v${v}`);
      if (published) git(src, 'tag', `released/v${v}`);
      git(src, 'push', '-q', bare, 'HEAD', '--tags');
    },
  };
  s.release(version, files);
  remotes({ update: bare });
  return s;
}
// The clone lessloc's install makes.
function clone(dir = path.join(tmp('clone-'), 'lessloc'), from = 'https://get.lessloc.org/lessloc.git') {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(path.dirname(dir), 'clone', '-q', '--depth', '1', from, dir);
  return dir;
}
const head = dir => git(dir, 'rev-parse', 'HEAD'), version = dir => load(path.join(dir, 'package.json')).version;

test('a depth-1 clone fast-forwards to the newest published release, by version and never a pre-release or a version tag the release workflow has not published, and stays shallow', () => {
  const s = server('1.0.0');
  s.commit({ 'docs.md': 'later\n' });
  const dir = clone();
  s.release('1.9.0');
  s.release('1.10.0');
  s.release('1.11.0', {}, false);
  s.commit({ 'next.md': 'x\n' });
  git(s.src, 'tag', '-a', '-m', 'rc', 'v2.0.0-rc.1');
  git(s.src, 'tag', 'released/v2.0.0-rc.1');
  // A released/ tag counts only on the commit its version tag names.
  git(s.src, 'tag', 'released/v3.0.0');
  git(s.src, 'tag', '-a', '-m', 'v', 'v4.0.0', 'v1.10.0');
  git(s.src, 'tag', 'released/v4.0.0');
  git(s.src, 'push', '-q', s.bare, '--tags');
  const r = fastForward(dir);
  assert.deepEqual([r.result, r.from, r.to], ['updated from 1.0.0 to 1.10.0', '1.0.0', '1.10.0']);
  assert.ok(Math.abs(Date.now() - r.updated) < 60000, 'the time of the update');
  assert.equal(head(dir), git(s.src, 'rev-parse', 'v1.10.0^{commit}'));
  assert.equal(git(dir, 'symbolic-ref', '--short', 'HEAD'), 'main', 'the branch moved with it');
  assert.equal(git(dir, 'rev-parse', '--is-shallow-repository'), 'true');
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD'), '3', 'only the commits since the clone came');
  assert.equal(fastForward(dir).result, 'up to date');
  assert.equal(git(dir, 'tag', '--list', '*v1.11*', '*v2*'), '', 'neither an unpublished version nor a pre-release is fetched');
});

test('lessloc.update false in the clone\'s git settings turns the daily check off', () => {
  const s = server('1.0.0'), dir = clone();
  s.release('1.1.0');
  git(dir, 'config', 'lessloc.update', 'false');
  assert.equal(fastForward(dir).result, 'off (lessloc.update false)');
  assert.equal(version(dir), '1.0.0');
  git(dir, 'config', '--unset', 'lessloc.update');
  assert.equal(fastForward(dir).result, 'updated from 1.0.0 to 1.1.0');
});

test('a newer release that does not descend from the clone is fetched but not taken, and an older one is not fetched', () => {
  const s = server('1.0.0');
  s.commit({ 'docs.md': 'later\n' });
  const dir = clone(), at = head(dir);
  git(s.src, 'checkout', '-q', '-b', 'side', 'v1.0.0');
  s.release('2.0.0');
  assert.equal(fastForward(dir).result, 'skipped: v2.0.0 does not descend from this checkout');
  assert.equal(head(dir), at);
  const later = server('3.0.0'), dir3 = clone();
  later.release('2.9.0');
  assert.equal(fastForward(dir3).result, 'up to date', 'never a downgrade');
  assert.equal(git(dir3, 'tag', '--list', '*v2.9.0'), '');
});

test('a checkout that is not lessloc\'s own clean clone on its branch stays as it is', () => {
  const cases = {
    'local changes': dir => fs.appendFileSync(path.join(dir, 'package.json'), ' '),
    'an untracked file': dir => write(dir, { 'notes.txt': 'mine\n' }),
    'commits of its own': dir => (write(dir, { 'mine.md': 'x\n' }), git(dir, 'add', '-A'), git(dir, 'commit', '-qm', 'mine')),
    'a detached HEAD': dir => git(dir, 'checkout', '-q', '--detach'),
    'a branch of its own': dir => git(dir, 'checkout', '-q', '-b', 'mine'),
    'a clone of another address': dir => git(dir, 'remote', 'set-url', 'origin', 'https://example.com/someone/lessloc.git'),
  };
  const why = { 'local changes': 'local changes', 'an untracked file': 'local changes', 'commits of its own': 'commits of its own', 'a detached HEAD': "not on a branch that tracks lessloc's", 'a branch of its own': "not on a branch that tracks lessloc's", 'a clone of another address': "not lessloc's own clone" };
  for (const [name, change] of Object.entries(cases)) {
    const s = server('1.0.0'), dir = clone();
    s.release('1.1.0');
    change(dir);
    const at = head(dir), files = git(dir, 'status', '--porcelain');
    assert.equal(fastForward(dir).result, `skipped: ${why[name]}`, name);
    assert.equal(head(dir), at, name);
    assert.equal(git(dir, 'status', '--porcelain'), files, `${name}: the checkout is untouched`);
  }
  // A copy an agent tool installed (Cursor's plugins), a folder that is no clone, and lessloc inside another repository.
  const s = server('1.0.0'), tool = clone(path.join(ENV.HOME, '.cursor', 'plugins', 'lessloc')), plain = tmp('plain-'), project = repo({ 'node_modules/lessloc/package.json': '{"version":"1.0.0"}' });
  s.release('1.1.0');
  write(plain, { 'package.json': '{"version":"1.0.0"}' });
  for (const dir of [tool, plain, path.join(project, 'node_modules', 'lessloc')]) assert.equal(fastForward(dir).result, "skipped: not lessloc's own clone", dir);
  assert.equal(version(tool), '1.0.0');
});

test('get.lessloc.org failing, the tags come from GitHub; neither answering, nothing changes; a repair clone updates too', () => {
  const s = server('1.0.0'), dir = clone(), repaired = clone(undefined, 'https://get.lessloc.org/repair/lessloc.git');
  s.release('1.1.0');
  remotes({ update: MISSING, github: MISSING });
  assert.equal(fastForward(dir).result, 'no answer from get.lessloc.org or github.com');
  assert.equal(version(dir), '1.0.0');
  remotes({ update: MISSING, github: s.bare });
  assert.equal(fastForward(dir).result, 'updated from 1.0.0 to 1.1.0');
  assert.equal(fastForward(repaired).result, 'updated from 1.0.0 to 1.1.0');
});

test('the update runs no git hook and no filter, whatever the user\'s git settings say', () => {
  const s = server('1.0.0'), dir = clone(), marks = tmp('marks-'), hooks = tmp('hooks-');
  s.release('1.1.0', { '.gitattributes': '* filter=probe\n', 'a.txt': 'raw\n' });
  write(hooks, { 'post-merge': `#!/bin/sh\ntouch "${marks}/hook"\n` });
  fs.chmodSync(path.join(hooks, 'post-merge'), 0o755);
  remotes({ update: s.bare, extra: `[core]\n\thooksPath = ${hooks}\n[filter "probe"]\n\tsmudge = touch "${marks}/smudge"\n\tprocess = touch "${marks}/process"\n\trequired = true` });
  assert.equal(fastForward(dir).result, 'updated from 1.0.0 to 1.1.0');
  assert.deepEqual(fs.readdirSync(marks), []);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'raw\n');
});

test('one update at a time: a lock another process holds stops it, one left over ten minutes is taken over', () => {
  const s = server('1.0.0'), dir = clone(), lock = path.join(path.dirname(updateFile(dir)), 'update.lock');
  s.release('1.1.0');
  fs.writeFileSync(lock, '');
  assert.equal(run(dir, ['update']), false);
  assert.equal(version(dir), '1.0.0');
  fs.utimesSync(lock, new Date(Date.now() - 11 * 60000), new Date(Date.now() - 11 * 60000));
  assert.equal(run(dir, ['update']), true);
  assert.equal(load(updateFile(dir)).result, 'updated from 1.0.0 to 1.1.0');
  assert.ok(!fs.existsSync(lock), 'the lock goes with its process');
});

// lessloc itself, cloned the way its install clones it, with its hooks set up for Codex by `init` from that clone.
const SELF = path.dirname(path.dirname(fileURLToPath(import.meta.url))), VERSION = load(path.join(SELF, 'package.json')).version;
const NEXT = VERSION.replace(/\d+$/, n => Number(n) + 1);
const FILES = Object.fromEntries(['hook.mjs', 'lessloc.mjs', 'package.json', 'RULES.md', ...fs.readdirSync(path.join(SELF, 'lib'), { recursive: true }).map(f => path.join('lib', f))].filter(f => fs.statSync(path.join(SELF, f)).isFile()).map(f => [f, fs.readFileSync(path.join(SELF, f), 'utf8')]));
const sessionStart = (root, work, more = {}, node = []) => spawnSync(process.execPath, [...node, path.join(root, 'hook.mjs')], { cwd: work, input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's', cwd: work, source: 'startup' }), encoding: 'utf8', env: { ...ENV, LESSLOC_OFF: '', ...more } });
test('a session start checks at most once a day, in a detached process that fast-forwards the clone the hooks run from, and the next version rewrites only lessloc\'s entries for this clone, once; LESSLOC_OFF=update turns it off', async () => {
  const s = server(VERSION, FILES), root = clone(path.join(tmp('install-'), '.lessloc')), work = repo({ 'a.py': 'x = 1\n' }), f = updateFile(root);
  const env = { ...ENV, LESSLOC_OFF: '' }, codex = path.join(ENV.HOME, '.codex', 'hooks.json'), gemini = path.join(ENV.HOME, '.gemini', 'settings.json');
  spawnSync(process.execPath, [path.join(root, 'lessloc.mjs'), 'init', '--codex'], { cwd: work, env });
  spawnSync(process.execPath, [CLI, 'init', '--gemini'], { cwd: work, env });
  const geminiText = fs.readFileSync(gemini, 'utf8');
  const start = (more = {}) => sessionStart(root, work, more);
  s.release(NEXT);

  start({ LESSLOC_OFF: 'update' });
  assert.deepEqual(load(f), {}, 'LESSLOC_OFF=update: no check, no rewrite');
  assert.ok(start().stdout.includes(STANDARD.slice(0, 40)), 'the session start still answers');
  const checked = load(f).checked;
  assert.ok(Math.abs(Date.now() - checked) < 60000, 'the check is stamped before it runs');
  await until(() => load(f).result);
  assert.equal(load(f).result, `updated from ${VERSION} to ${NEXT}`);
  assert.equal(version(root), NEXT);
  const doctor = (more = {}) => spawnSync(process.execPath, [path.join(root, 'lessloc.mjs'), 'doctor'], { cwd: work, encoding: 'utf8', env: { ...env, ...more } }).stdout;
  const setting = `git -C "${root}" config lessloc.update false`;
  assert.ok(doctor().includes(`✓ lessloc ${NEXT} in ${root}; auto-update on, daily; last check: ${Math.round((Date.now() - checked) / 60000)} min ago, updated from ${VERSION} to ${NEXT}; to turn it off: ${setting}\n`), 'doctor shows the version, the last check and the setting that turns it off');
  assert.ok(doctor({ LESSLOC_OFF: 'update' }).includes(`✓ lessloc ${NEXT} in ${root}; auto-update off (LESSLOC_OFF=update)\n`));
  git(root, 'config', 'lessloc.update', 'false');
  assert.ok(doctor().includes(`✓ lessloc ${NEXT} in ${root}; auto-update off (${setting})\n`));
  git(root, 'config', '--unset', 'lessloc.update');

  // An older lessloc's entries: one event is missing, and the user added one of their own.
  const mine = { type: 'command', command: 'echo mine' }, old = load(codex);
  const stale = { ...old, hooks: { ...old.hooks, Stop: [{ hooks: [mine] }] } };
  fs.writeFileSync(codex, JSON.stringify(stale, null, 2));
  start();
  assert.equal(load(f).checked, checked, 'one check a day');
  await until(() => load(f).wrote === NEXT);
  assert.deepEqual(load(codex).hooks.Stop.flatMap(e => e.hooks), [mine, ...old.hooks.Stop.flatMap(e => e.hooks)], 'the user\'s entry stays, lessloc\'s comes back');
  assert.deepEqual(load(f).failed, []);
  assert.equal(fs.readFileSync(gemini, 'utf8'), geminiText, 'entries that run another checkout are not touched');

  fs.writeFileSync(codex, JSON.stringify(stale, null, 2));
  const before = load(f);
  start();
  assert.deepEqual(load(f), before, 'the same version rewrites nothing again');
  await new Promise(r => setTimeout(r, 1500));
  assert.deepEqual(load(codex), stale);

  // A rewrite that failed is tried again at the next session start. doctor shows the failure, and a check that left the clone
  // as it was.
  fs.writeFileSync(f, JSON.stringify({ ...load(f), result: 'skipped: local changes', failed: ['Codex: a file in the way'] }));
  assert.match(doctor(), /^! lessloc .*, skipped: local changes; to turn it off: .* \(it updates only .*status\)$/m);
  assert.match(doctor(), new RegExp(`^✗ lessloc ${NEXT.replaceAll('.', '\\.')} could not rewrite its entries: Codex: a file in the way`, 'm'));
  start();
  await until(() => load(f).failed?.length === 0);
  assert.ok(JSON.stringify(load(codex).hooks.Stop).includes('--host codex'));

  // A day later the check runs again. Aider has no session start: its lint command keeps lessloc current instead.
  fs.writeFileSync(f, JSON.stringify({ ...load(f), checked: Date.now() - 864e5 - 1000 }));
  spawnSync(process.execPath, [path.join(root, 'hook.mjs'), '--host', 'aider', 'a.py'], { cwd: work, encoding: 'utf8', env });
  assert.ok(load(f).checked > checked, 'checked again after a day');
  await until(() => load(f).result === 'up to date');

  // A process that could not write the entries, here because another holds the lock, leaves the version unwritten, so the next
  // session start writes them.
  const lock = path.join(path.dirname(f), 'update.lock');
  await until(() => !fs.existsSync(lock));
  fs.writeFileSync(f, JSON.stringify({ ...load(f), wrote: VERSION }));
  fs.writeFileSync(lock, '');
  start();
  assert.equal(load(f).wrote, VERSION, 'not marked as written while the entries are not');
  fs.rmSync(lock);
  start();
  await until(() => load(f).wrote === NEXT);
});

// lessloc's clone as its install makes it, at this version, with the next one released.
const installed = () => {
  const s = server(VERSION, FILES), root = clone(path.join(tmp('install-'), '.lessloc'));
  s.release(NEXT);
  return { root, f: updateFile(root) };
};

test('a session start starts the check before anything else, so nothing that fails after it stops it, and returns while the check runs, which asks no askpass program', async () => {
  const { root, f } = installed(), work = repo({ 'a.py': 'x = 1\n' }), state = stateDir(work);
  // The project's folder of lessloc's state is a file, so nothing of the session can be written.
  fs.rmSync(state, { recursive: true });
  fs.writeFileSync(state, '');
  // A git first on the PATH that holds the background process's ls-remote until the test lets it go, and notes the askpass
  // programs it was given.
  const bin = tmp('bin-'), go = path.join(bin, 'go'), asked = path.join(bin, 'asked');
  write(bin, { git: `#!/bin/sh\ncase " $* " in *" ls-remote "*) printf '%s|%s' "$GIT_ASKPASS" "$SSH_ASKPASS" > "${asked}"; i=0; while [ ! -e "${go}" ] && [ $i -lt 300 ]; do sleep 0.1; i=$((i + 1)); done;; esac\nPATH="\${PATH#*:}" exec git "$@"\n` });
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  assert.equal(sessionStart(root, work, { PATH: `${bin}:${process.env.PATH}`, GIT_ASKPASS: '/bin/false', SSH_ASKPASS: '/bin/false' }).status, 0);
  assert.ok(Math.abs(Date.now() - load(f).checked) < 60000, 'the check started');
  assert.equal(load(f).result, undefined, 'the session start did not wait for it');
  fs.writeFileSync(go, '');
  await until(() => load(f).result);
  assert.equal(load(f).result, `updated from ${VERSION} to ${NEXT}`);
  assert.equal(fs.readFileSync(asked, 'utf8'), '|');
});

test('the session start answers whatever lessloc\'s own update meets: a process that cannot start, a state folder of its clone that cannot be written', () => {
  const { root, f } = installed(), work = repo({ 'a.py': 'x = 1\n' });
  // In the hook, process.execPath names no program, so the background process cannot start.
  const r = sessionStart(root, work, {}, ['--import', `data:text/javascript,${encodeURIComponent(`process.execPath = ${JSON.stringify(MISSING)};`)}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(STANDARD.slice(0, 40)));
  assert.ok(load(f).checked, 'the hook tried to start it');
  fs.rmSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(path.dirname(f), '');
  const again = sessionStart(root, work);
  assert.equal(again.status, 0, again.stderr);
  assert.ok(again.stdout.includes(STANDARD.slice(0, 40)), 'the session still gets its context');
});

test('a release whose rewrite of the entries throws still updates to its fix', async () => {
  const broken = { ...FILES, 'lib/install.mjs': FILES['lib/install.mjs'].replace('export function refresh() {', 'export function refresh() { throw new Error("broken");') };
  assert.notEqual(broken['lib/install.mjs'], FILES['lib/install.mjs']);
  const s = server(VERSION, broken), root = clone(path.join(tmp('install-'), '.lessloc')), work = repo({ 'a.py': 'x = 1\n' });
  s.release(NEXT, { 'lib/install.mjs': FILES['lib/install.mjs'] });
  sessionStart(root, work);
  await until(() => version(root) === NEXT);
});

test('doctor says who updates the copy it runs from: the agent tool that installed it, or nobody for a folder that is not lessloc\'s own clone; a fast-forward that failed is a warning', () => {
  const s = server(VERSION, FILES), work = repo({ 'a.py': 'x = 1\n' });
  const doctor = root => spawnSync(process.execPath, [path.join(root, 'lessloc.mjs'), 'doctor'], { cwd: work, encoding: 'utf8', env: { ...ENV, LESSLOC_OFF: '' } }).stdout;
  const tool = clone(path.join(ENV.HOME, '.cursor', 'plugins', 'cache', 'lessloc')), other = clone(), root = clone();
  s.release(NEXT);
  git(other, 'remote', 'set-url', 'origin', 'https://example.com/someone/lessloc.git');
  assert.ok(doctor(tool).includes(`✓ lessloc ${VERSION} in ${tool}; a copy Cursor installed, updated through Cursor\n`));
  assert.ok(doctor(other).includes(`✓ lessloc ${VERSION} in ${other}; not a clone lessloc may update\n`));
  sessionStart(tool, work);
  assert.equal(load(updateFile(tool)).checked, undefined, 'a session start in the tool\'s copy starts no check');
  fs.writeFileSync(updateFile(root), JSON.stringify({ checked: Date.now(), result: `the fast-forward to v${NEXT} failed` }));
  assert.match(doctor(root), new RegExp(`^! lessloc .*, the fast-forward to v${NEXT.replaceAll('.', '\\.')} failed; .* \\(it updates only .*status\\)$`, 'm'));
});
