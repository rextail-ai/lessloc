// Each agent tool's hook protocol, one row per tool: its event and tool names, what it cannot do, and how lessloc's answer
// is written back. The hook command names its host (`hook.mjs --host codex`); without the flag, the host is recognized from its
// environment and payload, and Claude Code is the default.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { exitCodeOf } from './evidence.mjs';
import { load, save, stateRoot } from './repo.mjs';

export const ENTRY = fileURLToPath(new URL('../hook.mjs', import.meta.url));
// OpenCode loads a configured plugin only from a folder; its entry is the folder's server.js.
export const BRIDGE = fileURLToPath(new URL('../opencode', import.meta.url));
const HOOK = (host, entry = ENTRY) => `node "${entry}" --host ${host}`;
// lessloc's entries in a hook file: `hook.mjs --host <one of its hosts>`, or `<host>/hook.sh` for a tool that runs only
// scripts, on any platform and even after the checkout moved.
export const OURS = entry => new RegExp(`hook\\.mjs\\\\*"?\\s+--host\\s+(?:${Object.keys(HOSTS).join('|')})\\b|[\\\\/](?:${Object.keys(HOSTS).join('|')})[\\\\/]+hook\\.sh\\b`).test(JSON.stringify(entry));
// The block a user-level rules file holds for a tool whose session start cannot reach its model. Its markers name nothing.
export const RULES_MARK = /<!-- working-standard -->\n([\s\S]*?)\n<!-- \/working-standard -->\n?/;

const EVENTS = { sessionStart: 'SessionStart', beforeSubmitPrompt: 'UserPromptSubmit', beforeShellExecution: 'PreToolUse', preToolUse: 'PreToolUse', postToolUse: 'PostToolUse', postToolUseFailure: 'PostToolUseFailure', stop: 'Stop' };
// Tool names in Claude Code's vocabulary whatever the host, since Cursor also runs Claude Code's hook files with its own names.
const TOOL_NAMES = { Shell: 'Bash', shell: 'Bash', write: 'Write', edit: 'Edit', patch: 'apply_patch', Delete: 'Delete', delete: 'Delete' };

// Whether a finished command reported exit code 0. No exit code found means no success.
const exitZero = r => exitCodeOf(r) === 0;

const json = o => (Object.keys(o).length ? JSON.stringify(o) : '');
const joined = (...parts) => parts.filter(Boolean).join('\n\n');
function claudeJson(out, event) {
  const o = {};
  if (out.deny || out.ask) o.hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: out.deny ? 'deny' : 'ask', permissionDecisionReason: out.deny || out.ask };
  else if (out.input) o.hookSpecificOutput = { hookEventName: 'PreToolUse', updatedInput: out.input };
  else if (out.context || out.feedback) o.hookSpecificOutput = { hookEventName: event, additionalContext: joined(out.context, out.feedback) };
  if (out.block) Object.assign(o, { decision: 'block', reason: out.block });
  return json(o);
}

// The generic protocol, version 1. `agent` is a subagent; its other tool names are in TOOL_NAMES.
const GENERIC = {
  ask: false, prompt: true, ok: input => exitZero(input.tool_response), reply: out => ({ stdout: json(out) }),
  tools: { agent: 'Task' }, caps: raw => (typeof raw.caps?.ask === 'boolean' ? { ask: raw.caps.ask } : {}),
};

// GitHub Copilot's payloads do not name their event, so each hook command names it (`--host copilot preToolUse`). Tool
// arguments may arrive as a JSON string, and the file tools are taken to name them as Anthropic's editor tool does: Copilot's
// docs do not show them (test/fixtures/hosts/copilot.json lists this under _verify).
const COPILOT = { sessionStart: 'SessionStart', userPromptSubmitted: 'UserPromptSubmit', preToolUse: 'PreToolUse', postToolUse: 'PostToolUse', postToolUseFailure: 'PostToolUseFailure', agentStop: 'Stop', subagentStart: 'SubagentStart' };
const COPILOT_TOOLS = 'bash|powershell|create|edit|apply_patch';
// File tool arguments under the other names agent tools give them: Anthropic's editor tool's (file_text, old_str, new_str), a
// patch as the whole argument or as `input`. Copilot's arguments, and those of tools whose documentation does not show them.
function editorArgs(a) {
  if (typeof a === 'string') {
    try { a = JSON.parse(a); } catch { return { patch: a }; }
  }
  return a && typeof a === 'object' ? { ...a, ...(a.file_text != null && { content: a.file_text }), ...(a.old_str != null && { old_string: a.old_str, new_string: a.new_str ?? '' }), ...(typeof a.input === 'string' && a.patch == null && { patch: a.input }) } : a;
}
// A Copilot hook entry that runs `entry`: a path on this machine, the plugin's folder (a variable bash and PowerShell spell
// differently), or a repository's clone for the cloud agent, in a folder whose name says nothing. Copilot refuses every tool
// call when a pre-tool hook fails for any reason but a timeout, so each command does nothing where node or that hook.mjs is
// missing: a moved checkout, a cleaned npx cache, a teammate without lessloc. PowerShell passes on exit code 2, which VS Code
// reads as a refusal.
export const CLOUD_ENTRY = '$HOME/.agent-standard/hook.mjs';
function copilotRun(entry, event) {
  const ps = entry.replace('$PLUGIN_ROOT', '$env:PLUGIN_ROOT'), run = e => `node "${e}" --host copilot ${event}`;
  return {
    bash: `if command -v node >/dev/null 2>&1 && [ -f "${entry}" ]; then ${run(entry)}; fi`,
    powershell: `if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path "${ps}")) { ${run(ps)}; exit $LASTEXITCODE }`,
  };
}
// VS Code's agent tools name their file path argument filePath, and its patch tool its patch input.
const vscodeArgs = a => (a && typeof a === 'object' ? { ...a, ...(a.filePath != null && { file_path: a.filePath }), ...(typeof a.input === 'string' && { patch: a.input }), ...(a.isBackground != null && { run_in_background: a.isBackground }) } : a);

// Gemini CLI's events in Claude Code's vocabulary, and back.
const GEMINI = { BeforeAgent: 'UserPromptSubmit', BeforeTool: 'PreToolUse', AfterTool: 'PostToolUse', AfterAgent: 'Stop' };
const GEMINI_EVENT = { SessionStart: 'SessionStart', UserPromptSubmit: 'BeforeAgent', PostToolUse: 'AfterTool', PostToolUseFailure: 'AfterTool' };
const GEMINI_TOOLS = '^(write_file|replace|run_shell_command)$';
const partsText = c => (typeof c === 'string' ? c : [].concat(c ?? []).map(p => (typeof p === 'string' ? p : p?.text ?? '')).join(''));
// A tool result as Gemini CLI and Qwen Code give it ({llmContent, returnDisplay, error}). Gemini's shell result starts with
// "Output:" and has an "Exit Code:" line only when the code is not 0; Qwen's always has one.
function llmResult(r) {
  const output = partsText(r.llmContent), code = /^Exit Code: (\d+)$/m.exec(output)?.[1];
  return { output, exit_code: code ? Number(code) : !r.error && /^(?:<untrusted_context>\n)?Output: /.test(output) ? 0 : undefined };
}
// A shell tool's folder and background flag under the names lessloc reads.
const shellArgs = (ti, dir) => (ti && typeof ti === 'object' ? { ...ti, workdir: ti[dir], run_in_background: ti.is_background } : ti);
function geminiFields(raw) {
  const r = raw.tool_response, o = { ...raw, hook_event_name: GEMINI[raw.hook_event_name] || raw.hook_event_name, last_assistant_message: raw.prompt_response };
  if (raw.tool_name === 'run_shell_command') o.tool_input = shellArgs(raw.tool_input, 'dir_path');
  if (r && typeof r === 'object') {
    o.tool_response = llmResult(r);
    if (r.error) Object.assign(o, { hook_event_name: 'PostToolUseFailure', error: String(r.error.message ?? r.error) });
  }
  return o;
}
// Qwen Code: Claude Code's events and answers, with Gemini CLI's tool names and results.
const QWEN_TOOLS = '^(write_file|edit|run_shell_command)$';
const qwenFields = raw => ({ ...raw, ...(raw.tool_name === 'run_shell_command' && { tool_input: shellArgs(raw.tool_input, 'directory') }), ...(raw.tool_response && typeof raw.tool_response === 'object' && { tool_response: llmResult(raw.tool_response) }) });

// Cline's file and shell tools in the generic protocol's names: its SDK's (editor, apply_patch, run_commands) and the older
// ones of its IDE extension. Hook files get every argument as a string, a list as JSON and a missing value as "null".
const given = v => v != null && v !== 'null';
const listOf = v => {
  if (typeof v === 'string' && v.startsWith('[')) {
    try { return JSON.parse(v); } catch { /* one command */ }
  }
  return [].concat(v ?? []);
};
// replace_in_file's diff: blocks of `------- SEARCH`, the old lines, `=======`, the new lines, `+++++++ REPLACE`. Read line by
// line, so a long diff without its closing markers takes no longer than its length.
function searchReplace(diff) {
  const blocks = [];
  let part = 0, old = [], next = [];
  for (const l of String(diff ?? '').split('\n')) {
    if (!part) { if (/^[-<]{3,} ?SEARCH[ \t]*$/.test(l)) [part, old, next] = [1, [], []]; }
    else if (part === 1 && /^={3,}[ \t]*$/.test(l)) part = 2;
    else if (part === 2 && /^[+>]{3,} ?REPLACE[ \t]*$/.test(l)) { blocks.push({ old_string: old.join('\n'), new_string: next.join('\n') }); part = 0; }
    else (part === 1 ? old : next).push(l);
  }
  return blocks;
}
export function clineTool(name, a) {
  const i = a && typeof a === 'object' ? a : {}, path = i.path;
  if (name === 'editor') return given(i.old_text) ? ['edit', { path, old_string: i.old_text, new_string: i.new_text ?? '' }] : given(i.insert_line) ? ['edit', { path, old_string: '', new_string: i.new_text ?? '' }] : ['write', { path, content: i.new_text ?? '' }];
  if (name === 'write_to_file') return ['write', { path, content: i.content ?? '' }];
  if (name === 'replace_in_file') return ['edit', { path, edits: searchReplace(i.diff) }];
  if (name === 'apply_patch') return ['patch', { patch: typeof a === 'string' ? a : String(i.input ?? '') }];
  if (name === 'run_commands') return ['shell', { command: listOf(i.commands ?? i.command ?? i.cmd ?? a).map(c => (typeof c === 'string' ? c : [c.command, ...(c.args || [])].join(' '))).join('\n') }];
  if (name === 'execute_command') return ['shell', { command: i.command }];
  if (name === 'delete_file') return ['delete', { path }];
  return undefined;
}
// A run_commands result is one entry per command, with whether it succeeded; a single command's success is its exit code.
export function clineResult(r) {
  let v = r;
  if (typeof r === 'string') {
    try { v = JSON.parse(r); } catch { return { output: r }; }
  }
  if (!Array.isArray(v)) return { output: typeof v === 'string' ? v : JSON.stringify(v ?? '') };
  const output = v.map(x => [x?.result, x?.error].filter(Boolean).join('\n')).join('\n'), one = v.length === 1 && v[0];
  return { output, ...(typeof one?.success === 'boolean' && !/timed out/i.test(one.error || '') && { exit_code: one.success ? 0 : 1 }) };
}
// Cline's hook files (its IDE extension): each is named after its event, and the payload names it too. Payloads of the Cline
// CLI's hook layer (snake_case events) are left to lessloc's Cline plugin, which the CLI also loads.
const CLINE = { TaskStart: 'SessionStart', UserPromptSubmit: 'UserPromptSubmit', PreToolUse: 'PreToolUse', PostToolUse: 'PostToolUse', TaskComplete: 'Stop' };
export const CLINE_HOOKS = Object.keys(CLINE);
function clineFields(raw) {
  const call = raw.preToolUse || raw.postToolUse, post = raw.postToolUse, [name, input] = (call && clineTool(call.toolName, call.parameters)) || [call?.toolName, call?.parameters];
  return { ...raw, hook_event_name: post?.success === false ? 'PostToolUseFailure' : CLINE[raw.hookName], session_id: raw.taskId, cwd: raw.cwd ?? raw.workspaceRoots?.[0], prompt: raw.userPromptSubmit?.prompt, last_assistant_message: raw.taskComplete?.taskMetadata?.result, ...(call && { tool_name: name, tool_input: input }), ...(post && { tool_response: clineResult(post.result) }) };
}

// The hook file entry most tools take ({matcher, hooks: [{type, command, timeout}]}, timeout in seconds), and the writer for a
// settings file the user shares with the tool: only its `hooks` key is lessloc's to change, and it goes when left empty.
const nested = ({ timeout = 30, matcher }, command) => ({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout }] });
const shared = (cur, hooks) => (Object.keys(hooks).length ? { ...cur, hooks } : Object.fromEntries(Object.entries(cur).filter(([k]) => k !== 'hooks')));
const obj = v => (v && typeof v === 'object' ? v : {});
// The entries of a tool's JSONL transcript, or none when it cannot be read.
function entries(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } }); } catch { return []; }
}

// Factory Droid: Claude Code's payloads and answers, with its own tool names. Its documentation shows only Create's
// arguments. Its user hook file holds the events at the top; without that file, it reads the `hooks` key of its settings. An
// Execute result ends with its exit code: "[Process exited with code N]".
const DROID_TOOLS = '^(Create|Edit|ApplyPatch|Execute)$';
const droidSettings = f => path.basename(f) === 'settings.json';
function droidFields(raw) {
  const r = raw.tool_response, code = typeof r === 'string' && /\n\[Process exited with code (\d+)\]\s*$/.exec(r)?.[1];
  return { ...raw, tool_input: editorArgs(raw.tool_input), ...(code && { tool_response: { output: r, exit_code: Number(code) } }) };
}
// What `droid exec` never gives its hooks, from the transcript each payload names: the request (it fires no UserPromptSubmit)
// and each Execute that ran and failed (it fires PostToolUse only after a tool succeeded). A call that was refused, cancelled or
// timed out names no exit code, and ran no test.
function droidTranscript(raw) {
  const calls = new Map(), runs = [];
  let prompt;
  for (const e of entries(raw.transcript_path)) for (const part of e.message?.content || []) {
    const text = typeof part.content === 'string' ? part.content : JSON.stringify(part.content ?? ''), code = /^Error: Command failed \(exit code: (\d+)\)/.exec(text)?.[1];
    if (part.type === 'tool_use') calls.set(part.id, part);
    else if (part.type === 'tool_result' && part.is_error && code && calls.get(part.tool_use_id)?.name === 'Execute') runs.push({ command: calls.get(part.tool_use_id).input?.command, exit: Number(code), output: text });
    else if (part.type === 'text' && e.message.role === 'user' && !e.message.visibility && !part.text.startsWith('<system-reminder>')) prompt = { text: part.text, id: e.id };
  }
  return { prompt, runs };
}

// Augment's CLI and its VS Code and IntelliJ extensions. Its editor numbers each replacement (old_str_1, new_str_1, ...), and
// an after-tool hook gets the files the call changed. It has no prompt event: the Stop hook asks for the conversation, which
// carries the turn's request and the agent's reply. It runs only script files as hook commands: augment/hook.sh.
const AUGMENT_TOOLS = '^(save-file|str-replace-editor|remove-files|launch-process)$';
function augmentArgs(name, a) {
  const i = obj(a);
  if (name === 'save-file') return { ...i, content: i.file_content ?? i.content };
  if (name === 'remove-files') return { ...i, path: [].concat(i.file_paths ?? [])[0] };
  if (name === 'launch-process') return { ...i, workdir: i.cwd };
  if (name !== 'str-replace-editor') return i;
  const n = [...new Set(Object.keys(i).map(k => /^(?:old|new)_str_(\d+)$/.exec(k)?.[1]).filter(Boolean))].sort((x, y) => x - y);
  return { ...i, edits: n.map(k => ({ old_string: i.command === 'insert' ? '' : String(i[`old_str_${k}`] ?? ''), new_string: String(i[`new_str_${k}`] ?? '') })) };
}
function augmentFields(raw) {
  const conv = obj(raw.conversation), changed = raw.file_changes?.[0]?.path, out = raw.tool_output, code = /<return-code>\s*(-?\d+)\s*<\/return-code>/.exec(String(out ?? ''))?.[1];
  return {
    ...raw, prompt: conv.userPrompt, last_assistant_message: conv.agentTextResponse,
    ...(raw.tool_name && { tool_input: { ...(changed != null && { path: changed }), ...augmentArgs(raw.tool_name, raw.tool_input) } }),
    ...(out != null && { tool_response: { output: String(out), ...(code != null && { exit_code: Number(code) }) } }),
    ...(raw.tool_error && { hook_event_name: 'PostToolUseFailure', error: String(raw.tool_error) }),
    ...(raw.agent_stop_cause && { status: raw.agent_stop_cause === 'end_turn' ? 'completed' : raw.agent_stop_cause }),
  };
}

// Kiro's IDE and CLI V3. Its hook file is a list of hooks, each naming its trigger; a write and a shell tool are matched by
// their category. Its documentation names the tools but not their arguments, and a result is {success, result}.
function kiroHooks(cur) {
  if (!Array.isArray(cur.hooks ?? [])) throw new Error('its "hooks" is not a list, so lessloc left it alone');
  const by = {};
  for (const x of cur.hooks ?? []) (by[x?.trigger] ??= []).push(x);
  return by;
}
function kiroFields(raw) {
  const r = raw.tool_response, items = [].concat(obj(r).result ?? []), status = items.find(x => x?.exit_status != null)?.exit_status;
  return {
    ...raw, hook_event_name: /^agentspawn$/i.test(raw.hook_event_name || '') ? 'SessionStart' : raw.hook_event_name, tool_input: editorArgs(raw.tool_input),
    ...(r && typeof r === 'object' && { tool_response: { output: items.map(x => (typeof x === 'string' ? x : [x?.stdout, x?.stderr].filter(Boolean).join('\n'))).join('\n'), ...(status != null && { exit_code: Number(status) }) } }),
    ...(r?.success === false && { hook_event_name: 'PostToolUseFailure' }),
  };
}

// OpenHands: snake_case hook keys, payload names of its own, and an editor tool whose `command` says what it does.
const OH_EVENTS = { session_start: 'SessionStart', user_prompt_submit: 'UserPromptSubmit', pre_tool_use: 'PreToolUse', post_tool_use: 'PostToolUse', stop: 'Stop' };
const OH_TOOLS = '/^(terminal|execute_bash|file_editor|str_replace_editor)$/';
const snake = k => k.replace(/(?<!^)(?=[A-Z])/g, '_').toLowerCase();
function openhandsTool(name, a) {
  const i = obj(a);
  if (!/^(file_editor|str_replace_editor)$/.test(name || '')) return [name, i];
  if (i.command === 'create') return ['write', { path: i.path, content: i.file_text ?? '' }];
  if (i.command === 'str_replace' || i.command === 'insert') return ['edit', { path: i.path, old_string: i.command === 'insert' ? '' : i.old_str ?? '', new_string: i.new_str ?? '' }];
  return [name, i];
}
function openhandsFields(raw) {
  const [tool_name, tool_input] = openhandsTool(raw.tool_name, raw.tool_input);
  return { ...raw, hook_event_name: OH_EVENTS[raw.event_type] || raw.event_type || raw.hook_event_name, cwd: raw.working_dir ?? raw.cwd, prompt: raw.message, ...(raw.tool_name && { tool_name, tool_input }) };
}

// goose: hooks from a plugin folder in the Open Plugins format. Only its tool and stop hooks can act, and it shows the model
// the plugin's name with a refusal or a held turn, so the plugin lessloc writes has a neutral name, as Kiro's hooks do.
export const NEUTRAL = 'review';
const GOOSE_TOOLS = '^(shell|write|edit)$';
function gooseFields(raw) {
  const ti = raw.tool_input;
  return { ...raw, hook_event_name: raw.event ?? raw.hook_event_name, cwd: raw.working_dir ?? raw.cwd, tool_use_id: raw.tool_call_id, prompt: raw.message, ...(raw.tool_name === 'edit' && ti && typeof ti === 'object' && { tool_input: { ...ti, old_string: ti.before ?? '', new_string: ti.after ?? '' } }) };
}

// Devin CLI: Claude Code's answers, with tool names of its own. A hook gets the project folder in DEVIN_PROJECT_DIR, and a
// tool's result as {success, output, error}, without an exit code.
const DEVIN_TOOLS = '^(write|edit|apply_patch|exec)$';
function devinFields(raw) {
  const r = raw.tool_response;
  return {
    ...raw, cwd: raw.cwd ?? process.env.DEVIN_PROJECT_DIR, tool_input: editorArgs(raw.tool_input),
    ...(r && typeof r === 'object' && { tool_response: { output: [r.output, r.error].filter(x => typeof x === 'string' && x).join('\n') } }),
    ...(r?.success === false && { hook_event_name: 'PostToolUseFailure', error: String(r.error ?? '') }),
  };
}
// A refusal or a held turn as `{decision: "block", reason}`, the answer Junie, goose and Devin CLI share.
const blocked = reason => json({ decision: 'block', reason });

// Crush: one hook event, before each tool call, whose answer can refuse the call or add text the model reads. Its documented
// payload shows only bash's arguments; its file tools take Claude Code's (from its source).
const CRUSH_TOOLS = '^(bash|edit|multiedit|write)$';
const xdg = (...p) => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), ...p);
// goose keeps its config folder, and the plugins it loads, under GOOSE_PATH_ROOT when that is an absolute path.
const gooseRoot = () => (path.isAbsolute(process.env.GOOSE_PATH_ROOT || '') ? process.env.GOOSE_PATH_ROOT : null);

// Google Antigravity's app, CLI and IDE share one hook file of named hooks. Its payloads are camelCase and do not name their
// event, so each command names it. After a tool it gives no output, only the error of a call that failed: "exit status N" for
// a command. A command still running in the background has no error either, so a call without one proves no exit code. The
// CLI's file tools are write_file and edit_file, and its turn ends normally with "NO_TOOL_CALL".
const AGY_TOOLS = '^(write_to_file|replace_file_content|multi_replace_file_content|write_file|edit_file|run_command)$';
function antigravityTool(name, a) {
  const i = obj(a);
  if (name === 'write_file') return ['write', { path: i.Path, content: i.Content ?? '' }];
  if (name === 'edit_file') return ['edit', { path: i.Path, old_string: i.Target ?? '', new_string: i.Replacement ?? '' }];
  if (name === 'write_to_file') return ['write', { path: i.TargetFile, content: i.CodeContent ?? '' }];
  if (name === 'replace_file_content') return ['edit', { path: i.TargetFile, old_string: i.TargetContent ?? '', new_string: i.ReplacementContent ?? '' }];
  if (name === 'multi_replace_file_content') return ['edit', { path: i.TargetFile, edits: [].concat(i.ReplacementChunks ?? []).map(c => ({ old_string: c?.TargetContent ?? '', new_string: c?.ReplacementContent ?? '' })) }];
  if (name === 'run_command') return ['shell', { command: i.CommandLine ?? '', workdir: i.Cwd }];
  return [name, i];
}
// What Antigravity CLI never gives its hooks, from the transcript each payload names: the request, and each command's exit code
// (its PostToolUse has an empty error whatever the command did, and the command's step is written after the hook returns).
function antigravityTranscript(raw) {
  const runs = [];
  let prompt, call;
  for (const e of entries(raw.transcriptPath)) {
    const asked = e.type === 'USER_INPUT' && /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/.exec(e.content)?.[1];
    if (asked) prompt = { text: asked, id: e.step_index };
    const done = call && /^Command exited with code (\d+)\.\n\nCommand output:\n([\s\S]*)/m.exec(e.content || '');
    if (done) runs.push({ command: call.CommandLine, cwd: call.Cwd, exit: Number(done[1]), output: done[2] });
    call = e.tool_calls?.find(t => t.name === 'run_command')?.args;
  }
  return { prompt, runs };
}
function antigravityFields(raw, named) {
  const error = String(raw.error ?? ''), code = /\bexit status (\d+)/.exec(error)?.[1], [tool_name, tool_input] = antigravityTool(raw.toolCall?.name, raw.toolCall?.args);
  return {
    ...raw, hook_event_name: named === 'PostToolUse' && error ? 'PostToolUseFailure' : named || raw.hook_event_name, session_id: raw.conversationId ?? raw.session_id, cwd: raw.workspacePaths?.[0] ?? raw.cwd,
    ...(raw.toolCall && { tool_name, tool_input }),
    ...(named === 'PostToolUse' && { tool_response: { output: error, ...(code != null && { exit_code: Number(code) }) } }),
    // A failure without an exit status (a timeout, a cancel) says nothing about the tests.
    ...(error && { error, is_interrupt: code == null }),
    ...(raw.terminationReason && { status: /^(model_stop|NO_TOOL_CALL)$/.test(raw.terminationReason) ? 'completed' : raw.terminationReason }),
  };
}

// ask: the host can put a decision to the user. prompt: it takes context with each prompt. ok: whether a finished tool call
// succeeded, for hosts that call PostToolUse after failed commands too. reply: lessloc's answer in the host's words. hooks:
// the user-level hook file `init --<host>` writes, lessloc's entries in it, and the file's format; `own`: the file goes when
// nothing but lessloc's entries was in it. Optional: tools, the host's own tool names, looked up before TOOL_NAMES; caps(raw),
// what one call's payload says its host can do; twice, the host may run lessloc's hooks twice for one event (a plugin's and
// a hook file's), so a repeated payload is answered once; fields(raw, event), the payload in the field names and shapes
// Claude Code uses, given the event the hook command names; variant(raw), another row for a payload of another runtime
// that reads the same hook file; gate: false, the host cannot refuse one tool call (it can only end the agent's run), so
// lessloc tracks writes there without judging them first.
// Channels a host lacks: start: false, its session start reaches no model, so the session start text waits for the first
// prompt (prompt) or tool call (preContext: a pre-tool hook can add context), and the standard comes from `rules()`, a
// user-level rules file `init` writes; feedback: false, nothing an after-tool hook says reaches the model, so lessloc only
// tracks there; track: 'turn', no after-tool event, so the end of a turn reviews every file changed since its start;
// turnStart: 'stop', no prompt event, so a turn starts where the last one ended; sessionStart: 'tool', no session start event,
// so a session starts with the first event lessloc hears of it; sessionless: its tool and stop hooks name no
// session, so they belong to the session that started last in the checkout. hooks.read(file, f) and hooks.command(entry):
// where a hook file keeps its lists of entries, and the command, when it is not `node hook.mjs --host <row>`.
export const HOSTS = {
  claude: {
    ask: true, prompt: true, ok: () => true,
    // Context, not exit code 2: Claude Code shows the model exit-2 feedback as a "blocking error" with the hook's command and
    // plugin name, and context as plain "<event> hook additional context".
    reply: (out, event) => ({ stdout: claudeJson(out, event) }),
  },
  codex: {
    ask: false, prompt: true, twice: true, ok: input => exitZero(input.tool_response),
    // Codex replaces a tool's output with exit-2 feedback, so feedback goes in as context.
    reply: (out, event) => ({ stdout: claudeJson(out, event) }),
    hooks: {
      file: () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'hooks.json'),
      events: { SessionStart: {}, UserPromptSubmit: {}, PreToolUse: { matcher: 'Bash|apply_patch' }, PostToolUse: { matcher: 'Bash|apply_patch' }, Stop: { timeout: 600 } },
      entry: nested,
      wrap: (cur, hooks) => ({ ...cur, hooks }),
    },
  },
  cursor: {
    ask: false, prompt: false, twice: true, ok: input => exitZero(input.tool_output),
    reply(out) {
      if (out.deny || out.ask) return { stdout: json({ permission: out.deny ? 'deny' : 'ask', user_message: out.deny || out.ask, agent_message: out.deny || out.ask }) };
      if (out.block) return { stdout: json({ followup_message: out.block }) };
      const context = joined(out.context, out.feedback);
      return { stdout: context ? json({ additional_context: context }) : '' };
    },
    hooks: {
      file: () => path.join(os.homedir(), '.cursor', 'hooks.json'),
      events: { sessionStart: {}, beforeSubmitPrompt: {}, preToolUse: { matcher: 'Shell|Write|Delete' }, postToolUse: { matcher: 'Shell|Write|Delete' }, postToolUseFailure: { matcher: 'Shell' }, stop: { timeout: 600 } },
      entry: ({ timeout = 30, ...o }, command) => ({ command, timeout, ...o }),
      wrap: (cur, hooks) => ({ ...cur, version: cur.version ?? 1, hooks }),
    },
  },
  // GitHub Copilot CLI and cloud agent, and VS Code's Copilot harness. Its prompt hook's answer is dropped, so the hints come
  // with the first tool result; it cannot always ask the user (the cloud agent and autopilot treat a question as a refusal).
  copilot: {
    ask: false, prompt: false, twice: true, ok: input => exitZero(input.tool_response),
    tools: { bash: 'Bash', powershell: 'Bash', create: 'Write', edit: 'Edit', task: 'Task' },
    fields(raw, named) {
      const r = raw.toolResult, output = String(r?.textResultForLlm ?? ''), code = /<shellId: \S+ completed with exit code (\d+)>\s*$/.exec(output)?.[1];
      return { ...raw, hook_event_name: COPILOT[named || raw.hook_event_name], session_id: raw.sessionId ?? raw.session_id, agent_id: raw.agentId, tool_name: raw.toolName, tool_input: editorArgs(raw.toolArgs), ...(r && { tool_response: { output, ...(code && { exit_code: Number(code) }) } }) };
    },
    // VS Code's Local harness reads the same hook file and names the event in its payload, the way Claude Code does.
    variant: raw => (/^[A-Z]/.test(raw.hook_event_name || '') ? 'vscode' : undefined),
    reply(out) {
      if (out.deny || out.ask) return { stdout: json({ permissionDecision: 'deny', permissionDecisionReason: out.deny || out.ask }) };
      if (out.input) return { stdout: json({ modifiedArgs: out.input }) };
      if (out.block) return { stdout: json({ decision: 'block', reason: out.block }) };
      const context = joined(out.context, out.feedback);
      return { stdout: context ? json({ additionalContext: context }) : '' };
    },
    hooks: {
      file: () => path.join(process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'), 'hooks', 'lessloc.json'),
      own: true,
      command: entry => entry,
      events: { sessionStart: {}, userPromptSubmitted: {}, preToolUse: { matcher: `${COPILOT_TOOLS}|task` }, postToolUse: { matcher: COPILOT_TOOLS, timeout: 60 }, postToolUseFailure: { timeout: 60 }, agentStop: { timeout: 600 }, subagentStart: {} },
      entry: ({ timeout = 30, matcher }, entry, event) => ({ type: 'command', ...copilotRun(entry, event), ...(matcher ? { matcher } : {}), timeoutSec: timeout }),
      wrap: (cur, hooks) => ({ ...cur, version: cur.version ?? 1, hooks }),
    },
  },
  // VS Code's Local harness, through Copilot's hook file: Claude Code's payload shape with VS Code's own tool names, which its
  // documentation leaves to the agent's debug log. It shows a refusal's reason only to the user, but gives the model what a
  // hook writes to stderr with exit code 2. Its prompt hook takes no context.
  vscode: {
    ask: true, prompt: false, twice: true, ok: input => exitZero(input.tool_response),
    tools: { run_in_terminal: 'Bash', create_file: 'Write', replace_string_in_file: 'Edit', insert_edit_into_file: 'Edit', multi_replace_string_in_file: 'MultiEdit' },
    fields: raw => ({ ...raw, tool_input: vscodeArgs(raw.tool_input) }),
    reply(out, event) {
      if (out.deny) return { stderr: out.deny, code: 2 };
      if (out.block) return { stdout: json({ decision: 'block', reason: out.block, hookSpecificOutput: { hookEventName: event, decision: 'block', reason: out.block } }) };
      return { stdout: claudeJson(out, event) };
    },
  },
  // Gemini CLI. Its stdout must be one JSON object and nothing else. A held turn goes back to the agent as a new prompt.
  gemini: {
    ask: false, prompt: true, twice: true, ok: input => exitZero(input.tool_response),
    tools: { write_file: 'Write', replace: 'Edit', run_shell_command: 'Bash' },
    fields: geminiFields,
    reply(out, event) {
      if (out.deny || out.ask || out.block) return { stdout: json({ decision: 'deny', reason: out.deny || out.ask || out.block }) };
      const context = joined(out.context, out.feedback);
      return { stdout: context ? json({ hookSpecificOutput: { hookEventName: GEMINI_EVENT[event], additionalContext: context } }) : '' };
    },
    hooks: {
      file: () => path.join(os.homedir(), '.gemini', 'settings.json'),
      own: true,
      events: { SessionStart: {}, BeforeAgent: {}, BeforeTool: { matcher: GEMINI_TOOLS }, AfterTool: { matcher: GEMINI_TOOLS, timeout: 60 }, AfterAgent: { timeout: 600 } },
      // Gemini counts a hook's timeout in milliseconds.
      entry: ({ timeout = 30, matcher }, command) => ({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout: timeout * 1000 }] }),
      wrap: shared,
    },
  },
  // Cline's IDE extension, through its hook files. A hook that cancels a tool call ends the agent's whole run, so lessloc
  // refuses nothing there; context goes to the model with its next request. The end of a run cannot be held.
  cline: {
    ask: false, prompt: true, gate: false, ok: input => exitZero(input.tool_response), fields: clineFields,
    reply(out) {
      const context = joined(out.context, out.feedback);
      return { stdout: context ? json({ cancel: false, contextModification: context }) : '' };
    },
  },
  // Qwen Code. Its extension (qwen-extension.json) and a settings hook file may both run lessloc.
  qwen: {
    ask: false, prompt: true, twice: true, ok: input => exitZero(input.tool_response),
    tools: { write_file: 'Write', edit: 'Edit', run_shell_command: 'Bash' },
    fields: qwenFields,
    reply: (out, event) => ({ stdout: claudeJson(out, event) }),
    hooks: {
      file: () => path.join(os.homedir(), '.qwen', 'settings.json'),
      own: true,
      events: { SessionStart: {}, UserPromptSubmit: {}, PreToolUse: { matcher: QWEN_TOOLS }, PostToolUse: { matcher: QWEN_TOOLS, timeout: 60 }, PostToolUseFailure: { matcher: '^run_shell_command$', timeout: 60 }, SubagentStart: {}, SubagentStop: { timeout: 600 }, Stop: { timeout: 600 } },
      entry: nested,
      wrap: shared,
    },
  },
  droid: {
    ask: true, prompt: true, ok: input => exitZero(input.tool_response),
    tools: { Create: 'Write', Edit: 'Edit', Execute: 'Bash', ApplyPatch: 'apply_patch', Task: 'Task' },
    fields: droidFields,
    transcript: droidTranscript,
    reply: (out, event) => ({ stdout: claudeJson(out, event) }),
    hooks: {
      file() {
        const dir = path.join(os.homedir(), '.factory'), own = path.join(dir, 'hooks.json'), settings = path.join(dir, 'settings.json');
        return !fs.existsSync(own) && load(settings).hooks ? settings : own;
      },
      own: true,
      events: { SessionStart: {}, UserPromptSubmit: {}, PreToolUse: { matcher: '^(Create|Edit|ApplyPatch|Execute|Task)$' }, PostToolUse: { matcher: DROID_TOOLS, timeout: 60 }, Stop: { timeout: 600 } },
      entry: nested,
      read: (cur, f) => (droidSettings(f) ? cur.hooks || {} : cur),
      wrap: (cur, hooks, f) => (droidSettings(f) ? shared(cur, hooks) : hooks),
    },
  },
  // Its session start hook runs, and its answer is dropped (0.36.0), so the standard comes from its user rules folder, which it
  // always applies.
  augment: {
    ask: false, prompt: false, start: false, turnStart: 'stop', ok: input => exitZero(input.tool_response),
    rules: () => path.join(os.homedir(), '.augment', 'rules', 'working-standard.md'),
    tools: { 'save-file': 'Write', 'str-replace-editor': 'Edit', 'remove-files': 'Delete', 'launch-process': 'Bash' },
    fields: augmentFields,
    reply(out, event) {
      if (out.block) return { stdout: json({ decision: 'block', reason: out.block, hookSpecificOutput: { hookEventName: event, decision: 'block', reason: out.block } }) };
      return { stdout: claudeJson(out, event) };
    },
    hooks: {
      file: () => path.join(os.homedir(), '.augment', 'settings.json'),
      own: true,
      command: entry => (p => (/\s/.test(p) ? JSON.stringify(p) : p))(path.join(path.dirname(entry), 'augment', 'hook.sh')),
      events: { SessionStart: {}, PreToolUse: { matcher: AUGMENT_TOOLS }, PostToolUse: { matcher: AUGMENT_TOOLS, timeout: 60 }, Stop: { timeout: 600, metadata: { includeConversationData: true } } },
      // Augment counts a hook's timeout in milliseconds.
      entry: ({ timeout = 30, matcher, metadata }, command) => ({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout: timeout * 1000 }], ...(metadata ? { metadata } : {}) }),
      wrap: shared,
    },
  },
  kiro: {
    ask: false, prompt: true, feedback: false, ok: input => exitZero(input.tool_response),
    tools: { fs_write: 'Write', fs_append: 'Write', str_replace: 'Edit', delete_file: 'Delete', execute_bash: 'Bash', execute_pwsh: 'Bash' },
    fields: kiroFields,
    reply(out) {
      if (out.deny || out.ask) return { stderr: out.deny || out.ask, code: 2 };
      if (out.block) return { stdout: blocked(out.block) };
      return { stdout: out.context || '' };
    },
    hooks: {
      file: () => path.join(os.homedir(), '.kiro', 'hooks', 'lessloc.json'),
      own: true,
      events: { SessionStart: {}, UserPromptSubmit: {}, PreToolUse: [{ matcher: 'write' }, { matcher: 'shell' }], PostToolUse: [{ matcher: 'write', timeout: 60 }, { matcher: 'shell', timeout: 60 }], Stop: { timeout: 600 } },
      entry: ({ timeout = 30, matcher }, command, event) => ({ name: [NEUTRAL, event, matcher].filter(Boolean).join(' '), trigger: event, ...(matcher ? { matcher } : {}), action: { type: 'command', command }, timeout }),
      read: kiroHooks,
      wrap: (cur, hooks) => ({ ...cur, version: cur.version ?? 'v1', hooks: Object.values(hooks).flat() }),
    },
  },
  // JetBrains Junie CLI: its session start runs in the background, unheard, and it has no after-tool event.
  junie: {
    ask: false, prompt: true, start: false, preContext: true, track: 'turn', sessionless: true, ok: () => false,
    rules: () => path.join(os.homedir(), '.junie', 'AGENTS.md'),
    // Its payload's cwd is Junie's own folder; the project is project_path.
    fields: raw => ({ ...raw, cwd: raw.project_path ?? raw.cwd, tool_input: editorArgs(raw.tool_input) }),
    // Its EAP refuses a tool call only on Claude Code's refusal, whatever its docs say of the top-level decision.
    reply(out, event) {
      const reason = out.deny || out.ask || out.block, context = joined(out.context, out.feedback);
      return { stdout: json({ ...(reason && { decision: 'block', reason }), ...(reason && event === 'PreToolUse' && { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }), ...(context && { additionalContext: context }) }) };
    },
    hooks: {
      file: () => path.join(os.homedir(), '.junie', 'config.json'),
      own: true,
      events: { SessionStart: {}, UserPromptSubmit: {}, PreToolUse: { matcher: '^(Write|Edit|Bash)$' }, Stop: { timeout: 600 } },
      entry: nested,
      wrap: shared,
    },
  },
  // OpenHands reads this user-level file only for a repository without its own .openhands/hooks.json. Its session start and
  // after-tool hooks are only logged.
  openhands: {
    ask: false, prompt: true, start: false, feedback: false, ok: input => exitZero(input.tool_response),
    tools: { terminal: 'Bash', execute_bash: 'Bash' },
    fields: openhandsFields,
    reply(out) {
      const reason = out.deny || out.ask || out.block, context = joined(out.context, out.feedback);
      return { stdout: json({ ...(reason && { decision: 'deny', reason }), ...(context && { additionalContext: context }) }) };
    },
    hooks: {
      // The CLI reads only the repository's file and the home folder's; OH_PERSISTENCE_DIR is its agent server's.
      file: () => path.join(os.homedir(), '.openhands', 'hooks.json'),
      own: true,
      events: { session_start: {}, user_prompt_submit: {}, pre_tool_use: { matcher: OH_TOOLS }, post_tool_use: { matcher: OH_TOOLS, timeout: 60 }, stop: { timeout: 600 } },
      entry: nested,
      // The file may wrap its lists in `hooks` and name events in PascalCase; lessloc writes them unwrapped, in snake_case.
      read: cur => Object.fromEntries(Object.entries(cur.hooks && typeof cur.hooks === 'object' ? cur.hooks : cur).map(([k, v]) => [snake(k), v])),
      wrap: (cur, hooks) => hooks,
    },
  },
  goose: {
    ask: false, prompt: false, start: false, feedback: false, ok: () => false,
    rules: () => (gooseRoot() ? path.join(gooseRoot(), 'config', '.goosehints') : xdg('goose', '.goosehints')),
    tools: { shell: 'Bash', write: 'Write', edit: 'Edit' },
    fields: gooseFields,
    reply: out => ({ stdout: out.deny || out.ask || out.block ? blocked(out.deny || out.ask || out.block) : '' }),
    hooks: {
      file: () => path.join(gooseRoot() || os.homedir(), '.agents', 'plugins', NEUTRAL, 'hooks', 'hooks.json'),
      own: true,
      events: { SessionStart: {}, UserPromptSubmit: {}, PreToolUse: { matcher: GOOSE_TOOLS }, PostToolUse: { matcher: GOOSE_TOOLS, timeout: 60 }, PostToolUseFailure: { matcher: '^shell$', timeout: 60 }, Stop: { timeout: 600 } },
      entry: nested,
      wrap: (cur, hooks) => ({ ...cur, hooks }),
    },
  },
  devin: {
    ask: false, prompt: true, ok: input => exitZero(input.tool_response),
    tools: { exec: 'Bash' },
    fields: devinFields,
    reply: (out, event) => ({ stdout: out.deny || out.ask ? blocked(out.deny || out.ask) : claudeJson(out, event) }),
    hooks: {
      file: () => (process.platform === 'win32' ? path.join(process.env.APPDATA || os.homedir(), 'devin', 'config.json') : xdg('devin', 'config.json')),
      own: true,
      events: { SessionStart: {}, UserPromptSubmit: {}, PreToolUse: { matcher: DEVIN_TOOLS }, PostToolUse: { matcher: DEVIN_TOOLS, timeout: 60 }, Stop: { timeout: 600 } },
      entry: nested,
      wrap: shared,
    },
  },
  // Crush hooks only the call before each tool runs: no session start, prompt, after-tool or stop event. A session starts with
  // its first call, which carries the session start text, without the standard once `init` put it in Crush's global context
  // file. A refused call's reason is what the model reads, so that text goes there too.
  crush: {
    ask: false, prompt: false, start: false, preContext: true, feedback: false, track: 'turn', sessionStart: 'tool', ok: () => false,
    rules: () => xdg('crush', 'CRUSH.md'),
    tools: { bash: 'Bash', multiedit: 'MultiEdit' },
    fields: raw => ({ ...raw, hook_event_name: raw.hook_event_name ?? raw.event }),
    reply(out) {
      const refused = out.deny || out.ask, o = refused ? { decision: 'deny', reason: joined(refused, out.context) } : out.context ? { context: out.context } : {};
      return { stdout: Object.keys(o).length ? json({ version: 1, ...o }) : '' };
    },
    hooks: {
      file: () => path.join(process.env.CRUSH_GLOBAL_CONFIG || xdg('crush'), 'crush.json'),
      own: true,
      events: { PreToolUse: { matcher: CRUSH_TOOLS } },
      // The name is what Crush's screen shows for the hook.
      entry: ({ timeout = 30, matcher }, command) => ({ name: NEUTRAL, matcher, command, timeout }),
      wrap: shared,
    },
  },
  // Google Antigravity. Its stdout is one JSON object for every event, with the decision its docs mark required. Its after-tool
  // answer is ignored, it has no prompt event, and a held turn goes back to the agent as a system message.
  antigravity: {
    ask: false, prompt: false, feedback: false, turnStart: 'stop', ok: input => exitZero(input.tool_response),
    fields: antigravityFields,
    transcript: antigravityTranscript,
    reply(out, event) {
      const refused = out.deny || out.ask;
      if (event === 'PreToolUse') return { stdout: JSON.stringify(refused ? { decision: 'deny', reason: refused } : { decision: 'allow' }) };
      if (event === 'Stop') return { stdout: JSON.stringify(out.block ? { decision: 'continue', reason: out.block } : { decision: 'allow' }) };
      return { stdout: JSON.stringify(out.context ? { injectSteps: [{ systemMessage: { systemMessage: out.context } }] } : {}) };
    },
    hooks: {
      file: () => path.join(os.homedir(), '.gemini', 'config', 'hooks.json'),
      own: true,
      events: { SessionStart: {}, PreToolUse: { matcher: AGY_TOOLS }, PostToolUse: { matcher: AGY_TOOLS, timeout: 60 }, Stop: { timeout: 600 } },
      // A tool event's entries take a matcher; the other events list their handlers directly.
      entry: ({ timeout = 30, matcher }, command, event) => (h => (matcher ? { matcher, hooks: [h] } : h))({ type: 'command', command: `${command} ${event}`, timeout }),
      // lessloc's events are under a hook of its own, with a neutral name, as Kiro's and goose's are.
      read: cur => (cur[NEUTRAL] && typeof cur[NEUTRAL] === 'object' && !Array.isArray(cur[NEUTRAL]) ? cur[NEUTRAL] : {}),
      wrap: (cur, hooks) => (Object.values(hooks).some(Array.isArray) ? { ...cur, [NEUTRAL]: hooks } : Object.fromEntries(Object.entries(cur).filter(([k]) => k !== NEUTRAL))),
    },
  },
  // Agents and SDK apps without a row of their own (docs/guide/any-agent.md): the integrator's code applies the answer.
  generic: GENERIC,
  // The OpenCode bridge plugin (opencode/server.js) speaks the generic protocol, and OpenCode 2.x can always ask the user.
  opencode: { ...GENERIC, ask: true },
  // The other plugin bridges speak it too, each under its own name, so `doctor` can tell which tool's hooks ran: Kilo Code
  // (opencode/server.js), Amp (amp/plugin.js), the Cline CLI and SDK (cline/plugin.js) and Pi (pi/extension.js).
  kilo: GENERIC,
  amp: GENERIC,
  'cline-sdk': GENERIC,
  pi: GENERIC,
};

// The entries lessloc puts in a host's hook file, each running `command`.
export const ourEntries = (name, command) => {
  const h = HOSTS[name].hooks;
  return Object.fromEntries(Object.entries(h.events).map(([e, o]) => [e, [].concat(o).map(x => h.entry(x, command, e))]));
};
// A settings file written in its own layout: the indentation of its first indented line (two spaces for a new file or one on a
// single line), and a last newline only where it had one.
const layout = (o, text) => `${JSON.stringify(o, null, /\n([ \t]+)\S/.exec(text ?? '')?.[1] ?? 2)}${text && !text.endsWith('\n') ? '' : '\n'}`;
// What each hook file held before lessloc first added its entries, where writing it back would not give the same bytes: null
// when lessloc created it. It stays in lessloc's cache, readable by the user alone, so `remove` can put the file back exactly.
const ORIGINALS = () => path.join(stateRoot(), 'originals.json');
function original(f, text) {
  const all = load(ORIGINALS()), before = JSON.stringify(all);
  if (text === undefined) delete all[f];
  else all[f] = text;
  for (const k of Object.keys(all)) if (k !== f && !fs.existsSync(k)) delete all[k];
  if (JSON.stringify(all) !== before) save(ORIGINALS(), all, 0o600);
}
const parsed = text => {
  try { return JSON.parse(text?.trim() || '{}'); } catch { return undefined; }
};

// Rewrites lessloc's entries in a host's user-level hook file, keeping everyone else's; without `install` it only removes them.
// A file with comments, or that is not a JSON object, is left alone. `entry` is the hook.mjs the hooks run (the benchmark points
// it at another checkout). Returns the file, or '' when there was nothing of lessloc's to remove.
export function userHooks(name, install, f = HOSTS[name].hooks.file(), entry = ENTRY) {
  const h = HOSTS[name].hooks, text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null, cur = parsed(text);
  const command = h.command ? h.command(entry) : HOOK(name, entry), ours = ourEntries(name, command);
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) {
    if (!install && !OURS(text)) return '';
    throw new Error(`${f} has comments or is not a JSON object, so lessloc left it alone. ${install ? `To set it up by hand, merge this into it: ${JSON.stringify(h.wrap({}, ours, f))}` : `Take out by hand the entries that run ${command}`}`);
  }
  // A file's hook lists without lessloc's entries. A value that is not a list of entries is someone else's setting, kept as it is.
  const theirs = o => {
    const hooks = {};
    for (const [e, list] of Object.entries(hookLists(name, o, f))) {
      const kept = Array.isArray(list) ? list.filter(x => !OURS(x)) : list;
      if (!Array.isArray(kept) || kept.length) hooks[e] = kept;
    }
    return hooks;
  };
  const had = Object.values(hookLists(name, cur, f)).some(list => Array.isArray(list) && list.some(OURS));
  if (!install && !had) return '';
  const hooks = theirs(cur);
  if (install) for (const [e, list] of Object.entries(ours)) hooks[e] = [...(hooks[e] || []), ...list];
  const next = h.wrap(cur, hooks, f);
  if (install) {
    if (!had) original(f, text === null ? null : layout(h.wrap(cur, theirs(cur), f), text) === text ? undefined : text);
    save(f, layout(next, text));
    return f;
  }
  const was = load(ORIGINALS())[f], base = was === undefined ? undefined : was === null ? {} : parsed(was);
  // Put back what the file held when only lessloc's entries changed since; a file lessloc created goes.
  if (base && isDeepStrictEqual(next, h.wrap(base, theirs(base), f))) was === null ? fs.rmSync(f) : save(f, was);
  else if (h.own && isDeepStrictEqual(next, h.wrap({}, {}, f))) fs.rmSync(f);
  else save(f, layout(next, text));
  original(f, undefined);
  return f;
}
// A hook file's lists of entries by event, wherever the host keeps them (by default under `hooks`).
export const hookLists = (name, cur, f) => {
  try {
    return HOSTS[name].hooks.read ? HOSTS[name].hooks.read(cur, f) : cur.hooks || {};
  } catch (e) {
    throw new Error(`${f}: ${e.message}`);
  }
};

// A tool call's name and input in Claude Code's shape, file paths absolute. A write whose input has no recognizable shape
// keeps its name: lessloc then tracks it by the snapshots around it, so only the gate before it lands is lost.
function tool(name, ti, cwd) {
  const t = TOOL_NAMES[name] || name, file = ti.file_path ?? ti.path ?? ti.target_file, abs = f => path.resolve(cwd, String(f));
  if (t === 'Bash') return [t, { ...ti, command: String(ti.command ?? '') }, ti.working_directory ?? ti.workdir];
  if (t === 'apply_patch') return [t, { command: String(ti.command ?? ti.patchText ?? ti.patch ?? '') }];
  if (file == null) return [t, ti];
  if (Array.isArray(ti.edits)) return ['MultiEdit', { file_path: abs(file), edits: ti.edits.map(e => ({ old_string: e.old_string ?? e.oldString, new_string: e.new_string ?? e.newString })) }];
  if ((ti.old_string ?? ti.oldString) != null) return ['Edit', { file_path: abs(file), old_string: ti.old_string ?? ti.oldString, new_string: ti.new_string ?? ti.newString ?? '' }];
  if ((ti.content ?? ti.contents) != null) return ['Write', { file_path: abs(file), content: String(ti.content ?? ti.contents) }];
  return [t, { ...ti, file_path: abs(file) }];
}

// `named` is the event the hook command names, for a host whose payload does not.
export function parse(raw, flag, env = process.env, named) {
  let host = HOSTS[flag] ? flag : env.CURSOR_VERSION || raw.cursor_version || /^[a-z]/.test(raw.hook_event_name || '') ? 'cursor' : raw.turn_id || env.PLUGIN_DATA ? 'codex' : 'claude';
  host = HOSTS[host].variant?.(raw) || host;
  if (HOSTS[host].fields) raw = HOSTS[host].fields(raw, named);
  const row = HOSTS[host], event = EVENTS[raw.hook_event_name] || raw.hook_event_name, cwd = raw.cwd || raw.workspace_roots?.[0] || env.CURSOR_PROJECT_DIR || process.cwd();
  const input = raw.hook_event_name === 'beforeShellExecution' ? { ...raw, tool_name: 'Shell', tool_input: { command: raw.command } } : { ...raw };
  if (input.tool_name) {
    const [name, ti, dir] = tool(row.tools?.[input.tool_name] || input.tool_name, input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {}, cwd);
    Object.assign(input, { tool_name: name, tool_input: ti, cwd: dir ? path.resolve(cwd, dir) : cwd });
  }
  const failed = event === 'PostToolUseFailure';
  return { host, caps: row.caps ? { ...row, ...row.caps(raw) } : row, event, cwd, input, sid: String(raw.session_id || raw.conversation_id || 'default'), failed, passed: event === 'PostToolUse' && row.ok(raw) };
}
