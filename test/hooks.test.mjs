import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { STANDARD } from '../lib/voice.mjs';
import { ENTRY, ENV, FN, STATE, agentShell, agentWrite, commit, deny, hook, repo, run, stop, turn, write } from './helpers.mjs';

const context = o => o?.hookSpecificOutput?.additionalContext ?? '';
// An agent's test run as its host reports it: the command, then success or failure.
const agentRun = (dir, command, { failed = false, stdout = '', input = {}, response = {} } = {}) => {
  hook(dir, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: command, tool_input: { command, ...input } });
  return hook(dir, { hook_event_name: failed ? 'PostToolUseFailure' : 'PostToolUse', tool_name: 'Bash', tool_use_id: command, tool_input: { command, ...input }, tool_response: { stdout, stderr: '', interrupted: false, ...response } });
};
// What the session's handoff record says its tests showed at the final state.
const verified = (dir, sid = 's') => JSON.parse(fs.readFileSync(path.join(STATE, fs.readdirSync(STATE).find(d => d.startsWith(`${path.basename(dir)}-`)), 'ledger', `${sid}.json`), 'utf8')).verified;
// The next session's start, where the last one's uncommitted work is handed over.
const nextSession = (dir, sid = 'next') => context(hook(dir, { hook_event_name: 'SessionStart', session_id: sid }));

test('Claude Code runs hook.mjs on every event, with no host flag', () => {
  const plugin = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  for (const [event, entries] of Object.entries(plugin.hooks)) for (const h of entries.flatMap(e => e.hooks)) assert.deepEqual([h.command, h.args], ['node', ['${CLAUDE_PLUGIN_ROOT}/hook.mjs']], event);
  assert.ok(fs.existsSync(ENTRY));
});

test('sessions get the working standard and the project\'s own rules, never a map or a command; subagents get one line; rules already in AGENTS.md are not repeated', () => {
  const dir = repo({ '.lessloc.json': JSON.stringify({ test: 'python3 -m unittest', protect: ['migrations/**'] }), 'shop/money.py': 'def format_money(amount):\n    return amount\n', 'shop/orders.py': 'def checkout(user):\n    return user\n' });
  const ctx = context(hook(dir, { hook_event_name: 'SessionStart' }));
  assert.match(ctx, /^Every line you leave is read again[\s\S]*Never cut correctness/);
  assert.match(ctx, /In this project: only the user changes `migrations\/\*\*`\./);
  assert.doesNotMatch(ctx, /lessloc|format_money|unittest|node /i, 'no name, map, test command or command line of its own');
  assert.match(context(hook(dir, { hook_event_name: 'SubagentStart', agent_id: 'x' })), /^Working standard: reuse code that already does the job/);
  write(dir, { 'AGENTS.md': `<!-- lessloc -->\n${STANDARD}\n<!-- /lessloc -->\n` });
  assert.doesNotMatch(context(hook(dir, { hook_event_name: 'SessionStart' })), /Never cut/);
  write(dir, { 'AGENTS.md': '<!-- lessloc -->\n# lessloc: the rules of an earlier version\n<!-- /lessloc -->\n' });
  assert.match(context(hook(dir, { hook_event_name: 'SessionStart' })), /Never cut/, 'an earlier version\'s block is not this standard');
  assert.match(run(dir, 'doctor').stdout, /AGENTS\.md holds the rules of an earlier lessloc/);
});

test('the edit gate denies junk files, placeholders and commented-out code, also in shell heredocs, and asks before policy edits', () => {
  const dir = repo({ 'app.py': 'def f():\n    return 1\n', '.lessloc.json': JSON.stringify({ protect: ['migrations/**'] }), 'migrations/001.sql': 'select 1;\n' });
  const py = path.join(dir, 'app.py'), edit = line => deny(dir, 'Edit', { file_path: py, old_string: 'x', new_string: `${line}\nx` });
  assert.equal(deny(dir, 'Write', { file_path: path.join(dir, 'app_old.py'), content: 'x = 1\n' }), 'Not applied: `app_old.py` is a backup, copy, scratch or report file. Edit the real file instead; git keeps history.');
  assert.match(deny(dir, 'Write', { file_path: path.join(dir, 'IMPLEMENTATION_SUMMARY.md'), content: '# done\n' }), /backup, copy, scratch or report/);
  assert.equal(edit('    # ... existing code ...'), 'Not applied: it adds a placeholder (`# ... existing code ...`). Write the real code, or tell the user plainly what is not done.');
  assert.match(edit('# x = compute(a)'), /^Not applied: it adds commented-out code/);
  assert.equal(edit('# retry once: the API drops the first call after idle'), undefined);
  for (const f of ['src/sandbox_reaper.py', 'src/scratch_space.py', 'schema-v2.json']) assert.equal(deny(dir, 'Write', { file_path: path.join(dir, f), content: '{}\n' }), undefined, f);
  assert.equal(deny(dir, 'Edit', { file_path: py, old_string: '# x = 1', new_string: '# x = 1\ny = 2' }), undefined, 'lines that already existed are not re-judged');
  assert.match(deny(dir, 'Bash', { command: "cat > report.py <<'EOF'\ndef report():\n    # ... existing code ...\n    return 1\nEOF" }), /placeholder/);
  assert.equal(deny(dir, 'Bash', { command: "cat > report.py <<'EOF'\ndef report():\n    return 1\nEOF" }), undefined);
  for (const file of ['.lessloc.json', 'migrations/001.sql']) {
    const o = hook(dir, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(dir, file), old_string: 'a', new_string: 'b' } }).hookSpecificOutput;
    assert.equal(o.permissionDecision, 'ask', file);
    assert.match(o.permissionDecisionReason, new RegExp(`^lessloc: \`${file.replace(/[.*]/g, '\\$&')}\` is protected in this project\\. Only you change it`), 'the approval prompt names the file to the user');
  }
  turn(dir, 'write an implementation summary to IMPLEMENTATION_SUMMARY.md');
  assert.equal(deny(dir, 'Write', { file_path: path.join(dir, 'IMPLEMENTATION_SUMMARY.md'), content: '# done\n' }), undefined, 'files the user asked for pass');
});

test('a turn is judged on what this session changed: unfinished work holds it once, in plain words, and nothing else reaches the agent', () => {
  const dir = repo({ 'src/a.py': FN, 'requirements.txt': 'flask==3.0\n' });
  turn(dir, 'add order totals');
  write(dir, { 'other.py': '# x = compute(y)\n' });
  agentWrite(dir, { 'src/b.py': `import math\n\n\n${FN}` });
  assert.equal(agentShell(dir, 'pip install requests && echo notes > NOTES_SUMMARY.md', { 'requirements.txt': 'flask==3.0\nrequests==2.31\n', 'NOTES_SUMMARY.md': '# notes\n' }), null, 'a junk file waits for the end of the turn');
  const o = stop(dir);
  assert.equal(o.decision, 'block');
  assert.match(o.reason, /^Before you finish \(this turn: \+\d+ −0 lines, 2 new files\):\n- /);
  assert.match(o.reason, /\n- src\/b\.py:\d+: lines \d+-\d+ repeat src\/a\.py:1/);
  assert.match(o.reason, /\n- NOTES_SUMMARY\.md: backup, copy, scratch or report file/);
  assert.match(o.reason, /\nFix only these and add nothing else for this note\. If one is intended, say why in one line\. Then finish\.$/);
  assert.doesNotMatch(o.reason, /requirements\.txt|new-dependency/, 'what does not hold a turn is not shown');
  assert.doesNotMatch(o.reason, /other\.py/, 'a file this session did not write is not blamed on it');
  assert.doesNotMatch(o.reason, /lessloc|\[[a-z-]+\]/, 'no name, no kind tags');
  assert.equal(stop(dir, { stop_hook_active: true }), null);
  turn(dir, 'now a small tweak');
  agentWrite(dir, { 'src/c.py': 'def tweak(value):\n    # Initialize the result\n    return value\n' });
  assert.equal(stop(dir), null, 'notes alone cost the agent nothing, and the user gets no report');
  turn(dir, 'thanks');
  assert.equal(stop(dir), null, 'earlier turns are not re-judged');
});

test('shell commands are snapshotted around: their writes are the session\'s, a swallowed error is noted right away once, the rest waits for the end of the turn', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  turn(dir, 'change x');
  assert.equal(hook(dir, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'r', tool_input: { command: 'ls -la && git status' } }), null, 'read-only commands are not snapshotted');
  assert.equal(agentShell(dir, 'python3 gen.py', { 'a.py': 'x = 1\n# y = compute(x)\n' }), null);
  const loader = 'def load():\n    try:\n        return open("x").read()\n    except Exception:\n        pass\n';
  assert.equal(context(agentShell(dir, 'python3 gen2.py', { 'load.py': loader })), 'load.py:4: swallowed error: let it reach a boundary that handles it, or catch only the error you expect');
  assert.equal(agentShell(dir, 'python3 gen3.py', { 'load.py': `${loader}\n` }), null, 'said once');
  const o = stop(dir);
  assert.match(o.reason, /a\.py:2: commented-out code/);
  assert.match(o.reason, /load\.py:4: swallowed error/, 'still unfixed at the end of the turn, so it holds the turn');
});

test('subagents get the existing code in their own prompt, and their own work is reviewed when they finish', () => {
  const dir = repo({ 'shop/money.py': 'def format_money(amount):\n    return f"${amount:,.2f}"\n' });
  const o = hook(dir, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { description: 'd', subagent_type: 'general-purpose', prompt: 'Write the money formatting for the invoice page' } }).hookSpecificOutput;
  assert.equal(o.updatedInput.subagent_type, 'general-purpose');
  assert.match(o.updatedInput.prompt, /^Write the money formatting for the invoice page\n\nExisting code that may already do part of this \(matched by name; search for other names too\):\n- shop\/money\.py:1 {2}def format_money/);
  hook(dir, { hook_event_name: 'SubagentStart', agent_id: 'ag1' });
  agentWrite(dir, { 'shop/fmt.py': 'def money_text(value):\n    try:\n        return f"${value:,.2f}"\n    except Exception:\n        pass\n' }, { agent_id: 'ag1' });
  agentWrite(dir, { 'shop/main.py': 'x = 1\n' }, { agent_id: 'ag2' });
  const r = hook(dir, { hook_event_name: 'SubagentStop', agent_id: 'ag1' }).reason;
  assert.match(r, /shop\/fmt\.py:4: swallowed error/);
  assert.doesNotMatch(r, /repeats the rule/, 'a near-copy does not hold the task');
  assert.doesNotMatch(r, /main\.py/, "another subagent's files are not this one's");
  assert.doesNotMatch(r, /Run the project's tests/, 'the turn that holds a subagent verifies the final state');
});

test('nothing in a hint is a guess: existing code is named only when a specific word of its name matches', () => {
  const dir = repo({ 'shop/money.py': 'def format_money(amount):\n    return amount\n', 'shop/items.py': 'class Item:\n    def __init__(self, value):\n        self.value = value\n', 'shop/parse.py': 'def parse_true(s):\n    return s == "true"\n' });
  assert.match(context(turn(dir, 'show the money totals')), /shop\/money\.py:1 {2}def format_money/);
  assert.equal(turn(dir, 'init the value'), null, 'generic words such as init and value match nothing worth reading');
  assert.equal(turn(dir, 'sorting is ignored when sort_keys=True'), null, 'neither does a literal');
});

test('lessloc never runs the tests: the agent\'s own runs are the evidence; a failing run or a change to how the tests run holds the turn, a missing run is only recorded', () => {
  const dir = repo({ '.lessloc.json': '{"test": "python3 -m pytest"}', 'pyproject.toml': '[project]\nname = "a"\n\n[tool.pytest.ini_options]\naddopts = "-q"\n', 'a.py': 'x = 1\n', 'README.md': '# a\n' });
  const held = (setup, said) => {
    turn(dir, 'change x');
    setup();
    return stop(dir, said ? { last_assistant_message: said } : {})?.reason ?? null;
  };
  let n = 1;
  const edit = () => agentWrite(dir, { 'a.py': `x = ${++n}\n` });
  assert.equal(hook(dir, { hook_event_name: 'SessionStart' }).systemMessage, undefined, 'nothing for anyone to approve');
  assert.equal(held(edit), null, 'no run: recorded, not held');
  assert.equal(verified(dir), 'tests not run');
  assert.equal(held(edit, 'Done. All tests pass.'), null);
  assert.match(held(() => (edit(), agentRun(dir, 'python3 -m pytest', { failed: true }))), /The tests fail on the final state \(`python3 -m pytest`\): fix the cause, or say why the failure is expected\./);
  assert.equal(held(() => (edit(), agentRun(dir, 'python3 -m pytest -q | head -1', { stdout: '.....' }))), null);
  assert.equal(verified(dir), 'tests not run', 'a run that hid both its exit status and its summary shows nothing');
  assert.equal(held(() => (edit(), agentRun(dir, '(python3 -m pytest -q 2>&1 | tail -3); git diff --stat', { stdout: '5 passed in 0.1s' }))), null);
  assert.equal(verified(dir), 'tests passed', 'a masked run counts by the summary the runner printed');
  assert.match(held(() => (edit(), agentRun(dir, 'python3 -m pytest -q 2>&1 | tail -5', { stdout: '1 failed, 4 passed in 0.12s' }))), /The tests fail on the final state/, 'a masked run still shows a failure');
  assert.equal(held(() => (edit(), agentRun(dir, 'python3 -m pytest tests/test_a.py'))), null);
  assert.equal(verified(dir), 'tests not run', 'part of the tests is no whole-suite pass');
  assert.equal(held(() => (edit(), agentRun(dir, 'python3 -m pytest'))), null);
  assert.equal(verified(dir), 'tests passed');
  assert.equal(held(() => (edit(), agentRun(dir, 'python3 -m pytest'), agentWrite(dir, { 'README.md': '# a\n\nUsage.\n' }))), null);
  assert.equal(verified(dir), 'tests passed', 'a run still covers a final state that differs only in files that are not code');
  assert.match(held(() => (edit(), agentWrite(dir, { 'pyproject.toml': '[project]\nname = "a"\n\n[tool.pytest.ini_options]\naddopts = "-q -k \'not slow\'"\n' }), agentRun(dir, 'python3 -m pytest'))), /You changed how the tests run this turn \(`pyproject\.toml`\), so a pass no longer shows the code works/);
  assert.doesNotMatch(run(dir, 'doctor').stdout, /trust|approv/);
});

test("the agent's own run of the exact test command is evidence for that state", () => {
  const dir = repo({ '.lessloc.json': '{"test": "true"}', 'a.py': 'x = 1\n' });
  turn(dir, 'change x');
  agentWrite(dir, { 'a.py': 'x = 2\n' });
  agentShell(dir, 'true', {});
  assert.equal(stop(dir), null, 'verified and clean: nothing to say');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  assert.match(run(dir, 'check', '--staged').stdout, /tests passed at this exact state \(working tree \(run by the agent\)\)/);
});

test('the next session in this checkout gets the last session’s uncommitted state in its own words', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  turn(dir, 'add a refund flow');
  agentWrite(dir, { 'a.py': 'x = 2\n' });
  stop(dir, { last_assistant_message: 'Refunds half done: B still needs the CLI flag. +1 line.' });
  assert.match(nextSession(dir), /The last session here \(under an hour ago\) was asked "add a refund flow" and left uncommitted changes in a\.py; this project has no test command\. It ended with: "Refunds half done: B still needs the CLI flag\. \+1 line\."/);
  const record = path.join(STATE, fs.readdirSync(STATE).find(d => d.startsWith(`${path.basename(dir)}-`)), 'ledger', 's.json'), saved = JSON.parse(fs.readFileSync(record, 'utf8'));
  assert.equal(saved.v, 10);
  fs.writeFileSync(record, JSON.stringify({ ...saved, open: ['[copy] a.py:1: lines 1-2 repeat b.py:1 (run `lessloc check`)'], said: 'Verified with lessloc test.' }));
  const named = nextSession(dir, 'named');
  assert.match(named, /was asked "add a refund flow" and left uncommitted changes in a\.py; this project has no test command\.$/, 'open items and last words that name lessloc are not passed on');
  assert.doesNotMatch(named, /lessloc|\[copy\]/);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  commit(dir);
  assert.doesNotMatch(nextSession(dir, 'later'), /The last session here/, 'committed work speaks through its commit');
});

test('single components switch off with LESSLOC_OFF; a broken setting is reported by doctor, not to the agent', () => {
  const dir = repo({ 'shop/money.py': 'def format_money(amount):\n    return amount\n', '.lessloc.json': '{"boundary": []}' });
  assert.match(context(turn(dir, 'show the money totals')), /^Existing code that may already do part of this/);
  assert.equal(hook(dir, { hook_event_name: 'UserPromptSubmit', prompt: 'show the money totals' }, { LESSLOC_OFF: 'reuse' }), null);
  assert.doesNotMatch(JSON.stringify(hook(dir, { hook_event_name: 'SessionStart' })), /boundary/);
  assert.match(run(dir, 'doctor').stdout, /unknown setting "boundary" \(did you mean "boundaries"\?\)/);
});

test('right after a write, the agent hears only what is cheapest to fix while the code is open, once', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  turn(dir, 'add refunds');
  const content = 'def has_refund(orders):\n    # Loop through each order and remember whether any was refunded\n    try:\n        return any(o["refunded"] == True for o in orders)\n    except Exception:\n        pass\n';
  agentWrite(dir, { 'refunds.py': content });
  const post = () => hook(dir, { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(dir, 'refunds.py'), content } });
  assert.equal(context(post()), 'refunds.py:5: swallowed error: let it reach a boundary that handles it, or catch only the error you expect', 'not the narrating comment or the shorter idiom');
  assert.equal(post(), null, 'what was said once is not repeated');
  assert.equal(hook(dir, { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(dir, 'refunds.py'), content } }, { LESSLOC_OFF: 'lines' }), null);
});

test('commands that skip the project checks need the user, not the agent', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  const ask = command => hook(dir, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: command, tool_input: { command } })?.hookSpecificOutput;
  for (const command of ['git commit --no-verify -m "wip"', 'git commit -nm wip', 'HUSKY=0 git commit -m x', 'LESSLOC=off git commit -m x', 'git push --no-verify']) assert.equal(ask(command)?.permissionDecision, 'ask', command);
  assert.match(ask('git commit --no-verify -m "wip"').permissionDecisionReason, /^lessloc: this command skips the project's own checks \(`--no-verify`\)/);
  for (const command of ['git commit -am "fix login"', 'git push -n origin main', 'git commit --amend --no-edit', 'npm test']) assert.notEqual(ask(command)?.permissionDecision, 'ask', command);
});

test('debug prints and stubs wait for the end of the turn; behavior without a test is asked of the turn, not of a subagent', () => {
  const dir = repo({ 'shop/cart.js': 'export const total = xs => xs.reduce((a, b) => a + b, 0);\n', 'test/cart.test.js': 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { total } from "../shop/cart.js";\ntest("total", () => assert.equal(total([1]), 1));\n' });
  turn(dir, 'add a discount');
  const content = 'export const total = xs => xs.reduce((a, b) => a + b, 0);\nexport function discount(xs, code) {\n  console.log("here");\n  if (code === "HALF") return total(xs) / 2;\n  if (code === "TENTH") return total(xs) * 0.9;\n  return total(xs);\n}\n';
  agentWrite(dir, { 'shop/cart.js': content });
  const mid = hook(dir, { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(dir, 'shop/cart.js'), content } });
  assert.equal(mid, null, 'mid-work, a debug print may still be in use');
  hook(dir, { hook_event_name: 'SubagentStart', agent_id: 'sub' });
  agentWrite(dir, { 'shop/fees.js': 'export function fee(x) {\n  if (x > 100) return 0;\n  if (x > 50) return 2;\n  return 5;\n}\n' }, { agent_id: 'sub' });
  assert.doesNotMatch(hook(dir, { hook_event_name: 'SubagentStop', agent_id: 'sub' })?.reason ?? '', /adds behavior/, 'a subagent may be one part of a change whose tests another part writes');
  const o = stop(dir);
  assert.match(o.reason, /shop\/cart\.js:3: `console\.log\("here"\);`: debug print left in/);
  assert.match(o.reason, /this change adds behavior/);
  assert.match(o.reason, /Fix only these and add nothing else for this note/);
});

test('a whole agent session leaves nothing in the repository: no state, no caches, nothing in .git but objects', () => {
  const dir = repo({ '.lessloc.json': '{"test": "true"}', 'shop/cart.py': 'def total(xs):\n    return sum(xs)\n', 'tests/test_cart.py': 'from shop.cart import total\n\n\ndef test_total():\n    assert total([1]) == 1\n' });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  commit(dir);
  const before = execFileSync('git', ['status', '--porcelain', '--ignored', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' });
  hook(dir, { hook_event_name: 'SessionStart' });
  turn(dir, 'add a discount');
  const content = 'def total(xs):\n    return sum(xs)\n\n\ndef half(xs):\n    if xs == True:\n        return 0\n    return total(xs) / 2\n';
  agentWrite(dir, { 'shop/cart.py': content });
  hook(dir, { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(dir, 'shop/cart.py'), content } });
  agentShell(dir, 'true', {});
  stop(dir);
  run(dir, 'test');
  run(dir, 'check');
  const after = execFileSync('git', ['status', '--porcelain', '--ignored', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' });
  assert.equal(after, `${before} M shop/cart.py\n`, 'only the file the agent wrote changed');
  assert.equal(fs.existsSync(path.join(dir, '.git/lessloc')), false);
  assert.deepEqual(fs.readdirSync(path.join(dir, '.git')).filter(f => /lessloc/.test(f)), []);
});

test('scaffolding and doc growth nobody asked for never cost the agent a turn; the next session hears of them; asked for, they pass', () => {
  const dir = repo({ 'app.py': 'x = 1\n', 'README.md': '# App\n' });
  turn(dir, 'add a greeting function');
  agentWrite(dir, { 'app.py': 'x = 1\n\n\ndef greet(name):\n    return f"hi {name}"\n', 'Dockerfile': 'FROM python:3.12\nCOPY . .\n', 'README.md': `# App\n${Array.from({ length: 45 }, (_, i) => `Line ${i} about the app.`).join('\n')}\n` });
  assert.equal(stop(dir), null);
  assert.match(nextSession(dir), /left open: .*Dockerfile: deployment, container or CI file nobody asked for/);
  const asked = repo({ 'app.py': 'x = 1\n' });
  turn(asked, 'add a Dockerfile so we can deploy with docker');
  agentWrite(asked, { 'Dockerfile': 'FROM python:3.12\nCOPY . .\n' });
  stop(asked);
  assert.doesNotMatch(nextSession(asked), /CI file nobody asked for/);
});

test('policy and refactors: a refactor that edits existing tests is handed to the next session, not held', () => {
  const dir = repo({ 'shop/cart.py': 'def total(xs):\n    return sum(xs)\n', 'tests/test_cart.py': 'from shop.cart import total\n\n\ndef test_total():\n    assert total([1, 2]) == 3\n' });
  turn(dir, 'refactor the cart module');
  agentWrite(dir, { 'shop/cart.py': 'def total(items):\n    return sum(items)\n', 'tests/test_cart.py': 'from shop.cart import total\n\n\ndef test_total():\n    assert total([2, 2]) == 4\n' });
  stop(dir);
  assert.match(nextSession(dir), /a refactor changed existing tests/);
});

test('commit messages that recap the diff file by file get a warning at commit time', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  execFileSync('git', ['config', 'core.hooksPath', '.git/hooks'], { cwd: dir });
  run(dir, 'init');
  write(dir, { 'a.py': 'x = 2\n' });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  const r = commit(dir, 'Update files\n\n- a.py: changed x\n- b.py: added\n- c.py: removed\n- d.py: renamed\n- e.py: fixed');
  assert.match(r.stderr, /^This commit message lists 5 files, which the diff already shows/m);
});

test('a definition the user asked for by name is the requested API, not dead code; one nobody asked for is', () => {
  const dir = repo({ 'shop/orders.py': 'def total(items):\n    return sum(items)\n' });
  turn(dir, 'Add a function order_count() to shop/orders.py that returns how many orders are stored.');
  agentWrite(dir, { 'shop/orders.py': 'def total(items):\n    return sum(items)\n\n\ndef order_count(orders):\n    return len(orders)\n\n\ndef doubled(x):\n    return x * 2\n' });
  stop(dir);
  const handed = nextSession(dir);
  assert.match(handed, /new `doubled` is never called/);
  assert.doesNotMatch(handed, /new `order_count` is never called/);
});

// Everything an agent reads from lessloc across a session, on every host: none of it may name lessloc, show one of its paths or
// commands, tag a finding kind or cite a source.
test('the agent never sees lessloc: no name, path, command, kind tag or citation in anything it reads', () => {
  const dir = repo({ '.lessloc.json': JSON.stringify({ test: 'python3 -m pytest', protect: ['migrations/**'] }), 'shop/money.py': 'def format_money(amount):\n    return f"${amount:,.2f}"\n', 'migrations/001.sql': 'select 1;\n' });
  const said = [], keep = o => {
    if (!o) return o;
    const s = o.hookSpecificOutput ?? {};
    said.push(s.additionalContext, s.permissionDecision === 'deny' ? s.permissionDecisionReason : '', s.updatedInput?.prompt, o.reason, o.systemMessage);
    return o;
  };
  turn(dir, 'first, the money totals');
  agentWrite(dir, { 'shop/totals.py': 'def total(xs):\n    return sum(xs)\n' });
  stop(dir, { last_assistant_message: 'Added total.' });
  keep(hook(dir, { hook_event_name: 'SessionStart', session_id: 'v' }));
  const at = (event, extra = {}) => keep(hook(dir, { hook_event_name: event, session_id: 'v', ...extra }));
  at('UserPromptSubmit', { prompt: 'show the money totals per customer' });
  at('PreToolUse', { tool_name: 'Agent', tool_input: { prompt: 'format money for the invoice' } });
  at('SubagentStart', { agent_id: 'a1' });
  for (const [file, content] of [['shop/totals_old.py', 'x = 1\n'], ['shop/b.py', '# ... existing code ...\n'], ['shop/c.py', '# y = compute(x)\n']]) at('PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(dir, file), content } });
  const loader = 'def load():\n    try:\n        return open("k").read()\n    except Exception:\n        pass\n\n\nKEY = "AKIAABCDEFGHIJKLMNOP"\n';
  at('PreToolUse', { tool_name: 'Write', tool_use_id: 'w', tool_input: { file_path: path.join(dir, 'shop/load.py'), content: loader } });
  write(dir, { 'shop/load.py': loader });
  at('PostToolUse', { tool_name: 'Write', tool_use_id: 'w', tool_input: { file_path: path.join(dir, 'shop/load.py'), content: loader } });
  at('SubagentStop', { agent_id: 'a1' });
  at('Stop', { last_assistant_message: 'All tests pass.' });
  const codex = spawnSync('node', [ENTRY, '--host', 'codex'], { cwd: dir, input: JSON.stringify({ cwd: dir, session_id: 'v', turn_id: 't', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b', tool_input: { command: 'git commit --no-verify -m x' } }), encoding: 'utf8', env: ENV });
  keep(JSON.parse(codex.stdout));
  const text = said.filter(Boolean).join('\n\n');
  for (const piece of ['Every line you leave', 'Existing code that may already do part of this', 'Working standard:', 'Not applied:', 'swallowed error', 'Before you finish', 'only the user may approve that']) assert.ok(text.includes(piece), `the scenario reached: ${piece}`);
  assert.doesNotMatch(text, /lessloc/i);
  assert.doesNotMatch(text, /\bnode\s|\.mjs\b|\/tmp\//);
  assert.doesNotMatch(text, /\[[a-z]+(-[a-z]+)*\]/, 'kind tags');
  assert.doesNotMatch(text, /\(CWE-|et al\.|Fowler|anti-patterns/, 'citations');
});

test('a run is credited to the tree it tested: never across a stash, from another checkout, or while it still runs in the background', () => {
  const dir = repo({ '.lessloc.json': '{"test": "python3 -m pytest"}', 'a.py': 'x = 1\n' });
  const reason = () => stop(dir)?.reason ?? null;
  turn(dir, 'change x');
  agentWrite(dir, { 'a.py': 'x = 2\n' });
  agentRun(dir, 'python3 -m pytest -q', { failed: true, stdout: '== 1 failed in 0.1s ==' });
  agentRun(dir, 'git stash && python3 -m pytest -q 2>&1 | tail -3; git stash pop', { stdout: '== 1 passed in 0.1s ==' });
  agentRun(dir, 'cd /tmp && python3 -m pytest -q', { stdout: '== 1 passed in 0.1s ==' });
  assert.match(reason(), /The tests fail on the final state/, 'neither pass was a run of this state');
  turn(dir, 'change x again');
  agentWrite(dir, { 'a.py': 'x = 3\n' });
  agentRun(dir, 'python3 -m pytest -q', { stdout: '', input: { run_in_background: true }, response: { backgroundTaskId: 'b1' } });
  assert.equal(reason(), null);
  assert.equal(verified(dir), 'tests not run', 'a run still going is no result');
  turn(dir, 'format and test');
  agentWrite(dir, { 'a.py': 'x =  4\n' });
  const cmd = 'black a.py && python3 -m pytest -q';
  hook(dir, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: cmd, tool_input: { command: cmd } });
  write(dir, { 'a.py': 'x = 4\n' });
  hook(dir, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: cmd, tool_input: { command: cmd }, tool_response: { stdout: '== 1 passed in 0.1s ==' } });
  assert.equal(reason(), null);
  assert.equal(verified(dir), 'tests passed', 'after a formatter, the run tested the formatted tree');
  turn(dir, 'show the test fails without the fix');
  agentWrite(dir, { 'a.py': 'x = 5\n' });
  agentRun(dir, 'git stash && python3 -m pytest -q 2>&1 | tail -3; git stash pop && python3 -m pytest -q', { stdout: '== 1 failed in 0.1s ==\n== 1 passed in 0.1s ==' });
  assert.equal(reason(), null);
  assert.equal(verified(dir), 'tests passed', 'the run after the stash came back tested this state');
  turn(dir, 'again, both runs piped');
  agentWrite(dir, { 'a.py': 'x = 6\n' });
  agentRun(dir, 'git stash -q -- a.py && python3 -m pytest -q 2>&1 | tail -3; git stash pop -q && python3 -m pytest -q 2>&1 | tail -3; git diff --stat', { stdout: '1 failed in 0.1s\n1 passed in 0.1s\n a.py | 2 +-\n' });
  assert.equal(reason(), null);
  assert.equal(verified(dir), 'tests passed', 'each run printed one summary: the last one is the restored code\'s');
  turn(dir, 'pass first, then show the failure');
  agentWrite(dir, { 'a.py': 'x = 7\n' });
  agentRun(dir, 'python3 -m pytest -q 2>&1 | tail -3; git stash -q && python3 -m pytest -q 2>&1 | tail -3; git stash pop -q', { stdout: '1 passed in 0.1s\n1 failed in 0.1s\n' });
  assert.equal(reason(), null);
  assert.equal(verified(dir), 'tests passed', 'the stashed run\'s failure is not the final state\'s');
  turn(dir, 'summary cut off');
  agentWrite(dir, { 'a.py': 'x = 8\n' });
  agentRun(dir, 'git stash -q && python3 -m pytest -q 2>&1 | tail -3; git stash pop -q && python3 -m pytest -q 2>&1 | tail -1', { stdout: '1 failed in 0.1s\n.\n' });
  assert.equal(reason(), null);
  assert.equal(verified(dir), 'tests not run', 'two runs, one summary: it cannot be told whose it is');
});

test('a run piped through grep or head still shows its own summary; a stage that rewrites lines hides it', () => {
  const dir = repo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }), 'src/a.js': 'export const a = 1;\n', 'test/a.test.js': "import test from 'node:test';\n\ntest('a', () => {});\n" });
  const reason = () => stop(dir)?.reason ?? null;
  turn(dir, 'change a');
  agentWrite(dir, { 'src/a.js': 'export const a = 2;\n', 'test/a.test.js': "import assert from 'node:assert';\nimport test from 'node:test';\nimport { a } from '../src/a.js';\n\ntest('a is 2', () => assert.equal(a, 2));\n" });
  agentRun(dir, 'npm test 2>&1 | grep -E "^# (tests|pass|fail)|not ok"; git diff --stat', { stdout: '# tests 1\n# pass 1\n# fail 0\n src/a.js | 2 +-\n' });
  assert.equal(reason(), null);
  assert.equal(verified(dir), 'tests passed', 'grep kept the runner\'s own trailer');
  turn(dir, 'change a again');
  agentWrite(dir, { 'src/a.js': 'export const a = 3;\n', 'test/a.test.js': "import assert from 'node:assert';\nimport test from 'node:test';\nimport { a } from '../src/a.js';\n\ntest('a is 3', () => assert.equal(a, 3));\n" });
  agentRun(dir, 'npm test 2>&1 | grep "# fail" | sed "s/[1-9][0-9]*/0/"', { stdout: '# fail 0\n' });
  assert.equal(reason(), null);
  assert.equal(verified(dir), 'tests not run', 'sed may have rewritten the count');
  turn(dir, 'pass, then show the failure');
  agentWrite(dir, { 'src/a.js': 'export const a = 4;\n', 'test/a.test.js': "import assert from 'node:assert';\nimport test from 'node:test';\nimport { a } from '../src/a.js';\n\ntest('a is 4', () => assert.equal(a, 4));\n" });
  agentRun(dir, 'npm test 2>&1 | tail -25; git stash -q && npm test 2>&1 | grep -E "^# (pass|fail)"; git stash pop -q && git status --short', { stdout: '# tests 1\n# pass 1\n# fail 0\n# pass 0\n# fail 1\n M src/a.js\n' });
  assert.equal(reason(), null);
  assert.equal(verified(dir), 'tests passed', 'the first run tested this state, and its own trailer passed');
});

test('the agent\'s own ways of running the tests count: interpreter options, and a checker run after the tests', () => {
  const dir = repo({ '.lessloc.json': '{"test": "python3 -m pytest"}', 'a.py': 'x = 1\n' });
  const reason = () => stop(dir)?.reason ?? null;
  turn(dir, 'change x');
  agentWrite(dir, { 'a.py': 'x = 2\n' });
  agentRun(dir, 'python -I -m pytest -q 2>&1 | tail -3 && python -I /tmp/repro.py', { stdout: '1 passed in 0.1s\nrepro ok\n' });
  assert.equal(reason(), null, '`python -I -m pytest` is pytest');
  turn(dir, 'change x again');
  agentWrite(dir, { 'a.py': 'x = 3\n' });
  agentRun(dir, "sed -i 's/3/4/' a.py && python -m pytest -q 2>&1 | tail -1 && ruff check . 2>&1 | tail -1; git diff --stat", { stdout: '1 passed in 0.1s\nAll checks passed!\n a.py | 2 +-\n' });
  assert.equal(reason(), null, '`ruff check` after the tests leaves the code as tested');
  write(dir, { 'tests/test_a.py': 'def test_a():\n    assert True\n' });
  turn(dir, 'and once more');
  agentWrite(dir, { 'a.py': 'x = 5\n' });
  agentRun(dir, 'python -m pytest -q tests/test_a.py 2>&1 | tail -1', { stdout: '1 passed in 0.1s\n' });
  assert.equal(reason(), null, 'a run that names the only test file ran the whole suite');
});

test('a value the request names is what was asked for, not a value copied from a test', () => {
  const dir = repo({ 'shop/pricing.py': 'def discount(email):\n    return 0\n', 'tests/test_pricing.py': 'def test_none():\n    assert True\n' });
  turn(dir, 'Give customers whose email ends with @vip.example 25% off.');
  agentWrite(dir, { 'shop/pricing.py': 'def discount(email):\n    if email.endswith("@vip.example"):\n        return 0.25\n    return 0\n', 'tests/test_pricing.py': 'from shop.pricing import discount\n\n\ndef test_vip():\n    assert discount("a@vip.example") == 0.25\n' });
  assert.doesNotMatch(stop(dir)?.reason ?? '', /appears only in tests/);
});

test('the final state is what must pass: a pass before the last edit does not count, nor one after the tests themselves changed', () => {
  const dir = repo({ '.lessloc.json': '{"test": "python3 -m pytest"}', 'a.py': 'x = 1\n', 'pytest.ini': '[pytest]\naddopts = -q\n', 'package.json': '{"scripts": {"test": "npm run unit", "unit": "node --test"}}\n' });
  let n = 1;
  const edit = () => agentWrite(dir, { 'a.py': `x = ${++n}\n` }), held = setup => (turn(dir, 'work'), setup(), stop(dir)?.reason ?? null);
  assert.equal(held(() => (edit(), agentRun(dir, 'python3 -m pytest'), edit())), null);
  assert.equal(verified(dir), 'tests not run', 'a pass before the last edit does not count');
  assert.equal(held(() => (edit(), agentRun(dir, 'env PYTHONPATH=. python3 -m pytest'))), null);
  assert.equal(verified(dir), 'tests passed', 'a run behind env still counts');
  assert.match(held(() => (edit(), agentRun(dir, 'python3 -m pytest tests/test_a.py', { failed: true }))), /The tests fail on the final state/, 'a failing selection still fails');
  assert.match(held(() => (edit(), agentWrite(dir, { 'package.json': '{"scripts": {"test": "npm run unit", "unit": "node --test --test-name-pattern=a"}}\n' }), agentRun(dir, 'python3 -m pytest'))), /You changed how the tests run this turn \(`package\.json`\)/);
  assert.match(held(() => agentWrite(dir, { 'pytest.ini': '[pytest]\naddopts = -q -k "not slow"\n' })), /You changed how the tests run this turn \(`pytest\.ini`\)/, 'held even when no code changed');
  assert.equal(held(() => (edit(), agentRun(dir, 'npm test'))), null);
  assert.equal(verified(dir), 'tests not run', 'another runner is not this project\'s test command');
});

test('a turn is held once, whatever the host reports; an item held once is not held again in a later turn', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  turn(dir, 'add a loader');
  agentWrite(dir, { 'load.py': 'def load():\n    print("debug here")\n    return 1\n' });
  assert.match(stop(dir).reason, /debug print/);
  agentWrite(dir, { 'load.py': 'def load():\n    print("debug here")\n    print("debug there")\n    return 1\n' });
  assert.equal(stop(dir), null, 'a second stop in the same turn, with no flag from the host, is not held');
  turn(dir, 'rename it');
  agentWrite(dir, { 'load.py': 'def load():\n    print("debug here")\n    print("debug there")\n    return 2\n' });
  assert.doesNotMatch(stop(dir)?.reason ?? '', /load\.py:2/, 'held in an earlier turn already');
});

test('right after a write, a credential is named once; a copy, a versioned copy and a forbidden dependency wait for the end of the turn', () => {
  const dir = repo({ '.lessloc.json': '{"approvedDependencies": ["flask"]}', 'requirements.txt': 'flask==3.0\n', 'shop/money.py': FN });
  turn(dir, 'invoices');
  const after = (file, content) => {
    agentWrite(dir, { [file]: content });
    return context(hook(dir, { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(dir, file), content } }));
  };
  assert.equal(after('shop/invoice.py', FN.replace('def total(items)', 'def order_sum(lines)').replace(/\bitems\b/g, 'lines').replace(/\bitem\b/g, 'line').replace(/\bresult\b/g, 'acc')), '', 'finding a copy needs the whole codebase: too slow for every write');
  assert.equal(after('shop/money2.py', 'def total_v2(items):\n    return sum(i.price for i in items)\n'), '');
  assert.equal(after('requirements.txt', 'flask==3.0\narrow==1.3\n'), '');
  assert.match(after('shop/keys.py', 'KEY = "AKIAQ7XK2M4ZJ8RT5WNP"\n'), /^shop\/keys\.py:1: credential/);
  assert.equal(after('shop/debug.py', 'def count(xs):\n    print("debug here")\n    return len(xs)\n'), '', 'a debug print waits for the end of the turn');
  const held = stop(dir).reason;
  for (const re of [/shop\/invoice\.py:1: `order_sum` has the same body as .*total/, /`total_v2` sits beside .*total/, /requirements\.txt:2: dependency `arrow` is not in approvedDependencies/]) assert.match(held, re);
});

test('a requested name that never appears holds the turn; one the request only mentions, or a choice between names, does not', () => {
  const dir = repo({ 'cli.py': 'import argparse\n\n\ndef main():\n    p = argparse.ArgumentParser()\n    p.add_argument("--verbose", action="store_true")\n    return p.parse_args()\n' });
  turn(dir, 'Add a `--status` flag to the CLI that prints the queue size.');
  agentWrite(dir, { 'cli.py': 'import argparse\n\n\ndef main():\n    p = argparse.ArgumentParser()\n    p.add_argument("--verbose", action="store_true")\n    p.add_argument("--quiet", action="store_true")\n    return p.parse_args()\n' });
  assert.match(stop(dir).reason, /- The request asks for `--status`; it appears nowhere in this repository\./);
  turn(dir, 'Add a `--status` flag to the CLI that prints the queue size.');
  agentWrite(dir, { 'cli.py': 'import argparse\n\n\ndef main():\n    p = argparse.ArgumentParser()\n    p.add_argument("--verbose", action="store_true")\n    p.add_argument("--status", action="store_true")\n    return p.parse_args()\n' });
  assert.doesNotMatch(stop(dir)?.reason ?? '', /The request asks for/, 'written, under any of its spellings');
  turn(dir, 'The `--verbose` output is too long when `dump_queue` runs; shorten it.');
  agentWrite(dir, { 'cli.py': 'import argparse\n\n\ndef main():\n    p = argparse.ArgumentParser()\n    p.add_argument("--verbose", action="count")\n    p.add_argument("--status", action="store_true")\n    return p.parse_args()\n' });
  assert.doesNotMatch(stop(dir)?.reason ?? '', /The request asks for/, 'names a bug report only mentions are no promise');
});

test('a reply that leaves part of the reported problem failing holds the turn, quoting it; a follow-up offer does not', () => {
  const dir = repo({ '.lessloc.json': '{"test": "python3 -m pytest"}', 'a.py': 'x = 1\n' });
  let n = 1;
  const held = (said, env) => {
    turn(dir, 'Appending to a comma-first array writes invalid TOML:\n```py\ndoc["a"].append(99)\n```');
    agentWrite(dir, { 'a.py': `x = ${++n}\n` });
    agentRun(dir, 'python3 -m pytest');
    return hook(dir, { hook_event_name: 'Stop', last_assistant_message: said }, env)?.reason ?? null;
  };
  assert.match(held('Fixed append.\n\n**Not fixed:** `insert(1, 99)` on the same input still produces a double comma; I left it alone to keep the change small.'), /\n- You say: "Not fixed: `insert\(1, 99\)` on the same input still produces a double comma; I left it alone to keep the change small\." That is part of the request and it still fails: fix it in this change\. Leave it only if the request itself rules it out, and quote that line\.\n/);
  assert.match(held('Fixed append.\n\nNot checked: `insert` copies the indent the same way, so it may have the same problem; I did not test it.'), /You say: "Not checked: `insert` copies the indent the same way, so it may have the same problem; I did not test it\." Check it now, and fix it in this change if it fails the same way\./);
  assert.match(held('Fixed append. `doc["a"].append(99)` gives `[1, 99]`.\n\nThe old code dropped `append` output for `insert` too, which I left alone: `insert` on the same input still produces a double comma.'), /You say: .*Leave it only if the request itself rules it out/, 'a name from the request said to be lost, or the same input, ties it to the report');
  assert.equal(held('Fixed append.\n\nI left the changelog alone; say if you want an entry.'), null, 'a follow-up offer leaves nothing failing');
  assert.equal(held('Fixed append. Before the fix, the same input still produced a double comma.'), null, 'a defect the change fixed is not left');
  assert.equal(held('Fixed append.\n\nNot fixed: the README example still produces the old output; that file is outside this issue.'), null, 'a defect with no tie to the reported case is the agent\'s call');
  assert.equal(held('Fixed append.\n\n**Not fixed:** `insert(2, 99)` on the same input still produces a double comma; I left it alone.', { LESSLOC_OFF: 'unfinished' }), null, 'switched off with LESSLOC_OFF');
  turn(dir, 'Appending writes invalid TOML');
  agentWrite(dir, { 'a.py': 'x = 0\n' });
  const both = stop(dir, { last_assistant_message: 'Done; tests pass.\n\nNot fixed: `insert(3, 99)` on the same input still produces a double comma, a separate path I left alone.' }).reason;
  assert.match(both, /- You say: "Not fixed: `insert\(3, 99\)` on the same input still produces a double comma, a separate path I left alone\."/, 'held with no test run: the reply alone is the evidence');
});

test('a report file a shell command wrote is held once, and not again when a later turn rewrites it', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  turn(dir, 'write notes');
  agentShell(dir, 'python3 notes.py', { 'NOTES_SUMMARY.md': '# notes\n' });
  assert.match(stop(dir).reason, /NOTES_SUMMARY\.md: backup, copy, scratch or report file/);
  turn(dir, 'add a line to them');
  agentShell(dir, 'python3 notes.py --more', { 'NOTES_SUMMARY.md': '# notes\n\nmore\n' });
  assert.doesNotMatch(stop(dir)?.reason ?? '', /NOTES_SUMMARY/, 'the agent already heard it, and may have said why it stays');
});

test('a turn that runs far past what tasks take is told once to finish what works and say what is left', () => {
  const dir = repo({ 'app.py': 'x = 1\n' });
  hook(dir, { hook_event_name: 'UserPromptSubmit', prompt: 'Reach 100% test coverage' });
  const step = i => context(hook(dir, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: `r${i}`, tool_input: { file_path: path.join(dir, 'app.py') } }));
  for (let i = 1; i < 40; i++) assert.doesNotMatch(step(i), /many steps/);
  assert.match(step(40), /^This turn has taken many steps\. If what is left of the request has no natural end/);
  assert.doesNotMatch(step(41), /many steps/);
  hook(dir, { hook_event_name: 'UserPromptSubmit', prompt: 'Now the docs' });
  assert.doesNotMatch(step(1), /many steps/);
});
