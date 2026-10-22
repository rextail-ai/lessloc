# Changelog

Every release of lessloc, newest first. Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Safer by default

- The CI workflow from `init --ci` installs lessloc from npm at exactly the version that wrote it, a version no one can republish. Its token can only read the repository, the checkout keeps no credentials, and the base branch reaches the command as a variable. To get it in a repository that has the earlier file, delete `.github/workflows/lessloc.yml` and run `lessloc init --ci` again.
- The setup step that `init --copilot --repo` prints for Copilot's cloud agent installs lessloc from npm at exactly that version, checked against the registry's hash.
- Snapshots keep the content of untracked environment and key files (`.env`, `.env.<name>`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`) out of `.git/objects`, and a new `.env`, or a private key in a new file, is still reported.
- lessloc's state, with its shortened copies of your prompts, is readable by your user alone, and so is each process's folder of temporary files.
- A settings file lessloc updates for an agent tool keeps its permissions, and a symlinked one stays a symlink.
- ruff runs with its fixes turned off, whatever the repository's ruff settings say, and every file name reaches it as a file name.
- On Windows, the programs lessloc starts itself (git, ruff, python3, cargo, node) always come from where they are installed, never from the repository's folder.
- Reviews stay fast on lines built to slow them down (long runs of escaped quotes or of `}else{`, `catch` clauses that never close, long banner and comment lines, SEARCH/REPLACE edits that never close), and so does reading a prompt with a long run of paths after a command.
- Each detector runs on its own, so one that meets unexpected code never stops the others, the credential check included. An invalid `mustNotImport` pattern in `.lessloc.json` is reported as a settings problem.
- The approval asked before a command that skips the project's checks covers more forms: `git -C <dir>` and other options before the command, a shortened `--no-verify`, and `core.hooksPath`.
- `audit --tools` runs knip from `node_modules` only when it was installed there, never from a `node_modules` committed to the repository.
- `init` sets up hooks only from a lessloc folder whose path its hook commands can quote: one without `"`, `$` or `` ` ``, and outside Windows without `\`.
- Releases go to npm through trusted publishing with provenance, and only from a commit on `main`.
- `init --ci` and `init --config` write their file only where nothing is, in one step: a file or a symlink already in its place is left as it is, and nothing is written through it. lessloc's own git hooks and `CLAUDE.md` are each read and written through one open file, and one that lessloc cannot write is left as it is, with the line to add shown when it lacks it.

### More accurate

- PHPUnit's and .NET's verdict lines count only at the start of a line, so one quoted inside a test name or a log line is not read as a failed run.
- A turn goes on through prompt events that bring no new request: Claude Code's notice that a background task or subagent ended, the event Qwen Code sends for the same prompt after each batch of tool calls, and a held turn that Gemini CLI sends back as a prompt. The turn is still held at most once, and the next session hears the session's last reply. Gemini CLI's request is read without the session start text it puts in front.

### Works in more tools

- Tested end to end: Claude Code 2.1.306, Codex 0.163.0 (`init --codex`) and OpenCode 2.1.2, each set up the documented way, work through one scripted session against a local model, and the standard, the hints, the gate, the note after a write, the agent's test runs, the held turn and the handoff each reach the agent or the record. `npm test` replays each session's recorded hook calls offline, and the status table names the version each tool was tested on.
- GitHub Copilot CLI: the agent's test runs are read from the exit code the CLI gives after a command's output.
- Junie: the hooks work in the project the payload names in `project_path`.
- Antigravity CLI: its own file tools, `write_file` and `edit_file`, are gated and tracked, and a turn it ends normally is reviewed.
- Cline CLI and SDK: the plugin file from `init --cline` imports lessloc in the form Cline loads. `doctor` points out a plugin file written by an earlier lessloc; run `lessloc init --cline` again to replace it.

## [0.10.0]

The first public release.

### For your agent, while it works

- At session start: the working standard (RULES.md) and the project's own rules from `.lessloc.json`. In Claude Code, each subagent gets a one-line standard.
- With each prompt, and inside each subagent's prompt: the existing code whose names match the request.
- Before each write, a gate. It refuses placeholders, commented-out code and backup, copy, scratch or report files, in shell heredocs too. It asks you before an edit to `.lessloc.json` or a protected path, and before a command that skips the project's checks (`--no-verify`, `HUSKY=0`, `LESSLOC=off`).
- Right after a write: one plain line for each problem that is cheapest to fix while the code is open: a credential, a swallowed error or a forbidden import.
- At the end of a turn: a review of exactly what this session changed. The turn is held once with what is unfinished: copies of existing code, stubs, debug leftovers, weakened tests, silenced checks, unsafe shortcuts, calls and packages that do not exist, behavior without a test, a broken project policy, tests that fail on the final state or a change to how they run, a requested name that appears nowhere, or a reply saying part of the reported problem still fails. The agent does not see the rest; the handoff keeps the five most severe findings on files.
- The agent's own test runs, as its tool reports them, are the evidence for the exact tree. The hooks never run your tests.
- A turn that reaches 40 tool calls is told once to finish what works and say what is left.
- The next session in the checkout hears the last one's uncommitted work, what was verified and what was left open.
- Nothing the agent reads names lessloc, shows its paths or commands, tags a finding kind or cites a source.

### For commits, CI and the whole codebase

- `lessloc init`: git hooks for this clone only, meaning a commit gate on tier-0 findings plus commit trailers when the team turns them on. `--rules`, `--config`, `--baseline` and `--ci` write shared files, but only when you ask. `remove` undoes all of it.
- `check`, `test`, `verify` (on a clean checkout of the exact state), `ci` (setup, tests, then the check with the ratchet), `baseline`, and annotations in GitHub Actions.
- `audit`, `find`, `probe`, `doctor`, `catalog` and `hosts`.
- `.lessloc.json` holds the test command, protected paths, boundaries, approved dependencies and exceptions. `LESSLOC=off` turns lessloc off, and `LESSLOC_OFF` turns off single components.

### The pattern catalog

- 92 patterns of AI coding agents in 12 groups, each with the standard that calls it bad, reported as 68 finding kinds ([PATTERNS.md](https://github.com/rextail-ai/lessloc/blob/main/PATTERNS.md)). A test proves every detected pattern.

### Agent tools

- Claude Code plugin, verified live on 2.1.303.
- Codex: `init --codex`, verified live on 0.163, and the Codex plugin, with the same hooks.
- OpenCode 2.x: `init --opencode`, verified live on 2.0.10.
- Tested against each tool's documented payloads: Cursor, OpenCode 1.x, Kilo Code, Amp, Cline, Pi, GitHub Copilot CLI and VS Code agent mode, the Copilot cloud agent, Gemini CLI, Qwen Code, Factory Droid, Augment, Kiro CLI, Junie CLI, OpenHands, goose, Devin CLI, Crush, Antigravity and Aider.
- A hook protocol for custom agents and SDKs, and `init --rules` for tools without hooks.
- The `/lessloc` skill in Claude Code and Codex: setup, audit, review, consolidate and find.

### Requirements

Node 20 or newer, and git. No dependencies, no network calls.

[0.10.0]: https://github.com/rextail-ai/lessloc/releases/tag/v0.10.0
