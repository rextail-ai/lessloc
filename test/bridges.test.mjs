import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { STANDARD } from '../lib/voice.mjs';
import { fill, repo, run, write } from './helpers.mjs';

// The contract every plugin bridge keeps, run from test/fixtures/bridges/<tool>.json: the events each tool's plugin API
// documents, with $NAME placeholders for what each step fills in, sent through a fake of that API the way the tool sends them;
// the answer is read where the tool reads it. `exports` names the module's export that each tool loads.
const FIXTURES = new URL('./fixtures/bridges/', import.meta.url);
const fixtures = fs.readdirSync(FIXTURES).map(f => JSON.parse(fs.readFileSync(new URL(f, FIXTURES), 'utf8')));
const quiet = t => assert.doesNotMatch(String(t), /lessloc|\bnode\s|\.mjs\b|\[[a-z]+(?:-[a-z]+)*\]|\(CWE-|et al\./i);
const textOf = c => (typeof c === 'string' ? c : (c || []).map(p => p.text).join('\n'));
const LOADER = 'def load():\n    try:\n        return open("x").read()\n    except Exception:\n        pass\nprint("debug", load())\n';
const MONEY = { 'shop/money.py': 'def format_money(amount):\n    return f"${amount:.2f}"\n', '.lessloc.json': '{"test": "python3 -m pytest"}' };

// Each tool's plugin API, reduced to what the bridge uses. `send(step, event, vars)` returns what reached the model:
// context, a refusal, the tool result after the feedback (and before it), the follow-up that holds the turn.
const HOSTS = {
  async 'opencode/server.js'(plugin, dir, fx) {
    const prompts = [], hooks = await plugin.server({ directory: dir, worktree: dir, project: {}, client: { session: { prompt: async m => void prompts.push(m) } } });
    return {
      holds: true,
      async send(step, ev, vars) {
        if (step === 'prompt') {
          await hooks['chat.message'](ev.input, ev.output);
          const request = fill(fx.events.system, vars), before = request.output.system.length;
          await hooks['experimental.chat.system.transform'](request.input, request.output);
          return { context: request.output.system.slice(before).join('\n\n') };
        }
        if (step === 'write' || step === 'shell') {
          try { await hooks['tool.execute.before'](ev.input, ev.output); return {}; } catch (e) { return { deny: e.message }; }
        }
        if (step === 'written' || step === 'ran') {
          const original = ev.output.output;
          await hooks['tool.execute.after'](ev.input, ev.output);
          return ev.output.output === original ? {} : { feedback: ev.output.output, original };
        }
        const sent = prompts.length;
        await hooks.event(ev);
        return prompts.length > sent ? { block: textOf(prompts.at(-1).body.parts) } : {};
      },
      // The follow-up arrives as a message, as the user's would, and continues the turn.
      followUp: (block, vars) => hooks['chat.message']({ sessionID: vars.SID }, { parts: [{ type: 'text', text: block, synthetic: true }] }).then(() => ({})),
    };
  },
  async 'amp/plugin.js'(plugin, dir) {
    const on = {}, ctx = sid => ({ thread: { id: sid, parentThreadID: async () => null } });
    plugin({ on: (name, f) => void (on[name] = f), system: { workspaceRoot: pathToFileURL(dir) }, helpers: { filePathFromURI: u => new URL(String(u)).pathname, shellCommandFromToolCall: e => (e.tool === 'Bash' ? { command: e.input.cmd, dir: e.input.cwd } : null) } });
    const answer = {
      prompt: r => ({ context: r?.message?.display === false ? r.message.content : undefined }),
      write: r => (r.action === 'reject-and-continue' ? { deny: r.message } : {}),
      written: (r, ev) => (r ? { feedback: r.output, original: ev.output } : {}),
      stop: r => (r?.action === 'continue' ? { block: r.userMessage } : {}),
    };
    const events = { prompt: 'agent.start', write: 'tool.call', shell: 'tool.call', written: 'tool.result', ran: 'tool.result', stop: 'agent.end' };
    return {
      holds: true,
      send: async (step, ev, vars) => (answer[step] || answer[step === 'shell' ? 'write' : 'written'])(await on[events[step]](ev, ctx(vars.SID)), ev),
      followUp: async (block, vars) => answer.prompt(await on['agent.start']({ thread: { id: vars.SID }, message: block, id: 2 }, ctx(vars.SID))),
    };
  },
  async 'cline/plugin.js'(factory, dir) {
    // A generous deadline: the tests run many hooks at once, where Cline runs one.
    const plugin = factory(60000), { hooks } = plugin;
    plugin.setup({}, { cwd: dir });
    return {
      holds: false,
      async send(step, ev) {
        if (step === 'prompt') return { context: (await hooks.beforeRun(ev))?.appendContext };
        if (step === 'write' || step === 'shell') {
          const r = await hooks.beforeTool(ev);
          return r?.skip ? { deny: r.reason } : {};
        }
        if (step === 'written' || step === 'ran') return { feedback: (await hooks.afterTool(ev))?.appendContext };
        await hooks.afterRun(ev);
        return {};
      },
    };
  },
  async 'pi/extension.js'(plugin, dir, fx) {
    const on = {};
    plugin({ on: (name, f) => void (on[name] = f) });
    const ctx = sid => ({ cwd: dir, sessionManager: { getSessionId: () => sid } }), begun = new Set();
    return {
      holds: true,
      async send(step, ev, vars) {
        if (step === 'prompt') {
          if (!begun.has(vars.SID)) begun.add(vars.SID), await on.session_start(fx.events.start, ctx(vars.SID));
          const r = await on.before_agent_start(ev, ctx(vars.SID));
          return { context: r?.message?.display === false ? textOf(r.message.content) : undefined };
        }
        if (step === 'write' || step === 'shell') {
          const r = await on.tool_call(ev, ctx(vars.SID));
          return r?.block ? { deny: r.reason } : {};
        }
        if (step === 'written' || step === 'ran') {
          const r = await on.tool_result(ev, ctx(vars.SID));
          return r?.content ? { feedback: textOf(r.content), original: textOf(ev.content) } : {};
        }
        const r = await on.agent_before_settle(ev, ctx(vars.SID));
        return r?.continue && r.entries?.[0]?.display === false ? { block: r.entries[0].content } : {};
      },
      // A held run makes one more model request; no new prompt starts.
      followUp: async () => ({}),
    };
  },
};

for (const fx of fixtures) {
  for (const [tool, name] of Object.entries(fx.exports)) {
    test(`${tool}: the plugin bridge's contract scenario from its documented events (${fx.source.join(', ')})`, async () => {
      const dir = repo(MONEY), plugin = (await import(`../${fx.module}`))[name], host = await HOSTS[fx.module](plugin, dir, fx);
      let n = 0;
      const send = async (step, vars = {}) => {
        const file = vars.FILE || 'shop/x.py', exit = vars.EXIT ?? 0;
        const all = { SID: 's1', CWD: dir, ID: `id${++n}`, FILE: file, ABSFILE: path.join(dir, file), CONTENT: '', PROMPT: 'show the money totals', OUTPUT: '', EXIT: exit, OK: exit === 0, FAILED: exit !== 0, EXIT_STATUS: exit ? `\n\nCommand exited with code ${exit}` : '', ...vars };
        const said = await host.send(step, fill(fx.events[step], all), all), { original, ...told } = said;
        // What lessloc added: the tool's own output is the tool's.
        Object.values({ ...told, ...(original !== undefined && { feedback: said.feedback.slice(original.length) }) }).forEach(quiet);
        return said;
      };

      const first = await send('prompt');
      assert.ok(first.context.startsWith(STANDARD.slice(0, 60)), 'the standard reaches the model with the first prompt');
      assert.match(first.context, /format_money/, 'and the hints about existing code');

      assert.match((await send('write', { FILE: 'shop/b.py', CONTENT: '# ... existing code ...\n' })).deny, /placeholder/);
      assert.deepEqual(await send('write', { FILE: 'shop/clean.py', CONTENT: 'x = 1\n' }), {}, 'a clean write passes');
      assert.match((await send('write', { FILE: '.lessloc.json', CONTENT: '{}\n' })).deny, /only the user may approve that\. Ask them/);
      assert.match((await send('shell', { COMMAND: 'git commit --no-verify -m x' })).deny, /only the user may approve that\. Ask them/);

      const loader = { FILE: 'shop/load.py', CONTENT: LOADER, ID: 'w1' };
      assert.equal((await send('write', loader)).deny, undefined);
      write(dir, { 'shop/load.py': LOADER });
      const note = await send('written', loader);
      assert.match(note.feedback, /shop\/load\.py:4: swallowed error/, 'the write note reaches the model');
      if (note.original !== undefined) assert.ok(note.feedback.startsWith(note.original), 'after the tool result, never in its place');

      const verified = () => (execFileSync('git', ['add', '-A'], { cwd: dir }), run(dir, 'check', '--staged').stdout);
      const tests = async (exit, output) => {
        const vars = { COMMAND: 'python3 -m pytest -q', EXIT: exit, OUTPUT: output, ID: `t${exit}${n}` };
        await send('shell', vars);
        await send('ran', vars);
      };
      await tests(1, 'F\n1 failed in 0.05s\n');
      assert.match(verified(), /tests FAILED at this exact state/);
      await tests(0, '.\n1 passed in 0.05s\n');
      assert.match(verified(), /tests passed at this exact state \(working tree \(run by the agent\)\)/);

      if (host.holds) {
        const { block } = await send('stop');
        assert.match(block, /shop\/load\.py/, 'the turn is held once, in plain words');
        assert.equal((await host.followUp(block, { SID: 's1' })).context, undefined, 'the follow-up continues the turn: no rules or hints again');
        assert.equal((await send('stop', { AGAIN: true })).block, undefined, 'and only once');
      } else assert.deepEqual(await send('stop'), {}, 'a tool that cannot hold the end of a run is told nothing');

      // The next session hears what was left open. Where the review runs on its own (Cline), it may still be running.
      let next = '';
      for (let i = 0; i < 100 && !/shop\/load\.py/.test(next); i++) {
        next = (await send('prompt', { SID: `s2-${i}` })).context || '';
        if (!/shop\/load\.py/.test(next)) await new Promise(r => setTimeout(r, 200));
      }
      assert.match(next, /shop\/load\.py/);
    });
  }
}

test("Cline CLI and SDK: a placeholder in a replace_in_file REPLACE block is refused, and a hook past Cline's deadline answers nothing", async () => {
  const dir = repo(MONEY), { lessloc } = await import('../cline/plugin.js'), plugin = lessloc(60000);
  plugin.setup({}, { cwd: dir });
  const snapshot = { agentId: 'a1', conversationId: 'c1', runId: 'r1', iteration: 1, messages: [] };
  const input = { path: path.join(dir, 'shop/money.py'), diff: '------- SEARCH\n    return f"${amount:.2f}"\n=======\n    # ... existing code ...\n    return f"${amount:.2f}"\n+++++++ REPLACE' };
  const r = await plugin.hooks.beforeTool({ snapshot, toolCall: { toolCallId: 't1', toolName: 'replace_in_file', input }, input });
  assert.equal(r.skip, true);
  assert.match(r.reason, /placeholder/);
  const hurried = lessloc(1);
  hurried.setup({}, { cwd: dir });
  assert.equal(await hurried.hooks.beforeTool({ snapshot, toolCall: { toolCallId: 't2', toolName: 'replace_in_file', input }, input }), undefined, 'fails open');
});

test('OpenCode 1.x: a subagent session is never held on its own; its parent turn is', async () => {
  const dir = repo({ ...MONEY, 'shop/load.py': '' }), { default: plugin } = await import('../opencode/server.js'), prompts = [];
  const hooks = await plugin.server({ directory: dir, worktree: dir, project: {}, client: { session: { prompt: async m => void prompts.push(m) } } });
  await hooks.event({ event: { type: 'session.created', properties: { info: { id: 'child', parentID: 'parent' } } } });
  for (const sid of ['child', 'parent']) {
    await hooks['chat.message']({ sessionID: sid }, { parts: [{ type: 'text', text: 'add a loader' }] });
    const args = { filePath: path.join(dir, 'shop/load.py'), content: LOADER };
    await hooks['tool.execute.before']({ tool: 'write', sessionID: sid, callID: `w-${sid}` }, { args });
    write(dir, { 'shop/load.py': LOADER });
    await hooks['tool.execute.after']({ tool: 'write', sessionID: sid, callID: `w-${sid}`, args }, { title: '', output: 'Wrote file successfully.', metadata: {} });
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: sid } } });
    write(dir, { 'shop/load.py': '' });
  }
  assert.deepEqual(prompts.map(p => p.path.id), ['parent']);
});
