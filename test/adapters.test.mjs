import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { HOSTS, NEUTRAL, userHooks } from '../lib/hosts.mjs';
import { REPO_HOOKS, ROOT, repoHooks } from '../lib/install.mjs';
import { STANDARD } from '../lib/voice.mjs';
import { ENTRY, ENV, agentWrite, fill, hook, repo, run, stop, tmp, turn, write } from './helpers.mjs';
import { session } from './reference-agent.mjs';

// The contract every agent tool's row keeps, run from test/fixtures/hosts/<row>.json: payloads copied from the tool's own
// documentation, with $NAME placeholders for what each step fills in, and where the tool reads each part of lessloc's answer.
// Optional: `flag`, the host the hook command names when it is another row's (VS Code runs Copilot's hook file); `argv`, the
// event each step's command names, for a tool whose payloads do not; `evidence: false`, the tool gives its hooks no command
// output, so no test run can be read, and `evidence: "failures"`, it gives only whether a command failed, so a passing run cannot
// be told from one still running; `text: true`, the tool reads plain text on stdout as context (`text` in the answer);
// `env`, variables the tool sets for its hooks. A step the tool has no event for is skipped. An answer path may end in
// `|field=value`, read only when the answer's field has that value. A tool with no `block` in its answer cannot hold the
// end of a turn.
const FIXTURES = new URL('./fixtures/hosts/', import.meta.url);
const fixtures = fs.readdirSync(FIXTURES).map(f => JSON.parse(fs.readFileSync(new URL(f, FIXTURES), 'utf8')));
const get = (o, p) => p?.split('.').reduce((x, k) => x?.[k], o);
const at = (o, p) => {
  const [where, when] = String(p).split('|'), [field, value] = (when || '').split('=');
  return !when || String(get(o, field)) === value ? get(o, where) : undefined;
};
// Nothing a model reads may name lessloc, show a path or command of its own, tag a kind or cite a source.
const quiet = t => assert.doesNotMatch(String(t), /lessloc|\bnode\s|\.mjs\b|\[[a-z]+(?:-[a-z]+)*\]|\(CWE-|et al\./i);

const SWALLOWED = 'def load():\n    try:\n        return open("x").read()\n    except Exception:\n        pass\n';
const LOADER = `${SWALLOWED}print("debug", load())\n`;
const MONEY = { 'shop/money.py': 'def format_money(amount):\n    return f"${amount:.2f}"\n', '.lessloc.json': '{"test": "python3 -m pytest"}' };

for (const fx of fixtures) {
  const caps = HOSTS[fx.host];
  test(`${fx.host}: the contract scenario from its documented payloads (${fx.source.join(', ')})`, () => {
    const dir = repo(MONEY);
    let n = 0;
    // One event through `hook.mjs --host <row>`, as the tool's hook runs it; the answer read where the tool reads it.
    const send = (step, vars = {}) => {
      const file = vars.FILE || 'shop/x.py', content = vars.CONTENT ?? '', id = `id${++n}`;
      const ms = Date.UTC(2026, 9, 19) + n * 1000;
      const all = { SID: 's1', CWD: dir, ID: id, FILE: file, ABSFILE: path.join(dir, file), CONTENT: content, PROMPT: 'show the money totals', AGAIN: false, LOOP: 0, EXIT: 0, OUTPUT: '', TIME_MS: ms, TIME: new Date(ms).toISOString(), ...vars };
      all.PATCH = `*** Begin Patch\n*** Add File: ${file}\n${content.replace(/\n$/, '').split('\n').map(l => `+${l}`).join('\n')}\n*** End Patch\n`;
      Object.assign(all, { OUTPUT_JSON: JSON.stringify(all.OUTPUT), ABSFILE_JSON: JSON.stringify(all.ABSFILE), CONTENT_JSON: JSON.stringify(all.CONTENT), EXIT_LINE: all.EXIT ? `\nExit Code: ${all.EXIT}` : '', EXIT_STATUS: all.EXIT ? `exit status ${all.EXIT}` : '' });
      if (!fx.events[step]) return {};
      const r = spawnSync('node', [ENTRY, '--host', fx.flag || fx.host, ...(fx.argv ? [fx.argv[step]] : [])], { cwd: dir, input: JSON.stringify(fill(fx.events[step], all)), encoding: 'utf8', env: { ...ENV, ...fill(fx.env || {}, all) } });
      const out = !r.stdout ? {} : fx.text && !r.stdout.startsWith('{') ? { text: r.stdout } : JSON.parse(r.stdout);
      assert.ok(out && typeof out === 'object' && !Array.isArray(out), `${step}: stdout is one JSON object or nothing`);
      // A tool that gives the model only what a refusal writes to stderr gets it there, with exit code 2.
      if (fx.answer.deny === 'stderr' && r.status === 2) {
        assert.equal(r.stdout, '', `${step}: a refusal on stderr comes alone`);
        out.stderr = r.stderr;
      } else {
        assert.equal(r.status, 0, `${step}: exit code 0, so the tool never replaces a result or shows a hook error`);
        assert.equal(r.stderr, '', `${step}: nothing on stderr`);
      }
      const said = Object.fromEntries(Object.entries(fx.answer).map(([k, p]) => [k, at(out, p)]).filter(([, v]) => v));
      // A question goes to the user, who may see the name; everything else reaches the model.
      Object.entries(said).forEach(([k, v]) => k === 'ask' || quiet(v));
      return said;
    };
    const decision = said => (caps.ask ? said.ask : said.deny), ASKED = caps.ask ? /^lessloc: / : /only the user may approve that/;

    // A tool whose session start reaches no model gets the standard with the first prompt (a rules file, written by `init`,
    // covers a tool with no channel at all).
    const late = caps.start === false, context = said => said.context ?? said.text;
    if (late) assert.deepEqual(send('start'), {}, 'nothing at a session start no model hears');
    else assert.ok(context(send('start')).startsWith(STANDARD.slice(0, 60)), 'the standard reaches the model at session start');
    const hints = send('prompt');
    if (caps.prompt) assert.match(context(hints), /format_money/, 'hints about existing code come with the prompt');
    else assert.equal(context(hints), undefined, 'a prompt hook without context gets nothing');
    if (late && caps.prompt) assert.ok(context(hints).startsWith(STANDARD.slice(0, 60)), 'and the standard before them, once');

    // A row with `gate: false` (Cline's hook files, which can end the agent's run but not refuse one call) refuses nothing.
    const placeholder = send('write', { FILE: 'shop/b.py', CONTENT: '# ... existing code ...\n' });
    if (caps.gate === false) assert.deepEqual(placeholder, {}, 'nothing is refused where a refusal would end the run');
    else assert.match(placeholder.deny, /placeholder/);
    assert.deepEqual(send('write', { FILE: 'shop/clean.py', CONTENT: 'x = 1\n' }), {}, 'a clean write passes');
    for (const asked of [send('write', { FILE: '.lessloc.json', CONTENT: '{}\n' }), send('shell', { COMMAND: 'git commit --no-verify -m x' })]) {
      if (caps.gate === false) assert.deepEqual(asked, {});
      else assert.match(decision(asked), ASKED);
    }

    const loader = { FILE: 'shop/load.py', CONTENT: LOADER, ID: 'w1' };
    assert.equal(send('write', loader).deny, undefined);
    write(dir, { 'shop/load.py': LOADER });
    // A tool whose after-tool hook reaches no model, or that has none, is told nothing there; the turn's end still sees the write.
    if (caps.feedback === false || !fx.events.written) assert.deepEqual(send('written', loader), {}, 'nothing after a write where no model hears it');
    else {
      const note = send('written', loader).feedback;
      assert.match(note, /shop\/load\.py:4: swallowed error/, 'the write note is added to the result');
      if (!caps.prompt && fx.events.prompt) assert.match(note, /format_money/, 'and the prompt hints, with the first tool result');
    }

    const verified = () => (execFileSync('git', ['add', '-A'], { cwd: dir }), run(dir, 'check', '--staged').stdout);
    const tests = (exit, output) => {
      const vars = { COMMAND: 'python3 -m pytest -q', EXIT: exit, OUTPUT: output, ID: `t${exit}${n}` };
      send('shell', vars);
      send('ran', vars);
    };
    tests(1, 'F\n1 failed in 0.05s\n');
    if (fx.evidence !== false) assert.match(verified(), /tests FAILED at this exact state/);
    tests(0, '.\n1 passed in 0.05s\n');
    if (fx.evidence == null) assert.match(verified(), /tests passed at this exact state \(working tree \(run by the agent\)\)/);

    if ('block' in fx.answer) {
      assert.match(send('stop').block, /shop\/load\.py/, 'the turn is held once, in plain words');
      assert.equal(send('stop', { AGAIN: true, LOOP: 1 }).block, undefined, 'and only once');
    } else assert.deepEqual(send('stop'), {}, 'a tool that cannot hold the end of a turn is told nothing; the review is kept for the next session');
    const twin = { SID: 's2', TIME_MS: 0, TIME: '2026-10-19T12:00:00.000Z' };
    if (late) {
      send('start', twin);
      if (caps.prompt) assert.match(context(send('prompt', twin)), /shop\/load\.py/, 'the next session hears what was left open, with its first prompt');
      return;
    }
    assert.match(context(send('start', twin)), /shop\/load\.py/, 'the next session hears what was left open');
    const again = send('start', twin);
    if (caps.twice) assert.deepEqual(again, {}, 'the same event run twice (by two hook files) answers once');
    else assert.match(context(again), /shop\/load\.py/, 'a host that runs each hook once gets every answer');
  });
}

test('generic: a subagent prompt gets the hints, and caps.ask lets the host ask the user', () => {
  const fx = fixtures.find(f => f.host === 'generic'), dir = repo(MONEY);
  const send = (step, vars = {}, extra = {}) => JSON.parse(spawnSync('node', [ENTRY, '--host', 'generic'], { cwd: dir, input: JSON.stringify({ ...fill(fx.events[step], { SID: 'g1', CWD: dir, ID: 'a1', PROMPT: 'show the money totals', ...vars }), ...extra }), encoding: 'utf8', env: ENV }).stdout || '{}');
  assert.match(send('agent').input.prompt, /^show the money totals\n\n[\s\S]*format_money/);
  const policy = { FILE: '.lessloc.json', CONTENT: '{}', ID: 'p1' };
  assert.match(send('write', policy).deny, /only the user may approve that\. Ask them/);
  assert.match(send('write', { ...policy, ID: 'p2' }, { caps: { ask: true } }).ask, /^lessloc:/, 'the question goes to the user, who may see the name');
});

test('generic: a 40-line agent loop wired through the protocol gets every moment, and its model never reads a name of lessloc', () => {
  const dir = repo(MONEY), steps = [
    { tool: 'write', input: { path: 'shop/b.py', content: '# ... existing code ...\n' } },
    { tool: 'write', input: { path: 'shop/load.py', content: LOADER } },
    { tool: 'shell', input: { command: 'python3 -m pytest -q' }, result: { exit_code: 0, output: '1 passed in 0.05s' } },
    { reply: 'Done.' },
    { reply: 'The debug print is intended.' },
  ];
  const { system, messages } = session(dir, 'r1', 'show the money totals', () => steps.shift(), ENV);
  assert.ok(system.startsWith(STANDARD.slice(0, 60)), 'S: the standard goes into the system prompt');
  assert.match(messages[0].content, /^show the money totals\n\n[\s\S]*format_money/, 'P: the hints ride on the prompt');
  assert.match(messages[1].content, /^Error: [\s\S]*placeholder/, 'G: the refusal is the tool error');
  assert.match(messages[2].content, /^Wrote shop\/load\.py\n\n[\s\S]*swallowed error/, 'F: the note is appended to the result');
  assert.match(messages[4].content, /^Before you finish[\s\S]*shop\/load\.py/, 'H: the hold is the next message, once');
  assert.equal(messages.length, 5);
  [system, ...messages.map(m => m.content)].forEach(quiet);
});

test('copilot: a subagent task gets the hints in its prompt, and arguments may be an object as well as a JSON string', () => {
  const dir = repo(MONEY);
  const send = (event, payload) => JSON.parse(spawnSync('node', [ENTRY, '--host', 'copilot', event], { cwd: dir, input: JSON.stringify({ sessionId: 'c1', timestamp: Date.now(), cwd: dir, ...payload }), encoding: 'utf8', env: ENV }).stdout || '{}');
  send('userPromptSubmitted', { prompt: 'tidy up' });
  assert.match(send('preToolUse', { toolName: 'task', toolArgs: { description: 'totals', prompt: 'show the money totals' } }).modifiedArgs.prompt, /^show the money totals\n\n[\s\S]*format_money/);
  const edit = { path: path.join(dir, 'shop/money.py'), old_str: '    return', new_str: '    # ... existing code ...\n    return' };
  assert.match(send('preToolUse', { toolName: 'edit', toolArgs: edit }).permissionDecisionReason, /placeholder/);
  assert.match(send('preToolUse', { toolName: 'edit', toolArgs: JSON.stringify(edit) }).permissionDecisionReason, /placeholder/);
});

test("copilot: the repository's hook file runs lessloc from ~/.agent-standard, and does nothing where node or lessloc is missing", () => {
  const dir = repo(MONEY);
  repoHooks(dir, true);
  const command = JSON.parse(fs.readFileSync(REPO_HOOKS(dir), 'utf8')).hooks.sessionStart[0].bash;
  const start = (home, PATH = ENV.PATH) => spawnSync('/bin/sh', ['-c', command], { cwd: dir, input: JSON.stringify({ sessionId: 'r1', timestamp: 1, cwd: dir, source: 'startup' }), encoding: 'utf8', env: { ...ENV, HOME: home, PATH } });
  const bare = tmp('home-'), withLessloc = tmp('home-');
  fs.symlinkSync(ROOT, path.join(withLessloc, '.agent-standard'));
  for (const r of [start(bare), start(withLessloc, tmp('empty-bin-'))]) assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''], 'no lessloc, or no node: a no-op that lets every tool call through');
  assert.ok(JSON.parse(start(withLessloc).stdout).additionalContext.startsWith(STANDARD.slice(0, 60)));
});

test('gemini: a tool result with an error is a failed call, whatever its output says', () => {
  const dir = repo(MONEY), command = 'python3 -m pytest -q';
  const send = (event, extra) => spawnSync('node', [ENTRY, '--host', 'gemini'], { cwd: dir, input: JSON.stringify({ session_id: 'g1', cwd: dir, hook_event_name: event, timestamp: new Date().toISOString(), tool_name: 'run_shell_command', tool_input: { command }, ...extra }), encoding: 'utf8', env: ENV });
  send('BeforeTool', {});
  const after = send('AfterTool', { tool_response: { llmContent: 'Output: 1 passed in 0.05s\nError: spawn sh ENOENT', returnDisplay: '', error: { message: 'spawn sh ENOENT', type: 'shell_execute_error' } } });
  assert.deepEqual([after.status, after.stderr], [0, '']);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  assert.match(run(dir, 'check', '--staged').stdout, /tests FAILED at this exact state/);
});

test("cline: a replace_in_file diff is read block by block, so a swallowed error in a REPLACE block gets its note; the CLI's own hook payloads are left to lessloc's Cline plugin", () => {
  const dir = repo(MONEY), file = path.join(dir, 'shop/money.py');
  const send = payload => JSON.parse(spawnSync('node', [ENTRY, '--host', 'cline'], { cwd: dir, input: JSON.stringify({ clineVersion: '3.40.0', timestamp: '1', taskId: 'k1', workspaceRoots: [dir], userId: 'u1', ...payload }), encoding: 'utf8', env: ENV }).stdout || '{}');
  send({ hookName: 'UserPromptSubmit', userPromptSubmit: { prompt: 'make money safe', attachments: [] } });
  const diff = `------- SEARCH\n    return f"\${amount:.2f}"\n=======\n    try:\n        return f"\${amount:.2f}"\n    except Exception:\n        pass\n+++++++ REPLACE`;
  const parameters = { path: file, diff };
  assert.deepEqual(send({ hookName: 'PreToolUse', preToolUse: { toolName: 'replace_in_file', parameters } }), {});
  write(dir, { 'shop/money.py': 'def format_money(amount):\n    try:\n        return f"${amount:.2f}"\n    except Exception:\n        pass\n' });
  assert.match(send({ hookName: 'PostToolUse', postToolUse: { toolName: 'replace_in_file', parameters, result: 'ok', success: true, executionTimeMs: 3 } }).contextModification, /^shop\/money\.py:4: swallowed error/);
  assert.deepEqual(send({ hookName: 'agent_start', taskStart: { taskMetadata: {} } }), {}, "the Cline CLI's hook layer, which also loads lessloc's plugin");
});

test("augment: numbered replacements are gated one by one, the changed files give a write note its path, and with no prompt event a turn starts where the last one ended, its request read at its end", () => {
  const dir = repo(MONEY);
  const send = input => JSON.parse(spawnSync('node', [ENTRY, '--host', 'augment'], { cwd: dir, input: JSON.stringify({ conversation_id: 'a1', workspace_roots: [dir], ...input }), encoding: 'utf8', env: ENV }).stdout || '{}');
  const stop = prompt => send({ hook_event_name: 'Stop', agent_stop_cause: 'end_turn', conversation: { userPrompt: prompt, agentTextResponse: 'Done.' } });
  send({ hook_event_name: 'SessionStart' });
  const edit = { command: 'str_replace', path: 'shop/money.py', old_str_1: 'def format_money(amount):', new_str_1: 'def format_money(amount: float):', old_str_2: '    return', new_str_2: '    # ... existing code ...\n    return' };
  assert.match(send({ hook_event_name: 'PreToolUse', tool_name: 'str-replace-editor', tool_input: edit, is_mcp_tool: false }).hookSpecificOutput.permissionDecisionReason, /placeholder/);
  const swallowed = 'def format_money(amount):\n    try:\n        return f"${amount:.2f}"\n    except Exception:\n        pass\n';
  const fix = { command: 'str_replace', path: 'shop/money.py', old_str_1: '    return f"${amount:.2f}"', new_str_1: '    try:\n        return f"${amount:.2f}"\n    except Exception:\n        pass' };
  assert.deepEqual(send({ hook_event_name: 'PreToolUse', tool_name: 'str-replace-editor', tool_input: fix, is_mcp_tool: false }), {});
  write(dir, { 'shop/money.py': swallowed });
  const note = send({ hook_event_name: 'PostToolUse', tool_name: 'str-replace-editor', tool_input: { command: 'str_replace', old_str_1: 'x', new_str_1: 'y' }, tool_output: 'Edited.', is_mcp_tool: false, file_changes: [{ path: 'shop/money.py', changeType: 'edit', content: swallowed, oldContent: MONEY['shop/money.py'] }] });
  assert.match(note.hookSpecificOutput.additionalContext, /^shop\/money\.py:4: swallowed error/);
  assert.match(stop('make money safe').reason, /shop\/money\.py/, 'the turn is held once');
  assert.deepEqual(stop('make money safe'), {}, 'and only once; the next turn starts here');
  write(dir, { 'shop/clean.py': 'x = 1\n' });
  send({ hook_event_name: 'PreToolUse', tool_name: 'save-file', tool_input: { path: 'shop/clean.py', file_content: 'x = 1\n' }, is_mcp_tool: false });
  const held = stop('implement `export_csv()` in shop/clean.py').reason;
  assert.match(held, /export_csv/, "the request the Stop hook carries is the turn's");
  assert.doesNotMatch(held, /money\.py/, 'the last turn\'s files are not this one\'s');
});

test('junie: with no after-tool event, the end of a turn reviews every file changed since its start, a shell command\'s too; its tool and stop hooks belong to the session that started last', () => {
  const dir = repo(MONEY), send = input => JSON.parse(spawnSync('node', [ENTRY, '--host', 'junie'], { cwd: dir, input: JSON.stringify(input), encoding: 'utf8', env: ENV }).stdout || '{}');
  send({ hook_event_name: 'SessionStart', session_id: 'j1', cwd: dir, project_path: dir, source: 'startup' });
  send({ hook_event_name: 'UserPromptSubmit', session_id: 'j1', cwd: dir, project_path: dir, prompt: 'generate the loader' });
  assert.deepEqual(send({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'python3 gen.py', run_in_background: false, timeout: 30 } }), {});
  write(dir, { 'shop/load.py': LOADER });
  assert.match(send({ hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.' }).reason, /shop\/load\.py/);
});

test("goose and kiro: the names they show the model with a refusal or a held turn say nothing of lessloc", () => {
  const dir = repo(MONEY), names = [];
  for (const host of ['goose', 'kiro']) {
    const f = path.join(tmp(`${host}-`), 'hooks.json');
    userHooks(host, true, f);
    const file = JSON.parse(fs.readFileSync(f, 'utf8'));
    names.push(...(Array.isArray(file.hooks) ? file.hooks.map(h => h.name) : [NEUTRAL]));
  }
  assert.ok(names.length > 1 && names.every(n => n.startsWith(NEUTRAL)));
  names.forEach(quiet);
  const reason = JSON.parse(spawnSync('node', [ENTRY, '--host', 'goose'], { cwd: dir, input: JSON.stringify({ event: 'PreToolUse', session_id: 'g1', tool_name: 'write', tool_input: { path: path.join(dir, 'shop/b.py'), content: '# ... existing code ...\n' }, working_dir: dir, tool_call_id: 'c1' }), encoding: 'utf8', env: ENV }).stdout).reason;
  // goose wraps a refusal in its own words, with the plugin's name (its hooks guide).
  quiet(`Tool call denied by policy hook \`${NEUTRAL}\`: ${reason}. Do not retry; this is a policy denial, not a transient failure.`);
});

test("crush: a session's first tool call carries the session start text, the standard only where Crush's CRUSH.md lacks it, and a refusal carries it in its reason", () => {
  const dir = repo(MONEY), home = tmp('home-'), ls = { tool_name: 'bash', tool_input: { command: 'ls' } };
  const send = (sid, call) => spawnSync('node', [ENTRY, '--host', 'crush'], { cwd: dir, input: JSON.stringify({ event: 'PreToolUse', session_id: sid, cwd: dir, ...call }), encoding: 'utf8', env: { ...ENV, HOME: home } }).stdout;
  // A Claude Code session leaves work uncommitted.
  hook(dir, { hook_event_name: 'SessionStart', source: 'startup' });
  turn(dir, 'add a loader');
  agentWrite(dir, { 'shop/load.py': LOADER });
  stop(dir);
  const first = JSON.parse(send('c1', ls)).context;
  assert.ok(first.startsWith(STANDARD.slice(0, 60)), 'the standard comes first');
  assert.match(first, /shop\/load\.py/, 'then the note the last session left');
  assert.equal(send('c1', ls), '', 'once per session');
  const refused = JSON.parse(send('c2', { tool_name: 'write', tool_input: { file_path: path.join(dir, 'shop/b.py'), content: '# ... existing code ...\n' } }));
  assert.match(refused.reason, /^Not applied: it adds a placeholder/);
  assert.ok(refused.reason.includes(STANDARD.slice(0, 60)) && refused.context === undefined, "the reason is what the model reads of a refused call");
  write(home, { '.config/crush/CRUSH.md': `<!-- working-standard -->\n${STANDARD}\n<!-- /working-standard -->\n` });
  const later = JSON.parse(send('c3', ls)).context;
  assert.ok(!later.includes(STANDARD.slice(0, 60)) && /shop\/load\.py/.test(later), 'CRUSH.md holds the standard');
  [first, refused.reason, later].forEach(quiet);
});

// What Aider runs as its lint command and what it shows its model, from test/fixtures/lint/aider.json.
const AIDER = JSON.parse(fs.readFileSync(new URL('./fixtures/lint/aider.json', import.meta.url), 'utf8'));
test(`aider: its lint command reports what a gate would refuse and what is cheapest to fix now, never reads its input, and names nothing of lessloc where the model reads it (${AIDER.source.join(', ')})`, async () => {
  const dir = repo(MONEY), home = tmp('home-'), env = { ...ENV, HOME: home };
  spawnSync('node', [new URL('../lessloc.mjs', import.meta.url).pathname, 'init', '--aider'], { cwd: dir, encoding: 'utf8', env });
  const conf = fs.readFileSync(path.join(home, '.aider.conf.yml'), 'utf8'), set = k => JSON.parse(new RegExp(`^${k}: (.*)$`, 'm').exec(conf)[1]);
  const vars = { LINT_CMD: set('lint-cmd'), READ: set('read'), READ_CONTENT: fs.readFileSync(set('read'), 'utf8') };
  // Aider's terminal stays open as the command's input; a command that waited for it would be killed here.
  const lint = file => new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', fill(AIDER.run, { ...vars, FILE: file })], { cwd: dir, env });
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    const timer = setTimeout(() => child.kill(), 4000);
    child.on('close', code => (clearTimeout(timer), resolve({ code, out })));
  });
  write(dir, { 'shop/b.py': 'x = 1\n# ... existing code ...\n', 'shop/load.py': LOADER, 'shop/clean.py': 'x = 1\n' });
  const placeholder = await lint('shop/b.py'), swallowed = await lint('shop/load.py');
  assert.deepEqual(placeholder, { code: 1, out: 'shop/b.py:2: placeholder: delete `# ... existing code ...`\n' });
  assert.equal(swallowed.code, 1);
  assert.match(swallowed.out, /^shop\/load\.py:4: swallowed error/);
  assert.deepEqual(await lint('shop/clean.py'), { code: 0, out: '' }, 'a clean file: no lint error');
  assert.deepEqual(await lint('shop/money.py'), { code: 0, out: '' }, 'an unchanged file');
  assert.equal(vars.READ_CONTENT, `${STANDARD}\n`);
  const shown = [fill(AIDER.model, { ...vars, FILE: 'shop/b.py', OUTPUT: placeholder.out }), fill(AIDER.system, vars), fill(AIDER.read_only, vars)];
  shown.map(t => t.replaceAll(home, '/home/user')).forEach(quiet);
});
