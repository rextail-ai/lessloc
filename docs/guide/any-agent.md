---
title: "Custom agents and SDKs: the lessloc hook protocol"
---

# Custom agents and SDKs

An agent you build yourself can use lessloc through one command: your code sends it one JSON object per event and applies the JSON answer. This page is that protocol, version 1. The agent tools in [Getting started](/guide/getting-started) need none of it.

## Claude Agent SDK

The Claude Agent SDK runs Claude Code's hooks, so it needs no protocol work. Load the lessloc clone, `~/.lessloc`, as a plugin, with an absolute path, because the SDK does not expand `~`:

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const message of query({ prompt, options: { plugins: [{ type: 'local', path: '/home/you/.lessloc' }] } })) {
  // lessloc's hooks run as they do in Claude Code
}
```

In Python, pass `plugins=[{"type": "local", "path": "/home/you/.lessloc"}]` to `ClaudeAgentOptions`. The plugin's hooks then answer exactly as they do in Claude Code.

## Codex SDK

The Codex SDK runs the Codex CLI, which reads your user-level hooks. Run `lessloc init --codex` once, and trust the hooks once in Codex (`/hooks`). Codex records that trust, so SDK runs use the same hooks. [Supported agent tools](/guide/getting-started#supported-agent-tools) says what was verified live in the Codex CLI.

## OpenAI Agents SDK

The OpenAI Agents SDK has no hook files for lessloc to install. Connect it through [the protocol](#the-protocol), at these points:

- **Session start:** send `SessionStart` before the first run, and add `context` to the agent's `instructions`.
- **Each user message:** send `UserPromptSubmit`, and add `context` to that message.
- **Before a function tool runs:** a tool input guardrail (`@tool_input_guardrail` in Python) sends `PreToolUse`. When the answer has `deny`, it returns `ToolGuardrailFunctionOutput.reject_content(deny)`; otherwise `allow()`.
- **After a function tool runs:** send `PostToolUse` from the tool itself, and append `feedback` to what it returns. A tool output guardrail can only replace the result, and `feedback` must never replace it.
- **Shell and patch tools:** the SDK's docs say `ShellTool` and `ApplyPatchTool` skip the guardrails. Wrap the code you give them to run commands and apply patches, and send `PreToolUse` before it and `PostToolUse` after it.
- **End of a run:** after `Runner.run`, send `Stop` with the run's final output as `last_assistant_message`. When the answer has `block`, run once more with `block` as the next input, then send `Stop` again with `stop_hook_active: true`.

The commit gate and CI work as with any tool, once `lessloc init` has run in the repository.

## The protocol

Run this once per event, in the session's working directory:

```sh
node ~/.lessloc/hook.mjs --host generic
```

Write one JSON object to its stdin, then close stdin. lessloc waits at most 5 seconds for it. Read one JSON object from stdout. The exit code is always 0. Empty output, a crash or a timeout means there is nothing to do: carry on as if lessloc were not there.

Allow 30 seconds for `SessionStart`, `UserPromptSubmit` and `PreToolUse`, 60 seconds for `PostToolUse`, and 600 seconds for `Stop`, because the end-of-turn review runs there.

### Input

Field names follow Claude Code's hooks, so a payload from Claude Code also works. Unknown fields are ignored.

| Field | Events | Meaning |
|---|---|---|
| `hook_event_name` | all | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure` or `Stop`. Optional: `SubagentStart` and `SubagentStop` |
| `session_id` | all | the same for every event of one agent session. Turn state, the once-per-turn hold and the handoff key on it |
| `cwd` | all | the absolute path of the repository the agent works in |
| `source` | `SessionStart` | `startup`, `resume`, `clear` or `compact` |
| `prompt` | `UserPromptSubmit` | the user's message |
| `tool_name` | `PreToolUse`, `PostToolUse` | one of the tool names below. Send only these; lessloc does nothing with other names |
| `tool_input` | `PreToolUse`, `PostToolUse` | the call's arguments, converted to the shape below. Send exactly these keys (`file_path` also works for `path`): map your tools' own argument names to them, for example `cmd` → `command` and `old_str`/`new_str` → `old_string`/`new_string`. Other keys fail silently: a write, edit or patch is not checked before it runs, though `Stop` still reviews its change, and a shell command is read as an empty command, so what it changed and the test run it made go unseen |
| `tool_use_id` | `PreToolUse`, `PostToolUse` | pairs a call's two events. lessloc needs it to track what a shell command or patch changed |
| `tool_response` | `PostToolUse` | `{exit_code, output}`. `output` is what the command printed, where a test runner's summary is |
| `error`, `is_interrupt` | `PostToolUseFailure` | why the call failed; `is_interrupt: true` when the user stopped it |
| `last_assistant_message` | `Stop` | the agent's final reply |
| `stop_hook_active` | `Stop` | `true` when this stop follows a hold lessloc asked for |
| `status` | `Stop` | `completed`, or how the turn ended otherwise (for example `aborted` or `error`). lessloc holds only a completed turn |
| `agent_id` | subagent events, and the calls a subagent makes | which subagent it is |
| `caps` | any | `{ask: true}` when your agent can put a decision to the user. Without it, lessloc refuses such a call and tells the agent to ask the user |

| `tool_name` | `tool_input` |
|---|---|
| `write` | `{path, content}` |
| `edit` | `{path, old_string, new_string}`, or `{path, edits: [{old_string, new_string}]}` |
| `patch` | `{patch}`, in the `*** Begin Patch` format |
| `shell` | `{command, workdir}`; `workdir` is optional |
| `delete` | `{path}` |
| `agent` | `{prompt}`: the task for a subagent |

### Output

Every text in the answer is written for the model, and none names lessloc. Your code must deliver each one where the table says, and never show the model that a hook produced it.

| Field | Event | What your code does |
|---|---|---|
| `context` | `SessionStart`, `UserPromptSubmit`, `SubagentStart` | `SessionStart`: the working standard, the project's rules and a note on work the last session left open; add it to the system prompt. The standard is left out when `init --rules` put it in the repository's AGENTS.md, so your agent must then load AGENTS.md itself. `UserPromptSubmit`: usually empty; hints about existing code when the prompt names it; add it to the user's message. `SubagentStart`: a short form of the working standard; add it to the subagent's system prompt |
| `deny` | `PreToolUse` | Do not run the call. Return this text to the model as the call's error |
| `ask` | `PreToolUse`, only with `caps.ask` | Ask the user, and run the call only if they approve. This text is for the user and may name lessloc |
| `input` | `PreToolUse` of `agent` | Run the call with this input instead: the `tool_input` you sent, with hints about existing code added to the subagent's task in `prompt`. Convert it back to your tool's own argument names |
| `feedback` | `PostToolUse` | Append this text to the result the model sees. Never replace the result |
| `block` | `Stop`, `SubagentStop` | Do not end the turn. Send this text to the agent as its next message, then send the next `Stop` with `stop_hook_active: true`. lessloc holds a turn at most once |

## A reference loop

[test/reference-agent.mjs](https://github.com/rextail-ai/lessloc/blob/main/test/reference-agent.mjs) is an agent loop of about 40 lines, wired to lessloc through this protocol. Its core is one function:

```js
import { spawnSync } from 'node:child_process';

function lessloc(cwd, event) {
  const r = spawnSync('node', [ENTRY, '--host', 'generic'], { cwd, input: JSON.stringify({ cwd, ...event }), encoding: 'utf8' });
  try { return JSON.parse(r.stdout || '{}'); } catch { return {}; }
}
```

In Python:

```python
import json, subprocess

def lessloc(cwd, event):
    r = subprocess.run(["node", ENTRY, "--host", "generic"], input=json.dumps({"cwd": cwd, **event}), capture_output=True, text=True, cwd=cwd)
    try:
        return json.loads(r.stdout or "{}")
    except ValueError:
        return {}
```

`ENTRY` is the absolute path of `hook.mjs` in the lessloc clone, such as `/home/you/.lessloc/hook.mjs`. Other SDKs and agent frameworks call it at the same points: before and after each tool call that can change files, when a session starts, with each user message, and when the agent says it is done.

## Checking your integration

`test/adapters.test.mjs` runs every agent tool's row, and this protocol, through the same scenario. A placeholder write is refused. A swallowed error gets a note appended to the result. A failed and then a passing test run are recorded. The turn is held once. The next session hears what was left open. Nothing the model reads names lessloc. The payloads it sends for this protocol are in [test/fixtures/hosts/generic.json](https://github.com/rextail-ai/lessloc/blob/main/test/fixtures/hosts/generic.json).

To test your own integration, in any language, run it against the real `node ~/.lessloc/hook.mjs --host generic` in a temporary git repository whose test command lessloc knows (`lessloc doctor` there shows it). Send these checks through your agent's own tool wrapper, with your tools' real arguments, not hand-written payloads: a payload that already has the protocol's keys proves nothing about how your code converts your tools' arguments.

- Each of your file tools (write, edit, patch), called to add `# ... existing code ...` to a `.py` file, must come back with `deny`, and the file must stay as it was.
- A turn that writes a file with your write tool, then runs the test command with your shell tool and gets a failure, must get `block` at `Stop`, and nothing at the next `Stop` with `stop_hook_active: true`.

lessloc reads what a turn changed from the files on disk, by comparing snapshots of the working tree taken at the turn's start, around tool calls, and at `Stop`. `tool_input` names the file a write is about and lets lessloc refuse the call before it runs, but the change itself is read from disk. So in these checks the tool must really run between `PreToolUse` and `PostToolUse`. If your test stubs out the write, the working tree stays as it was, the turn changed nothing, and it gets no note and no `block`. A test run's result, by contrast, is read from `tool_response`, and it counts for the files as they were when the run started, so write first and test after.

Hook errors are logged to `errors.log` in this checkout's folder in your user cache, `~/.cache/lessloc/<repo>-<id>/errors.log`, not in the `~/.lessloc` clone. `lessloc doctor` shows them, and prints that folder as `lessloc's own files` ([In your user cache](/guide/reference#in-your-user-cache)). `LESSLOC_DEBUG=1` prints them on the hook's stderr, so a wrapper that captures output, as the reference loop does, must pass stderr through for you to see them.

If your tests fake the hook instead, the fake must answer every event: `SessionStart`, `UserPromptSubmit` and `Stop` carry no `tool_input`.

Status: tested against this page's payloads by `test/adapters.test.mjs`. lessloc's plugins for OpenCode, Kilo Code, Amp, Cline and Pi speak the same protocol, each under its own host name. They share `bridge/core.js`, which runs one event and returns the answer; [Supported agent tools](/guide/getting-started#supported-agent-tools) says what was verified in each.

## Disconnecting your agent

1. Take the hook calls out of your agent's code.
2. In each repository where you ran `lessloc init`, run `node ~/.lessloc/lessloc.mjs remove`. It takes lessloc out of that clone's git hooks, and out of AGENTS.md where `init --rules` ran, and deletes only that checkout's folder in your user cache.
3. Once no agent session runs, run `rm -rf ~/.cache/lessloc ~/.lessloc`. That deletes the clone and lessloc's folders for every other repository your agent worked in, with their shortened copies of your prompts. If another agent tool still uses lessloc, take it out there first ([Remove lessloc](/guide/getting-started#remove-lessloc)).

The snapshots of the working tree stay in each repository's `.git/objects`, never pushed, until `git gc` prunes them ([`remove`](/guide/reference#remove) says how to delete them sooner).
