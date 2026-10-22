---
title: "lessloc CLI reference: commands, flags and finding kinds"
---

# Reference

Every command and flag, every finding kind, every file lessloc writes, and the environment variables it reads. Here `lessloc` stands for `node ~/.lessloc/lessloc.mjs` ([Getting started](/guide/getting-started)). Run it with no command to print the usage.

## Commands

| Command | Use |
|---|---|
| [`find`](#find) | existing definitions for a task, by name |
| [`audit`](#audit) | the whole codebase: copies, dead code, junk, comment weight, structure |
| [`check`](#check) | review a change; tier-0 findings fail it |
| [`test`](#test) | run the tests with compact output, recorded for this exact state |
| [`verify`](#verify) | run the tests on a clean checkout of a commit |
| [`ci`](#ci) | setup, tests, then `check` with the ratchet and required evidence |
| [`probe`](#probe) | ask a fresh agent where a behavior lives |
| [`baseline`](#baseline) | record a fixed line for the ratchet |
| [`doctor`](#doctor) | is lessloc working here, and what does it cost |
| [`init`](#init) | set up this clone, shared files on request, and agent tools' hooks |
| [`remove`](#remove) | undo `init` and delete lessloc's own files |
| [`catalog`](#catalog) | the pattern catalog's tables |
| [`hosts`](#hosts) | each agent tool: how it installs and how it was tested |
| [`version`](#version) | print the version |

A command that cannot start prints why and exits with 2: for example `check`, `verify`, `ci`, `init` and `remove` outside a git repository, `test` and `verify` without a test command, or `probe` without a `probe` command.

### find

```sh
lessloc find <words>
```

Lists up to 15 existing definitions whose names match the words, best first, as `path:line  signature`, followed by the doc comment when there is one. It matches names and doc words, so search for other names too. Definitions are indexed for [these languages](/guide/faq#which-agent-tools-and-languages-does-it-support). Works outside a git repository too.

```sh
lessloc find round money
```

### audit

```sh
lessloc audit [dir] [--json] [--tools]
```

Reads the codebase under the folder `dir`, by default the current folder (the whole codebase when you run it at the repository's root), and lists:

- duplicate blocks, definitions with the same body under other names, and same-named functions in different files
- definitions nothing references, wrappers that only forward, swallowed errors
- commented-out code and placeholders, stubs and mock data, silenced checks, debug leftovers, comments that narrate, comment-heavy files
- backup, copy, scratch and report files, tiny files, single-entry folders, the largest files, paths deeper than 6 levels
- `shortcut:` markers (deliberate debt), and builds without a lockfile
- always-loaded instruction files and their tokens, lessloc's own overhead per hook, and whether the tests can be run
- how many files and folders a typical commit touches, which folders change together, and the number of test assertions

| Flag | Effect |
|---|---|
| `--json` | everything as JSON, with the ratchet's measures under `metrics` |
| `--tools` | also runs these analyzers, where installed: knip, vulture, cargo-machete and deadcode, and the vulnerability scanners osv-scanner, pip-audit, cargo-audit and govulncheck |

[The ratchet](/guide/ci#the-ratchet) lists the measures it keeps from getting worse.

### check

```sh
lessloc check [--staged | --base <ref>] [--ratchet] [--require-evidence] [--strict] [--json] [--github] [--all]
```

Reviews a change and prints its findings, ordered by tier. By default the change is the working tree, untracked files included, against `HEAD`.

| Flag | Effect |
|---|---|
| `--staged` | review the staged state against `HEAD`, as the pre-commit hook does |
| `--base <ref>` | review everything since the merge base of `<ref>` and `HEAD` |
| `--ratchet` | compare the codebase's measures with `.lessloc-baseline.json`, or, without that file, with the base commit of `--base`. A worse measure is a `ratchet` finding |
| `--require-evidence` | fail with a tier-0 `unverified` finding unless a passing test run is recorded for exactly this state |
| `--strict` | fail on any finding, not only on tier 0 |
| `--json` | print `summary`, `verified`, `unchecked`, `findings` and `suppressed` as JSON |
| `--github` | also print GitHub Actions annotations: tier 0 as errors, tier 1 as warnings, the rest and every suppression as notices. Automatic when `GITHUB_ACTIONS=true` |
| `--all` | print every finding, not only the first 15 |

How to read its output is under [Review a change](/guide/ci#review-a-change-lessloc-check). Which test runs count as evidence is under [Test evidence](/guide/ci#test-evidence). How hard a `ratchet` finding is depends on the line it is measured against ([the ratchet](/guide/ci#the-ratchet)).

Exit code: 1 when a tier-0 finding remains (any finding with `--strict`), otherwise 0.

### test

```sh
lessloc test [-- <command>]
```

Runs the project's test command with compact output: one summary line when it passes; when it fails, the failing parts and the end, at most 80 lines. A run of the project's test command is recorded as evidence for this exact working-tree state. After `--`, another command runs instead; it is recorded only if it is the project's test command. The run stops after `testTimeout` seconds. Exit code: the command's own, or 1 when it timed out.

### verify

```sh
lessloc verify [<rev>]
```

Runs the test command on a clean checkout of a commit, by default of the staged state. The checkout is a temporary git worktree, removed afterwards. With `setup` set, that runs first. Without it, your `node_modules`, `.venv` or `venv` are linked in, unless a lockfile differs from the commit's: then the installed dependencies may not match, so `verify` prints `NOT verified` and asks you to set `setup` (for example `npm ci`). The result is recorded for the commit's tree as a clean-checkout run.

It prints `verified:` or `NOT verified:`. Anything other than a pass, including a crash, a timeout or a failed setup, counts as not verified and exits with 1.

### ci

```sh
lessloc ci [--base <ref>] [--strict]
```

CI in one command: `setup` when it is set, then the tests, then `check --base <ref> --ratchet --require-evidence` on the commit. `--strict` passes on to the check, which then fails on any finding, `ratchet` findings included. [`lessloc ci`](/guide/ci#ci-in-one-command-lessloc-ci) explains each step, the base it picks, when it fails, and how to run the job's check on your machine.

### probe

```sh
lessloc probe --task <behavior> [<rev>]
```

Checks whether the next agent could find a change. Your `probe` command, a fresh agent with lessloc off, is asked in a clean checkout of `<rev>` (by default the staged state) where the behavior is implemented and what it would reuse. The probe passes when the answer names a code file that commit changed. It fails when the answer names none, when the agent did not run, or when it needed more than 8 turns. With JSON output, the turns and tokens come from its `num_turns` and `usage` fields.

Each probe starts a paid agent session. It needs `probe` in `.lessloc.json` ([Configuration](/guide/configuration#probe)).

### baseline

```sh
lessloc baseline [--allow-worse <why>]
```

Writes the codebase's current measures to `.lessloc-baseline.json`, with the lessloc version that measured them. [The ratchet](/guide/ci#the-ratchet) explains when a baseline helps, and how `--allow-worse` records a worse measure with a reason.

### doctor

```sh
lessloc doctor
```

Says whether lessloc works in this repository. Each check prints one line that starts with `✓` (works), `!` (needs attention) or `✗` (failed). It reports:

- the version of the Node that runs `doctor`, and whether it was built without its startup snapshot ([Requirements](/guide/getting-started#requirements) has the fix)
- the git repository, and the folder outside it where lessloc keeps its files
- whether `.lessloc.json` is valid, or that there is none and the defaults apply
- the test command, and whether it was discovered or set
- when a lessloc hook last ran in this repository
- hook errors, with the latest one
- whether the lessloc block in AGENTS.md is out of date, so that agents get two standards
- whether the git hooks are installed
- how the ratchet works here: against each change's base commit, or against a committed baseline
- for each hook event, over the last 2000 hook runs recorded in this repository: the median time of lessloc's own work, timed from after Node has started and loaded lessloc, so Node's start is not included; the median tokens it added; and how many of those runs were that event
- for each agent tool installed for your user: whether lessloc is set up there, whether it is set up twice (a tool's own plugin or extension and `init`), whether its installed hook command answers, and when that tool's hooks last ran in this repository. lessloc checks the command by running it once with a session start, in a temporary folder outside any repository: it must answer with the working standard, or, for a tool whose session start reaches no model, run without an error. Aider's lint command is run once on a file outside any repository, and must answer nothing. Tools that lessloc has no hooks for share one line

Exit code: 1 when a check failed.

### init

```sh
lessloc init [--rules] [--config] [--baseline] [--ci] [--agents] [--codex] [--cursor] [--opencode] [--kilo] [--amp] [--cline] [--pi] [--copilot] [--gemini] [--qwen] [--droid] [--augment] [--kiro] [--junie] [--openhands] [--goose] [--devin] [--crush] [--antigravity] [--aider] [--repo]
```

Without flags, `init` installs the commit gate (`pre-commit`) and the trailers hook (`prepare-commit-msg`) in this clone's git hooks folder. It writes only hook files that do not exist yet or that hold only lessloc's lines; for a shared or hand-written hook, it prints the line to add. It writes nothing into the working tree, and prints the test command and where lessloc keeps its files.

It also lists the agent tools installed for your user, under "Agent tools for this user". It finds a tool by its program on your PATH or its settings in your home folder; it starts nothing and makes no network call. It names the tool it runs in from the variable each tool sets for its agent's commands ([Environment variables](#environment-variables)). For each tool, it says whether lessloc is set up there and prints the command that sets it up. Without a tool flag or `--agents`, it changes none of the agent tools' files.

| Flag | Writes |
|---|---|
| `--rules` | the working standard in AGENTS.md, between `<!-- lessloc -->` and `<!-- /lessloc -->`, replacing an earlier block. Appends `@AGENTS.md` to a CLAUDE.md that does not import it |
| `--config` | `.lessloc.json` with the test command lessloc found, if the file does not exist |
| `--baseline` | `.lessloc-baseline.json`, if it does not exist |
| `--ci` | `.github/workflows/lessloc.yml`, if it does not exist: a workflow that runs `ci` on pull requests ([GitHub Actions](/guide/ci#github-actions)) |
| `--agents` | what each tool flag below writes, for each of those tools that is installed, except a tool already set up through its own plugin or extension. For Claude Code, it prints the `claude plugin` commands instead: lessloc never edits Claude Code's settings |
| `--codex` | lessloc's entries in `~/.codex/hooks.json` (`$CODEX_HOME/hooks.json`), for all your projects |
| `--cursor` | lessloc's entries in `~/.cursor/hooks.json`, for all your projects ([status](/guide/getting-started#supported-agent-tools)) |
| `--opencode` | the bridge plugin `~/.config/opencode/plugins/lessloc.js` (under `$XDG_CONFIG_HOME` when set), for OpenCode 1.x and 2.x in all your projects |
| `--gemini` | lessloc's entries under `hooks` in `~/.gemini/settings.json`, for all your projects. Gemini CLI's other settings stay as they are |
| `--copilot` | the hook file `~/.copilot/hooks/lessloc.json` (`$COPILOT_HOME/hooks/lessloc.json`), for Copilot CLI and VS Code's agent mode in all your projects |
| `--kilo` | the bridge plugin `~/.config/kilo/plugin/lessloc.js` (under `$XDG_CONFIG_HOME` when set), for Kilo Code's CLI and VS Code extension in all your projects |
| `--amp` | the bridge plugin `~/.config/amp/plugins/lessloc.js` (under `$XDG_CONFIG_HOME` when set), for all your projects |
| `--cline` | the bridge plugin `~/.cline/plugins/lessloc.js` (`$CLINE_DIR/plugins/lessloc.js`) for the Cline CLI and SDK, and five hook files in `~/Documents/Cline/Hooks/` for Cline's VS Code extension, for all your projects. If one of those hook files is your own, it writes none and says so |
| `--pi` | the extension `~/.pi/agent/extensions/lessloc.js` (`$PI_CODING_AGENT_DIR/extensions/lessloc.js`), for all your projects |
| `--qwen` | lessloc's entries under `hooks` in `~/.qwen/settings.json`, for all your projects. Qwen Code's other settings stay as they are |
| `--droid` | lessloc's entries in `~/.factory/hooks.json`, or under `hooks` in `~/.factory/settings.json` when Droid keeps your hooks there and the first file does not exist |
| `--augment` | lessloc's entries under `hooks` in `~/.augment/settings.json`, for Auggie and Augment's VS Code and IntelliJ extensions in all your projects. They run `augment/hook.sh` from your clone |
| `--kiro` | the hook file `~/.kiro/hooks/lessloc.json`, for Kiro's CLI in all your projects |
| `--junie` | lessloc's entries under `hooks` in `~/.junie/config.json`, and the working standard in `~/.junie/AGENTS.md` between `<!-- working-standard -->` markers |
| `--openhands` | lessloc's entries in `~/.openhands/hooks.json`, which OpenHands reads for repositories without their own `.openhands/hooks.json` |
| `--goose` | the plugin folder `~/.agents/plugins/review/`, and the working standard in `~/.config/goose/.goosehints` between `<!-- working-standard -->` markers (both under `$GOOSE_PATH_ROOT` when that is set, as goose reads them). A plugin of yours named `review` is left alone |
| `--devin` | lessloc's entries under `hooks` in `~/.config/devin/config.json` (under `$XDG_CONFIG_HOME` when that is set; `%APPDATA%\devin\config.json` on Windows), for all your projects |
| `--crush` | lessloc's entry under `hooks` in `~/.config/crush/crush.json` (`$CRUSH_GLOBAL_CONFIG/crush.json`), and the working standard in `~/.config/crush/CRUSH.md` between `<!-- working-standard -->` markers |
| `--antigravity` | a hook named `review` in `~/.gemini/config/hooks.json`, for Antigravity's app, CLI and IDE in all your projects. A hook of yours named `review` is left alone |
| `--aider` | a block in `~/.aider.conf.yml` between `# >>> lessloc` and `# <<< lessloc` lines, with `lint-cmd`, `read` and `git-commit-verify: true`, each only where you set no value; and the folder `~/.config/agent-standard/` with the lint command, `check`, and the working standard, `CONVENTIONS.md` |
| `--copilot --repo` | `.github/hooks/review.json` in the repository instead, for Copilot's cloud agent ([Copilot cloud agent](/guide/getting-started#copilot-cloud-agent)). Prints the setup step that gets lessloc for the cloud agent |

Running `init` again is safe. Hook files lessloc wrote are rewritten, its block in AGENTS.md, in a tool's rules file and in `~/.aider.conf.yml` is replaced, and its entries in the agent tools' hook files are replaced while everyone else's are kept. A tool's file keeps its own indentation. A file that has comments or is not a JSON object is left alone, and `init` says so and prints the entries to add by hand.

### remove

```sh
lessloc remove [--agents] [--codex] [--cursor] [--opencode] [--kilo] [--amp] [--cline] [--pi] [--copilot] [--gemini] [--qwen] [--droid] [--augment] [--kiro] [--junie] [--openhands] [--goose] [--devin] [--crush] [--antigravity] [--aider] [--repo]
```

In a repository, `remove` undoes `init` for this clone. It deletes:

- lessloc's lines in the git hooks, and the hook files that held nothing else
- the lessloc block in AGENTS.md, and the whole file when it held only that block
- lessloc's own files for this checkout, in your user cache

It keeps `.lessloc.json`, `.lessloc-baseline.json`, `.github/workflows/lessloc.yml` and `.github/hooks/review.json`, because they are shared with your team. It also keeps the `@AGENTS.md` line that `init --rules` may have added to CLAUDE.md; delete it by hand if you no longer want it.

A tool's flag takes lessloc out of that tool, for all your projects, and `--agents` out of every tool that `init` can set up. Outside a repository, these flags take out only the agent tools' hooks.

- A hook or settings file gets back the bytes it had before `init`, when nothing but lessloc's entries changed since. A file that `init` created is deleted. Otherwise everyone else's entries and settings stay, in the file's own indentation. lessloc keeps what each file held in `originals.json` in its user cache ([Files lessloc writes](#in-your-user-cache)).
- lessloc's plugin files, Cline hook files, goose's `review` plugin folder and Aider's `agent-standard` folder are deleted.
- lessloc's block comes out of a tool's rules file and out of `~/.aider.conf.yml`, and the file goes when it held nothing else.
- With `--repo`, `--copilot` and `--agents` take lessloc's entries out of `.github/hooks/review.json`.
- A file that has comments or is not a JSON object is left alone. `remove` names it on stderr, says which entries to take out by hand, and exits with 1.
- Plugins and extensions a tool installed itself are removed in that tool. `remove` prints how.

`remove` leaves the snapshots of the working tree in `.git/objects` ([In your repository](#in-your-repository)). They are unreachable objects that git never pushes, and `git gc` prunes them once they are older than `gc.pruneExpire` (two weeks by default). To delete them now, run `git gc --prune=now` in the repository after every agent session has ended; it also deletes the repository's other unreachable objects, such as a dropped stash.

lessloc trims its cache at the start of each agent session. Once you have removed lessloc everywhere, nothing runs that cleanup, so delete `~/.cache/lessloc` by hand, and the clone `~/.lessloc` with it. Do that only after every agent session that was open during the removal has ended, the one that ran `remove` included: an agent tool registers its hooks when a session starts, and the session keeps running them until it ends, so they write lessloc's folder in the cache again.

### catalog

```sh
lessloc catalog [--write]
```

Prints the pattern catalog's tables as PATTERNS.md shows them, generated from `lib/catalog.mjs`. `--write` writes them into lessloc's own PATTERNS.md, between its catalog markers. This is for contributors adding a pattern ([ARCHITECTURE.md](https://github.com/rextail-ai/lessloc/blob/main/ARCHITECTURE.md#adding-a-pattern)).

### hosts

```sh
lessloc hosts [--markdown] [--write]
```

Prints each agent tool lessloc knows: how to install lessloc for it, and its status. A status names a version of the tool only where a recording in the repository backs it: "tested end to end on <version>" when that version of the tool's own program, set up the documented way, ran lessloc's hooks through a scripted session and passed every check, and "verified live on <version>" when a session with a real model did. Otherwise it says "tested against documented payloads". `--markdown` prints it as the table that [Supported agent tools](/guide/getting-started#supported-agent-tools) shows. `--write` writes that table into lessloc's own getting-started guide, between its hosts markers. The rows live in `TOOLS` in `lib/install.mjs` ([ARCHITECTURE.md](https://github.com/rextail-ai/lessloc/blob/main/ARCHITECTURE.md#adding-an-agent-tool)).

### version

```sh
lessloc version
```

Prints lessloc's version.

### Used by the git hooks

You do not run these yourself. The hooks that `init` installs do.

- **`check --staged --gate`** (pre-commit) reviews the staged state. When tier-0 findings remain, it prints "Not committed. Fix these first:" with up to ten plain lines, and the commit is refused ([The commit gate](/guide/ci#the-commit-gate)).
- **`trailers <message-file> [<source>]`** (prepare-commit-msg) adds the commit trailers that the [`trailers`](/guide/configuration#trailers) setting asks for ([Trailers](/guide/ci#trailers)).

## Finding kinds

Every finding has a kind and a tier.

- **Tier 0** fails `check` and blocks the commit gate, for the kinds `check` reports. `tests-failed`, `policy` and `protected` come only from an agent session, where they hold the turn: `check`, the commit gate and CI never report them.
- **Tier 1** marks risks.
- **Tier 2** covers duplication, structure and brute force.
- **Tier 3** covers knowledge: comments and docs.
- **Tier 4** is size.

**Stops** marks the kinds in the default [`interrupt`](/guide/configuration#interrupt) list. In a session, they hold the agent's turn once, with what is unfinished. Findings of other kinds do not interrupt the agent: they are kept for the next session's handoff, and `check` and CI report them.

Some kinds come only from an agent session, because they need its request, its test runs or its last reply: `tests-failed`, `policy`, `protected`, `unaddressed`, `unfinished`, `unrequested-file`, `unrequested-doc` and `refactor-tests`. Some come only from `check`: `config`, `ratchet` (with `--ratchet`), and `unverified` at tier 0 (with `--require-evidence`).

How often kinds fired on commits people merged is on the [Benchmarks](/benchmarks#precision-on-code-humans-merged-without-a-model-bench-replay-mjs) page. Suppress a false positive with a reason, or accept it as the owner ([Configuration](/guide/configuration#suppressing-one-finding-in-the-code)). Each pattern page shows an example and the standard behind it; [Patterns](/patterns/) lists them all.

Copies are found in three forms:

- **Blocks:** repeated runs of lines.
- **Renamed copies:** a function with the same body under other names, where only local variables differ. A function that calls different things counts as different code.
- **Rule literals:** a format, strftime pattern, regex or query copied out of the function that owns it, or one new rule written in two places.

Duplicate findings show how widely each copy is used, so "same responsibility?" comes with evidence.

### Tier 0

| Kind | Stops | What it reports | Pattern |
|---|---|---|---|
| `tests-failed` | yes | A test run on the final state failed. | [Done without a passing run](/patterns/#unverified) |
| `ratchet` | | A codebase measure got worse than its line: more duplication, copies, similar names, unreferenced definitions, comments, commented-out code, swallowed errors, pass-through wrappers, junk files or instruction tokens, or fewer test assertions. Tier 0 only against a baseline this version recorded. | [Ratchet](/patterns/#ratchet) |
| `config` | | `.lessloc.json` is not valid JSON, or has an unknown key, a wrong type or an exception without a reason. It never refuses a commit. | [Broken settings](/patterns/#config) |
| `policy` | yes | `.lessloc.json` or `.lessloc-baseline.json` changed in an agent session without your approval. Only in a session: `check`, the commit gate and CI do not report it. | [Policy edits](/patterns/#policy-edits) |
| `protected` | yes | A path in `protect` changed in an agent session without your approval. Only in a session: `check`, the commit gate and CI do not report it. | [Policy edits](/patterns/#policy-edits) |
| `boundary` | yes | An added import breaks a rule in `boundaries`. | [Boundary](/patterns/#boundary) |
| `dependency` | yes | An added dependency is not in `approvedDependencies`. | [Approved dependencies](/patterns/#approved-dependencies) |
| `secret` | yes | A credential in a known format in the added lines, or a new `.env` file that would be committed. | [Secrets](/patterns/secrets) |
| `placeholder` | yes | A placeholder such as `# ... existing code ...`. Refused before it lands. | [Placeholders](/patterns/placeholders) |
| `commented-out` | yes | Commented-out code. Refused before it lands. | [Commented-out code](/patterns/commented-out) |
| `junk-file` | yes | A new backup, copy, scratch or report file (refused before it lands, unless the request names it), or cache files, build output or logs that would be committed. | [Scratch files](/patterns/#scratch-files), [report files](/patterns/#report-files), [caches](/patterns/#caches), [versions side by side](/patterns/side-by-side) |
| `weakened-tests` | yes | Test assertions or tests removed, or tests newly skipped, focused or forced to pass. Tier 0 in a session; `check`, where a person may remove a test on purpose, reports it at tier 1. | [Weakened tests](/patterns/weakened-tests) |

### Tier 1

| Kind | Stops | What it reports | Pattern |
|---|---|---|---|
| `swallowed-error` | yes | An error caught and dropped, such as `except Exception: pass` or an empty catch. The agent hears about it right after the write. | [Swallowed errors](/patterns/swallowed-error) |
| `suppression` | yes | A blanket suppression: `@ts-ignore`, `any`, `# type: ignore` or `# noqa` without a code, `eslint-disable` without a rule, `nolint` without a linter and a reason, `allow(dead_code)`. | [Silenced checks](/patterns/silenced-checks) |
| `unsafe` | yes | A shortcut that trades away safety: SQL built from values, HTML built or escaped by hand, `Math.random()` for secrets, a fast hash for passwords, certificate checks turned off, text run as code. | [SQL](/patterns/sql-from-values), [HTML](/patterns/html-by-hand), [randomness](/patterns/weak-randomness), [password hashes](/patterns/password-hash), [TLS](/patterns/tls-off), [eval](/patterns/eval) |
| `made-up-api` | yes | Another language's API, such as `null` in Python, `len()` in JavaScript or `None` in Go, or an import that no manifest declares and the platform does not provide. | [Another language's API](/patterns/wrong-language-api), [undeclared imports](/patterns/undeclared-import) |
| `test-logic` | yes | Production code that checks whether tests are running, says it exists to make tests pass, or branches on a value that appears only in tests. | [Test logic](/patterns/test-logic), [test-shaped code](/patterns/test-shaped) |
| `stub` | yes | A stub or fake success left in, such as `raise NotImplementedError`, `todo!()` or a "not implemented" error, or mock data in production code. Judged when the turn ends. | [Stubs](/patterns/stubs) |
| `debug-leftover` | yes | `debugger`, `breakpoint()`, `pdb.set_trace()`, or a debug print such as `print("here")`. Judged when the turn ends. | [Debug leftovers](/patterns/debug-leftovers) |
| `empty-test` | yes | A test that asserts nothing or only a constant, or one that mocks the code it tests. | [Empty tests](/patterns/empty-test), [mocked subject](/patterns/mocked-subject) |
| `untested` | yes | The change adds behavior and no test changed, [with some exceptions](/guide/how-it-works#end-of-turn-unfinished-work-is-held-once). | [Untested](/patterns/untested) |
| `unaddressed` | yes | A function, option or flag the request asked for appears nowhere in the repository. A name the request only mentions does not count. | [Stopping short](/patterns/unaddressed) |
| `unfinished` | yes | In a turn that changed code, the agent's last reply says part of the reported problem still fails, or that the same problem may be elsewhere, unchecked. | [Leaving part of the problem failing](/patterns/unfinished) |
| `removed-safeguard` | | Logging, error handling, validation, or a comment that states a security rule or contract was removed. | [Removed safeguards](/patterns/removed-safeguard) |
| `copy` | yes | A block of `dupLines` code lines that also exists elsewhere, or a function with the same body as another under other names. | [Reimplemented helpers](/patterns/reuse-helper), [duplicate shapes](/patterns/duplicate-shapes) |
| `versioned-copy` | yes | A definition beside an older version of itself, such as `parse_date_v2` next to `parse_date`. | [Versions side by side](/patterns/side-by-side) |
| `unverified` | yes | In a session, the turn changed what the tests run, so a pass no longer shows the code works. With `check --require-evidence`, no passing test run is recorded for exactly the state checked, at tier 0. | [Done without a passing run](/patterns/#unverified) |

### Tier 2

| Kind | Stops | What it reports | Pattern |
|---|---|---|---|
| `simpler` | | Brute-force code with a shorter idiom: `== True`, an if/else that returns the condition, an index loop that only reads `xs[i]`, `.filter(...).length > 0`, a catch that only rethrows, a flag loop that is `any()`, a hand-built counter, an `__init__` that `@dataclass` writes, a React Effect that only sets state. ruff and clippy add more. | [Brute force](/patterns/brute-force), [counters and flags](/patterns/counters-and-flags), [catch and rethrow](/patterns/catch-rethrow), [promise wrapping](/patterns/promise-wrap), [inferred types](/patterns/inferred-types), [derived Effects](/patterns/derived-effect), [boilerplate](/patterns/boilerplate), [rebuilt library](/patterns/rebuilt-library) |
| `reinvented` | | A hand-written version of what the standard library or an installed package does (deep clone, UUID, debounce, slugify, CSV, flag parsing), or a retry loop where the project already retries. | [Rebuilt library](/patterns/rebuilt-library) |
| `defensive` | | A check for a case that cannot happen, such as testing a value just created for emptiness. | [Defensive code](/patterns/defensive) |
| `unused` | | A new function or import that nothing calls, imports or tests. | [Unused](/patterns/unused) |
| `single-use` | | A one-line helper used once. | [Single use](/patterns/single-use) |
| `near-copy` | | A new function that is mostly the same code as an existing one. | [Reimplemented helpers](/patterns/reuse-helper) |
| `repeated-literal` | | A rule, such as a format, regex, query or date pattern, copied out of the function that owns it, or one new rule written in several places. | [Copied rules](/patterns/copied-rule) |
| `style-copy` | | The same CSS declarations under another selector, or the same long utility-class string written again and again. | [CSS copies](/patterns/css-copy) |
| `similar-name` | | A new function whose name looks like an existing one's. | [Reimplemented helpers](/patterns/reuse-helper) |
| `wrapper` | | A function that only forwards to another, or a file that only re-exports. | [Wrappers](/patterns/wrappers) |
| `single-impl` | | An interface or abstract class with one implementation, or an abstract class with none. | [Single implementation](/patterns/single-impl) |
| `if-chain` | | Three or more if-branches on literal values of one variable, where a lookup table would do. | [If-chains](/patterns/if-chain) |
| `mode-flag` | | An existing function gained a boolean flag parameter. | [Speculative options](/patterns/speculative-options) |
| `long-params` | | A new function with 8 or more parameters. | [Long parameter lists](/patterns/long-params) |
| `deep-nesting` | | Statements nested 4 or more control levels deep. | [Deep nesting](/patterns/deep-nesting) |
| `long-function` | | A function over 100 code lines, 20 or more of them written by the change. | [Long functions](/patterns/long-function) |
| `clever` | | Golfed code: nested ternaries, nested conditional expressions, comprehensions with several `for` clauses. | [Golfed code](/patterns/golfed-code) |
| `copied-tests` | | Copy-pasted test cases that one table-driven test would cover. | [Copied tests](/patterns/copied-tests) |
| `demo-code` | | An example or demo block, such as `if __name__ == "__main__":`, in a module other code imports. | [Demo code](/patterns/demo-code) |
| `unrequested-file` | | A deployment, container or CI file nobody asked for. | [Scaffolding](/patterns/scaffolding) |
| `tiny-file` | | A new code file under 10 code lines. | [Tiny files](/patterns/tiny-files) |
| `new-folder` | | A new folder with one or two entries, or an examples or demo folder nobody asked for. | [One-file folders](/patterns/one-file-folders), [demo code](/patterns/demo-code) |
| `swollen-file` | | A file that grew by 150 or more lines and now has over 800 code lines. | [Swollen files](/patterns/swollen-file) |
| `vague-name` | | A new name made only of vague words, such as `process_data` or `handle`. | [Vague names](/patterns/vague-name) |
| `junk-drawer` | | A new `utils`, `helpers`, `common`, `misc` or similar module or folder. | [Junk drawers](/patterns/junk-drawer) |
| `moved-files` | | Files moved or renamed when the request did not ask for a refactor. | [Moved files](/patterns/moved-files) |
| `new-dependency` | | A new dependency, when there is no `approvedDependencies` list. It says when an installed one already does the job, or when the lockfile does not pin it. | [Second library](/patterns/second-library) |
| `refactor-tests` | | A refactor changed existing tests. | [Refactor tests](/patterns/refactor-tests) |
| `churn` | | Lines only reformatted (quotes, spacing, punctuation) that the task did not need to change. | [Churn](/patterns/churn) |

### Tier 3

| Kind | Stops | What it reports | Pattern |
|---|---|---|---|
| `narration` | | Comments that narrate the code, decorate it or restate a name, closing-brace comments, and log lines that narrate each step. | [Narration](/patterns/narration), [decoration](/patterns/decoration), [restating docs](/patterns/restating-docs), [log chatter](/patterns/log-chatter) |
| `history` | | Dates, change history or notes to the requester in comments. | [Tombstones](/patterns/tombstones), [history](/patterns/history) |
| `todo` | | A TODO, FIXME, HACK or XXX comment left in. | [TODO and FIXME](/patterns/todo) |
| `comment-density` | | Comments make up more than `maxCommentRatio` of a file's added lines. | [Comment weight](/patterns/comment-weight) |
| `comment-block` | | A comment block of 6 or more lines. | [Comment weight](/patterns/comment-weight) |
| `dense-lines` | | Code lines over 160 characters, long strings and URLs aside. | [Golfed code](/patterns/golfed-code) |
| `stale-doc` | | A doc that still names something the change removed or renamed. | [Stale docs](/patterns/stale-doc) |
| `doc-removed` | | More than 20 lines of documentation removed. | [Docs removed](/patterns/doc-removed) |
| `unrequested-doc` | | A doc file nobody asked for, or a doc that grew by 40 or more lines without a request for docs. | [Unrequested docs](/patterns/unrequested-docs) |
| `long-instructions` | | A directory tour in always-loaded instructions, or instruction files over `instructionBudget` tokens. | [Long instructions](/patterns/long-instructions) |

### Tier 4

| Kind | Stops | What it reports | Pattern |
|---|---|---|---|
| `net-growth` | | The change adds more than `maxNetLines` net lines. | [Net growth](/patterns/net-growth) |
| `new-files` | | The change adds more than `maxNewFiles` new code files. | [Tiny files](/patterns/tiny-files) |

## Files lessloc writes

lessloc writes nothing into your working tree unless you ask. Its own state lives in your user cache.

### In your repository

| File | Written by | Notes | Shared with your team? |
|---|---|---|---|
| `.git/hooks/pre-commit`, `.git/hooks/prepare-commit-msg` | `init` | only hook files that did not exist or held only lessloc's lines | No: git never pushes `.git/hooks` |
| `.git/objects` | the agent hooks, the git hooks, `check`, `test`, `verify` and `probe` | snapshots of the working tree, untracked files that git does not ignore included, so a review sees exactly what each tool call changed. Ordinary unreachable objects, which `git gc` prunes once they are older than `gc.pruneExpire` (two weeks by default). Untracked files over 1 MB are skipped. Untracked environment and key files (`.env`, `.env.<name>` except examples and templates, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`) go in with every line blank but their PEM `BEGIN` and `END` lines, so their content never reaches `.git/objects` while a private key in one is still reported | No: git never pushes them |
| `.git/worktrees/` | `verify`, `ci`, `probe`, `check --ratchet` | git's record of a temporary clean checkout, removed with it | No |
| `AGENTS.md` | `init --rules` | the working standard, between `<!-- lessloc -->` markers | Only when you commit it |
| `CLAUDE.md` | `init --rules` | one `@AGENTS.md` line, only when CLAUDE.md exists and does not import AGENTS.md | Only when you commit it |
| `.lessloc.json` | `init --config` | the owner's settings ([Configuration](/guide/configuration)) | Only when you commit it |
| `.lessloc-baseline.json` | `init --baseline`, `baseline` | the ratchet's line | Only when you commit it |
| `.github/workflows/lessloc.yml` | `init --ci` | the CI workflow | Only when you commit it |
| `.github/hooks/review.json` | `init --copilot --repo` | Copilot's hooks for its cloud agent; each line does nothing where node or `~/.agent-standard` is missing | Only when you commit it |
| commit messages | the `prepare-commit-msg` hook | `Lessloc-Verified`, and with `"all"` also `Lessloc-Open` and `Lessloc-Unchecked`, only when `trailers` is set | Yes, in history |

### In your user cache

lessloc keeps one folder per checkout, and per git worktree: `~/.cache/lessloc/<repo>-<id>/`. `<repo>` is the checkout's folder name, and `<id>` comes from the path of its git directory. `LESSLOC_STATE` replaces the whole root. Otherwise `XDG_CACHE_HOME`, or `LOCALAPPDATA` on Windows, replaces `~/.cache`.

| File | What it holds |
|---|---|
| `repo` | the git directory this folder belongs to |
| `sessions/<session>.json` | a session's state: where its turn started, its request, its last test run, whether it was held |
| `sessions/<session>.log` | a session's journal: the files each agent touched, approvals asked, notes given, turns held |
| other files in `sessions/` | private git indexes for snapshots, and the snapshots taken around tool calls and subagents |
| `evidence/<tree>.json` | the test result for one exact tree |
| `ledger/<session>.json` | the handoff record a session leaves: its request, files, net lines, verification, what was left open, and its last message |
| `defs-*.json` | the definitions index, cached per file |
| `staged.json` | the last pre-commit check, reused for the commit's trailers |
| `python-stdlib.txt` | the names of Python's standard library modules, asked of `python3` once, for the check of undeclared imports |
| `cost.log` | each hook's time and tokens added, and the agent tool, when it is not Claude Code |
| `once/` | one empty file per recent Codex, Cursor, Copilot, Gemini CLI or Qwen Code hook payload, kept 30 seconds, so a tool that runs lessloc's hooks twice for one event (a plugin's and a hook file's) gets one answer |
| `errors.log` | hook errors, shown by `doctor` |

Beside the checkout folders, `originals.json` keeps what each agent tool's hook or settings file held before `init` first added lessloc's entries: its text, where writing it back would not give the same bytes, or that `init` created it. `remove` uses it to give each file back exactly. Only your user can read it.

The whole folder is private to your user. lessloc creates the root (`~/.cache/lessloc`, `$XDG_CACHE_HOME/lessloc` or the `LESSLOC_STATE` folder) and each checkout's folder readable by your user alone (mode 700), and sets a root folder an earlier version created to 700 the next time it runs, so other accounts on a shared machine cannot read these files, the shortened prompts among them. On Windows, where folders have no mode, the default `%LOCALAPPDATA%\lessloc` is private to you through your user profile; keep a `LESSLOC_STATE` or `XDG_CACHE_HOME` folder inside your profile too.

Session files go after a week, and handoff records after two weeks. Evidence keeps the 50 newest trees, and the logs keep their recent lines. A checkout's whole folder is removed when the checkout is gone, or a month after lessloc first wrote it.

None of these files is shared with your team: they live in your account's cache, outside the repository ([several agents in one checkout](/guide/how-it-works#several-agents-in-one-checkout)). Session state and handoff records keep a shortened copy of your prompts, and handoff records also keep the agent's last message, so the next session can be told what was asked and how it ended.

### In your home folder

| File | Written by |
|---|---|
| `~/.codex/hooks.json`, or `$CODEX_HOME/hooks.json` | `init --codex` |
| `~/.cursor/hooks.json` | `init --cursor` |
| `~/.config/opencode/plugins/lessloc.js`, or the same under `$XDG_CONFIG_HOME` | `init --opencode` |
| `~/.gemini/settings.json`, the `hooks` key | `init --gemini` |
| `~/.copilot/hooks/lessloc.json`, or `$COPILOT_HOME/hooks/lessloc.json` | `init --copilot` |
| `~/.config/kilo/plugin/lessloc.js`, or the same under `$XDG_CONFIG_HOME` | `init --kilo` |
| `~/.config/amp/plugins/lessloc.js`, or the same under `$XDG_CONFIG_HOME` | `init --amp` |
| `~/.cline/plugins/lessloc.js`, or `$CLINE_DIR/plugins/lessloc.js` | `init --cline` |
| `~/Documents/Cline/Hooks/`: `TaskStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `TaskComplete` | `init --cline` |
| `~/.pi/agent/extensions/lessloc.js`, or `$PI_CODING_AGENT_DIR/extensions/lessloc.js` | `init --pi` |
| `~/.qwen/settings.json`, the `hooks` key | `init --qwen` |
| `~/.factory/hooks.json`, or the `hooks` key of `~/.factory/settings.json` | `init --droid` |
| `~/.augment/settings.json`, the `hooks` key | `init --augment` |
| `~/.kiro/hooks/lessloc.json` | `init --kiro` |
| `~/.junie/config.json`, the `hooks` key, and a block in `~/.junie/AGENTS.md` | `init --junie` |
| `~/.openhands/hooks.json` | `init --openhands` |
| `~/.agents/plugins/review/`: `plugin.json`, `hooks/hooks.json`, and a block in `~/.config/goose/.goosehints` | `init --goose` |
| `~/.config/devin/config.json` (`%APPDATA%\devin\config.json` on Windows), the `hooks` key | `init --devin` |
| `~/.config/crush/crush.json`, or `$CRUSH_GLOBAL_CONFIG/crush.json`, the `hooks` key, and a block in `~/.config/crush/CRUSH.md` | `init --crush` |
| `~/.gemini/config/hooks.json`, the hook named `review` | `init --antigravity` |
| `~/.aider.conf.yml`, a block, and `~/.config/agent-standard/`: `check`, `CONVENTIONS.md` | `init --aider` |

lessloc changes only its own entries in these files, which are not shared with your team. Claude Code installs and removes the Claude Code plugin itself.

### Temporary files

In the system's temporary folder, lessloc creates clean checkouts (`lessloc-checkout-*`) for `verify`, `ci`, `probe` and `check --ratchet`, a folder (`lessloc-doctor-*`) where `doctor` runs each installed hook command once, and one folder per process (`lessloc-tmp-*`) for short-lived input and index files. Only your user can open these folders, and each is removed when its command ends.

## Environment variables

| Variable | Effect |
|---|---|
| `LESSLOC=off` | turns every agent hook off ([Configuration](/guide/configuration#turning-lessloc-off)) |
| `LESSLOC_OFF` | turns single components off, comma-separated ([Configuration](/guide/configuration#lessloc-off-single-components)) |
| `LESSLOC_STATE` | the folder lessloc keeps its files in, instead of the user cache |
| `LESSLOC_DEBUG=1` | prints hook errors on the hook's stderr as they happen; `doctor` shows the logged ones |
| `LESSLOC_PROFILE=1` | prints each detector's time |
| `LESSLOC_SOURCE` | where the workflow from `init --ci` installs lessloc from, instead of the npm package at exactly this version, `lessloc@<version>` |
| `XDG_CACHE_HOME`, `LOCALAPPDATA` | the user cache that lessloc's folder goes in |
| `XDG_CONFIG_HOME` | where `init --opencode`, `--kilo` and `--amp` put their plugin files, `init --goose` and `--crush` their rules blocks, `init --crush` its hook entry, `init --devin` its hook entries and `init --aider` its `agent-standard` folder, and where `init` and `doctor` look for the settings folders of OpenCode, Amp, Kilo Code, goose, Crush and Zed |
| `CRUSH_GLOBAL_CONFIG` | the folder of Crush's `crush.json`, as Crush reads it, for `init --crush` |
| `GOOSE_PATH_ROOT` | where `init --goose` puts its plugin folder and rules block, as goose reads them |
| `CLINE_DIR` | where `init --cline` puts the Cline plugin, and where `init` and `doctor` look for Cline's folder |
| `CODEX_HOME` | where `init --codex` finds Codex's `hooks.json`, and `init` and `doctor` find Codex's `config.toml` |
| `COPILOT_HOME` | where `init --copilot` writes Copilot's hook file, and where `init` and `doctor` find Copilot's installed plugins |
| `CLAUDE_CONFIG_DIR` | where `init` and `doctor` look for Claude Code's installed plugins |
| `PI_CODING_AGENT_DIR` | where `init --pi` puts the Pi extension, and where `init` and `doctor` look for Pi's folder and its installed packages |
| `CLAUDECODE=1`, `CODEX_THREAD_ID`, `CURSOR_AGENT=1`, `OPENCODE_TERMINAL=1`, `GEMINI_CLI=1`, `COPILOT_CLI=1`, `KILO_PID`, `CLINE_ACTIVE=true`, `PI_CODING_AGENT=true`, `QWEN_CODE=1`, `AUGMENT_AGENT=1`, `GOOSE_TERMINAL=1`, `CRUSH=1` | set by Claude Code, Codex, Cursor, OpenCode 2.x, Gemini CLI, Copilot CLI, Kilo Code, Cline's VS Code terminals, Pi, Qwen Code, Augment, goose and Crush for the commands their agents run; `init` reads them to name the tool it runs in. Amp, Factory Droid, Kiro, Junie, OpenHands, Devin CLI, Antigravity and Aider document none |
| `CURSOR_VERSION`, `CURSOR_PROJECT_DIR`, `PLUGIN_DATA` | set by the agent tools themselves; lessloc reads them to tell which tool ran a hook that does not name its host |
| `DEVIN_PROJECT_DIR` | set by Devin CLI for its hooks; lessloc reads it as the project folder, since Devin's hook payloads do not name it |
| `GITHUB_ACTIONS=true` | `check` prints GitHub annotations |
| `GITHUB_BASE_REF` | the branch `ci` compares with, as `origin/` plus its value, when no `--base` is given |
