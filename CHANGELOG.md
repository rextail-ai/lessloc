# Changelog

Every release of lessloc, newest first. Versions follow [Semantic Versioning](https://semver.org).

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
