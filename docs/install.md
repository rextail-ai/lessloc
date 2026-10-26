---
title: "Install lessloc: steps for an AI coding agent"
---

# Install lessloc

These steps are for an AI coding agent whose user asked it to install lessloc. Follow them in order and run each command yourself. The user only approves your commands. Where a step says to stop, stop and tell the user why.

lessloc keeps coding agents to the least code that does the job and still works. It runs as hooks inside the user's agent tools. Its only network contact of its own is a daily check for its newest published release; [Does my code leave my machine?](https://lessloc.org/guide/faq#does-my-code-leave-my-machine) lists every network contact. In the repository it writes the commit gate in `.git/hooks` and snapshots of the working tree in `.git/objects`, which git never pushes, and nothing into the repository's files unless the user asks.

## 1. Check the requirements

Run these three commands:

```sh
node --version
git --version
git rev-parse --show-toplevel
```

- `node` must print v20 or newer. If node is missing or older, stop. Tell the user: "lessloc needs Node 20 or newer. Install it from https://nodejs.org or with a version manager such as nvm or fnm, then ask me again." Do not install Node yourself.
- `git` must print a version. If it is missing, stop and tell the user that lessloc needs git.
- `git rev-parse` must print a folder. That is the repository to set up. If it fails, ask the user which repository they mean, and run the next steps there.

## 2. Get lessloc

If the folder `~/.lessloc` does not exist, clone lessloc into it:

```sh
git clone --depth 1 https://get.lessloc.org/lessloc.git ~/.lessloc
```

get.lessloc.org is lessloc's download address. It serves lessloc's GitHub repository, https://github.com/rextail-ai/lessloc, unchanged, and counts downloads: new installs and lessloc's daily update checks; lessloc keeps no addresses. What it keeps: [Where it downloads from](https://lessloc.org/guide/faq#does-my-code-leave-my-machine). Updates use it too: lessloc's own daily update check, `git pull`, and the update check that Codex and Qwen Code make each time they start, when lessloc is their plugin or extension. If this clone fails, or the user wants to download only from GitHub, clone from GitHub instead: `git clone --depth 1 https://github.com/rextail-ai/lessloc ~/.lessloc`. Every get.lessloc.org address, the plugin addresses among them, serves that same repository, so the GitHub URL works in its place, and the later steps download nothing.

If it exists, update it:

```sh
git -C ~/.lessloc pull --ff-only
```

Keep lessloc in `~/.lessloc`, because the hooks run it from there. Do not install it globally, and do not run it through npx: npx may clean its cache, and the hooks would stop.

## 3. Set up the agent tools and this repository

From the repository folder, run:

```sh
node ~/.lessloc/lessloc.mjs init --agents
```

This command does three things:

- It adds the commit gate to this repository's `.git/hooks`. Nothing goes into the repository's files.
- It finds the agent tools installed for this user. The line "this command runs in" names the tool you run in.
- It installs lessloc's hooks for each tool it supports, in the user's home folder, for all their projects.

Read the lines under "Agent tools for this user" and act on each:

| The line says | Do this |
|---|---|
| `installed in <file>` | Nothing. It is done. |
| `set up (...)` | Nothing. It was done before. |
| `Claude Code: not set up ... run: <commands>` | Run those commands yourself. They are Claude Code's own plugin commands, which add the plugin from the clone in `~/.lessloc` and download nothing. |
| `not set up: <reason>` | Tell the user the reason. Do not edit that file. |
| `lessloc has no hooks for it` | Tell the user that this tool gets no hooks. Offer `node ~/.lessloc/lessloc.mjs init --rules`, which puts lessloc's working standard in the repository's AGENTS.md. Run it only if the user agrees, because AGENTS.md is shared with their team. |
| `no agent tool found for this user` | Tell the user. If you are a custom agent, your developer can connect lessloc with the protocol at https://lessloc.org/guide/any-agent. |

### Only if the user asked for GitHub Copilot's cloud agent

The cloud agent reads hooks only from the repository. From the repository folder, run:

```sh
node ~/.lessloc/lessloc.mjs init --copilot --repo
```

It writes `.github/hooks/review.json` and prints one step that starts with `- run: mkdir`. Put that step under `steps:` of the `copilot-setup-steps` job in `.github/workflows/copilot-setup-steps.yml`. If that file does not exist, create it with this content, and use the printed line as the step:

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

Do not commit. Tell the user that both files must be committed to the repository's default branch, because the cloud agent reads them from there, and that everyone who works in the repository shares them.

## 4. Check that it works

Run:

```sh
node ~/.lessloc/lessloc.mjs doctor
```

Report each line to the user in plain words. A line that starts with `✓` works, `!` needs attention and `✗` failed. The text in parentheses is the fix.

Hooks start with the next session, so right after an install these lines are expected:

- `! no lessloc hook has run in this repository yet`
- `✓ <tool>: set up (...); its hooks have not run in this repository yet`, for each tool that was set up.
- If you run in Claude Code, its line reads `! Claude Code: set up (Claude Code plugin) after this session started, so this session runs without it`. That is expected: tell the user lessloc works from their next session.

## 5. Tell the user what you did and what happens next

Tell the user every point below. Skip only what is about a tool or a step this install did not set up. You may shorten the wording, but keep every fact in it.

- **What you did:**
  - lessloc is in `~/.lessloc`.
  - Its hooks are installed for each tool that was set up, in the user's home folder, for all their projects.
  - Two git hooks are in this repository's `.git/hooks`: `pre-commit`, the commit gate, and `prepare-commit-msg`, which adds commit trailers only when `trailers` is set in `.lessloc.json`.
  - lessloc keeps its own files, a shortened copy of the user's prompts among them, in `~/.cache/lessloc`.
  - lessloc updates itself: once a day, when a session starts, it checks for its newest published release and updates `~/.lessloc` in the background. `git -C ~/.lessloc config lessloc.update false` turns this off.
  - Its hooks keep snapshots of the working tree, untracked files that git does not ignore included, in each repository's `.git/objects`; git never pushes them.
  - Nothing goes into the repository's files.
- **Start a new session** in each tool that was set up, so it loads lessloc. This session runs without lessloc.
- **What they will notice:** the agent never sees lessloc. Each session starts with a short working standard, and unfinished work is noted for the next session. The user notices lessloc in these four ways:
  - An approval prompt that starts with `lessloc:`, when an agent edits `.lessloc.json`, `.lessloc-baseline.json` or a protected file, or skips the project's checks, such as with `git commit --no-verify`. Claude Code, OpenCode 2.x, Factory Droid and VS Code's agent mode show it. In the other tools, Codex among them, that call is refused instead, and the agent asks the user in its reply. Cline's VS Code extension and Aider neither ask nor refuse.
  - A refused write: a placeholder, commented-out code or a junk file does not land, and the agent writes the real thing.
  - When the agent says it is done while the tests fail or requested work is missing, it is sent back once, in plain words.
  - A commit with such problems is refused with "Not committed. Fix these first:".
- **Only for the tools that were set up:**
  - **Codex:** Codex runs new hooks only after the user trusts them once. They open `/hooks` in Codex and trust lessloc's hooks.
  - **Cline:** in VS Code, Cline runs hook files only when the user turns on "Enable Hooks" once: Cline settings, Feature Settings.
  - **Amp:** Amp loads the plugin after the user runs `plugins: reload` from its command palette (Ctrl+O), or restarts Amp.
  - **Pi:** Pi loads the extension after the user types `/reload`, or restarts Pi.
  - **Kiro:** Kiro's CLI runs the hooks in every workspace. Kiro's IDE does not read them.
  - **Junie:** Junie runs hooks only in the Early Access build of its CLI.
  - **OpenHands:** OpenHands reads the hooks only in a repository without its own `.openhands/hooks.json`.
  - **Aider:** lessloc runs as Aider's lint command, which works only while Aider's auto-lint is on, its default. Aider's commits now run the repository's git hooks, so the commit gate checks them.
- **To undo it:**
  - In each repository where `init` ran: `node ~/.lessloc/lessloc.mjs remove --agents`. It takes lessloc out of that repository's git hooks and out of every agent tool's hooks, and deletes lessloc's files for that checkout in `~/.cache/lessloc`. Outside a repository, it takes out only the agent tools' hooks.
  - For Claude Code, `remove --agents` prints two more commands to run: `claude plugin uninstall lessloc@lessloc` and `claude plugin marketplace remove lessloc`.
  - For the cloud agent: `node ~/.lessloc/lessloc.mjs remove --copilot --repo` takes lessloc out of `.github/hooks/review.json`.
  - Once every agent session has ended: `rm -rf ~/.cache/lessloc ~/.lessloc` deletes lessloc's files in the user cache, the shortened prompt copies among them, and the clone.
  - If you offer to pause lessloc instead of removing it, say what stays on: `"mode": "off"` in `.lessloc.json`, or `LESSLOC=off` in the environment the agent tool starts with, silences only the agent hooks; the commit gate still checks and refuses commits, and `node ~/.lessloc/lessloc.mjs check` and CI still run. Only `node ~/.lessloc/lessloc.mjs remove` takes out the commit gate.
- **What stays after the undo:** the snapshots of the working tree stay in each repository's `.git/objects`, never pushed, until `git gc` prunes them once they are older than `gc.pruneExpire`, two weeks by default. `git gc --prune=now` in the repository deletes them now. If you mention `git gc --prune=now`, always say that it also deletes the repository's other unreachable objects, such as a dropped stash, and to run it only after every agent session has ended.

Never tell the user that `remove` or the `rm -rf` deletes everything of lessloc: the snapshots stay.

More: https://lessloc.org/guide/getting-started
