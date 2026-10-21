import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CLI, ENTRY, ENV, repo, run, tmp, write } from './helpers.mjs';

// Each tool's hook payloads as its documentation gives them, sent through `hook.mjs --host <tool>`, the command its hooks run.
const call = (host, dir, input, env = {}) => {
  const r = spawnSync('node', [ENTRY, '--host', host], { cwd: dir, input: JSON.stringify({ cwd: dir, ...input }), encoding: 'utf8', env: { ...ENV, ...env } });
  return { status: r.status, stderr: r.stderr, out: r.stdout ? JSON.parse(r.stdout) : null };
};
// Nothing a model reads may name lessloc, show a path or command of its own, tag a kind or cite a source.
const quiet = (...texts) => {
  for (const t of texts.filter(Boolean)) assert.doesNotMatch(typeof t === 'string' ? t : JSON.stringify(t), /lessloc|\bnode\s|\.mjs\b|\[[a-z]+(?:-[a-z]+)*\]|\(CWE-|et al\./i);
};
const SWALLOWED = 'def load():\n    try:\n        return open("x").read()\n    except Exception:\n        pass\n';
// Reported right after the write (the swallowed error) and at the end of the turn (the debug print).
const LOADER = `${SWALLOWED}print("debug", load())\n`;
const SUMMARY = 'Ran 3 tests in 0.05s\n\nOK\n';
const MONEY = { 'shop/money.py': 'def format_money(amount):\n    return f"${amount:.2f}"\n' };

test('Codex: patches are gated, tracked and reviewed; feedback never replaces a tool output; "ask" becomes a denial', () => {
  const dir = repo(MONEY), codex = (input, env) => call('codex', dir, { session_id: 'x1', turn_id: 't1', ...input }, env);
  codex({ hook_event_name: 'SessionStart', source: 'startup' });
  assert.match(codex({ hook_event_name: 'UserPromptSubmit', prompt: 'show the money totals' }).out.hookSpecificOutput.additionalContext, /format_money/);
  const placeholder = codex({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_use_id: 'p1', tool_input: { command: '*** Begin Patch\n*** Add File: shop/b.py\n+# ... existing code ...\n*** End Patch\n' } });
  assert.equal(placeholder.out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(placeholder.out.hookSpecificOutput.permissionDecisionReason, /placeholder/);
  const junk = codex({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_use_id: 'p2', tool_input: { command: '*** Begin Patch\n*** Update File: shop/money.py\n*** Move to: shop/money_backup.py\n@@\n-    return f"${amount:.2f}"\n+    return f"${amount:,.2f}"\n*** End Patch\n' } });
  assert.match(junk.out.hookSpecificOutput.permissionDecisionReason, /backup, copy, scratch or report file/);

  const patch = `*** Begin Patch\n*** Add File: shop/load.py\n${LOADER.trimEnd().split('\n').map(l => `+${l}`).join('\n')}\n*** End Patch\n`;
  assert.equal(codex({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_use_id: 'p3', tool_input: { command: patch } }).out, null);
  write(dir, { 'shop/load.py': LOADER });
  const after = codex({ hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_use_id: 'p3', tool_input: { command: patch }, tool_response: 'Success. Updated the following files:\nA shop/load.py' });
  assert.equal(after.status, 0, 'exit code 2 would make Codex replace the tool output with the feedback');
  assert.equal(after.out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.equal(after.out.hookSpecificOutput.additionalContext, 'shop/load.py:4: swallowed error: let it reach a boundary that handles it, or catch only the error you expect');
  const held = codex({ hook_event_name: 'Stop', stop_hook_active: false }).out.reason ?? '';
  assert.match(held, /shop\/load\.py/, 'the patched file is in the turn review');
  quiet(placeholder.out.hookSpecificOutput.permissionDecisionReason, junk.out.hookSpecificOutput.permissionDecisionReason, after.out.hookSpecificOutput.additionalContext, held);

  const policy = codex({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_use_id: 'p4', tool_input: { command: '*** Begin Patch\n*** Add File: .lessloc.json\n+{}\n*** End Patch\n' } });
  assert.match(policy.out.hookSpecificOutput.permissionDecisionReason, /^Not applied: the project's policy file is protected in this project, and only the user may approve that/);
  quiet(policy.out.hookSpecificOutput.permissionDecisionReason);
  const bypass = codex({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'git commit --no-verify -m x' } });
  assert.equal(bypass.out.hookSpecificOutput.permissionDecision, 'deny', 'Codex lets an unanswered "ask" through');
  assert.match(bypass.out.hookSpecificOutput.permissionDecisionReason, /only the user may approve that\. Ask them/);
  quiet(bypass.out.hookSpecificOutput.permissionDecisionReason, codex({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'x9' }).out.hookSpecificOutput.additionalContext);
});

test('Codex: a failed test run is evidence of failure, a passing one of success', () => {
  const dir = repo({ '.lessloc.json': '{"test": "true"}', 'a.py': 'x = 1\n' }), codex = input => call('codex', dir, { session_id: 'x2', turn_id: 't1', ...input });
  codex({ hook_event_name: 'UserPromptSubmit', prompt: 'change x' });
  const tests = (id, response) => {
    codex({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'true' } });
    codex({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'true' }, tool_response: response });
  };
  const verified = () => (execFileSync('git', ['add', '-A'], { cwd: dir }), run(dir, 'check', '--staged').stdout);
  write(dir, { 'a.py': 'x = 2\n' });
  tests('t1', 'Process exited with code 1\nOutput:\nFAILED');
  assert.match(verified(), /tests FAILED at this exact state/);
  tests('t2', 'Process exited with code 0\nOutput:\nOK');
  assert.match(verified(), /tests passed at this exact state \(working tree \(run by the agent\)\)/);
});

test("Codex: where it reports no exit code, the test runner's own summary decides; a verdict printed by anything else proves nothing", () => {
  const dir = repo({ '.lessloc.json': '{"test": "python3 -m pytest"}', 'a.py': 'x = 1\n' }), codex = input => call('codex', dir, { session_id: 'x3', turn_id: 't1', ...input });
  const verified = () => (execFileSync('git', ['add', '-A'], { cwd: dir }), run(dir, 'check', '--staged').stdout);
  const ran = (id, command, response) => {
    codex({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: id, tool_input: { command } });
    codex({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: id, tool_input: { command }, tool_response: response });
  };
  codex({ hook_event_name: 'UserPromptSubmit', prompt: 'change x' });
  write(dir, { 'a.py': 'x = 2\n' });
  ran('f1', 'echo "5 passed in 0.1s"', '5 passed in 0.1s\n');
  assert.doesNotMatch(verified(), /run by the agent/, 'echo is not a test run');
  ran('f2', 'python3 -m pytest -q', '.....\n5 passed in 0.12s\n');
  assert.match(verified(), /tests passed at this exact state \(working tree \(run by the agent\)\)/);
  write(dir, { 'a.py': 'x = 3\n' });
  ran('f3', 'python3 -m pytest -q', 'F....\n1 failed, 4 passed in 0.12s\n');
  assert.match(verified(), /tests FAILED at this exact state/);
});

test('Cursor: writes are gated and tracked per tool; prompt hints arrive with the first tool result; one follow-up at stop', () => {
  const dir = repo(MONEY), cursor = input => call('cursor', dir, { conversation_id: 'c1', generation_id: 'g1', workspace_roots: [dir], ...input }).out;
  assert.equal(cursor({ hook_event_name: 'beforeSubmitPrompt', prompt: 'show the money totals' }), null, 'beforeSubmitPrompt takes no context');
  const denied = cursor({ hook_event_name: 'preToolUse', tool_name: 'Write', tool_use_id: 'w1', tool_input: { file_path: path.join(dir, 'shop/b.py'), content: '# ... existing code ...\n' } });
  assert.equal(denied.permission, 'deny');
  cursor({ hook_event_name: 'preToolUse', tool_name: 'Write', tool_use_id: 'w2', tool_input: { target_file: 'shop/load.py', code: LOADER } });
  write(dir, { 'shop/load.py': LOADER, 'notes.txt': 'the user, editing on their own\n' });
  const after = cursor({ hook_event_name: 'postToolUse', tool_name: 'Write', tool_use_id: 'w2', tool_input: { target_file: 'shop/load.py', code: LOADER }, tool_output: '{}' });
  assert.match(after.additional_context, /format_money/, 'the prompt hints');
  assert.match(after.additional_context, /shop\/load\.py:4: swallowed error/, 'the write feedback');
  const followup = cursor({ hook_event_name: 'stop', status: 'completed', loop_count: 0 }).followup_message;
  assert.match(followup, /shop\/load\.py/);
  assert.doesNotMatch(followup, /notes\.txt/, 'a change no tool made is not charged to the agent');
  quiet(denied.agent_message, denied.user_message, after.additional_context, followup);
  cursor({ hook_event_name: 'postToolUse', tool_name: 'Write', tool_use_id: 'w3', tool_input: { target_file: 'shop/load.py', code: `${LOADER}x = 1\n` }, tool_output: '{}' });
  assert.equal(cursor({ hook_event_name: 'stop', status: 'completed', loop_count: 1 }), null, 'once, even after another write');
});

test('Cursor: a write whose input lessloc cannot read is still tracked, by the snapshots around it', () => {
  const dir = repo(MONEY), cursor = input => call('cursor', dir, { conversation_id: 'c2', workspace_roots: [dir], ...input }).out;
  cursor({ hook_event_name: 'beforeSubmitPrompt', prompt: 'add a loader' });
  cursor({ hook_event_name: 'preToolUse', tool_name: 'Write', tool_use_id: 'w1', tool_input: { blob: 1 } });
  write(dir, { 'shop/load.py': SWALLOWED });
  assert.match(cursor({ hook_event_name: 'postToolUse', tool_name: 'Write', tool_use_id: 'w1', tool_input: { blob: 1 }, tool_output: '{}' }).additional_context, /swallowed error/);
});

// What OpenCode hands a plugin, reduced to the calls lessloc's bridge makes.
function opencode(dir) {
  const hooks = {}, synthetic = [], items = [], waits = [], idle = [];
  const feed = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (items.length) yield items.shift();
        else {
          idle.splice(0).forEach(r => r());
          yield await new Promise(r => waits.push(r));
        }
      }
    },
  };
  const on = domain => ({ hook: async (name, f) => void (hooks[`${domain}.${name}`] = f) });
  const ctx = { location: { directory: dir }, session: { ...on('session'), synthetic: async m => void synthetic.push(m) }, tool: on('tool'), permission: on('permission'), event: { subscribe: () => feed } };
  // Resolves once the plugin has handled every event so far and waits for the next.
  const send = ev => (waits.length ? waits.shift()(ev) : items.push(ev), new Promise(r => idle.push(r)));
  return { ctx, hooks, synthetic, send };
}

test('OpenCode: the bridge plugin adds the rules and hints, denies through the permission hook, appends feedback, sends back once', async () => {
  const dir = repo({ ...MONEY, '.lessloc.json': '{"test": "python3 -m unittest discover -s tests -v"}' }), oc = opencode(dir), { default: plugin } = await import('../opencode/server.js');
  const cleanup = await plugin.setup(oc.ctx), { hooks } = oc, sid = 'ses_1';
  await hooks['session.prompt']({ sessionID: sid, messageID: 'm1', prompt: { text: 'show the money totals' }, delivery: 'queue' });
  const request = { sessionID: sid, system: [] };
  await hooks['session.context'](request);
  assert.match(request.system[0].text, /^Every line you leave is read again/);
  assert.match(request.system[0].text, /format_money/);

  const write1 = { tool: 'write', sessionID: sid, id: 'call_1', input: { path: 'shop/b.py', content: '# ... existing code ...\n' } };
  await hooks['tool.execute.before'](write1);
  const permission = { sessionID: sid, action: 'edit', resources: ['shop/b.py'], source: { type: 'tool', messageID: 'm1', id: 'call_1' }, effect: 'allow' };
  hooks['permission.evaluate'](permission);
  assert.equal(permission.effect, 'deny');
  assert.match(permission.message, /placeholder/);

  const write2 = { tool: 'write', sessionID: sid, id: 'call_2', input: { path: 'shop/load.py', content: LOADER } };
  await hooks['tool.execute.before'](write2);
  write(dir, { 'shop/load.py': LOADER });
  const done = { ...write2, status: 'completed', result: { content: 'Wrote shop/load.py', metadata: {} } };
  await hooks['tool.execute.after'](done);
  assert.match(done.result.content, /^Wrote shop\/load\.py\n\nshop\/load\.py:4: swallowed error/);

  // A test run piped through tail: OpenCode's result carries the runner's summary in its content.
  const run = { tool: 'shell', sessionID: sid, id: 'call_3', input: { command: 'python3 -m unittest discover -s tests -v 2>&1 | tail -3' } };
  await hooks['tool.execute.before'](run);
  await hooks['tool.execute.after']({ ...run, status: 'completed', result: { content: [{ type: 'text', text: SUMMARY }, { type: 'text', text: 'Command exited with code 0.' }], metadata: { exit: 0 } } });
  await oc.send({ type: 'session.step.ended', data: { sessionID: sid, finish: 'stop' } });
  assert.equal(oc.synthetic.length, 1);
  assert.doesNotMatch(oc.synthetic[0].text, /Run the project's tests|hid both|tests fail/, 'the run counted by its summary');
  assert.match(oc.synthetic[0].text, /^Before you finish[\s\S]*shop\/load\.py/);
  assert.equal(oc.synthetic[0].delivery, 'steer');
  await hooks['session.prompt']({ sessionID: sid, messageID: 'm2', prompt: { text: oc.synthetic[0].text }, delivery: 'steer' });
  await oc.send({ type: 'session.step.ended', data: { sessionID: sid, finish: 'stop' } });
  assert.equal(oc.synthetic.length, 1, 'once per prompt');
  quiet(request.system.map(x => x.text).join('\n'), permission.message, done.result.content, oc.synthetic[0].text);
  cleanup();
});

test('init installs hooks for Codex, Cursor and OpenCode in the home folder only, keeps other hooks, and remove takes only its own', () => {
  const dir = repo({ 'a.py': 'x = 1\n' }), home = tmp('user-');
  const env = { ...ENV, HOME: home, XDG_CONFIG_HOME: '', CODEX_HOME: '' }, cli = (...a) => spawnSync('node', [CLI, ...a], { cwd: dir, encoding: 'utf8', env });
  write(home, { '.cursor/hooks.json': JSON.stringify({ version: 1, hooks: { stop: [{ command: './mine.sh' }] } }) });
  const installed = cli('init', '--codex', '--cursor', '--opencode').stdout;
  for (const what of [/Codex hooks/, /Cursor hooks/, /OpenCode plugin/]) assert.match(installed, what);
  cli('init', '--codex', '--cursor');
  const cursor = JSON.parse(fs.readFileSync(path.join(home, '.cursor/hooks.json'), 'utf8')), codex = JSON.parse(fs.readFileSync(path.join(home, '.codex/hooks.json'), 'utf8'));
  assert.deepEqual(cursor.hooks.stop.map(h => h.command.replace(/node ".*"/, 'node lessloc')), ['./mine.sh', 'node lessloc --host cursor'], 'installed once, after the user\'s own');
  assert.equal(cursor.hooks.preToolUse[0].matcher, 'Shell|Write|Delete');
  assert.match(codex.hooks.PreToolUse[0].hooks[0].command, /^node ".*\/hook\.mjs" --host codex$/);
  assert.match(fs.readFileSync(path.join(home, '.config/opencode/plugins/lessloc.js'), 'utf8'), /^\/\/ Written by `lessloc init --opencode`[\s\S]*export \{ default \} from "file:\/\/.*\/opencode\/server\.js";/);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }), '', 'nothing in the repository');
  cli('remove', '--codex', '--cursor', '--opencode');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.cursor/hooks.json'), 'utf8')).hooks, { stop: [{ command: './mine.sh' }] });
  assert.ok(!fs.existsSync(path.join(home, '.codex/hooks.json')), 'a hook file lessloc created goes again');
  assert.ok(!fs.existsSync(path.join(home, '.config/opencode/plugins/lessloc.js')));
});
