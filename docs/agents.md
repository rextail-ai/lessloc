---
title: "For AI agents: install, configure, fix or remove lessloc"
outline: [2, 3]
---

# For AI agents

lessloc keeps coding agents to the least code that does the job and still works. It runs inside your agent tool's hooks: you never call it, and nothing it tells you names it. It needs no account and no API key, installs no packages (it needs only Node and git), and is open source under Apache-2.0.

It makes no network calls; [Does my code leave my machine?](/guide/faq#does-my-code-leave-my-machine) lists the programs it runs and has a check the user can run. The agent tool still sends code and prompts to its model provider. Of the commands the user runs, `lessloc probe` starts the user's `probe` agent command in a clean checkout of the repository, a paid agent session whose model provider gets the code that agent reads, and `lessloc audit --tools` runs the vulnerability scanners the user has installed, which look up advisories online. What lessloc stores ([Files lessloc writes](#files-lessloc-writes)):

- In the repository: two git hooks in `.git/hooks`, `pre-commit` (the commit gate) and `prepare-commit-msg` (commit trailers, only when `trailers` is set), and snapshots of the working tree, untracked files that git does not ignore included, as unreachable objects in `.git/objects` until `git gc` prunes them. Git pushes neither. Nothing goes into the repository's files or commits unless the user asks.
- In the user cache: one folder per checkout, which holds a shortened copy of the user's prompts and is readable by the user alone.

`node ~/.lessloc/lessloc.mjs remove` deletes only this checkout's folder in the user cache. To delete what lessloc stored outside the repositories, the user closes every agent session and runs `rm -rf ~/.cache/lessloc ~/.lessloc`; the snapshots stay in `.git/objects` until `git gc` prunes them ([Remove lessloc](#remove-lessloc)).

This page is the whole documentation, condensed for you, the AI coding agent. Read it when your user asks about lessloc; during normal work you need none of it. Here `lessloc` stands for `node ~/.lessloc/lessloc.mjs`: run it in that full form.

## What you may notice while working

lessloc says nothing while the work is fine. When it does speak, the text arrives through your tool, in plain words:

| What you see | What it means | What to do |
|---|---|---|
| A refused write: `Not applied: it adds a placeholder (...)`, `Not applied: it adds commented-out code (...)`, or ``Not applied: `<file>` is a backup, copy, scratch or report file.`` | The write did not land. | Do what the message says: write the real code instead of a placeholder, delete commented-out code, or edit the real file instead of a copy. If part of the work is not done, tell the user plainly. |
| `Not applied: ..., and only the user may approve that. Ask them in your reply; if they agree, they can do it themselves.` | The call changes a protected path or the project's policy file, or skips the project's checks. | Ask the user in your reply. Do not reach the same result another way. |
| One line after a write, such as `shop/config.py:4: swallowed error: let it reach a boundary that handles it, or catch only the error you expect` | What you just wrote has a credential, a swallowed error or an import the project forbids. | Fix it now, while the file is open. |
| `This turn has taken many steps. If what is left of the request has no natural end (all coverage, every warning, every case), finish with what works now and say exactly what is left. Otherwise carry on.` | The turn passed 40 tool calls. It comes once per turn. | If the request has no natural end, stop with what works and say exactly what is left. Otherwise keep going. |
| A message when you try to finish: `Before you finish (this turn: ...):` and a list | Work is unfinished: tests that fail on the final code, a name the request asked for, a stub, a copy of existing code and the like. It comes at most once per turn. | Fix only the listed items and add nothing else. If one is intended, say why in one line. Then finish. |
| `Not committed. Fix these first:` and a list | The commit gate refused the commit. | Fix the listed lines and commit again. |

You may also get context without asking: a short working standard at session start, a line such as ``In this project: only the user changes `migrations/**`.``, a note that starts with `The last session here`, and, with a prompt, `Existing code that may already do part of this (matched by name; search for other names too):` with up to five places. Treat them as the project's own instructions.

In Claude Code, OpenCode 2.x, Factory Droid and VS Code's agent mode, such a call goes to the user, not you, as an approval prompt that starts with `lessloc:`. It is the one text written for them. Every other tool, Codex among them, refuses the call with the `Not applied: ..., and only the user may approve that` text above, and you ask the user in your reply. Cline's VS Code extension and Aider neither ask nor refuse.

## When your user asks you to...

Shared files and switches are the user's decision. Do these only when the user asks for them, and say what each one changes:

- write files the team shares: AGENTS.md (`init --rules`), `.lessloc.json`, `.lessloc-baseline.json`, `.github/workflows/lessloc.yml`, `.github/hooks/review.json`, or commit them;
- turn lessloc, or a part of it, off;
- edit or delete lessloc's entries in an agent tool's settings by hand;
- skip the commit check (`git commit --no-verify`).

### Install lessloc

Follow [install.md](/install.md) step by step. In short, from the repository's folder:

```sh
node --version                                # v20 or newer, or stop and tell the user
git --version                                 # a version, or stop: lessloc needs git
git rev-parse --show-toplevel                 # the repository to set up
git clone --depth 1 https://github.com/rextail-ai/lessloc ~/.lessloc
node ~/.lessloc/lessloc.mjs init --agents
node ~/.lessloc/lessloc.mjs doctor
```

- If Node or git is missing, or Node is older than 20, stop and tell the user; do not install them yourself.
- If `git rev-parse` fails, ask the user which repository they mean, and run the next steps there.
- If `~/.lessloc` exists, update it instead, as [Update lessloc](#update-lessloc) says.
- Keep lessloc in `~/.lessloc`: the hooks run it from there. Never install it globally or run it through npx.
- `init --agents` adds the commit gate to this repository's `.git/hooks` and installs hooks for every agent tool it finds, in the user's home folder, for all their projects. It must run inside a git repository.
- Act on each line under "Agent tools for this user" as install.md's table says. For Claude Code it prints `claude plugin` commands instead, because lessloc never edits Claude Code's settings: run them.
- Then tell the user the points in install.md's step 5: what you did, including the snapshots lessloc's hooks keep in `.git/objects`; to start a new session in each tool and do the step in the last column below; how to undo it; if you offer to pause it instead, what stays on ([Turn a check off](#turn-a-check-off)); and that the snapshots stay after the undo until `git gc` prunes them. Never say that `remove` or `rm -rf ~/.cache/lessloc ~/.lessloc` deletes everything ([Remove lessloc](#remove-lessloc)).

To set up one tool, run `init` with its flag. Flags combine, as in `init --codex --gemini`. Some tools can also install lessloc as their own plugin or extension ([Getting started](/guide/getting-started#_1-install-lessloc)); use that or `init`, not both.

| Agent tool | Set up with | Writes | Then the user |
|---|---|---|---|
| Claude Code | `claude plugin marketplace add ~/.lessloc` and `claude plugin install lessloc@lessloc` | Claude Code installs the plugin itself | starts a new session |
| Codex | `init --codex` | `~/.codex/hooks.json` | trusts the hooks once: `/hooks` in Codex |
| Cursor | `init --cursor` | `~/.cursor/hooks.json` | starts a new session |
| OpenCode 1.x and 2.x | `init --opencode` | `~/.config/opencode/plugins/lessloc.js` | restarts OpenCode |
| Kilo Code | `init --kilo` | `~/.config/kilo/plugin/lessloc.js` | restarts Kilo Code |
| Amp | `init --amp` | `~/.config/amp/plugins/lessloc.js` | runs `plugins: reload` from the command palette (Ctrl+O), or restarts Amp |
| Cline | `init --cline` | `~/.cline/plugins/lessloc.js`, and five hook files in `~/Documents/Cline/Hooks/` | in VS Code, turns on "Enable Hooks" once: Cline settings, Feature Settings |
| Pi | `init --pi` | `~/.pi/agent/extensions/lessloc.js` | types `/reload`, or restarts Pi |
| GitHub Copilot CLI, VS Code agent mode | `init --copilot` | `~/.copilot/hooks/lessloc.json` | starts a new session |
| Copilot cloud agent | `init --copilot --repo` | `.github/hooks/review.json` in the repository, and a printed setup step ([install.md](/install.md)) | commits both files to the default branch |
| Gemini CLI | `init --gemini` | the `hooks` key of `~/.gemini/settings.json` | restarts Gemini CLI |
| Qwen Code | `init --qwen` | the `hooks` key of `~/.qwen/settings.json` | starts a new session |
| Factory Droid | `init --droid` | `~/.factory/hooks.json`, or the `hooks` key of `~/.factory/settings.json` | starts a new session |
| Augment | `init --augment` | the `hooks` key of `~/.augment/settings.json` | starts a new session |
| Kiro CLI | `init --kiro` | `~/.kiro/hooks/lessloc.json` | uses Kiro's CLI; its IDE does not read this file |
| Junie CLI | `init --junie` | the `hooks` key of `~/.junie/config.json`, and a block in `~/.junie/AGENTS.md` | uses the Early Access build of Junie's CLI |
| OpenHands | `init --openhands` | `~/.openhands/hooks.json` | works in repositories without their own `.openhands/hooks.json` |
| goose | `init --goose` | `~/.agents/plugins/review/`, and a block in `~/.config/goose/.goosehints` | starts a new session |
| Devin CLI | `init --devin` | the `hooks` key of `~/.config/devin/config.json` | starts a new session |
| Crush | `init --crush` | the `hooks` key of `~/.config/crush/crush.json`, and a block in `~/.config/crush/CRUSH.md` | starts a new session |
| Antigravity | `init --antigravity` | a hook named `review` in `~/.gemini/config/hooks.json` | starts a new session |
| Aider | `init --aider` | a block in `~/.aider.conf.yml`, and `~/.config/agent-standard/` | keeps auto-lint on, its default |
| Zed, Warp, Continue, JetBrains AI Assistant, Roo Code | `init --rules`, only if the user agrees | the working standard in the repository's AGENTS.md | commits AGENTS.md if the team agrees |

Files in the home folder apply to all the user's projects; the Copilot cloud agent's file and AGENTS.md are in the repository. `init --agents` finds Copilot by its `copilot` program or its `~/.copilot` folder, so with VS Code alone, run `init --copilot`. The environment variables under [Reference](#environment-variables) move some of these files.

Two of the tools without hooks differ ([Tools without hooks](/guide/getting-started#tools-without-hooks)). Continue does not read AGENTS.md: the user copies `~/.lessloc/RULES.md` into `.continue/rules/`. Zed reads only the first rules file it finds, so it skips AGENTS.md when an earlier one, such as `.rules`, `.cursorrules` or `AGENT.md`, exists.

### Check that it works

```sh
node ~/.lessloc/lessloc.mjs doctor
```

Run it in the repository. Each line starts with `✓` (works), `!` (needs attention) or `✗` (failed); the text in parentheses is the fix. It exits with 1 when a line failed. Report each line to the user in plain words.

| The line says | Do this |
|---|---|
| `✗ node <version>` | Stop. The user installs Node 20 or newer. |
| `! this Node (...) was built without its startup snapshot, ...` | This Node starts several times slower, and every hook starts Node. Do what [Node without its startup snapshot](#node-without-its-startup-snapshot) says. |
| `✗ not in a git repository` | Run it inside the repository. |
| `✓ lessloc's own files: <folder> (outside the repository)` | Nothing. Session journals and the error log are there. |
| `✗ .lessloc.json: <problem>` | A key with a problem is ignored and its default applies; if the file is not valid JSON, every default applies. Show the user the fix ([Configure it](#configure-it)). |
| `! no test command`, or `✓ test command: <command> (discovered)` that is wrong | Suggest a `test` key in `.lessloc.json`. |
| `! no lessloc hook has run in this repository yet` | Expected right after an install: the user starts a new session, then you run `doctor` again. A session's first hook records a run, so if you run `doctor` from a session that started in this repository and the line is still there, your own session's hooks did not run either. If a session that started after the install has already worked in this repository, a new session will not fix it: go through [Hooks do not run](#hooks-do-not-run). |
| `✗ <n> hook error(s), latest: ...` | Read the `errors.log` it names, and tell the user. |
| `! AGENTS.md holds the rules of an earlier lessloc, so agents get both` | With the user's agreement, run `lessloc init --rules`. |
| `! git hooks not installed` | Run `lessloc init`. |
| `! ratchet baseline is from lessloc <version>, so it only informs` | The user reviews it, then runs the command in parentheses and commits the file if they agree. |
| `<event>: median <n> ms, ~<n> tokens added (<n> runs)` | Nothing. Over the last 2000 hook runs recorded in this repository: the median time of lessloc's own work in that event, timed from after Node has started and loaded lessloc, so Node's start is not included; the median tokens it added; and how many of those runs were that event. |
| `✓ <tool>: set up (...); its hooks have not run in this repository yet (...)` | Expected after an install. The user does the step in parentheses, if there is one, and starts a new session. When `doctor` runs in Claude Code, Claude Code's own line is one of the next three rows instead. |
| `! Claude Code: set up (Claude Code plugin) after this session started, so this session runs without it` | Expected in the session that installed the plugin. Tell the user it works from their next session. |
| `✗ Claude Code: set up (Claude Code plugin), but its hooks did not run in this session either` | The plugin was installed before this session started, and your own session's hooks did not run, so a new session will not fix it; `doctor` exits with 1. Go through [Hooks do not run](#hooks-do-not-run). |
| `! Claude Code: set up (Claude Code plugin), but no hook has run in this session: ...` | `doctor` could not tell when this session started. If this session installed the plugin, it is expected: tell the user it works from their next session. Otherwise go through [Hooks do not run](#hooks-do-not-run). |
| `! Claude Code: set up, but the plugin is disabled` | Ask the user; if they agree, run `claude plugin enable lessloc@lessloc` and tell them to start a new session. |
| `! <tool>: installed, lessloc not set up` | Run the command in parentheses. |
| `! <tool>: set up twice (...), so its hooks run twice` | Do what the parentheses say: remove one of the two. |
| `✗ <tool>: the hooks in <file> do not answer` | Run the command in parentheses again ([Hooks do not run](#hooks-do-not-run)). |
| `no lessloc hooks for <tools>: ...` | Those tools get no hooks. Offer `init --rules`. |

When you tell the user what they will notice from now on, use this list: an approval prompt that starts with `lessloc:` when an agent edits a protected path, `.lessloc.json` or `.lessloc-baseline.json`, or runs a command that skips the project's checks, such as `git commit --no-verify`; the agent working once more after saying it is done, because lessloc sent it back with what is unfinished; and a refused commit that says "Not committed. Fix these first:". A refused write goes to you, the agent, not to the user.

### Configure it

lessloc works without configuration. A project's own settings go in `.lessloc.json` at the repository's root. It is the project owner's policy, committed so every teammate, agent and CI use it. `mode`, `interrupt` and `protect` act only in agent sessions: the commit gate, `lessloc check` and CI do not read them.

- Write it with your edit tool. The user gets an approval prompt for it. Where your tool cannot ask, the edit is refused; give the user the change to make.
- Do not change it, or `.lessloc-baseline.json`, with a shell command: in a session, that holds your turn as a change the user did not approve. `lessloc init --config`, `lessloc init --baseline` and `lessloc baseline` are shell commands too, so do not run them in a session: create `.lessloc.json` with your edit tool, and give the user the baseline command to run.
- The user can start the file in their own terminal with `lessloc init --config`, which writes the test command lessloc found.
- Run `lessloc doctor` afterwards. An unknown key, a wrong type or broken JSON is named there, a misspelled key gets a "did you mean" suggestion, and a key with a problem is ignored.

A full example:

```json
{
  "test": "npm test",
  "setup": "npm ci",
  "protect": ["migrations/**", ".github/workflows/**"],
  "boundaries": [
    { "files": "src/ui/**", "mustNotImport": "/db/", "why": "the UI reads data through src/api" }
  ],
  "approvedDependencies": ["express", "zod", "vitest"],
  "allow": ["generated/**"],
  "exceptions": [
    { "path": "legacy/**", "finding": "narration", "why": "vendored file, kept verbatim" }
  ],
  "trailers": "verified"
}
```

**Test command.** `"test": "python3 -m pytest -q"` is the command that runs the whole suite. `lessloc test`, `verify` and `ci` run it. An agent's passing whole-suite run on the final state counts as evidence, which the handoff reports, and commit trailers too when `trailers` is set. A run of the configured command counts, and so does a whole-suite run of the same runner: for `uv run pytest -q`, also `pytest`, `python3 -m pytest -x` or `uv run pytest`. Only arguments that select a part, such as a file path or `-k`, narrow a run. A script lessloc cannot read, such as `./scripts/test.sh`, counts only when it is run itself ([what counts as evidence](/guides/verification#what-counts-as-evidence)). Without a `test` key, lessloc uses the first that fits: `npm test`, `make test`, `cargo test`, `go test ./...`, `python3 -m pytest -q`, or `python3 -m unittest discover -s tests -q`. Set it when that guess is wrong, or when the suite runs through a script.

**Protected paths.** `"protect": ["migrations/**", "LICENSE"]` lists paths only the user changes, and every session is told so at its start. In `block` mode, an agent's write there with its edit tools, a heredoc (`cat > file <<EOF`) or a patch goes to the user for approval. Any other change there in a session, such as with `sed -i`, holds the turn when it ends; in `warn` mode nothing goes for approval and every change there holds the turn. This works only in agent sessions: `lessloc check`, the commit gate and CI do not look at `protect`, so a protected path changed outside a session, or in a pull request, is not flagged. For a binding rule, the user sets one up on their code host, such as CODEOWNERS with branch protection on GitHub.

**Which kinds interrupt.** `interrupt` lists the finding kinds that hold a turn. The list replaces the default, so copy the default and edit it. This is the default:

```json
{
  "interrupt": [
    "tests-failed", "policy", "protected", "boundary", "dependency", "secret",
    "placeholder", "commented-out", "junk-file", "weakened-tests", "swallowed-error",
    "suppression", "unsafe", "made-up-api", "test-logic", "stub", "debug-leftover",
    "empty-test", "untested", "unaddressed", "unfinished", "copy", "versioned-copy", "unverified"
  ]
}
```

A name that is not a finding kind makes the whole list invalid, and the default applies. Every kind is in the [Reference](/guide/reference#finding-kinds).

**Allow.** `"allow": ["generated/**", "docs/api/**"]` lists paths lessloc leaves alone: writes there are never refused, and the review skips them. Files marked `@generated`, dependency and build folders, and lockfiles are skipped already.

**Mode.** `"mode"` is `"block"` (default: the gate refuses and asks), `"warn"` (nothing is refused or sent for approval; notes and the end-of-turn review still run) or `"off"` (the agent hooks do nothing in this repository. lessloc is not off: the commit gate, `lessloc check` and CI still run, and only `lessloc remove` takes out the commit gate. Say this whenever you mention `"off"`, also as an option you did not use).

The other keys:

| Key | Default | Value |
|---|---|---|
| `setup` | none | the command that installs the dependencies, such as `"npm ci"`; `ci` runs it in the repository before the tests, `verify` in its clean checkout |
| `testTimeout` | `300` | seconds a run of `test`, `verify` or `ci` may take; it never limits the agent |
| `probe` | none | the agent command `lessloc probe` runs, such as `"claude -p --output-format json"` |
| `trailers` | `"off"` | `"verified"` or `"all"` adds commit trailers ([Set up the commit check and CI](#set-up-the-commit-check-and-ci)) |
| `boundaries` | `[]` | `{ "files", "mustNotImport", "why" }`: a path glob, a regular expression tested against added import lines (a literal dot is `\\.` in JSON), and an optional reason |
| `approvedDependencies` | `null` | a list of package names; a dependency added that is not listed holds the turn and fails `check` |
| `exceptions` | `[]` | `{ "path", "finding", "why" }`: findings the owner accepts ([Accept one finding](#accept-one-finding)) |
| `maxCommentRatio`, `maxNetLines`, `maxNewFiles`, `dupLines`, `instructionBudget` | `0.25`, `150`, `3`, `6`, `2000` | when the `comment-density`, `net-growth`, `new-files`, `copy` and `long-instructions` findings appear; `"maxNetLines": 0` turns that check off |

Path globs are relative to the repository's root and use `/`. `*` matches within one folder, `**` across folders, `?` one character, and a glob must match the whole path: `**/*.sql` matches SQL files anywhere.

### Turn a check off

Only when the user asks. Tell them what stays on, also when you mention a switch you do not use: `LESSLOC=off`, `LESSLOC_OFF`, `"mode"` and `interrupt` leave the git hooks, `lessloc check` and CI on. `allow` also applies to `check` and CI. `lessloc remove` takes out the commit gate.

| To turn off | Do this |
|---|---|
| lessloc in the agent, for a session | The user starts the agent tool with `LESSLOC=off`, as in `LESSLOC=off claude`. |
| single parts, for a session | The user starts the tool with `LESSLOC_OFF` and a comma-separated list, as in `LESSLOC_OFF=reuse,handoff claude`. |
| lessloc in the agent, for a project | `"mode": "off"` in `.lessloc.json` |
| refusals and approval prompts, for a project | `"mode": "warn"` in `.lessloc.json` |
| holds for some kinds | leave them out of `interrupt` in `.lessloc.json` |
| some paths | list them in `allow` in `.lessloc.json` |
| the commit gate, trailers and the AGENTS.md block | `lessloc remove` in the repository |

lessloc reads `.lessloc.json` again at every hook call, so `"mode": "off"` takes effect at the next tool call, in sessions that are already open, this one included; no new session is needed. To pause lessloc now, write `"mode": "off"` with your edit tool ([Configure it](#configure-it)); to turn it back on, set `"mode": "block"` or delete the key. `LESSLOC=off` and `LESSLOC_OFF` work from the environment the agent tool starts with, so they take effect only in a session started with them. Put in front of your own commands, they go to the user for approval.

| `LESSLOC_OFF` part | What it turns off |
|---|---|
| `rules` | the working standard at session start (the project's `protect` and `boundaries` lines stay) |
| `handoff` | the note about the last session's uncommitted work |
| `reuse` | the hints about existing code |
| `gate` | refusals and approval prompts before writes and commands |
| `lines` | the note right after a Write or Edit |
| `shell` | the same note after shell commands, patches and other tools |
| `review` | the whole end-of-turn review: no hold and no handoff record |
| `tests` | holding the turn for failed tests, or for a change to how the tests run |
| `requests` | the check that requested functions, options and flags exist |
| `unfinished` | the check of your last reply for part of the request it says still fails |
| `pace` | the one note in a turn that passes 40 tool calls |

### Accept one finding

When you are sent back for something you intended, say why in one line; an item held once is not held again in that session. When the user asks to accept a finding for good, put a comment with a reason on its line or the line above. A `lessloc-ignore <kind>: <reason>` comment suppresses that finding wherever lessloc reviews a change: the end-of-turn hold in every agent session, `check` and CI.

```python
try:
    import uvloop
    uvloop.install()
# lessloc-ignore swallowed-error: uvloop is an optional speedup
except Exception:
    pass
```

- The reason is required. Without a kind, `lessloc-ignore: <reason>` covers any finding on that line.
- It works only for findings tied to a line, and never for tier-0 findings. `check` still lists each suppression with its reason.
- An entry in `exceptions` in `.lessloc.json`, such as `{ "path": "scripts/debug_tool.py", "finding": "debug-leftover", "why": "the script exists to print" }`, accepts every matching finding under `path`, in the same places. It is the only way to accept a tier-0 finding. Add one only when the user asks, with your edit tool ([Configure it](#configure-it)). `finding` is a kind, or else a regular expression tested against the message; without `path`, the entry covers every file.
- What `check` shows: it reviews only the change, by default the working tree against HEAD, and line rules such as `debug-leftover` look only at the lines it adds. For a line already committed, `check` shows nothing, before or after; "1 accepted by exception" or "1 suppressed" appears only while a change adds such a line. Only tier-0 findings fail `check` (any finding with `--strict`), so accepting a tier-1 kind such as `debug-leftover` changes no exit code ([exceptions](/guide/configuration#exceptions)).
- `lessloc audit` lists the whole codebase as it is: exceptions and comments do not apply to it.
- Exceptions cannot accept `config`, `ratchet`, `tests-failed`, `unverified`, `unaddressed` or `unfinished`. Fix those at their source, or use `interrupt`, `LESSLOC_OFF=tests`, `LESSLOC_OFF=requests` or `LESSLOC_OFF=unfinished`.

### Set up the commit check and CI

**The commit gate.** `lessloc init` installs two hooks in this clone's `.git/hooks`: `pre-commit`, the commit gate, and `prepare-commit-msg`, the trailers hook. The trailers hook adds trailers only when `trailers` is set, and with any setting prints a note when a commit message lists five or more files one by one. Git never pushes that folder, so each clone runs `init` once. The gate runs `check --staged --gate`: it prints nothing when the commit may go ahead, and otherwise `Not committed. Fix these first:` with what blocks it. Only tier-0 findings block a commit: `placeholder`, `commented-out`, `junk-file`, `secret`, `boundary` and `dependency`. If the repository's hooks are shared or hand-written (husky, `core.hooksPath`), `init` leaves them alone and prints `add to <file>: <line>`; tell the user.

To see what the gate sees, run `lessloc check --staged`. To see everything since the branch left main, run `lessloc check --base origin/main`. It reviews the working tree without the ratchet, so it is not what CI checks: **A stricter job**, below, says how to run CI's check locally.

**CI.** `lessloc init --ci` writes `.github/workflows/lessloc.yml`, if it does not exist:

```yaml
name: lessloc
on: [pull_request]
permissions:
  contents: read
jobs:
  lessloc:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npx --yes lessloc@<version> ci --base "origin/$GITHUB_BASE_REF"
```

- `<version>` is the version that wrote the file; npm serves exactly that version. `LESSLOC_SOURCE` set when running `init --ci` installs from elsewhere, such as a fork.
- Keep `permissions: contents: read`, `persist-credentials: false` and the `pull_request` trigger: `lessloc ci` runs the pull request's own setup and tests. Never change the trigger to `pull_request_target`.
- If the tests need a toolchain, services or dependencies, add those steps before the lessloc step, and put the install command in `setup` in `.lessloc.json`, with your edit tool ([Configure it](#configure-it)).
- Tell the user to commit the file and make the lessloc job a required status check, so a pull request cannot merge while it fails.
- `protect` does not reach pull requests: `check` and CI ignore it. For review of changes to `.github/workflows/` and `.lessloc.json` in pull requests, the user sets up CODEOWNERS with "Require review from Code Owners" in branch protection.
- Other CI services run `npx --yes lessloc@<version> ci --base origin/main` in a clone with the base branch and its history.

`lessloc ci` runs `setup` when it is set, then the tests, then `check --base <ref> --ratchet --require-evidence` (`--require-evidence` only when there is a test command), and fails when any of them fails. Without `--base`, the base is `origin/$GITHUB_BASE_REF` on a GitHub pull request, and `HEAD~1` anywhere else.

The check in `ci` fails only on tier-0 findings: `placeholder`, `commented-out`, `junk-file`, `secret`, `boundary`, `dependency`, `config`, `unverified` (no passing test run for the commit) and `ratchet` against a committed baseline that this lessloc version recorded. Every other finding, such as `empty-test`, `swallowed-error`, or `weakened-tests` (tier 0 only in a session), is a warning or notice on the pull request and does not fail it. What holds your turn in a session is another list, `interrupt`.

**The ratchet.** By default, `ci` compares each change with its base commit, and a worse measure is a warning. For a fixed line, `lessloc baseline` writes `.lessloc-baseline.json`; committed, a worse measure fails the check. It refuses to record a worse measure without `--allow-worse "<why>"`.

**A stricter job.** `ci --strict` fails on every finding it reports. To make the workflow strict, add `--strict` at the end of its `run:` line with your edit tool. Then every `ratchet` finding fails the job too, also a worse measure against the base commit, which is otherwise a warning. `exceptions` and `lessloc-ignore` cannot accept a `ratchet` finding: fix the measure (`lessloc audit` shows where), or the user accepts the new value in a baseline and commits `.lessloc-baseline.json` (`lessloc baseline` when there is none, `lessloc baseline --allow-worse "<why>"` when there is one); from then on a worse measure fails the job without `--strict` too. A finding below tier 0 that is tied to a line can take a `lessloc-ignore <kind>: <reason>` comment, which you may add when the user asks; only a tier-0 finding needs the owner's `exceptions` entry ([Accept one finding](#accept-one-finding)). To run the job's check locally, with the work committed and after `git fetch origin`, run `lessloc ci --base origin/main` with the flags of the workflow's `run:` line, such as `--strict`: like the job, it runs `setup` and the tests, then checks the committed state with the ratchet. `lessloc check --base origin/main --strict` is not the same: it reviews the working tree and leaves the ratchet out.

**Trailers.** With `"trailers": "verified"`, each commit made through the hooks gets a line such as `Lessloc-Verified: tests passed at this exact state (clean checkout)`. `"all"` adds `Lessloc-Open:` and `Lessloc-Unchecked:` lines. A pass counts for one exact state: stage the change and run `lessloc verify` before committing.

### Update lessloc

```sh
git -C ~/.lessloc pull --ff-only
node ~/.lessloc/lessloc.mjs doctor
```

- The pull updates the clone in `~/.lessloc`. Every hook event starts `~/.lessloc/hook.mjs` afresh: the hooks that `init` wrote in the home folder run it, directly or through lessloc's plugin, and Claude Code reads the plugin that install.md added from that folder too (`claude plugin list` shows `Read from: ~/.lessloc`). So the pull updates the code every hook runs.
- The pull does not change what `init` wrote into a tool's own files: lessloc's hook entries (which events and tool calls run it), and the copy of the working standard for Junie, goose, Crush and Aider. In the repository, run `init` again with the flag of each tool whose `doctor` line reads `set up (<path>)`, such as `node ~/.lessloc/lessloc.mjs init --codex --gemini` (the flags are in the [install table](#install-lessloc)); lessloc replaces its own entries with the current ones. Claude Code's plugin, `set up (Claude Code plugin)`, needs no step: a new session reads its hook list from `~/.lessloc`.
- If `~/.lessloc` does not exist, there is no clone to pull and no `doctor` to run: lessloc came as a plugin its tool installed. For Claude Code (`claude plugin list` shows `lessloc@lessloc`), run:

  ```sh
  claude plugin marketplace update lessloc
  claude plugin update lessloc@lessloc
  ```
- Any other plugin or extension that a tool installed itself (`doctor` lists it as `set up (Codex plugin)`, `(Cursor plugin)`, `(Copilot plugin)`, `(Gemini CLI extension)`, `(Qwen Code extension)` or `(Pi package)`) belongs to that tool. These pages give no update step for it: tell the user so, and do not guess one.
- `doctor` shows no versions. `lessloc version` prints the clone's, and `claude plugin list` shows the Claude Code plugin's.
- Act on `doctor`'s lines as in [Check that it works](#check-that-it-works). Two come from a version change. For `AGENTS.md holds the rules of an earlier lessloc`, run `lessloc init --rules` with the user's agreement. For `ratchet baseline is from lessloc <version>`, a baseline recorded by another version only informs: the user reviews the difference, then runs `lessloc baseline` to record it again.
- Then tell the user to start a new session in each tool. Each hook runs lessloc from `~/.lessloc`, so open sessions run the new code from their next hook, but they keep the hooks they loaded at start (which events call lessloc and, in OpenCode, Kilo Code, Amp, Cline and Pi, lessloc's plugin) until a new session loads the current ones.

### Remove lessloc

Run in each repository where `init` ran:

```sh
node ~/.lessloc/lessloc.mjs remove            # this clone: git hooks, lessloc's AGENTS.md block if there is one, lessloc's own files for this checkout
node ~/.lessloc/lessloc.mjs remove --agents   # also every agent tool's hooks, for all projects
```

Tell the user only what the output lists as removed: an AGENTS.md block, for example, exists only where `init --rules` ran.

| The output says | Do this |
|---|---|
| `removed: ...` | Nothing. Settings files are given back as they were. |
| `kept, because they are shared with the team: ...` | Delete them only if the user asks. |
| `installed by the tool itself, so remove it there: ...` | Run the commands it gives. Where it names a step in a tool's settings, tell the user. |
| `not removed: ...` (exit code 1) | The file has comments or is not a JSON object. Tell the user which entries to take out by hand. |
| `nothing of lessloc's to remove` | Nothing. |

- Outside a repository, `remove --agents` takes out only the agent tools' hooks. A tool's flag, such as `remove --codex`, takes out that tool only.
- For Claude Code, the commands are `claude plugin uninstall lessloc@lessloc` and `claude plugin marketplace remove lessloc`.
- For the Copilot cloud agent, `remove --copilot --repo` takes lessloc out of `.github/hooks/review.json`.
- The `@AGENTS.md` line that `init --rules` may have added to CLAUDE.md stays; delete it if the user wants.
- Do not delete `~/.cache/lessloc` or `~/.lessloc` from this session. An agent tool registers its hooks when a session starts, and the session keeps running them until it ends, so this session, and any other agent session that is open, keeps running lessloc's hooks, and they write lessloc's folder in `~/.cache/lessloc` again, even right after `remove` deleted it. Tell the user to close those sessions and then run `rm -rf ~/.cache/lessloc ~/.lessloc`, or to ask for it in a new session. That deletes what lessloc stored outside the repositories; nothing trims that folder once lessloc is gone.
- The snapshots lessloc's hooks took stay in each repository's `.git/objects` as unreachable git objects: copies of the working tree, untracked files that git does not ignore included. `remove` and the `rm -rf` leave them. Git never pushes them, and `git gc` prunes them once they are older than `gc.pruneExpire`, two weeks by default. To delete them now, the user runs `git gc --prune=now` in each repository after every agent session has ended, or asks for it in a new session; it also deletes the repository's other unreachable objects, such as a dropped stash. Tell the user this instead of saying that nothing of lessloc remains.
- If you offer to pause lessloc instead of removing it, say what stays on: `"mode": "off"` in `.lessloc.json`, or `LESSLOC=off` in the environment the agent tool starts with, silences only the agent hooks; the commit gate still checks and refuses commits, and `lessloc check` and CI still run ([Turn a check off](#turn-a-check-off)).

### Troubleshoot

#### Hooks do not run

Run `lessloc doctor` in the repository, then check these in order:

1. **A new session.** An agent tool registers its hooks when a session starts, so the session that installed lessloc runs without it.
2. **The tool's one-time step.** In Claude Code, `claude plugin list` must show `lessloc@lessloc` with `Status: ✔ enabled`; if it is disabled, `claude plugin enable lessloc@lessloc` with the user's agreement; `✘ failed to load` means the folder it was added from is gone (item 5). Codex runs new hooks only after the user trusts them: `/hooks` in Codex. Cline's VS Code extension runs hook files only with "Enable Hooks" on: Cline settings, Feature Settings. Amp needs `plugins: reload` (Ctrl+O), Pi `/reload`, and Gemini CLI, OpenCode 1.x and Kilo Code a restart.
3. **A switch.** `LESSLOC=off` in the environment the tool starts with, or `"mode": "off"` in `.lessloc.json`, turns every agent hook off. `LESSLOC_OFF` is not a cause: it turns single parts off, and the hooks still run and show in `doctor`.
4. **Node.** Every hook starts `node`. Node 20 or newer must be on the PATH the agent tool uses, not only in your shell.
5. **The clone.** The hooks, and Claude Code's plugin, run lessloc from `~/.lessloc`. If `ls ~/.lessloc/hook.mjs` fails, put the clone back there: move it back, or clone it again with `git clone --depth 1 https://github.com/rextail-ai/lessloc ~/.lessloc`, then start a new session. While it is missing, `claude plugin list` shows `lessloc@lessloc` as `✘ failed to load`, and `init` run from another folder does not re-point the Claude Code plugin.
6. **Errors.** A `hook error(s)` line names the latest one; the rest are in `errors.log` in this checkout's folder in the user cache, `~/.cache/lessloc/<repo>-<id>/errors.log`, the folder `doctor` prints as `lessloc's own files`, not in `~/.lessloc`. `LESSLOC_DEBUG=1` prints them on the hook's stderr as they happen; an agent the user built shows them only if it passes the hook's stderr through.
7. **Where the tool reads hooks.** Kiro's IDE reads none of them, only its CLI. Junie runs hooks only in its CLI's Early Access build. OpenHands skips them in a repository with its own `.openhands/hooks.json`. A `crushrc` that sets hooks may hide Crush's entry.

#### Node without its startup snapshot

Some Linux distribution packages build Node without its startup snapshot, and such a Node starts several times slower. Every hook starts `node`: the first one on the PATH the agent tool started with. `doctor` tests the Node that runs it.

1. **Install Node from nodejs.org, or with a version manager such as nvm or fnm.** If the user asked you to fix the warning, install it with nvm or fnm yourself; neither needs root. Otherwise tell the user.
2. **Make it the first `node` on the PATH.** In a new terminal, `command -v node` prints the new Node's path, and `node -p process.config.variables.node_use_node_snapshot` does not print `false`.
3. **Restart the agent tool**, a terminal tool from a new terminal. A running tool keeps the PATH it started with, so a new session inside it still runs the old Node.
4. **Check.** `lessloc doctor`, run in the restarted tool, no longer prints the line. The per-event medians at its end do not include Node's start, so they do not show the gain; `time node -e 0`, run before and after, does.

#### The agent was held for nothing

1. **Find out why.** The session's journal is `sessions/<session>.log` in lessloc's folder, the one `doctor` prints. It has one `held` line per item, with its kind and, for the tests and the reply, the reason: `failed` or `redefined`, `admitted` or `suspected`.
2. **Choose what holds.** Leave the kind out of `interrupt` in `.lessloc.json`.
3. **Accept one case for good.** For a finding about code: an `exceptions` entry with a `why`, or a `lessloc-ignore <kind>: <reason>` comment. Holds about the tests, requested names and your reply are not affected by these; use `interrupt`, `LESSLOC_OFF=tests`, `LESSLOC_OFF=requests` or `LESSLOC_OFF=unfinished`.
4. **Report it** at https://github.com/rextail-ai/lessloc/issues, with the command you ran and what you were told, and nothing private.

#### Platforms and tools lessloc cannot hook

| Where | What does not work | Tell the user |
|---|---|---|
| Node older than 20, or no git | lessloc does not work | lessloc needs Node 20 or newer and git; they install them, not you |
| Windows, Cursor's plugin | its hooks run a shell script | use `init --cursor` instead |
| Windows, Cline's VS Code extension | it runs `.ps1` hook files, which `init --cline` does not write | Cline's hooks do not run there |
| Windows, Augment | it runs only `.ps1`, `.cmd` and `.bat` hooks, which `init --augment` does not write | Augment's hooks do not run there |
| Windows, Aider | the lint command is a shell script | `init --aider` does not work there |
| Kiro's IDE, Junie's IDE plugin, OpenHands Cloud | they do not read the user-level hooks | use the tool's CLI, or rely on the commit gate and CI |
| Zed, Warp, Continue, JetBrains AI Assistant, Roo Code | no hooks lessloc can install | offer `init --rules`, the commit gate and CI; Continue and Zed differ, as the note under [Install lessloc](#install-lessloc) says |

`lessloc check` and CI work whatever the agent tool.

### Connect their own agent

An agent the user builds runs, once per event, in the session's working directory:

```sh
node ~/.lessloc/hook.mjs --host generic
```

The agent writes one JSON object to its stdin, closes it, and reads one JSON object from its stdout. Empty output means there is nothing to do. The field names follow Claude Code's hooks:

| Event | The agent sends | The agent does with the answer |
|---|---|---|
| every event | `hook_event_name`, `session_id`, `cwd`, and `caps: {"ask": true}` when it can put a decision to the user | |
| `SessionStart` | `source`: `startup`, `resume`, `clear` or `compact` | adds `context` to the system prompt: the working standard (left out when `init --rules` put it in AGENTS.md, which the agent must then load), the project's rules and a note on work the last session left open |
| `UserPromptSubmit` | `prompt`: the user's message | adds `context` to that message: usually empty, hints about existing code when the prompt names it |
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id` | `deny`: does not run the call, and returns the text as its error. `ask` (only with `caps.ask`): asks the user. `input` (for `agent`): runs the call with this input instead |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_use_id`, `tool_response`: `{exit_code, output}` | appends `feedback` to the result the model sees, never replacing it |
| `PostToolUseFailure` | `error`, `is_interrupt` | |
| `Stop` | `last_assistant_message`: the final reply, `stop_hook_active`, and `status`: `completed`, or how the turn ended otherwise | `block`: does not end the turn, sends the text as the agent's next message, then sends the next `Stop` with `stop_hook_active: true` |

`tool_name` is one of `write`, `edit`, `patch`, `shell`, `delete` and `agent`, and `tool_input` has exactly the keys of its shape: `write` `{path, content}`, `edit` `{path, old_string, new_string}`, `patch` `{patch}`, `shell` `{command, workdir}`, `delete` `{path}`, `agent` `{prompt}`. The integration converts its tools' own argument names to these, for example `cmd` → `command` and `old_str`/`new_str` → `old_string`/`new_string`, and converts an `input` answer back. Other keys fail silently: a write is not checked before it runs, and a shell command is read as an empty command, so what it changed and its test run go unseen. lessloc needs `tool_use_id` to pair a call's two events and track what a shell command or patch changed. lessloc reads what a turn changed from the files on disk, by comparing snapshots of the working tree taken at the turn's start, around tool calls and at `Stop`; `tool_input` names the file a write is about, and lets lessloc refuse the call before it runs. A test run's result comes from `tool_response`. So a test of the integration must go through the agent's own tool wrapper with its tools' real arguments, not hand-written payloads, and must really run the tool between `PreToolUse` and `PostToolUse`: a stubbed write changes nothing on disk, and the turn gets no note and no `block`. Every text in the answer except `ask` is written for the model. Hook errors go to `errors.log` in the checkout's folder in the user cache, `~/.cache/lessloc/<repo>-<id>/errors.log`, never into `~/.lessloc`. `lessloc doctor` shows them and prints that folder as `lessloc's own files`. `LESSLOC_DEBUG=1` prints them on the hook's stderr, so a wrapper that captures the hook's output must pass stderr through for them to show. Read [Custom agents and SDKs](/guide/any-agent) before writing the integration: it has each `tool_input` shape in full, the timeouts, a reference loop and [how to test the integration](/guide/any-agent#checking-your-integration) against the real hook.

The Claude Agent SDK loads `~/.lessloc` as a plugin, by absolute path. The Codex SDK uses the hooks from `init --codex`. The OpenAI Agents SDK connects through the protocol, at the points [Custom agents and SDKs](/guide/any-agent#openai-agents-sdk) lists.

When the integration is done, tell the user how to disconnect it, and never say that `remove` undoes everything:

1. Take the hook calls, and any tests of them, out of the agent's code.
2. Run `node ~/.lessloc/lessloc.mjs remove` in each repository where `init` ran. It takes lessloc out of that clone's git hooks, and out of AGENTS.md where `init --rules` ran, and deletes only that checkout's folder in the user cache.
3. Once no agent session runs, `rm -rf ~/.cache/lessloc ~/.lessloc` deletes the clone and lessloc's folders for every other repository the agent worked in, with their shortened copies of the user's prompts. If another agent tool still uses lessloc, take it out there first ([Remove lessloc](#remove-lessloc)).
4. The snapshots of the working tree stay in each repository's `.git/objects`, never pushed, until `git gc` prunes them.

## Reference

### Commands

Run `lessloc` with no command to print the usage. A command that cannot start prints why and exits with 2, such as `check`, `verify`, `ci`, `init` and `remove` outside a git repository.

| Command | Flags | What it does |
|---|---|---|
| `find <words>` | | up to 15 existing definitions whose names match, best first; works outside a git repository |
| `audit [dir]` | `--json`, `--tools` | the whole codebase: copies, dead code, junk, comment weight, structure |
| `check` | `--staged` or `--base <ref>`, `--ratchet`, `--require-evidence`, `--strict`, `--json`, `--github`, `--all` | reviews a change, by default the working tree against `HEAD`; exits with 1 when a tier-0 finding remains |
| `test [-- <command>]` | | runs the test command with compact output, and records a run of the project's test command for this exact state |
| `verify [<rev>]` | | runs the tests on a clean checkout, by default of the staged state; prints `verified:` or `NOT verified:` |
| `ci` | `--base <ref>`, `--strict` | `setup` when it is set, the tests, then `check --base <ref> --ratchet --require-evidence` (`--require-evidence` only when there is a test command); the base defaults to `origin/$GITHUB_BASE_REF` on a GitHub pull request, otherwise `HEAD~1` |
| `probe --task <behavior> [<rev>]` | | asks a fresh agent, the `probe` command, where a behavior lives; each run is a paid agent session |
| `baseline` | `--allow-worse <why>` | writes `.lessloc-baseline.json` |
| `doctor` | | whether lessloc works here, and what each hook costs |
| `init` | `--rules`, `--config`, `--baseline`, `--ci`, `--agents`, a tool flag, `--repo` with `--copilot` | the commit gate for this clone, and lists the agent tools; shared files and tool hooks only with their flags |
| `remove` | `--agents`, a tool flag, `--repo` with `--copilot` or `--agents` | undoes `init` for this clone, and takes out the hooks of the tools named |
| `hosts` | `--markdown`, `--write` | each agent tool: how it installs and what was verified live |
| `catalog` | `--write` | the pattern catalog's tables |
| `version` | | the version |

The tool flags are `--codex`, `--cursor`, `--opencode`, `--kilo`, `--amp`, `--cline`, `--pi`, `--copilot`, `--gemini`, `--qwen`, `--droid`, `--augment`, `--kiro`, `--junie`, `--openhands`, `--goose`, `--devin`, `--crush`, `--antigravity` and `--aider`. The git hooks run `check --staged --gate` and `trailers <message-file> [<source>]`; you do not.

### Files lessloc writes

In the repository. Nothing goes into the working tree unless the user asks:

| File | What writes it |
|---|---|
| `.git/hooks/pre-commit`, `.git/hooks/prepare-commit-msg` | `init`; never pushed |
| `.git/objects` | the hooks, `check`, `test`, `verify` and `probe`: snapshots of the working tree, untracked files that git does not ignore included (over 1 MB skipped; environment and key files such as `.env`, `*.pem` and `id_rsa` go in with their lines blanked), as unreachable objects that `git gc` prunes and `remove` leaves; never pushed |
| `AGENTS.md`, between `<!-- lessloc -->` markers, and an `@AGENTS.md` line in an existing CLAUDE.md | `init --rules` |
| `.lessloc.json` | `init --config` |
| `.lessloc-baseline.json` | `init --baseline`, `baseline` |
| `.github/workflows/lessloc.yml` | `init --ci` |
| `.github/hooks/review.json` | `init --copilot --repo` |
| `Lessloc-Verified`, `Lessloc-Open`, `Lessloc-Unchecked` commit trailers | `prepare-commit-msg`, only when `trailers` is set |

In the user cache, one folder per checkout: `~/.cache/lessloc/<repo>-<id>/`. It holds `sessions/<session>.log` (each session's journal: files touched, approvals asked, notes given, turns held), `sessions/<session>.json`, `ledger/<session>.json` (the handoff record), `evidence/<tree>.json` (test results per exact tree), `errors.log`, `cost.log` and `staged.json`. Beside the checkout folders, `originals.json` keeps what each agent tool's settings file held before `init`, so `remove` can give it back. None of it is shared with the team. Session state and handoff records keep a shortened copy of the user's prompts. The whole folder is readable by the user alone: lessloc creates it, and each checkout's folder, with mode 700 ([In your user cache](/guide/reference#in-your-user-cache)).

In the home folder: the files in the [install table](#install-lessloc). In the system's temporary folder: clean checkouts (`lessloc-checkout-*`), `doctor`'s test folders (`lessloc-doctor-*`) and one folder per process for short-lived files (`lessloc-tmp-*`), each readable by the user alone and removed when the command ends.

### Environment variables

| Variable | Effect |
|---|---|
| `LESSLOC=off` | every agent hook does nothing |
| `LESSLOC_OFF` | turns single parts off, comma-separated; the hooks still run |
| `LESSLOC_STATE` | the folder lessloc keeps its files in, instead of the user cache |
| `LESSLOC_DEBUG=1` | prints hook errors on the hook's stderr as they happen |
| `LESSLOC_PROFILE=1` | prints each detector's time |
| `LESSLOC_SOURCE` | where the workflow from `init --ci` installs lessloc from |
| `XDG_CACHE_HOME`, `LOCALAPPDATA` | the user cache that lessloc's folder goes in |
| `XDG_CONFIG_HOME` | replaces `~/.config` for the files `init --opencode`, `--kilo`, `--amp`, `--goose`, `--crush` and `--aider` write there (not `--devin`) |
| `CODEX_HOME`, `COPILOT_HOME`, `CLINE_DIR`, `PI_CODING_AGENT_DIR`, `CRUSH_GLOBAL_CONFIG`, `OH_PERSISTENCE_DIR`, `CLAUDE_CONFIG_DIR` | where each tool keeps its settings, as the tool reads it |
| `GITHUB_ACTIONS=true` | `check` prints GitHub annotations |
| `GITHUB_BASE_REF` | the branch `ci` compares with when no `--base` is given |

## Read more

- [llms-full.txt](/llms-full.txt): the docs in one plain-text file, and [llms-patterns.txt](/llms-patterns.txt): the pattern pages, one per kind of finding.
- [llms.txt](/llms.txt): the list of pages. Each page is also plain Markdown at its own address plus `.md`.
- The pages behind this one: [Getting started](/guide/getting-started), [How it works](/guide/how-it-works), [Configuration](/guide/configuration), [Commits and CI](/guide/ci), [Reference](/guide/reference), [FAQ](/guide/faq) and [Custom agents and SDKs](/guide/any-agent).
