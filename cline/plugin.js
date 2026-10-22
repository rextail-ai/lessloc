// lessloc for the Cline CLI and SDK: an AgentPlugin whose hooks forward each run and tool call to `hook.mjs --host cline-sdk`
// and apply the answers (bridge/core.js). `lessloc init --cline` puts a file in Cline's plugin folder that loads this one.
// Cline's IDE extension loads no plugins; it runs lessloc's hook files instead (the `cline` row in lib/hosts.mjs).
import { call, joined } from '../bridge/core.js';
import { clineResult, clineTool } from '../lib/hosts.mjs';

const sid = snapshot => snapshot.conversationId ?? snapshot.runId ?? snapshot.agentId;
const text = content => (typeof content === 'string' ? content : (content || []).filter(p => p?.type === 'text').map(p => p.text).join(''));
// The prompt that started the run; the context blocks hooks add are user messages too, shown as system ones. The Cline CLI
// keeps what the user typed inside <user_input mode="act">.
const prompt = snapshot => text([...(snapshot.messages || [])].reverse().find(m => m?.role === 'user' && m.metadata?.displayRole !== 'system')?.content).replace(/^\s*<user_input\b[^>]*>([\s\S]*)<\/user_input>\s*$/, '$1');

// Cline gives each plugin hook 3 seconds and turns off a plugin whose hooks keep failing, so lessloc answers within `wait`
// milliseconds: past that it says nothing for that call, and the hook still finishes its work.
export function lessloc(wait = 2500) {
  let cwd = process.cwd();
  const started = new Map(), run = (input, opts) => call('cline-sdk', cwd, input, opts);
  const within = work => Promise.race([work(), new Promise(resolve => setTimeout(resolve, wait).unref?.())]);
  return {
    name: 'lessloc',
    manifest: { capabilities: ['hooks'] },
    setup(api, ctx) {
      if (ctx?.cwd) cwd = ctx.cwd;
    },
    hooks: {
      // The working standard and the hints reach the model with the run's first request.
      beforeRun: ({ snapshot }) => within(async () => {
        const id = sid(snapshot), first = !started.has(id);
        if (first) started.set(id, run({ hook_event_name: 'SessionStart', session_id: id, source: 'startup' }));
        const start = await started.get(id), hints = await run({ hook_event_name: 'UserPromptSubmit', session_id: id, prompt: prompt(snapshot) });
        const appendContext = joined(first && start.context, hints.context);
        return appendContext ? { appendContext } : undefined;
      }),
      // A refused call is skipped, and its reason goes back to the model as the call's error.
      beforeTool: ({ snapshot, toolCall, input }) => within(async () => {
        const [tool, args] = clineTool(toolCall.toolName, input) || [];
        if (!tool) return undefined;
        const out = await run({ hook_event_name: 'PreToolUse', session_id: sid(snapshot), tool_name: tool, tool_input: args, tool_use_id: toolCall.toolCallId });
        return out.deny ? { skip: true, reason: out.deny } : undefined;
      }),
      afterTool: ({ snapshot, toolCall, input, result }) => within(async () => {
        const [tool, args] = clineTool(toolCall.toolName, input) || [];
        if (!tool) return undefined;
        const failed = result?.isError === true, response = clineResult(result?.output);
        const out = await run({ hook_event_name: failed ? 'PostToolUseFailure' : 'PostToolUse', session_id: sid(snapshot), tool_name: tool, tool_input: args, tool_use_id: toolCall.toolCallId, tool_response: response, ...(failed && { error: response.output }) });
        return out.feedback ? { appendContext: out.feedback } : undefined;
      }),
      // A finished run cannot be held, and its review takes longer than a hook may: it runs on its own, for the handoff.
      async afterRun({ snapshot, result }) {
        await run({ hook_event_name: 'Stop', session_id: sid(snapshot), last_assistant_message: result?.outputText ?? '', status: result?.status }, { detach: true });
      },
    },
  };
}

export default lessloc();
