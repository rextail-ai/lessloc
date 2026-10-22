---
title: "Getting started: install lessloc for your AI coding agent"
---

# Getting started

lessloc is a free, open-source (Apache-2.0) tool that keeps AI coding agents to the least code that does the job and still works. It runs inside your AI coding agent through the agent tool's hooks. You install it once for your agent tools. Each repository then gets a commit gate. The agent never sees lessloc: there is no command for it to learn and no file for it to read.

New to lessloc? [Start here](/start) has it all on one short page: one sentence to install, one to remove.

## Requirements

- **Node 20 or newer**, on the PATH your agent tool uses. Every hook starts `node`.
- **git.** Reviews, checks and test evidence need a git repository.
- **An agent tool with hooks**, from [Supported agent tools](#supported-agent-tools). Other tools get the rules tier.

Recommended:

- **A test command** that runs your whole suite, so agents and CI can verify. lessloc reads the agent's runs of it, and `lessloc test`, `verify` and `ci` run it. lessloc finds the common ones itself; if it finds none, set `test` in `.lessloc.json` ([Configuration](/guide/configuration#test)).
- **ruff**, if you write Python. lessloc runs it for deeper checks when it is installed; without it, `lessloc check` lists those checks under "Not checked".
- **Node from nodejs.org or a version manager** such as nvm or fnm. Some Linux distribution packages build Node without its startup snapshot, which makes every hook start several times slower. `lessloc doctor` warns when that is the case. After installing another Node, make it the first `node` on the PATH (`command -v node` in a new terminal prints it), then restart the agent tool: a running tool keeps the PATH it started with. `doctor`'s per-event medians leave out Node's start, so they do not show the gain; `time node -e 0`, run before and after, does.

## Supported agent tools

<!-- hosts:start -->
| Agent tool | Install | Status |
|---|---|---|
| Claude Code | [plugin](/guide/getting-started#claude-code) | tested end to end on 2.1.306 |
| Codex | [`init --codex` or the Codex plugin](/guide/getting-started#codex) | `init --codex` tested end to end on 0.163.0; the Codex plugin: tested against documented payloads |
| Cursor | [`init --cursor` or the Cursor plugin](/guide/getting-started#cursor) | tested against documented payloads |
| OpenCode 2.x | [`init --opencode`](/guide/getting-started#opencode-2-x) | tested end to end on 2.1.2 |
| OpenCode 1.x | [`init --opencode`](/guide/getting-started#opencode-1-x-and-kilo-code) | tested end to end on 1.19.3 |
| Kilo Code | [`init --kilo`](/guide/getting-started#opencode-1-x-and-kilo-code) | tested end to end on 7.8.15 |
| Amp | [`init --amp`](/guide/getting-started#amp) | tested against documented payloads |
| Cline | [`init --cline`](/guide/getting-started#cline) | tested end to end on 3.0.73 (Cline CLI); the IDE's hook files: tested against documented payloads |
| Pi | [`init --pi` or the Pi package](/guide/getting-started#pi) | tested end to end on 1.4.0 |
| GitHub Copilot CLI, VS Code agent mode | [`init --copilot` or the Copilot CLI plugin](/guide/getting-started#github-copilot-cli-and-vs-code) | tested end to end on 1.0.102 (Copilot CLI); VS Code agent mode: tested against documented payloads |
| Copilot cloud agent | [`init --copilot --repo` and a setup step](/guide/getting-started#copilot-cloud-agent) | tested against documented payloads |
| Gemini CLI | [`init --gemini` or the Gemini CLI extension](/guide/getting-started#gemini-cli) | tested end to end on 0.65.0 |
| Qwen Code | [`init --qwen` or the Qwen Code extension](/guide/getting-started#qwen-code) | tested end to end on 0.26.0 |
| Factory Droid | [`init --droid`](/guide/getting-started#factory-droid) | tested end to end on 0.247.0 |
| Augment (CLI, VS Code, IntelliJ) | [`init --augment`](/guide/getting-started#augment) | tested against documented payloads |
| Kiro CLI | [`init --kiro`](/guide/getting-started#kiro) | tested against documented payloads |
| Junie CLI (Early Access) | [`init --junie`](/guide/getting-started#junie) | tested end to end on 26.10.20 |
| OpenHands | [`init --openhands`](/guide/getting-started#openhands) | tested end to end on 1.16.0 |
| goose | [`init --goose`](/guide/getting-started#goose) | tested end to end on 1.55.0 |
| Devin CLI | [`init --devin`](/guide/getting-started#devin-cli) | tested against documented payloads |
| Crush | [`init --crush`](/guide/getting-started#crush) | tested end to end on 0.98.1 |
| Antigravity (app, CLI, IDE) | [`init --antigravity`](/guide/getting-started#antigravity) | tested end to end on 1.4.5 (CLI); the app and IDE: tested against documented payloads |
| Aider | [`init --aider`](/guide/getting-started#aider) | tested end to end on 0.86.2 |
| Your own agent | [the hook protocol](/guide/any-agent) | tested against documented payloads |
| Claude Agent SDK, Codex SDK | [the plugin, or `init --codex`](/guide/any-agent) | tested against documented payloads |
| OpenAI Agents SDK | [the hook protocol](/guide/any-agent#openai-agents-sdk), the git hooks and CI | tested against documented payloads |
| Zed, Warp, Continue, JetBrains AI Assistant, Roo Code, and other tools without hooks | [`init --rules`](/guide/getting-started#tools-without-hooks), the git hooks and CI | rules tier: rules written where each tool's documentation says it reads them |
<!-- hosts:end -->

`lib/hosts.mjs` maps each tool's hook protocol onto one core, so every tool with hooks gets the same gate, end-of-turn review and handoff, as far as the tool lets lessloc act. Claude Code also reviews subagents and checks MCP tools that write. Each tool's section below says how lessloc works there.

## 1. Install lessloc

Each tool below has up to three ways to install lessloc, in this order:

1. **Ask your agent.** Give your coding agent this sentence:

   > Install lessloc for this project by following https://lessloc.org/install.md

   [That page](/install) is written for agents. The agent checks Node and git, clones lessloc into `~/.lessloc`, sets up every agent tool it finds and this repository, runs `doctor`, and tells you what changes. You only approve its commands.
2. **In your tool's prompt box**, where the tool installs plugins itself.
3. **In a terminal.** Get lessloc first:

   ```sh
   git clone https://github.com/rextail-ai/lessloc ~/.lessloc
   ```

   On this site, `lessloc` stands for `node ~/.lessloc/lessloc.mjs`. Running `npm link` inside the clone puts `lessloc` on your PATH. The hooks run lessloc from this clone, so keep it where it is. If you move it, run the same `init` commands again; lessloc replaces its own entries.

`lessloc init` lists the agent tools it finds and the command for each. To set up all of them at once:

```sh
cd your-repo
lessloc init --agents
```

This installs lessloc's hooks for every tool it finds and supports, in your home folder, and prints Claude Code's own commands for Claude Code. lessloc never edits Claude Code's settings itself.

### Claude Code

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In Claude Code's prompt box:

   ```
   /plugin marketplace add rextail-ai/lessloc
   /plugin install lessloc@lessloc
   ```

3. In a terminal:

   ```sh
   claude plugin marketplace add ~/.lessloc
   claude plugin install lessloc@lessloc
   ```

Start a new agent session afterwards. The plugin hooks every event lessloc uses: session start, each prompt, before and after tool calls, subagents, and the end of each turn.

Tested end to end on Claude Code 2.1.306: with a subagent running in the background, the standard at session start, the hints, a refused placeholder, the note after a write and a held turn reach the agent, and none of these texts names lessloc.

The plugin also adds a `/lessloc` skill for you. It is never listed to the agent. It can `setup`, `audit`, `review`, `consolidate` and `find`.

### Codex

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In a terminal:

   ```sh
   cd your-repo
   lessloc init --codex
   ```

   This adds lessloc's entries to `~/.codex/hooks.json` (in `$CODEX_HOME` when that is set), so they apply to all your projects.
3. In Codex's prompt box, type `/plugins`, choose "Add marketplace", enter `rextail-ai/lessloc`, and install lessloc from the list. The plugin's hooks are exactly the ones `init --codex` writes.

Either way, Codex runs new hooks only after you trust them once: `/hooks` in Codex. Use the plugin or `init --codex`, not both; `doctor` warns when both are set up.

`init --codex` is tested end to end on Codex 0.163.0: the standard, the hints, a refused placeholder patch, the note after a write and a held turn reach the agent, never lessloc, and the agent's own test runs are recorded.

How lessloc works in Codex:

- File edits arrive as patches. lessloc gates them from the patch text.
- Where lessloc would ask you, the call is refused instead, and the agent is told to ask you in its reply ([why](/guide/how-it-works#before-each-write-the-gate)).
- Feedback is added as context, since exit code 2 would replace the tool's output.

### Cursor

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In Cursor's agent chat:

   ```
   /add-plugin https://github.com/rextail-ai/lessloc
   ```

   Cursor reads lessloc's Cursor manifest, `.cursor-plugin/plugin.json`. The plugin has the same hooks as `init --cursor`, run by `cursor/hook.sh` in the plugin's folder, and lists no skill to the agent. On Windows, use the terminal: the plugin's hooks run a shell script.
3. In a terminal:

   ```sh
   cd your-repo
   lessloc init --cursor
   ```

   This adds lessloc's entries to `~/.cursor/hooks.json`, for all your projects.

Use the plugin or `init --cursor`, not both; `doctor` warns when both are set up.

How lessloc works in Cursor:

- Cursor's prompt hook takes no context. Hints about existing code arrive with the first command or write of the turn instead.
- As in Codex, where lessloc would ask you, the call is refused and the agent asks you instead.
- The note at the end of a turn reaches the agent as a follow-up message.
- Cursor also runs the hooks of the Claude Code plugins you installed. When lessloc's hooks run twice for one event with the same payload, the second run answers nothing.

### OpenCode 2.x

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In a terminal:

   ```sh
   cd your-repo
   lessloc init --opencode
   ```

   This writes a small plugin, `~/.config/opencode/plugins/lessloc.js` (under `$XDG_CONFIG_HOME` when that is set). It loads lessloc's bridge from your clone, for all your projects.

How lessloc works in OpenCode: the review at the end of a turn reaches the agent as a follow-up message.

Tested end to end on OpenCode 2.1.2: OpenCode loads the plugin file that `init --opencode` writes, and the rules, the hints, the gate, the notes after writes and the follow-up at the end of a turn reach the agent. No agent call touches lessloc.

### OpenCode 1.x and Kilo Code

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In a terminal:

   ```sh
   cd your-repo
   lessloc init --opencode   # OpenCode 1.x
   lessloc init --kilo       # Kilo Code
   ```

   `--opencode` writes the same plugin file for OpenCode 1.x and 2.x. `--kilo` writes `~/.config/kilo/plugin/lessloc.js` (under `$XDG_CONFIG_HOME` when that is set), which Kilo Code's CLI and its VS Code extension both load. Restart the tool afterwards.

How lessloc works in OpenCode 1.x and Kilo Code:

- Their plugin API cannot put a call to you. Where lessloc would ask you, the call is refused and the agent asks you instead.
- The note at the end of a turn is sent as a new prompt, once per prompt, so it starts one more turn.
- A subagent's own session is never held.

### Amp

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In a terminal:

   ```sh
   cd your-repo
   lessloc init --amp
   ```

   This writes `~/.config/amp/plugins/lessloc.js` (under `$XDG_CONFIG_HOME` when that is set), which loads lessloc's plugin from your clone, for all your projects. Then run `plugins: reload` from Amp's command palette (Ctrl+O), or restart Amp.

How lessloc works in Amp:

- Where lessloc would ask you, the call is refused and the agent asks you instead.
- The working standard and the hints are added to your prompt as hidden text.
- The note at the end of a turn is a follow-up message that starts one more turn. A subagent's thread is never held.

### Cline

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In a terminal:

   ```sh
   cd your-repo
   lessloc init --cline
   ```

   This writes two things, for all your projects:

   - `~/.cline/plugins/lessloc.js` (in `$CLINE_DIR` when that is set), a plugin for the Cline CLI and SDK.
   - five hook files in `~/Documents/Cline/Hooks/` for Cline's VS Code extension: `TaskStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` and `TaskComplete`. If one of those files is your own, `init` writes none of them and says so.

   In VS Code, turn on hooks once: Cline settings, Feature Settings, "Enable Hooks".

How lessloc works in Cline:

- The end of a run cannot be held. lessloc still reviews it and keeps the result for the next session.
- In VS Code, a hook that refuses a tool call ends the agent's whole run (from Cline's source). So lessloc refuses nothing there; the commit gate and CI catch placeholders, commented-out code and junk files.
- In VS Code, hook files do not get the output of the agent's commands (from Cline's source), so lessloc cannot read its test runs there.
- In the CLI, where lessloc would ask you, the call is refused and the agent asks you instead.
- The CLI gives a plugin hook 3 seconds. A hook that takes longer answers nothing for that call, and lessloc still records what it saw.
- On Windows, Cline's VS Code extension runs `.ps1` hook files, which `init --cline` does not write.

### Pi

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In Pi's prompt box:

   ```
   !pi install git:github.com/rextail-ai/lessloc
   /reload
   ```

   The `!` runs the command from the prompt box. The package loads lessloc's extension and nothing else.
3. In a terminal:

   ```sh
   cd your-repo
   lessloc init --pi
   ```

   This writes `~/.pi/agent/extensions/lessloc.js` (in `$PI_CODING_AGENT_DIR` when that is set), for all your projects. Then type `/reload` in Pi, or restart it.

Use the package or `init --pi`, not both; `doctor` warns when both are set up.

How lessloc works in Pi:

- Where lessloc would ask you, the call is refused and the agent asks you instead.
- The working standard and the hints arrive as a message you do not see.
- The note at the end of a turn asks for one more model request in the same run, as a message you do not see.

### GitHub Copilot CLI and VS Code

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In Copilot CLI's prompt box:

   ```
   /plugin install rextail-ai/lessloc
   ```

   Copilot reads lessloc's Copilot manifest, `.github/plugin/plugin.json`, which comes before the Claude Code plugin's in Copilot's search order. In VS Code, use the sentence or the terminal.
3. In a terminal:

   ```sh
   cd your-repo
   lessloc init --copilot
   ```

   This writes `~/.copilot/hooks/lessloc.json` (in `$COPILOT_HOME` when that is set), for all your projects. Copilot CLI and VS Code's agent mode both read it. `init --agents` finds Copilot by its `copilot` program or its `~/.copilot` folder, not by VS Code alone, so with VS Code only, run `init --copilot`.

Use the plugin or `init --copilot`, not both; `doctor` warns when both are set up.

How lessloc works in Copilot:

- Copilot refuses every tool call when a pre-tool hook fails. So each of lessloc's hook commands first checks that node and lessloc are there, and does nothing otherwise.
- Copilot drops what a prompt hook answers. Hints about existing code arrive with the first command or write of the turn instead.
- As in Codex, where lessloc would ask you, the call is refused and the agent asks you instead. Copilot's autopilot mode and cloud agent cannot ask anyone.
- The note at the end of a turn becomes the prompt for one more turn.
- Copilot does not give the hook the agent's last reply, so lessloc cannot check what the reply says is left failing.
- In VS Code's Local harness, a refusal reaches the agent as a hook error, and an approval request goes to you.

### Copilot cloud agent

The cloud agent reads hooks only from the repository, so this setup is per repository.

1. Ask your agent:

   > Install lessloc for Copilot's cloud agent in this repository by following https://lessloc.org/install.md

2. In a terminal:

   ```sh
   cd your-repo
   lessloc init --copilot --repo
   ```

   This writes `.github/hooks/review.json` into the repository, and prints one step for `.github/workflows/copilot-setup-steps.yml`. The step installs lessloc into `~/.agent-standard` from npm, at exactly the version that printed it. If that file does not exist yet, create it:

   ```yaml
   name: Copilot setup steps
   on: workflow_dispatch
   permissions:
     contents: read
   jobs:
     copilot-setup-steps:
       runs-on: ubuntu-latest
       steps:
         - run: mkdir -p "$HOME/.agent-standard" && cd "$HOME/.agent-standard" && npm pack lessloc@<version> --silent && tar -xzf lessloc-<version>.tgz --strip-components=1
   ```

   Commit both files to the default branch: the cloud agent reads both from there. A published npm version never changes, and `npm pack` checks the package against the registry's hash.

Each line of the hook file runs lessloc from `~/.agent-standard`, and does nothing where node or lessloc is missing, so a teammate without it is not affected. The cloud agent can read the repository's files, so the hook file and that folder have neutral names. The setup step is the one file in the repository that names lessloc.

How lessloc works in the cloud agent: as in [Copilot](#github-copilot-cli-and-vs-code). Each job runs in a fresh sandbox, so the handoff note does not reach the next job.

### Gemini CLI

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In Gemini CLI's prompt box:

   ```
   /extensions install https://github.com/rextail-ai/lessloc
   ```

   Then restart Gemini CLI. Gemini installs the extension from lessloc's latest GitHub release. In a terminal, the same is `gemini extensions install https://github.com/rextail-ai/lessloc`.
3. In a terminal:

   ```sh
   cd your-repo
   lessloc init --gemini
   ```

   This adds lessloc's entries under `hooks` in `~/.gemini/settings.json`, for all your projects, and keeps your other settings. Restart Gemini CLI afterwards.

Use the extension or `init --gemini`, not both; `doctor` warns when both are set up.

How lessloc works in Gemini CLI:

- As in Codex, where lessloc would ask you, the call is refused and the agent asks you instead.
- The note at the end of a turn reaches the agent as a new prompt.

### Qwen Code

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In Qwen Code's prompt box:

   ```
   /extensions install rextail-ai/lessloc
   ```

   Qwen Code reads lessloc's own manifest, `qwen-extension.json`, and keeps the `/lessloc` skill off. In a terminal, the same is `qwen extensions install rextail-ai/lessloc`. Then start a new session.
3. In a terminal:

   ```sh
   cd your-repo
   lessloc init --qwen
   ```

   This adds lessloc's entries under `hooks` in `~/.qwen/settings.json`, for all your projects, and keeps your other settings.

Use the extension or `init --qwen`, not both; `doctor` warns when both are set up.

How lessloc works in Qwen Code: where lessloc would ask you, the call is refused, and the agent is told to ask you instead.

### Factory Droid

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In the prompt box, do not add lessloc's repository in `/plugins`: Droid would install lessloc's Claude Code plugin, which is written for Claude Code. Use the sentence or the terminal.
3. In a terminal:

   ```sh
   cd your-repo
   lessloc init --droid
   ```

   This adds lessloc's entries to `~/.factory/hooks.json`, for all your projects. If that file does not exist and `~/.factory/settings.json` holds your hooks, it adds them there instead, because Droid then reads hooks only from its settings.

How lessloc works in Droid: Droid asks you where lessloc asks, as Claude Code does. `droid exec` runs no prompt hook and no hook after a command that failed, so there lessloc reads the request and the failed test runs from the session's transcript.

### Augment

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In the prompt box, do not add lessloc's repository in `/plugins`: Augment would offer lessloc's Claude Code plugin, which is written for Claude Code. Use the sentence or the terminal.
3. In a terminal:

   ```sh
   cd your-repo
   lessloc init --augment
   ```

   This adds lessloc's entries under `hooks` in `~/.augment/settings.json`, for all your projects, and keeps your other settings. Auggie and Augment's VS Code and IntelliJ extensions all read this file. Augment runs only script files as hooks, so the entries run `augment/hook.sh` from your clone. On Windows, Augment runs only `.ps1`, `.cmd` and `.bat` hooks, which `init --augment` does not write.

How lessloc works in Augment:

- Augment has no prompt hook. The agent gets no hints about existing code, and lessloc reads the turn's request when the turn ends.
- Augment's hooks can refuse a call but not ask you. Where lessloc would ask you, the call is refused, and the agent is told to ask you instead.

### Kiro

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In a terminal:

   ```sh
   cd your-repo
   lessloc init --kiro
   ```

   This writes `~/.kiro/hooks/lessloc.json`. Kiro's CLI runs the hooks there in every workspace. Kiro's documentation says only its CLI reads that folder, so Kiro's IDE gets no hooks this way.

How lessloc works in Kiro:

- Nothing an after-tool hook says reaches the agent, so there are no notes right after a write. The review at the end of the turn still sees each write.
- Where lessloc would ask you, the call is refused, and the agent is told to ask you instead.
- The note at the end of a turn starts one more agent turn.

### Junie

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In the prompt box, do not add lessloc's repository in `/extensions`: Junie would install lessloc's Claude Code plugin, which is written for Claude Code. Use the sentence or the terminal.
3. In a terminal:

   ```sh
   cd your-repo
   lessloc init --junie
   ```

   This writes two things, for all your projects:

   - lessloc's entries under `hooks` in `~/.junie/config.json`. Your other settings stay.
   - the working standard in `~/.junie/AGENTS.md`, between `<!-- working-standard -->` markers, after anything already there.

   Junie runs hooks only in the Early Access build of its CLI. Its IDE plugin runs none.

How lessloc works in Junie:

- Junie does not wait for its session start hook. The working standard comes from `~/.junie/AGENTS.md`. The project's rules and the note from the last session come with your first prompt, or, in a run without the terminal UI, with the agent's first write or command.
- Junie has no hook after a tool runs. So there are no notes right after a write, and lessloc cannot read the agent's test runs. At the end of a turn, lessloc reviews every file changed since the turn began, including files a command wrote and another agent's changes in the same checkout.
- Junie's tool and stop hooks name no session, so they count toward the session that started last in the checkout.
- Where lessloc would ask you, the call is refused, and the agent is told to ask you instead.

### OpenHands

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In a terminal:

   ```sh
   cd your-repo
   lessloc init --openhands
   ```

   This adds lessloc's entries to `~/.openhands/hooks.json`. OpenHands reads this file only for a repository that has no `.openhands/hooks.json` of its own. It applies where OpenHands runs on your machine, as its CLI does. OpenHands Cloud runs in its own sandbox, without this file.

How lessloc works in OpenHands:

- OpenHands only logs what its session start hook says. The working standard, the project's rules and the note from the last session come with your first message.
- It only logs what an after-tool hook says, so there are no notes right after a write. lessloc still tracks each write and reads the agent's test runs.
- Where lessloc would ask you, the call is refused, and the agent is told to ask you instead.

### goose

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In a terminal:

   ```sh
   cd your-repo
   lessloc init --goose
   ```

   This writes two things, for all your projects:

   - a plugin folder, `~/.agents/plugins/review/`, with `plugin.json` and `hooks/hooks.json`. goose shows the model a plugin's name when a hook refuses a call or holds a turn, so the folder has a neutral name. If a plugin of yours already has that name, `init` leaves it alone and says so.
   - the working standard in `~/.config/goose/.goosehints` (under `$XDG_CONFIG_HOME` when that is set), between `<!-- working-standard -->` markers, after anything already there.

   When `GOOSE_PATH_ROOT` is set, both go under it, where goose reads them: `$GOOSE_PATH_ROOT/.agents/plugins/review/` and `$GOOSE_PATH_ROOT/config/.goosehints`.

How lessloc works in goose:

- goose's hooks cannot add context. The working standard comes from `.goosehints`. The agent gets no hints about existing code, no project rules, no notes right after a write and no note from the last session.
- goose gives hooks no command output, so lessloc sees a test run only when it fails: the turn is held for it, and a passing run is not seen.
- A refusal reaches the agent in goose's words: "Tool call denied by policy hook `review`:", then the reason.
- Where lessloc would ask you, the call is refused, and the agent is told to ask you instead.

### Devin CLI

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In the prompt box, do not run `devin plugins install rextail-ai/lessloc`: it would install lessloc's Claude Code plugin, which is written for Claude Code. Use the sentence or the terminal.
3. In a terminal:

   ```sh
   cd your-repo
   lessloc init --devin
   ```

   This adds lessloc's entries under `hooks` in `~/.config/devin/config.json` (under `$XDG_CONFIG_HOME` when that is set; `%APPDATA%\devin\config.json` on Windows), for all your projects, and keeps your other settings.

How lessloc works in Devin CLI:

- Devin gives hooks no exit code for a command. lessloc reads the test runner's own summary instead.
- Where lessloc would ask you, the call is refused, and the agent is told to ask you instead.

### Crush

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In a terminal:

   ```sh
   cd your-repo
   lessloc init --crush
   ```

   This writes two things, for all your projects:

   - lessloc's entry under `hooks` in `~/.config/crush/crush.json` (in `$CRUSH_GLOBAL_CONFIG` when that is set). Your other settings stay. The entry is named `review`.
   - the working standard in `~/.config/crush/CRUSH.md`, between `<!-- working-standard -->` markers, after anything already there. Crush adds that file to every session's system prompt.

   Both go under `$XDG_CONFIG_HOME` when that is set. Crush merges `crush.json` with a `crushrc` in the same folder, and its source says the `crushrc` wins where both set the same key. So a `crushrc` that sets hooks may hide lessloc's entry.

How lessloc works in Crush:

- Crush hooks only the moment before a tool runs. The working standard comes from `CRUSH.md`. The project's rules and the note from the last session come with the agent's first write or command of each session.
- A refused write is the only check during a session. There are no notes after a write, lessloc cannot read the agent's test runs, and it cannot hold the end of a turn. The commit gate and CI check the rest.
- lessloc never sees a Crush turn end, so a Crush session leaves no note for the next one.
- Crush runs subagents without hooks (from its documentation).
- Where lessloc would ask you, the call is refused, and the agent is told to ask you instead.

### Antigravity

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In a terminal:

   ```sh
   cd your-repo
   lessloc init --antigravity
   ```

   This adds a hook named `review` to `~/.gemini/config/hooks.json`, for all your projects. Antigravity's app, CLI and IDE all read that file. Your other hooks stay. If a hook of yours is already named `review`, `init` leaves the file alone and says so.

How lessloc works in Antigravity:

- Antigravity has no prompt hook, so the agent gets no hints about existing code. In its CLI, lessloc reads the turn's request from the transcript each hook names, checks it, and passes it to the next session; elsewhere it cannot check the turn's request or the agent's last reply.
- Nothing an after-tool hook says reaches the agent, so there are no notes right after a write. The review at the end of the turn still sees each write.
- After a command, Antigravity tells a hook only whether it failed. In its CLI, lessloc reads each command's exit code from the transcript and records every test run. Elsewhere it records a failed run and no pass, because a command still running in the background looks the same, so when the agent reruns failing tests without changing code and they pass, lessloc may still hold the turn once for the failure.
- The note at the end of a turn reaches the agent as a system message, and the agent keeps working.
- Where lessloc would ask you, the call is refused, and the agent is told to ask you instead.

### Aider

1. Ask your agent: [the sentence above](#_1-install-lessloc).
2. In a terminal:

   ```sh
   cd your-repo
   lessloc init --aider
   ```

   This writes two things, for all your projects:

   - a block in `~/.aider.conf.yml`, between `# >>> lessloc` and `# <<< lessloc` lines, with three settings: `lint-cmd`, `read` and `git-commit-verify: true`. A setting you already have stays yours, and `init` prints lessloc's value instead. A project's own `.aider.conf.yml` overrides these.
   - the folder `~/.config/agent-standard/` (under `$XDG_CONFIG_HOME` when that is set), with lessloc's lint command, `check`, and the working standard, `CONVENTIONS.md`. Aider shows its model the lint command and the names of read-only files, so neither names lessloc.

   `check` is a shell script, so this does not work on Windows.

How lessloc works in Aider:

- Aider has no hooks. lessloc runs as its lint command on each file the model edits. Placeholders, commented-out code, junk files, credentials, swallowed errors and forbidden imports come back to the model as lint errors, after the edit has landed, when you agree to fix them. Nothing is refused before it lands, but the commit gate refuses Aider's commit while a placeholder, commented-out code, a junk file or a credential remains.
- Aider runs one lint command for every language, so lessloc's replaces Aider's built-in lint, its syntax check included. Aider lints only while auto-lint is on, its default.
- The working standard is a read-only file in every chat.
- Aider skips your git hooks by default. `git-commit-verify: true` makes its commits run them, so the commit gate checks each one.
- lessloc gets no prompt, no test runs and no end of a turn from Aider: no hints, no hold and no note for the next session.

### Your own agent or SDK

[Custom agents and SDKs](/guide/any-agent) covers the Claude Agent SDK, the Codex SDK, the OpenAI Agents SDK, and the hook protocol for an agent you build.

### Tools without hooks

Zed, Warp, JetBrains AI Assistant, Roo Code and Continue have no hooks that lessloc can install. They get the rules tier: the working standard in the repository's AGENTS.md, the commit gate and CI. `lessloc init` names Zed, Warp and Continue when it finds them.

1. Ask your agent: [the sentence above](#_1-install-lessloc). The agent sets up the commit gate, and offers to write AGENTS.md. You decide, because AGENTS.md is shared with your team.
2. In a terminal:

   ```sh
   cd your-repo
   lessloc init --rules --ci
   ```

   `init` adds the commit gate. `--rules` writes the working standard into AGENTS.md, and may add one line to CLAUDE.md ([what it writes](/guide/reference#init)). `--ci` writes the CI workflow. These are files your team shares: commit them if your team agrees.

What each tool reads, from its documentation:

- **Zed.** Its agent reads the first of these project files it finds: `.rules`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md`, `AGENT.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`. If an earlier one exists, it does not read AGENTS.md. Zed's personal instructions file, `~/.config/zed/AGENTS.md`, applies to every project: you can copy `~/.lessloc/RULES.md`, the working standard, there instead. Claude Code, Codex and the other agents Zed runs keep their own lessloc install.
- **Warp.** Its agent reads `AGENTS.md`, or `WARP.md`, at the repository's root. The CLI agents you run in Warp's terminal keep their own lessloc install.
- **JetBrains AI Assistant.** Most of its agents read the repository's AGENTS.md. Claude Agent reads CLAUDE.md. `init --rules` adds `@AGENTS.md` to a CLAUDE.md that exists. AI Assistant's chat reads only its own project rules, in `.aiassistant/rules/`, which lessloc does not write.
- **Roo Code.** It reads AGENTS.md beside its own `.roo/rules/`.
- **Continue.** It reads rules from `.continue/rules/`, and its documentation does not say it reads AGENTS.md. Copy `~/.lessloc/RULES.md`, the working standard, into `.continue/rules/` yourself.

### Notes for every tool

- `init --agents` and the tool flags (`--codex`, `--cursor`, `--opencode`, `--kilo`, `--amp`, `--cline`, `--pi`, `--copilot`, `--gemini`, `--qwen`, `--droid`, `--augment`, `--kiro`, `--junie`, `--openhands`, `--goose`, `--devin`, `--crush`, `--antigravity`, `--aider`) must run inside a git repository, because `init` always sets up that repository's git hooks too. The flags combine: `lessloc init --codex --gemini`.
- Agent hooks are installed once for your user account, not per repository. After that they work in every git repository you open with that tool. The Copilot cloud agent is the exception: its hooks live in each repository.

## 2. Set up each repository

```sh
cd your-repo
lessloc init
lessloc doctor
```

`init` adds the commit gate to this clone, and lists your agent tools. The agent-driven install and `init --agents` already did this for the repository they ran in. The [reference](/guide/reference#init) lists its flags for the files your whole team shares, and [every file lessloc writes](/guide/reference#files-lessloc-writes).

## 3. Check that it works

`lessloc doctor` prints one line per check, and one per agent tool: whether lessloc is set up there, and whether its installed hooks answer. The [reference](/guide/reference#doctor) lists what it checks and how to read each line.

Right after you install, `doctor` says that no lessloc hook has run in this repository yet. Start an agent session there and run it again. If the line stays after a session that started after the install has worked in the repository, the hooks do not run: ask your agent to go through [Hooks do not run](/agents#hooks-do-not-run).

## What you will notice

The agent never sees lessloc, but you will see it now and then:

- An approval prompt that starts with `lessloc:` when an agent edits a protected path, `.lessloc.json` or `.lessloc-baseline.json` with its edit tools, or runs a command that skips the project's checks, such as `git commit --no-verify`. Approve only what you asked for. [The gate](/guide/how-it-works#before-each-write-the-gate) says what tools that cannot ask you do instead.
- An agent that keeps working once after saying it is done, because lessloc sent it back with what is unfinished, in plain words. For example: the tests fail on the final code, or the agent's own reply says part of the problem still fails.
- A refused commit that says "Not committed. Fix these first:", followed by what blocks it.

[How it works](/guide/how-it-works) explains each step.

## Everyday commands

You do not need any of these for the agent hooks to work. They are for you and for CI:

```sh
lessloc check               # review your uncommitted work
lessloc test                # run the tests, recorded for this exact state
lessloc verify              # run the tests on a clean checkout of the staged state
lessloc audit               # the whole codebase: copies, dead code, junk
lessloc find round money    # existing definitions for a task, by name
```

The [reference](/guide/reference#commands) lists every command and flag.

## Update lessloc

```sh
git -C ~/.lessloc pull --ff-only
lessloc doctor
```

Every hook event starts `~/.lessloc/hook.mjs` afresh: the hooks that `init` installed run it from this clone, and Claude Code reads the plugin added from `~/.lessloc` from that folder. So the pull updates the code every hook runs. A plugin or extension that a tool installed from elsewhere updates through that tool: for Claude Code, `claude plugin marketplace update lessloc && claude plugin update lessloc@lessloc`. `doctor` shows no versions: `lessloc version` prints the clone's, and `claude plugin list` the Claude Code plugin's.

The pull does not change what `init` wrote into a tool's own files: lessloc's hook entries (which events and tool calls run it), and the copy of the working standard for Junie, goose, Crush and Aider. Run `init` again in a repository with the flag of each tool that `doctor` lists as `set up (<path>)`, such as `lessloc init --codex --gemini`, and lessloc replaces its entries with the current ones. The Claude Code plugin needs no step.

Start a new session in each tool afterwards. Each hook runs lessloc from `~/.lessloc`, so open sessions run the new code from their next hook, but they keep the hooks they loaded at start (which events call lessloc and, in OpenCode, Kilo Code, Amp, Cline and Pi, lessloc's plugin) until a new session loads the current ones.

## Remove lessloc

From inside each repository where you ran `init`:

```sh
lessloc remove
```

This takes lessloc out of that repository's git hooks and AGENTS.md, and deletes lessloc's own files for that checkout. Files shared with your team stay.

To take lessloc out of your agent tools as well, for all your projects:

```sh
lessloc remove --agents
```

Outside a repository, this takes out only the agent tools' hooks. Plugins a tool installed itself are removed in that tool, and `remove --agents` prints how. For Claude Code:

```sh
claude plugin uninstall lessloc@lessloc
claude plugin marketplace remove lessloc
```

Then, once every agent session that was open during the removal has ended, delete lessloc's cache and the clone. An open session keeps running lessloc's hooks, which write to the cache again ([`remove`](/guide/reference#remove)).

```sh
rm -rf ~/.cache/lessloc ~/.lessloc
```

That deletes what lessloc stored outside your repositories. The snapshots of the working tree it took stay in each repository's `.git/objects`, never pushed, until `git gc` prunes them.

The reference lists [what `remove` deletes and keeps](/guide/reference#remove), flag by flag, and how to delete the snapshots sooner.

To turn off only lessloc's agent hooks without removing it (the commit gate, `lessloc check` and CI keep running), see [Turning lessloc off](/guide/configuration#turning-lessloc-off).

## What to expect

On 117 real changes to three open-source projects, lessloc wrote 27% fewer production lines per task and cost 23% less, with the same results on the projects' own tests. [Benchmarks](/benchmarks) has the results, task by task.

## Next

- [How it works](/guide/how-it-works): what happens in a session, step by step
- [Configuration](/guide/configuration): `.lessloc.json` and the switches that turn lessloc off
- [Commits and CI](/guide/ci): the commit gate, the ratchet and the CI workflow
- [Reference](/guide/reference): every command, finding kind and file
