import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CLI = new URL('../lessloc.mjs', import.meta.url).pathname;
export const FN = 'def total(items):\n    result = 0\n    for item in items:\n        if item.price > 0:\n            result += item.price * item.qty\n        else:\n            result -= item.refund\n    return round(result, 2)\n';
// Each test process keeps everything it creates in one folder of its own, removed on exit: lessloc's state, the test
// repositories and, through TMPDIR, whatever the tests and the processes they start put in the temporary folder. The settings
// go into this process's own environment, so every process it starts inherits them, git hooks included.
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-test-')));
process.env.TMPDIR = ROOT;
process.on('exit', () => fs.rmSync(ROOT, { recursive: true, force: true }));
export const tmp = prefix => fs.mkdtempSync(path.join(ROOT, prefix));
export const STATE = tmp('state-');
// A home folder of its own, so no test reads or writes the agent tools' real settings, and no marker of the agent tool that
// runs the tests (Claude Code's CLAUDECODE, for one) makes lessloc think it runs inside that tool.
const AGENT_ENV = ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'CODEX_THREAD_ID', 'CURSOR_AGENT', 'OPENCODE_TERMINAL', 'GEMINI_CLI', 'COPILOT_CLI', 'COPILOT_HOME', 'KILO_PID', 'CLINE_ACTIVE', 'CLINE_DIR', 'PI_CODING_AGENT', 'PI_CODING_AGENT_DIR', 'QWEN_CODE', 'AUGMENT_AGENT', 'GOOSE_TERMINAL', 'DEVIN_PROJECT_DIR', 'OH_PERSISTENCE_DIR', 'CRUSH', 'CRUSH_GLOBAL_CONFIG', 'XDG_CONFIG_HOME'];
export const ENV = Object.assign(process.env, { LESSLOC_STATE: STATE, LESSLOC_OFF: '', LESSLOC: '', HOME: tmp('home-') }, Object.fromEntries(AGENT_ENV.map(k => [k, ''])));

export const write = (dir, files) => {
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
};
export const commit = (dir, msg = 'c') => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', msg, '--allow-empty'], { cwd: dir, encoding: 'utf8', env: ENV });
export const repo = (files = {}) => {
  const dir = tmp('repo-');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  write(dir, files);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  commit(dir);
  return dir;
};
export const run = (dir, ...args) => spawnSync('node', [CLI, ...args], { cwd: dir, encoding: 'utf8', env: ENV });
export const findings = (dir, ...args) => JSON.parse(run(dir, 'check', '--json', ...args).stdout).findings;
// The hook as Claude Code runs it: plugin.json's command, hook.mjs with no host flag.
export const ENTRY = new URL('../hook.mjs', import.meta.url).pathname;
export const hook = (dir, input, env = {}) => {
  const r = spawnSync('node', [ENTRY], { cwd: dir, input: JSON.stringify({ cwd: dir, session_id: 's', ...input }), encoding: 'utf8', env: { ...ENV, ...env } });
  return r.status === 2 ? { stderr: r.stderr } : r.stdout ? JSON.parse(r.stdout) : null;
};
export const deny = (dir, tool_name, tool_input) => hook(dir, { hook_event_name: 'PreToolUse', tool_name, tool_input })?.hookSpecificOutput?.permissionDecisionReason;
// What an agent's Write tool does: the gate sees the file first, then it lands.
export const agentWrite = (dir, files, extra = {}) => {
  for (const [f, content] of Object.entries(files)) {
    const o = hook(dir, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_use_id: f, tool_input: { file_path: path.join(dir, f), content }, ...extra });
    if (o?.hookSpecificOutput?.permissionDecision === 'deny') throw new Error(o.hookSpecificOutput.permissionDecisionReason);
    write(dir, { [f]: content });
  }
};
// What an agent's shell command does: a snapshot before, the command's writes, the check after.
export const agentShell = (dir, command, files, extra = {}) => {
  hook(dir, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: command, tool_input: { command }, ...extra });
  write(dir, files);
  return hook(dir, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: command, tool_input: { command }, ...extra });
};
export const turn = (dir, prompt) => hook(dir, { hook_event_name: 'UserPromptSubmit', prompt });
export const stop = (dir, extra = {}) => hook(dir, { hook_event_name: 'Stop', ...extra });
// A fixture's payload with its $NAME placeholders filled in. A placeholder that is a whole value keeps its type (a number, a
// boolean); inside a string, it is written in.
export function fill(x, vars) {
  if (Array.isArray(x)) return x.map(y => fill(y, vars));
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fill(v, vars)]));
  if (typeof x !== 'string') return x;
  if (/^\$[A-Z_]+$/.test(x) && x.slice(1) in vars) return vars[x.slice(1)];
  return x.replace(/\$([A-Z_]+)/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
