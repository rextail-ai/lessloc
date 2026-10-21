#!/usr/bin/env node
// Refusing unfinished work, measured without a model. For each judged task of a prepared real project, the human's change is
// a finished candidate, and variants of it with work left out are unfinished ones. Each candidate is replayed through
// lessloc's hooks the way an agent would make it (the request, its writes, a real test run, its last words), and the task's
// hidden tests say whether its code is finished. A hold on finished work is a false reject; no hold on unfinished work is a
// false accept.
//   node bench/candidates.mjs <prepared dir> <clone> [--tasks pr471,pr486] [--lessloc <dir>]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { overlay } from './real/hidden.mjs';

const args = process.argv.slice(2), opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [prepared, clone] = args.slice(0, 2).map(p => path.resolve(p));
const LESSLOC = path.resolve(opt('--lessloc') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const { project: P, tasks: ALL } = JSON.parse(fs.readFileSync(path.join(prepared, 'tasks.json'), 'utf8'));
const only = opt('--tasks')?.split(','), TASKS = ALL.filter(t => t.judged && (!only || only.includes(t.id)));
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
const TEST = `${P.python} -m pytest -q -p no:cacheprovider`, isTest = f => P.tests.some(r => f.startsWith(`${r}/`)), isSource = f => P.source.some(r => f.startsWith(`${r}/`)) && f.endsWith('.py');

// One working copy with the full history and the project's environment, reset to each task's parent before each candidate.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-candidates-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
execFileSync('git', ['clone', '-q', '--no-local', clone, dir], { stdio: 'ignore' });
fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '.venv/\n.lessloc.json\n');
const reset = rev => {
  git(dir, 'checkout', '-qf', rev);
  git(dir, 'clean', '-fdqx', '-e', '.venv', '-e', '.lessloc.json');
  spawnSync('git', ['-C', dir, 'submodule', 'update', '-q', '--init', '--recursive'], { stdio: 'ignore' });
};
reset(TASKS[0].landed);
if (spawnSync('bash', ['-c', P.setup], { cwd: dir, encoding: 'utf8' }).status) throw new Error('setup failed');
fs.writeFileSync(path.join(dir, '.lessloc.json'), JSON.stringify({ test: TEST }));

const hook = (input, state) => {
  const r = spawnSync('node', [path.join(LESSLOC, 'hook.mjs')], { cwd: dir, input: JSON.stringify({ cwd: dir, session_id: 'c', ...input }), encoding: 'utf8', env: { ...process.env, LESSLOC_STATE: state, LESSLOC_OFF: '', LESSLOC: '' } });
  try { return r.stdout ? JSON.parse(r.stdout) : {}; } catch { return {}; }
};
// The task's hidden tests on the current tree: whether the change's own checks pass.
function finished(t) {
  const restore = overlay(dir, [path.join(prepared, 'hidden', t.id)]);
  try {
    const r = spawnSync(path.join(dir, P.python), ['-m', 'pytest', '-p', 'no:cacheprovider', '-rA', '-q', '--no-header', ...t.hidden.map(h => h.file)], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 900e3 });
    const res = Object.fromEntries([...(r.stdout || '').matchAll(/^(PASSED|FAILED|ERROR) (\S+)/gm)].map(m => [m[2], m[1]]));
    return t.hidden.flatMap(h => h.ids).every(id => res[id] === 'PASSED');
  } finally { restore(); }
}

// A candidate: the files it writes (path -> text, or null to delete), and how its session ends.
function replay(t, files, { run = 'last', said = 'Done. The tests pass.' } = {}) {
  reset(`${t.landed}^`);
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-candidates-state-')), entries = Object.entries(files);
  try {
    hook({ hook_event_name: 'SessionStart', source: 'startup' }, state);
    hook({ hook_event_name: 'UserPromptSubmit', prompt: `Resolve this issue in the repository:\n\n${t.text}` }, state);
    const notes = [], test = () => {
      const id = `t${Math.random()}`;
      hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: id, tool_input: { command: TEST } }, state);
      const r = spawnSync('bash', ['-c', TEST], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 900e3 });
      hook({ hook_event_name: r.status === 0 ? 'PostToolUse' : 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: id, tool_input: { command: TEST }, tool_response: { stdout: (r.stdout || '').slice(-4000), stderr: (r.stderr || '').slice(-2000), interrupted: false }, ...(r.status ? { error: `Exit code ${r.status}\n${(r.stdout || '').slice(-2000)}` } : {}) }, state);
    };
    for (const [i, [f, text]] of entries.entries()) {
      if (run === 'stale' && i === entries.length - 1) test();
      const abs = path.join(dir, f), content = text ?? '';
      const pre = hook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_use_id: f, tool_input: { file_path: abs, content } }, state).hookSpecificOutput;
      if (pre?.permissionDecision === 'deny') return { denied: pre.permissionDecisionReason };
      if (text == null) fs.rmSync(abs, { force: true });
      else fs.mkdirSync(path.dirname(abs), { recursive: true }), fs.writeFileSync(abs, text);
      const post = hook({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_use_id: f, tool_input: { file_path: abs, content } }, state).hookSpecificOutput?.additionalContext;
      if (post) notes.push(post);
    }
    if (run === 'last') test();
    const held = hook({ hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: said }, state).reason || '';
    return { held, notes, finished: finished(t) };
  } finally { fs.rmSync(state, { recursive: true, force: true }); }
}

// The human change, file by file, and variants with work left out.
function variants(t) {
  const changed = git(dir, 'diff', '--name-only', `${t.landed}^`, t.landed).split('\n').filter(Boolean);
  const at = f => { try { return git(dir, 'show', `${t.landed}:${f}`); } catch { return null; } };
  const human = Object.fromEntries(changed.map(f => [f, at(f)])), source = changed.filter(isSource), out = { human: [human] };
  out['no tests'] = [Object.fromEntries(Object.entries(human).filter(([f]) => !isTest(f)))];
  if (source.length > 1) out['half the fix'] = [Object.fromEntries(Object.entries(human).filter(([f]) => !source.slice(Math.ceil(source.length / 2)).includes(f)))];
  // A stub where the human wrote the first new block of a function: the rest of the change as written.
  for (const f of source) {
    const diff = git(dir, 'diff', '-U0', `${t.landed}^`, t.landed, '--', f), hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/m.exec(diff);
    const lines = (human[f] || '').split('\n'), from = hunk && Number(hunk[1]) - 1, n = hunk && Number(hunk[2] ?? 1);
    if (!hunk || !n || !/^\s{4,}\S/.test(lines[from] || '')) continue;
    lines.splice(from, n, `${lines[from].match(/^\s*/)[0]}raise NotImplementedError`);
    out.stub = [{ ...human, [f]: lines.join('\n') }];
    break;
  }
  out['no test run'] = [human, { run: 'none' }];
  out['run before the last edit'] = [human, { run: 'stale' }];
  return out;
}

const rows = [];
for (const t of TASKS) {
  reset(t.landed);
  for (const [name, [files, how]] of Object.entries(variants(t))) {
    const r = replay(t, files, how);
    rows.push({ task: t.id, variant: name, ...r });
    const items = (r.held || '').split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2, 110));
    console.error(`${t.id} ${name}: ${r.denied ? `refused at write (${r.denied.slice(0, 100)})` : items.length ? `held: ${items.join(' | ')}` : 'not held'}; hidden tests ${r.finished ? 'pass' : 'fail'}`);
  }
}
const file = path.join(os.tmpdir(), `lessloc-candidates-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(rows, null, 1), { flag: 'wx', mode: 0o600 });
// Per variant: how many candidates, how many stopped (refused at write or held), and how many finished by the hidden tests.
console.log(`| variant | candidates | stopped | not stopped | hidden tests pass |\n|---|--:|--:|--:|--:|`);
for (const v of [...new Set(rows.map(r => r.variant))]) {
  const xs = rows.filter(r => r.variant === v), stopped = xs.filter(r => r.denied || r.held).length;
  console.log(`| ${v} | ${xs.length} | ${stopped} | ${xs.length - stopped} | ${xs.filter(r => r.finished).length} |`);
}
const kinds = rows.flatMap(r => (r.held || '').split('\n').filter(l => l.startsWith('- ')).map(l => `${r.variant}: ${l.slice(2).replace(/[`(].*$/, '').slice(0, 70)}`));
console.log(`\nWhat held them, by variant:\n${[...new Set(kinds)].map(k => `- ${k} (${kinds.filter(x => x === k).length})`).join('\n')}\n\nraw: ${file}`);
