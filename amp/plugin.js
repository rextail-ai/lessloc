// lessloc for Amp: a plugin (Amp's Plugin API) that forwards each thread's turns and tool calls to `hook.mjs --host amp` and
// applies the answers (bridge/core.js). `lessloc init --amp` puts a file in Amp's plugin folder that loads this one.
import { append, call, joined } from '../bridge/core.js';

// Amp's file and shell tools in the generic protocol's names. A shell call is recognized by Amp's own helper where it has one.
function toolOf(e, amp) {
  const sh = amp.helpers?.shellCommandFromToolCall?.(e), i = e.input || {};
  if (sh) return ['shell', { command: sh.command, workdir: sh.dir }];
  if (e.tool === 'Bash' || e.tool === 'shell_command') return ['shell', { command: i.cmd ?? i.command, workdir: i.cwd ?? i.workdir }];
  if (e.tool === 'create_file') return ['write', { path: i.path, content: i.content }];
  if (e.tool === 'edit_file') return ['edit', { path: i.path, old_string: i.old_str, new_string: i.new_str }];
  if (e.tool === 'apply_patch') return ['patch', { patch: i.patch ?? i.input ?? i.patchText ?? '' }];
  return undefined;
}
// A tool's output may be text, content parts, or an object with its text under `output` and its exit code.
const textOf = o => (typeof o === 'string' ? o : Array.isArray(o) ? o.map(p => p?.text ?? '').join('\n') : typeof o?.output === 'string' ? o.output : JSON.stringify(o ?? ''));
const response = o => ({ ...(typeof (o?.exitCode ?? o?.exit_code) === 'number' && { exit_code: o.exitCode ?? o.exit_code }), output: textOf(o) });
const withNote = (o, note) => (typeof o === 'string' || Array.isArray(o) || o == null ? append(o ?? '', note) : typeof o.output === 'string' ? { ...o, output: append(o.output, note) } : o);
const said = messages => {
  const m = [...(messages || [])].reverse().find(x => x?.role === 'assistant');
  return m ? textOf(typeof m.content === 'string' ? m.content : (m.content || []).filter(p => p?.type === 'text')) : '';
};

export default function (amp) {
  // The workspace the user has open; Amp reloads its plugins when it changes.
  const root = amp.system?.workspaceRoot, cwd = root && amp.helpers?.filePathFromURI ? amp.helpers.filePathFromURI(root) : process.cwd(), started = new Map(), sentBack = new Map();
  const run = input => call('amp', cwd, input);
  amp.on('agent.start', async e => {
    const sid = e.thread.id;
    // lessloc's own follow-up arrives as a prompt too: it continues the turn instead of starting one.
    if (sentBack.get(sid) === e.message) return {};
    sentBack.delete(sid);
    // The working standard rides on the thread's first prompt, as hidden text after it; Amp keeps it in the thread.
    const first = !started.has(sid);
    if (first) started.set(sid, run({ hook_event_name: 'SessionStart', session_id: sid, source: 'startup' }));
    const start = await started.get(sid), hints = (await run({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: e.message })).context;
    const content = joined(first && start.context, hints);
    return content ? { message: { content, display: false } } : {};
  });
  amp.on('tool.call', async e => {
    const [tool, input] = toolOf(e, amp) || [];
    if (!tool) return { action: 'allow' };
    const out = await run({ hook_event_name: 'PreToolUse', session_id: e.thread.id, tool_name: tool, tool_input: input, tool_use_id: e.toolUseID });
    return out.deny ? { action: 'reject-and-continue', message: out.deny } : { action: 'allow' };
  });
  amp.on('tool.result', async e => {
    const [tool, input] = toolOf(e, amp) || [];
    if (!tool) return undefined;
    const done = e.status === 'done';
    const out = await run({ hook_event_name: done ? 'PostToolUse' : 'PostToolUseFailure', session_id: e.thread.id, tool_name: tool, tool_input: input, tool_use_id: e.toolUseID, tool_response: response(e.output), ...(done ? {} : { error: String(e.error ?? ''), is_interrupt: e.status === 'cancelled' }) });
    return out.feedback && done ? { status: 'done', output: withNote(e.output, out.feedback) } : undefined;
  });
  // A turn that ended done may be sent back once, with a follow-up message; one cancelled or failed is only reviewed, and so
  // is a subagent's thread, whose work its parent's turn carries on.
  amp.on('agent.end', async (e, ctx) => {
    const sid = e.thread.id, again = sentBack.has(sid);
    const out = await run({ hook_event_name: 'Stop', session_id: sid, stop_hook_active: again, last_assistant_message: said(e.messages), status: e.status === 'done' ? 'completed' : e.status });
    if (!out.block || again || (await ctx?.thread?.parentThreadID?.().catch(() => null))) return undefined;
    sentBack.set(sid, out.block);
    return { action: 'continue', userMessage: out.block };
  });
}
