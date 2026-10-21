#!/usr/bin/env node
// Turns mined changes into the frozen task list of the long-horizon benchmark. Every change stays a task, so the code an agent
// builds on never misses a step; a task is judged when its real change brought tests that can judge it:
// 1. The tests the change added or changed that fail before it (at its real parent, with the new tests) and pass after it.
// 2. A test that uses a name the change introduced, where the task text never mentions that name, is dropped: an agent could
//    not know it (SWE-bench Verified's rule for underspecified tasks). The rest are cut into hidden test files.
// 3. Hidden tests are graded in the test folders an agent has: the project's test helpers (conftest.py and other non-test
//    modules) as they were at the start, plus the data files the change added for its tests. A test that needs newer helpers
//    cannot judge an agent fairly, so it is dropped.
// 4. A hidden test that a later real change breaks (behavior the project changed on purpose) retires at that change, found by
//    a binary search over the main-line commits where later tasks landed.
// 5. A hidden test that already passes at the start cannot show an agent's work: the behavior existed, a later change broke
//    it, and the task restored it. Such a test is dropped from judging.
// usage: node bench/real/prepare.mjs <candidates.json> <clone dir> <out dir>
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesIn, overlay } from './hidden.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), SLICE = path.join(HERE, 'slice.py');
const [first, clone, out] = process.argv.slice(2).map(p => path.resolve(p));
const { project: P, candidates } = JSON.parse(fs.readFileSync(first, 'utf8'));
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
const slice = (...a) => execFileSync('python3', [SLICE, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const log = msg => process.stderr.write(`${msg}\n`);
const isTestModule = f => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(f);

const wt = path.join(out, 'work');
if (!fs.existsSync(wt)) git(clone, 'worktree', 'add', '-q', '--detach', wt, P.start);
let at = null;
function checkout(sha) {
  if (at === sha) return;
  git(wt, 'checkout', '-q', '--detach', '--force', sha);
  git(wt, 'clean', '-fdxq', '-e', '.venv');
  const r = spawnSync('bash', ['-c', P.setup], { cwd: wt, encoding: 'utf8' });
  if (r.status) throw new Error(`setup failed at ${sha}: ${r.stderr.slice(-400)}`);
  at = sha;
}
// The test helpers an agent has: every non-test Python file under the test folders, and every submodule (test data), as they
// were at the start.
const helpersAtStart = git(clone, 'ls-tree', '-r', '--name-only', P.start, '--', ...P.tests).split('\n').filter(f => f.endsWith('.py') && !isTestModule(f));
const submodulesAtStart = git(clone, 'ls-tree', '-r', P.start).split('\n').filter(l => l.startsWith('160000 ')).map(l => l.split('\t')[1]);
function startHelpers() {
  for (const f of git(wt, 'ls-files', '--', ...P.tests).split('\n').filter(f => f.endsWith('.py') && !isTestModule(f) && !helpersAtStart.includes(f))) fs.rmSync(path.join(wt, f), { force: true });
  if (helpersAtStart.length) git(wt, 'checkout', P.start, '--', ...helpersAtStart);
  if (submodulesAtStart.length) git(wt, 'checkout', P.start, '--', ...submodulesAtStart), git(wt, 'submodule', 'update', '-q', '--init', '--', ...submodulesAtStart);
  at = null;
}
// Outcome per test id, from pytest's summary.
function pytest(files) {
  const r = spawnSync(path.join(wt, P.python), ['-m', 'pytest', '-p', 'no:cacheprovider', '-rA', '-q', '--no-header', ...files], { cwd: wt, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 900e3 });
  return Object.fromEntries([...(r.stdout || '').matchAll(/^(PASSED|FAILED|ERROR|XFAIL|XPASS) (\S+)/gm)].map(m => [m[2], m[1]]));
}
const nameOf = id => id.split('::').slice(1).join('::').replace(/\[.*$/, '');
const fileOf = id => id.split('::')[0];
const tmp = (name, text) => (fs.mkdirSync(path.join(out, 'tmp'), { recursive: true }), fs.writeFileSync(path.join(out, 'tmp', name), text), path.join(out, 'tmp', name));
const mentions = (text, name) => new RegExp(`(^|[^\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`).test(text);
// Production lines, counted as the benchmark counts them for agents: non-blank lines that are not comments.
const lines = sha => git(clone, 'ls-tree', '-r', '--name-only', sha, '--', ...P.source).split('\n').filter(f => f.endsWith('.py'))
  .reduce((n, f) => n + git(clone, 'show', `${sha}:${f}`).split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length, 0);

const bundle = id => path.join(out, 'hidden', id);
function judged(t) {
  const restore = overlay(wt, [bundle(t.id)]), r = pytest(t.hidden.map(h => h.file));
  restore();
  return r;
}
const passesAt = (t, sha) => (checkout(sha), startHelpers(), (r => t.hidden.flatMap(h => h.ids).every(id => r[id] === 'PASSED'))(judged(t)));

const tasks = [];
for (const c of candidates) {
  const files = c.tests.filter(f => isTestModule(f) && !tryGit(clone, 'cat-file', '-e', `${c.sha}:${f}`).status), t = { id: c.id, hidden: [] };
  if (files.length) {
    checkout(c.sha);
    const after = pytest(files);
    checkout(c.parent);
    for (const f of files) fs.mkdirSync(path.dirname(path.join(wt, f)), { recursive: true }), fs.writeFileSync(path.join(wt, f), git(clone, 'show', `${c.sha}:${f}`) + '\n');
    const before = pytest(files);
    at = null;
    fs.rmSync(bundle(c.id), { recursive: true, force: true });
    for (const [i, f] of files.entries()) {
      const newer = tmp(`new_${i}.py`, git(clone, 'show', `${c.sha}:${f}`)), older = tryGit(clone, 'show', `${c.parent}:${f}`).status ? '-' : tmp(`old_${i}.py`, git(clone, 'show', `${c.parent}:${f}`));
      const changed = new Set(slice('changed', older, newer).split('\n').filter(Boolean));
      const ids = Object.keys(after).filter(id => fileOf(id) === f && after[id] === 'PASSED' && before[id] !== 'PASSED' && changed.has(nameOf(id)));
      const names = [...new Set(ids.map(nameOf))].filter(name => {
        const introduced = slice('names', newer, name).split('\n').filter(n => n.length > 2 && !tryGit(clone, 'grep', '-q', '-w', '-e', n, c.sha, '--', ...P.source).status && tryGit(clone, 'grep', '-q', '-w', '-e', n, c.parent, '--', ...P.source).status);
        const unknown = introduced.filter(n => !mentions(c.text, n));
        if (unknown.length) log(`  ${c.id} ${name}: uses ${unknown.join(', ')}, which the task text never names`);
        return !unknown.length;
      });
      if (!names.length) continue;
      const rel = path.posix.join(path.posix.dirname(f), `test_lessloc_${c.id}_${path.posix.basename(f)}`);
      fs.mkdirSync(path.dirname(path.join(bundle(c.id), rel)), { recursive: true });
      fs.writeFileSync(path.join(bundle(c.id), rel), slice('cut', newer, ...names) + '\n');
      t.hidden.push({ file: rel, ids: ids.filter(id => names.includes(nameOf(id))).map(id => `${rel}::${id.split('::').slice(1).join('::')}`) });
    }
    // The data files the change added or changed for its tests travel with them.
    if (t.hidden.length) for (const f of git(clone, 'diff', '--name-only', '--diff-filter=AM', c.parent, c.sha, '--', ...P.tests).split('\n').filter(f => f && !f.endsWith('.py') && tryGit(clone, 'cat-file', '-t', `${c.sha}:${f}`).stdout.trim() === 'blob')) {
      fs.mkdirSync(path.dirname(path.join(bundle(c.id), f)), { recursive: true });
      fs.writeFileSync(path.join(bundle(c.id), f), execFileSync('git', ['-C', clone, 'show', `${c.sha}:${f}`], { maxBuffer: 1 << 28 }));
    }
    // Judged with the helpers an agent has: kept only if it passes after the change and fails before it.
    if (t.hidden.length) {
      checkout(c.sha);
      startHelpers();
      const ok = judged(t);
      checkout(c.parent);
      startHelpers();
      const bad = judged(t);
      for (const h of t.hidden) h.ids = h.ids.filter(id => ok[id] === 'PASSED' && bad[id] !== 'PASSED');
      t.hidden = t.hidden.filter(h => h.ids.length);
      if (!t.hidden.length) log(`  ${c.id}: its tests need test helpers newer than the start`);
    }
    if (!t.hidden.length) fs.rmSync(bundle(c.id), { recursive: true, force: true });
    else for (const f of filesIn(bundle(c.id)).filter(f => f.endsWith('.py') && !t.hidden.some(h => h.file === f))) fs.rmSync(path.join(bundle(c.id), f));
  }
  tasks.push({ id: c.id, pr: c.pr, issue: c.issue, merged: c.merged, landed: c.landed, title: c.title, text: c.text, judged: t.hidden.length > 0, hidden: t.hidden, humanCode: lines(c.landed) });
  log(`${tasks.length} ${c.id}: ${t.hidden.length ? `judged by ${t.hidden.reduce((n, h) => n + h.ids.length, 0)} hidden tests` : 'not judged'}`);
}

// Retirement: does a judged task's hidden test still pass where a later task landed? Searched only where it fails at the end.
for (const [j, t] of tasks.entries()) {
  if (!t.judged) continue;
  let lo = j + 1, hi = tasks.length - 1;
  if (hi < lo || passesAt(t, tasks[hi].landed)) continue;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (passesAt(t, tasks[mid].landed)) lo = mid + 1;
    else hi = mid;
  }
  t.retiredBy = tasks[lo].id;
  log(`  ${t.id} retires at ${t.retiredBy}`);
}
// A hidden test that passes at the start judges nothing an agent did.
checkout(P.start);
startHelpers();
for (const t of tasks.filter(x => x.judged)) {
  const r = judged(t);
  for (const h of t.hidden) h.ids = h.ids.filter(id => r[id] !== 'PASSED');
  t.hidden = t.hidden.filter(h => h.ids.length);
  if (!t.hidden.length) Object.assign(t, { judged: false }), fs.rmSync(bundle(t.id), { recursive: true, force: true }), log(`  ${t.id}: its tests already pass at the start, so they judge nothing`);
}
const body = JSON.stringify({ project: P, startCode: lines(git(clone, 'rev-parse', P.start)), tasks }, null, 1);
fs.writeFileSync(path.join(out, 'tasks.json'), body);
fs.writeFileSync(path.join(out, 'tasks.sha256'), createHash('sha256').update(body).digest('hex') + '\n');
log(`${tasks.length} tasks, ${tasks.filter(t => t.judged).length} judged; ${path.join(out, 'tasks.json')}`);
