// lessloc for the Pi coding agent: an extension that forwards Pi's runs and tool calls to `hook.mjs --host pi` and applies the
// answers (bridge/core.js). `pi install https://get.lessloc.org/pi/lessloc.git` loads it through package.json's `pi` key, and
// `lessloc init --pi` puts a file in Pi's extensions folder that loads it.
import { append, call, joined } from '../bridge/core.js';

// Pi's file and shell tools in the generic protocol's names.
function toolOf(name, i = {}) {
  if (name === 'bash' || name === 'powershell') return ['shell', { command: i.command }];
  if (name === 'write') return ['write', { path: i.path, content: i.content }];
  if (name === 'edit') return ['edit', { path: i.path, edits: (Array.isArray(i.edits) ? i.edits : [i]).map(e => ({ old_string: e.oldText, new_string: e.newText })) }];
  return undefined;
}
const textOf = content => (typeof content === 'string' ? content : (content || []).filter(p => p?.type === 'text').map(p => p.text).join('\n'));
const said = messages => textOf([...(messages || [])].reverse().find(m => m?.role === 'assistant')?.content);

export default function (pi) {
  const started = new Map(), sentBack = new Set();
  let source = 'startup';
  const run = (ctx, input) => call('pi', ctx.cwd, { session_id: ctx.sessionManager.getSessionId(), ...input });
  pi.on('session_start', e => {
    source = e.reason === 'resume' ? 'resume' : 'startup';
  });
  // The working standard comes with the session's first run, the hints with each prompt, as a message the user does not see.
  pi.on('before_agent_start', async (e, ctx) => {
    if (e.messageType !== 'user') return undefined;
    const sid = ctx.sessionManager.getSessionId(), first = !started.has(sid);
    sentBack.delete(sid);
    if (first) started.set(sid, run(ctx, { hook_event_name: 'SessionStart', source }));
    const start = await started.get(sid), hints = await run(ctx, { hook_event_name: 'UserPromptSubmit', prompt: e.prompt });
    const content = joined(first && start.context, hints.context);
    return content ? { message: { customType: 'context', content, display: false } } : undefined;
  });
  // A blocked call's reason is the error result the model reads.
  pi.on('tool_call', async (e, ctx) => {
    const [tool, input] = toolOf(e.toolName, e.input) || [];
    if (!tool) return undefined;
    const out = await run(ctx, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: e.toolCallId });
    return out.deny ? { block: true, reason: out.deny } : undefined;
  });
  pi.on('tool_result', async (e, ctx) => {
    const [tool, input] = toolOf(e.toolName, e.input) || [];
    if (!tool) return undefined;
    // A shell command's exit code is in its structured result; a non-zero one makes the result an error, but the call ran.
    const exit = e.structuredContent?.exit_code, ran = !e.isError || typeof exit === 'number';
    const out = await run(ctx, { hook_event_name: ran ? 'PostToolUse' : 'PostToolUseFailure', tool_name: tool, tool_input: input, tool_use_id: e.toolCallId, tool_response: { ...(typeof exit === 'number' && { exit_code: exit }), output: textOf(e.content) }, ...(ran ? {} : { error: textOf(e.content) }) });
    return out.feedback && ran ? { content: append(e.content, out.feedback), structuredContent: e.structuredContent } : undefined;
  });
  // Before a run settles, lessloc may ask for one more model request, with what is unfinished as a message the user does not see.
  pi.on('agent_before_settle', async (e, ctx) => {
    const sid = ctx.sessionManager.getSessionId(), again = sentBack.has(sid);
    const out = await run(ctx, { hook_event_name: 'Stop', stop_hook_active: again, last_assistant_message: said(e.context?.contextMessages), status: e.outcome });
    if (!out.block || again) return undefined;
    sentBack.add(sid);
    return { entries: [{ type: 'custom_message', customType: 'follow-up', content: out.block, display: false }], continue: true };
  });
}
