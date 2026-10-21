#!/usr/bin/env node
// What lessloc costs an agent session without any model: one scripted session's hook events (start, prompt, a search, an
// edit, a test run, stop) replayed through a lessloc checkout's hook on a throwaway clone of a repository, with each event's
// time and the tokens it adds to the agent's context.
//   node bench/weight.mjs <repo> --file <path to edit> --prompt <text> [--lessloc <dir>] [--test <command>] [--runs 5] [--show]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2), opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const [source] = args, LESSLOC = path.resolve(opt('--lessloc', path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))), RUNS = Number(opt('--runs', 5));
const file = opt('--file'), prompt = opt('--prompt'), test = opt('--test', 'python -m pytest -q');
if (!source || !file || !prompt) throw new Error('usage: weight.mjs <repo> --file <path> --prompt <text> [--lessloc <dir>] [--test <command>] [--runs 5]');
const entry = [path.join(LESSLOC, 'hook.mjs')];

// The tokens an event adds to the agent's context, from whichever field its answer uses.
const said = (out, err, code) => {
  let o = {};
  try { o = out ? JSON.parse(out) : {}; } catch { /* not JSON */ }
  const s = o.hookSpecificOutput ?? {};
  return [s.additionalContext, s.permissionDecision === 'deny' ? s.permissionDecisionReason : '', o.reason, code === 2 ? err : ''].filter(Boolean).join('\n');
};

function session(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-weight-')), home = fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-weight-home-'));
  const env = { ...process.env, LESSLOC_STATE: path.join(home, 'state'), LESSLOC_OFF: '', LESSLOC: '' };
  try {
    execFileSync('git', ['clone', '-q', '--no-local', source, dir], { stdio: 'ignore' });
    const target = path.join(dir, file), before = fs.readFileSync(target, 'utf8'), last = before.trimEnd().split('\n').at(-1);
    const added = `${last}\n\n\ndef _weight_probe(value):\n    return value * 2\n`, rows = [];
    const event = (name, input, write) => {
      const t0 = performance.now(), r = spawnSync('node', entry, { cwd: dir, input: JSON.stringify({ cwd: dir, session_id: `w${run}`, hook_event_name: name, ...input }), encoding: 'utf8', env });
      const ms = performance.now() - t0, text = said(r.stdout, r.stderr, r.status);
      if (write) write();
      rows.push({ event: name + (input.tool_name ? `:${input.tool_name}` : ''), ms, tokens: Math.round(text.length / 4), text });
    };
    const tool = (name, tool_name, tool_input, extra = {}) => event(name, { tool_name, tool_use_id: `${tool_name}-${rows.length}`, tool_input, ...extra });
    event('SessionStart', { source: 'startup' });
    event('UserPromptSubmit', { prompt });
    const grep = { command: `grep -rn "def " ${path.dirname(file)} | head -20` };
    tool('PreToolUse', 'Bash', grep);
    tool('PostToolUse', 'Bash', grep, { tool_response: { stdout: '', stderr: '' } });
    const edit = { file_path: target, old_string: last, new_string: added };
    event('PreToolUse', { tool_name: 'Edit', tool_use_id: 'e', tool_input: edit }, () => fs.writeFileSync(target, before.replace(last, added)));
    event('PostToolUse', { tool_name: 'Edit', tool_use_id: 'e', tool_input: edit });
    event('PreToolUse', { tool_name: 'Bash', tool_use_id: 't', tool_input: { command: test } });
    event('PostToolUse', { tool_name: 'Bash', tool_use_id: 't', tool_input: { command: test }, tool_response: { stdout: '812 passed in 9.10s', stderr: '' } });
    event('Stop', { stop_hook_active: false, last_assistant_message: 'Added _weight_probe; the tests pass.' });
    return rows;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const all = Array.from({ length: RUNS }, (_, i) => session(i)), med = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
console.log(`lessloc ${LESSLOC}, ${RUNS} sessions on ${source}`);
for (const [i, r] of all[0].entries()) console.log(`${r.event.padEnd(22)} ${String(Math.round(med(all.map(s => s[i].ms)))).padStart(6)} ms ${String(med(all.map(s => s[i].tokens))).padStart(6)} tokens`);
if (args.includes('--show')) for (const r of all[0].filter(r => r.text)) console.log(`\n--- ${r.event}\n${r.text}`);
console.log(`${'session'.padEnd(22)} ${String(Math.round(med(all.map(s => s.reduce((a, r) => a + r.ms, 0))))).padStart(6)} ms ${String(med(all.map(s => s.reduce((a, r) => a + r.tokens, 0)))).padStart(6)} tokens`);
