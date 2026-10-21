// lessloc for OpenCode and Kilo Code: a plugin that forwards their session and tool events to `hook.mjs --host <tool>` and
// applies the answers (bridge/core.js). One default export carries both plugin shapes: OpenCode 2.x runs `setup`, and OpenCode
// 1.x runs `server`. Kilo Code, a fork of OpenCode 1.x, loads the `kilo` export, whose runs are logged under its own name.
import { append, call as hook, joined } from '../bridge/core.js';

const WRITES = /^(write|edit|patch|shell)$/;
const call = (cwd, input) => hook('opencode', cwd, input);

async function setup(ctx) {
  const cwd = ctx.location.directory, started = new Map(), hints = new Map(), decisions = new Map(), sentBack = new Map(), stop = new AbortController();
  const start = sid => started.get(sid) || started.set(sid, call(cwd, { hook_event_name: 'SessionStart', session_id: sid, source: 'startup' })).get(sid);
  await ctx.session.hook('prompt', async e => {
    // lessloc's own follow-up arrives as a prompt too: it continues the turn instead of starting one.
    if (sentBack.get(e.sessionID) === e.prompt.text) return;
    sentBack.delete(e.sessionID);
    await start(e.sessionID);
    hints.set(e.sessionID, (await call(cwd, { hook_event_name: 'UserPromptSubmit', session_id: e.sessionID, prompt: e.prompt.text })).context);
  });
  // OpenCode keeps no change a context hook makes, so the rules and the turn's hints go into every request.
  await ctx.session.hook('context', async e => {
    const text = joined((await start(e.sessionID)).context, hints.get(e.sessionID));
    if (text) e.system.push({ type: 'text', text });
  });
  // The decision is made where the full input is, and applied where OpenCode asks for permission: the same call, by its id.
  await ctx.tool.hook('execute.before', async e => {
    if (!WRITES.test(e.tool)) return;
    const out = await call(cwd, { hook_event_name: 'PreToolUse', session_id: e.sessionID, tool_name: e.tool, tool_input: e.input, tool_use_id: e.id });
    if (out.deny || out.ask) decisions.set(e.id, out);
  });
  await ctx.permission.hook('evaluate', e => {
    const out = e.source?.type === 'tool' && decisions.get(e.source.id);
    if (!out) return;
    decisions.delete(e.source.id);
    e.effect = out.deny ? 'deny' : 'ask';
    e.message = out.deny || out.ask;
  });
  await ctx.tool.hook('execute.after', async e => {
    if (!WRITES.test(e.tool)) return;
    decisions.delete(e.id);
    // The whole result: its metadata has the exit code, its content the output, where a test runner's summary is.
    const done = e.status === 'completed', result = { ...(e.result?.metadata || {}), content: e.result?.content };
    // A call the user rejected or aborted never ran to its end: it is no result.
    const error = String(e.error?.message ?? e.error ?? ''), stopped = !done && /reject|denied|abort|cancel|interrupt/i.test(`${e.status} ${error}`);
    const out = await call(cwd, { hook_event_name: done ? 'PostToolUse' : 'PostToolUseFailure', session_id: e.sessionID, tool_name: e.tool, tool_input: e.input, tool_use_id: e.id, tool_response: result, ...(done ? {} : { error, is_interrupt: stopped }) });
    if (out.feedback && done) e.result = { ...e.result, content: append(e.result.content, out.feedback) };
  });
  // A turn ends when a step finishes without calling a tool. lessloc may send the agent back once per prompt.
  (async () => {
    for await (const ev of ctx.event.subscribe({ signal: stop.signal })) {
      if (ev.type !== 'session.step.ended' || ev.data.finish !== 'stop') continue;
      const sid = ev.data.sessionID, out = await call(cwd, { hook_event_name: 'Stop', session_id: sid, stop_hook_active: sentBack.has(sid) });
      if (!out.block || sentBack.has(sid)) continue;
      sentBack.set(sid, out.block);
      await ctx.session.synthetic({ sessionID: sid, text: out.block, delivery: 'steer' });
    }
  })().catch(() => {});
  return () => stop.abort();
}

// OpenCode 1.x and Kilo Code name their tools and arguments as below; the generic protocol's names are on the right.
const V1_TOOLS = { bash: 'shell', write: 'write', edit: 'edit', multiedit: 'edit', apply_patch: 'patch', patch: 'patch' };
function v1Input(tool, a = {}) {
  const path = a.filePath ?? a.path;
  if (tool === 'shell') return { command: a.command, workdir: a.workdir };
  if (tool === 'patch') return { patch: a.patchText ?? a.patch ?? '' };
  if (Array.isArray(a.edits)) return { path, edits: a.edits.map(e => ({ old_string: e.oldString, new_string: e.newString })) };
  return tool === 'edit' ? { path, old_string: a.oldString, new_string: a.newString } : { path, content: a.content };
}
const textOf = parts => (parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n');

// The 1.x plugin API has no per-call permission override, so a call lessloc would put to the user is refused with the reason
// instead, and the agent asks the user. A held turn is sent back as a new prompt (an emulated hold), once per prompt.
const v1 = host => async ({ directory, client }) => {
  const cwd = directory, started = new Map(), hints = new Map(), sentBack = new Map(), children = new Set();
  const send = input => hook(host, cwd, { ...input, caps: { ask: false } });
  const start = sid => started.get(sid) || started.set(sid, send({ hook_event_name: 'SessionStart', session_id: sid, source: 'startup' })).get(sid);
  return {
    // lessloc's own follow-up arrives as a message too: it continues the turn. Text the tool adds to a message (an attached
    // file's content) is not the user's request.
    'chat.message': async (input, output) => {
      const sid = input.sessionID, parts = output.parts || [];
      if (sentBack.get(sid) === textOf(parts)) return;
      sentBack.delete(sid);
      await start(sid);
      hints.set(sid, (await send({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: textOf(parts.filter(p => !p.synthetic)) })).context);
    },
    'experimental.chat.system.transform': async (input, output) => {
      if (!input.sessionID) return;
      const text = joined((await start(input.sessionID)).context, hints.get(input.sessionID));
      if (text) output.system.push(text);
    },
    // A plugin refuses a call by throwing; the tool call then fails with that message, which the model reads.
    'tool.execute.before': async (input, output) => {
      const tool = V1_TOOLS[input.tool];
      if (!tool) return;
      const out = await send({ hook_event_name: 'PreToolUse', session_id: input.sessionID, tool_name: tool, tool_input: v1Input(tool, output.args), tool_use_id: input.callID });
      if (out.deny) throw new Error(out.deny);
    },
    'tool.execute.after': async (input, output) => {
      const tool = V1_TOOLS[input.tool];
      if (!tool) return;
      const exit = output.metadata?.exit ?? output.metadata?.exitCode;
      const out = await send({ hook_event_name: 'PostToolUse', session_id: input.sessionID, tool_name: tool, tool_input: v1Input(tool, input.args), tool_use_id: input.callID, tool_response: { ...(typeof exit === 'number' && { exit_code: exit }), output: String(output.output ?? '') } });
      if (out.feedback) output.output = append(String(output.output ?? ''), out.feedback);
    },
    // A session goes idle when its turn ends. A subagent's session is part of its parent's turn, never held on its own.
    event: async ({ event }) => {
      if (event.type === 'session.created' && event.properties?.info?.parentID) children.add(event.properties.info.id);
      if (event.type !== 'session.idle' || children.has(event.properties?.sessionID)) return;
      const sid = event.properties.sessionID, out = await send({ hook_event_name: 'Stop', session_id: sid, stop_hook_active: sentBack.has(sid) });
      if (!out.block || sentBack.has(sid)) return;
      sentBack.set(sid, out.block);
      client.session.prompt({ path: { id: sid }, body: { parts: [{ type: 'text', text: out.block, synthetic: true }] } })?.catch?.(() => {});
    },
  };
};

export default { id: 'lessloc', setup, server: v1('opencode') };
export const kilo = { id: 'lessloc', server: v1('kilo') };
