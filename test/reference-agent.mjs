// A minimal agent loop wired to lessloc through the generic hook protocol, the way an integrator writes it. The model is any
// function that returns the next tool call or a final reply; the loop does with each answer what the protocol asks.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ENTRY = new URL('../hook.mjs', import.meta.url).pathname;
// One event in, one answer out. No answer, bad JSON or a crash means nothing to do.
function lessloc(cwd, event, env) {
  const r = spawnSync('node', [ENTRY, '--host', 'generic'], { cwd, input: JSON.stringify({ cwd, ...event }), encoding: 'utf8', env });
  try { return JSON.parse(r.stdout || '{}'); } catch { return {}; }
}

export function session(cwd, sid, prompt, model, env) {
  const call = e => lessloc(cwd, { session_id: sid, ...e }, env);
  const system = call({ hook_event_name: 'SessionStart', source: 'startup' }).context || '';
  const hints = call({ hook_event_name: 'UserPromptSubmit', prompt }).context;
  const messages = [{ role: 'user', content: [prompt, hints].filter(Boolean).join('\n\n') }];
  let held = false;
  for (let i = 0; i < 50; i++) {
    const step = model(system, messages);
    if (step.reply) {
      const out = call({ hook_event_name: 'Stop', stop_hook_active: held, last_assistant_message: step.reply });
      if (!out.block || held) return { system, messages };
      held = true;
      messages.push({ role: 'user', content: out.block });
      continue;
    }
    const call_ = { tool_name: step.tool, tool_input: step.input, tool_use_id: `call_${i}` }, pre = call({ hook_event_name: 'PreToolUse', ...call_ });
    if (pre.deny) {
      messages.push({ role: 'tool', content: `Error: ${pre.deny}` });
      continue;
    }
    const result = step.result || run(cwd, step.tool, step.input), post = call({ hook_event_name: 'PostToolUse', ...call_, tool_response: result });
    messages.push({ role: 'tool', content: [result.output, post.feedback].filter(Boolean).join('\n\n') });
  }
  return { system, messages };
}
// The one tool this loop runs itself; a scripted step brings its own result for anything else.
function run(cwd, tool, input) {
  fs.mkdirSync(path.dirname(path.join(cwd, input.path)), { recursive: true });
  fs.writeFileSync(path.join(cwd, input.path), input.content);
  return { exit_code: 0, output: `Wrote ${input.path}` };
}
