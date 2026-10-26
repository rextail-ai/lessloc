---
title: "Configure lessloc: every .lessloc.json key and its default"
---

# Configuration

lessloc works without any configuration. When a project needs its own rules, its owner writes them in `.lessloc.json` at the root of the repository. This page lists every key with its default, how to accept or suppress a finding, and the switches that turn lessloc off.

## Who owns `.lessloc.json`

The file is the project owner's policy. Commit it, so that every teammate, every agent and CI use the same settings. [`mode`](#mode), [`interrupt`](#interrupt) and [`protect`](#protect) act only in agent sessions: the commit gate, `lessloc check` and CI do not read them.

- **Agents need your approval to edit it.** In the default `block` mode, an agent's edit to `.lessloc.json` or `.lessloc-baseline.json` goes to you for approval ([the gate](/guide/how-it-works#before-each-write-the-gate)). CI and code review are the authority over this file.
- **Mistakes never reach the agent.** An unknown key, a wrong type or broken JSON is reported by `lessloc doctor`, and by `lessloc check` as a tier-0 `config` finding, so CI fails until it is fixed. A misspelled key gets a "did you mean" suggestion. The pre-commit gate never refuses a commit over it.
- **A key with a problem is ignored, and its default applies.** If the file is not valid JSON, every default applies. An exception without a reason is dropped; the other exceptions still apply.
- **To start one,** run `lessloc init --config` in your terminal. It writes the file with the test command lessloc found. An agent creates it with its edit tool instead, so you approve it: in a session, a change to `.lessloc.json` or `.lessloc-baseline.json` made by a shell command, such as `lessloc init --config` or `lessloc baseline`, is a tier-0 `policy` finding and holds the agent's turn.

## Example

```json
{
  "test": "npm test",
  "setup": "npm ci",
  "protect": ["migrations/**", ".github/workflows/**"],
  "boundaries": [
    { "files": "src/ui/**", "mustNotImport": "/db/", "why": "the UI reads data through src/api" }
  ],
  "approvedDependencies": ["express", "zod", "vitest"],
  "exceptions": [
    { "path": "legacy/**", "finding": "narration", "why": "vendored file, kept verbatim" }
  ],
  "trailers": "verified"
}
```

## All keys

| Key | Default | Value |
|---|---|---|
| [`test`](#test) | discovered | a shell command |
| [`setup`](#setup) | none | a shell command |
| [`testTimeout`](#testtimeout) | `300` | seconds |
| [`probe`](#probe) | none | a shell command |
| [`mode`](#mode) | `"block"` | `"block"`, `"warn"` or `"off"` |
| [`interrupt`](#interrupt) | the kinds marked "stops" in the [reference](/guide/reference#finding-kinds) | a list of finding kinds |
| [`trailers`](#trailers) | `"off"` | `"verified"`, `"all"` or `"off"` |
| [`protect`](#protect) | `[]` | a list of path globs |
| [`boundaries`](#boundaries) | `[]` | a list of `{ "files", "mustNotImport", "why" }` |
| [`approvedDependencies`](#approveddependencies) | `null` | a list of package names, or `null` |
| [`allow`](#allow) | `[]` | a list of path globs |
| [`exceptions`](#exceptions) | `[]` | a list of `{ "path", "finding", "why" }` |
| [`maxCommentRatio`](#thresholds) | `0.25` | a number |
| [`maxNetLines`](#thresholds) | `150` | a number |
| [`maxNewFiles`](#thresholds) | `3` | a number |
| [`dupLines`](#thresholds) | `6` | a number |
| [`instructionBudget`](#thresholds) | `2000` | a number |

Path globs are relative to the repository root and use `/`. `*` matches within one folder, `**` across folders, and `?` one character. A glob must match the whole path: `*.sql` matches only files at the root, and `**/*.sql` matches them anywhere.

## Verifying the work

### `test`

```json
{ "test": "python3 -m pytest -q" }
```

The command that runs your whole test suite. An agent's passing whole-suite run on its final state is recorded as evidence for that exact state, which the handoff reports, and the commit trailers too when [`trailers`](#trailers) is set. `lessloc test`, `verify` and `ci` run this command.

When `test` is not set, lessloc uses the first of these that fits:

1. `npm test`, when package.json has a real `test` script
2. `make test`, when the Makefile has a `test:` target
3. `cargo test`, when there is a Cargo.toml
4. `go test ./...`, when there is a go.mod
5. `python3 -m pytest -q`, when there is a pytest.ini, tox.ini or conftest.py, or a `[tool.pytest` section in pyproject.toml
6. for a `tests` or `test` folder with `test_*.py` files: `python3 -m unittest discover -s tests -q` (or `-s test`) when the first file uses unittest, otherwise `python3 -m pytest -q`

On Windows, `python` replaces `python3`. `lessloc init` and `lessloc doctor` show the command in use.

Set `test` yourself when this guesses wrong, or when your suite runs through a script. A passing run of the configured command counts as the whole suite, and so does a whole-suite run of the same runner: for `uv run pytest -q`, also `pytest`, `python3 -m pytest -x` or `uv run pytest`. Only arguments that select a part, such as a file path or `-k`, narrow a run. A script lessloc cannot see into, such as `./scripts/test.sh`, counts only when it is run itself. With a discovered command, a run counts when it tests the language the turn changed; set `test` to make it exact ([what counts as evidence](/guides/verification#what-counts-as-evidence)).

### `setup`

```json
{ "setup": "npm ci" }
```

How a fresh checkout installs its dependencies. `lessloc verify` runs it in the clean checkout before the tests, and `lessloc ci` runs it before anything else. What `verify` does without it is under [`verify`](/guide/reference#verify).

### `testTimeout`

```json
{ "testTimeout": 900 }
```

How many seconds a test run may take in `lessloc test`, `verify` and `ci`. lessloc never runs your tests during an agent session, so this never limits the agent.

### `probe`

```json
{ "probe": "claude -p --output-format json" }
```

The agent command that [`lessloc probe`](/guide/reference#probe) runs to ask a fresh agent where a behavior lives. The question arrives on stdin. Without `probe`, `check` lists the handoff probe under "Not checked".

## How lessloc acts

### `mode`

```json
{ "mode": "warn" }
```

- `"block"` (default): the gate before writes and commands is on. It refuses placeholders, commented-out code and junk files, and sends policy edits and the common commands that skip the project's checks to you for approval ([the gate](/guide/how-it-works#before-each-write-the-gate)).
- `"warn"`: nothing is refused or sent to you for approval before a write or a command. The notes after writes and the review at the end of each turn still run, and can still send the agent back.
- `"off"`: the agent hooks do nothing in this repository. The git hooks, `lessloc check` and CI still run.

### `interrupt`

The finding kinds that hold an agent's turn: the agent is sent back once, with what it left unfinished (at most eight items). The default list is the kinds marked "Stops" in the [reference](/guide/reference#finding-kinds), which describes every kind.

Your list replaces the default; it is not added to it. Findings of other kinds never hold a turn: they are kept for the next session's handoff, and `check` reports them. A name that is not a finding kind makes the whole list invalid, and the default applies.

This keeps the default, drops `untested` and adds `near-copy`:

```json
{
  "interrupt": [
    "tests-failed", "policy", "protected", "boundary", "dependency", "secret",
    "placeholder", "commented-out", "junk-file", "weakened-tests", "swallowed-error",
    "suppression", "unsafe", "made-up-api", "test-logic", "stub", "debug-leftover",
    "empty-test", "unaddressed", "unfinished", "copy", "versioned-copy", "unverified", "near-copy"
  ]
}
```

### `trailers`

```json
{ "trailers": "verified" }
```

What the `prepare-commit-msg` hook from `lessloc init` adds to each commit made through it: nothing with `"off"` (default), one line saying what was verified at exactly the committed state with `"verified"`, and also what was left open and not checked with `"all"`. [Trailers](/guide/ci#trailers) shows each line.

## Project policy

### `protect`

```json
{ "protect": ["migrations/**", ".github/workflows/**", "LICENSE"] }
```

Paths only you change. At session start the agent reads one line about them, such as "In this project: only the user changes `migrations/**`." In the default `block` mode, an agent's write to a protected path with its edit tools, a heredoc or a patch goes to you for approval ([the gate](/guide/how-it-works#before-each-write-the-gate)). A change made in a session without your approval, such as with `sed -i`, is a tier-0 `protected` finding, which holds the turn when it ends. In `warn` mode nothing goes to you for approval, and every change there holds the turn.

This works only in agent sessions. `lessloc check`, the commit gate and CI do not look at `protect`, so a protected path changed outside a session, or in a pull request, is not flagged. For a binding rule, set one up on your code host, such as CODEOWNERS with branch protection on GitHub.

### `boundaries`

```json
{
  "boundaries": [
    { "files": "src/ui/**", "mustNotImport": "/db/", "why": "the UI reads data through src/api" }
  ]
}
```

Imports a part of the code must not make. Each entry needs `files` and `mustNotImport`:

- `files` is a path glob.
- `mustNotImport` is a regular expression, tested against each import line a change adds in those files (lines that start with `import`, `from`, `require`, `use`, `using` or `#include`, and `require(` or `import(` calls). In JSON, a literal dot is written `\\.`, as in `"app\\.db"`.
- `why` is optional. It is shown with the rule.

At session start the agent reads the rule, such as "`src/ui/**` must not import `/db/` (the UI reads data through src/api)". A matching import is a tier-0 `boundary` finding: the agent hears about it right after the write, the turn is held if the import is still there at the end, and `check` fails.

The check reads the import lines a change adds.

### `approvedDependencies`

```json
{ "approvedDependencies": ["express", "zod", "vitest"] }
```

- `null` (default): a dependency added to a manifest is a tier-2 `new-dependency` note. The note says when an installed library already does the same job, or when the lockfile does not pin the new one.
- A list: a dependency added that is not on the list is a tier-0 `dependency` finding. It holds the turn and fails `check`.

lessloc reads package.json, composer.json, `requirements*.txt`, pyproject.toml, Cargo.toml, go.mod and Gemfile. A new version of a dependency that was already there is not a new dependency. Names are matched as the manifest writes them, such as `@types/node` or a Go module path.

### `allow`

```json
{ "allow": ["generated/**", "docs/api/**"] }
```

Paths lessloc leaves alone. Writes there are never refused, and the review's line, file and copy checks skip them.

You do not need `allow` for generated files that say so in their first lines (`@generated`, "do not edit", "auto-generated"), or for dependency and build folders such as `node_modules`, `vendor`, `dist` and `build`, or for lockfiles. lessloc skips those already.

### `exceptions`

```json
{
  "exceptions": [
    { "path": "legacy/**", "finding": "narration", "why": "vendored file, kept verbatim" },
    { "path": "src/cli.py", "finding": "reads command-line flags by hand", "why": "the target device has no argparse" }
  ]
}
```

Findings the owner accepts. An accepted finding is not shown in a session, in `check` or in CI, and does not hold a turn; an accepted tier-0 finding no longer fails `check` or blocks a commit. This is the only way to accept a tier-0 finding from the review. An entry covers every matching finding under its `path`; a [`lessloc-ignore` comment](#suppressing-one-finding-in-the-code) covers one line.

- `why` is required. An entry without one is ignored and reported as a `config` problem.
- `path` is a path glob. Without it, the entry covers every file.
- `finding` is a finding kind. If it is not a kind, it is a regular expression tested against the finding's message, as in the second entry above. Without `finding`, the entry accepts every finding under `path`.

Exceptions apply to the findings of a review. They do not stop the refusals before a write; use [`allow`](#allow) for that. They also cannot accept `config`, `ratchet`, `tests-failed`, `unverified`, `unaddressed` or `unfinished`, which come from outside the review. The ones the check adds itself are handled where they come from: a worse ratchet measure by fixing it, or by committing a baseline that records it (`lessloc baseline`, with `--allow-worse "<why>"` when a baseline exists; [the ratchet](/guide/ci#the-ratchet)), a `config` finding by fixing `.lessloc.json`, and a missing test run by running the tests.

What `check` then shows:

- `check` reviews only the change: by default the working tree against HEAD, with `--staged` the staged change, and with `--base <ref>` everything since the branch left `<ref>`. Line rules such as `debug-leftover`, `swallowed-error` and `stub` look only at the lines the change adds. So `check` shows or counts such a finding, as in "1 accepted by exception" on its first line, only while the change adds its line. A line already in the base (HEAD, by default) and left as it is shows nothing, before the entry or after.
- Only tier-0 findings fail `check` (any finding with `--strict`). For other kinds, such as `debug-leftover`, an exception hides the finding and keeps it from holding a turn; `check` did not fail on it before.
- `lessloc audit` lists the whole codebase as it is: exceptions and `lessloc-ignore` comments do not apply to it.

## Thresholds

```json
{ "maxNetLines": 300, "maxNewFiles": 5 }
```

Each threshold sets when a finding appears. Of these findings, only `copy` holds a turn by default.

| Key | Default | Finding | Reported when |
|---|---|---|---|
| `maxCommentRatio` | `0.25` | `comment-density` | comments are more than this share of a file's added lines, once at least 8 comment and code lines were added. Doc comments and directives do not count. `audit` uses the same share for comment-heavy files |
| `maxNetLines` | `150` | `net-growth` | a change adds more net lines than this. Tests, fixtures, examples, migrations, lockfiles and build output do not count. `0` turns the check off |
| `maxNewFiles` | `3` | `new-files` | a change adds more new code files than this. Tests, fixtures, examples and migrations do not count |
| `dupLines` | `6` | `copy` | a block of this many code lines in a row also exists elsewhere. Blank lines, comments, imports and lines such as a lone bracket are skipped. `audit` uses the same size for duplicate blocks |
| `instructionBudget` | `2000` | `long-instructions` | always-loaded instruction files (CLAUDE.md, AGENTS.md, GEMINI.md, `.cursorrules` and the like) together hold more than this many tokens, estimated as characters divided by 4. Checked when a change touches one of them |

## Suppressing one finding in the code

A `lessloc-ignore <kind>: <reason>` comment, on a finding's line or on the line above, suppresses that finding wherever lessloc reviews a change: the end-of-turn hold in every agent session, `check` and CI.

```python
try:
    import uvloop
    uvloop.install()
# lessloc-ignore swallowed-error: uvloop is an optional speedup
except Exception:
    pass
```

- The reason is required.
- Without a kind (`lessloc-ignore: <reason>`), the comment suppresses any finding on that line.
- Only findings tied to a line can be suppressed this way, and never tier-0 findings. Only the owner accepts those, through [`exceptions`](#exceptions).
- A suppression stays visible. `check` counts it on its first line and lists each one with its reason, and in GitHub Actions each one shows as a notice on the diff:

```text
suppressed: [swallowed-error] shop/loop.py:5: swallowed error: let it reach a boundary that handles it, or catch only the error you expect (uvloop is an optional speedup)
```

An agent sent back for something it intended can just say why in one line instead; an item held once is not held again in that session. For a case that comes back session after session, use the comment or an [exception](#exceptions).

## Turning lessloc off

| To turn off | Do this |
|---|---|
| lessloc in the agent, for one run | Start the agent tool with `LESSLOC=off`, for example `LESSLOC=off claude` |
| lessloc in the agent, for a repository | Set `"mode": "off"` in `.lessloc.json` |
| Refusals and approval prompts before writes | Set `"mode": "warn"`; the end-of-turn review still runs |
| One part | Set `LESSLOC_OFF` to a comma-separated list of parts ([below](#lessloc-off-single-components)) |
| lessloc's daily update | Run `git -C ~/.lessloc config lessloc.update false`, for every agent tool however it is started; `git -C ~/.lessloc config --unset lessloc.update` turns it on again ([Update lessloc](/guide/getting-started#update-lessloc)) |
| Holds for some kinds | Leave them out of [`interrupt`](#interrupt) in `.lessloc.json` |
| Some paths | List them in [`allow`](#allow) in `.lessloc.json` |
| The commit gate, trailers, the rules block in AGENTS.md and lessloc's files | Run `lessloc remove` in the repository |
| Everything | Also run `lessloc remove --agents`, and remove the Claude Code plugin. Then, once every agent session has ended, run `rm -rf ~/.cache/lessloc ~/.lessloc`. That deletes the stored prompt copies and the clone ([Remove lessloc](/guide/getting-started#remove-lessloc)) |

### `LESSLOC=off` and `"mode": "off"`

| Switch | Where | Effect | Takes effect |
|---|---|---|---|
| `LESSLOC=off` | the environment your agent tool starts with | every agent hook does nothing, for that tool's sessions | only in sessions of a tool started with it |
| `"mode": "off"` | `.lessloc.json` | every agent hook does nothing in this repository, for everyone | at the next hook call, in sessions that are already open too |

Every hook call starts lessloc afresh and reads `.lessloc.json` again, so any change to the file, `"mode"` included, applies from the agent's next tool call, without a new session. Written during a session, `"mode": "off"` silences lessloc from that session's next tool call on; setting `"mode": "block"` or deleting the key turns it back on the same way. `LESSLOC=off` is read from the environment the agent tool started with, so it takes effect only when the tool is started with it, as in `LESSLOC=off claude`.

Neither switch touches the git hooks, `lessloc check` or CI.

In the default `block` mode, if an agent puts `LESSLOC=off` or `LESSLOC_OFF=…` in front of its own commands, the command goes to you for approval ([the gate](/guide/how-it-works#before-each-write-the-gate)). A quoted message for `git` or `gh`, a quoted search pattern, or a heredoc with a quoted delimiter written to a text, docs, Python or JavaScript file or read by Python or Node is not read for them, unless something in the same command could run it; the rest of the command is read as before. For enforcement, make `lessloc ci` a required check ([what each layer stops](/guide/ci#what-each-layer-stops)). An agent's shell can still change `.lessloc.json` or `.git/hooks` in ways the hooks do not parse; the required check reviews every pull request either way.

### `LESSLOC_OFF`: single components

`LESSLOC_OFF` takes a comma-separated list of components to switch off, and leaves the rest on:

```sh
LESSLOC_OFF=reuse,handoff claude
```

| Component | What it switches off |
|---|---|
| `rules` | the working standard at session start, and its short form for each subagent. The project's `protect` and `boundaries` rules are still given |
| `handoff` | the note at session start about the last session's uncommitted work |
| `reuse` | the hints about existing code with each prompt and in each subagent's prompt |
| `gate` | the refusals and approval prompts before writes and commands, as `"mode": "warn"` does |
| `lines` | the one-line note right after a Write or Edit, about a credential, a swallowed error or a forbidden import |
| `shell` | the same note after shell commands, patches and other tools that change files. The agent's test runs are still read |
| `review` | the whole review at the end of each turn and of each subagent: no hold, and no handoff record |
| `tests` | judging the agent's test runs at the end of a turn: nothing is held for tests that failed, or for a change to how the tests run |
| `requests` | the check that the functions, options and flags a request asks for exist (`unaddressed`) |
| `unfinished` | the check of the agent's last reply for part of the request it says still fails (`unfinished`) |
| `pace` | the one note in a turn that passes 40 tool calls, to finish what works and say what is left |
| `update` | lessloc's daily check for its newest published release, and the rewrite of its entries in the agent tools' files after its version changes, in sessions of a tool started with it. To turn the daily check off for good, use `git -C ~/.lessloc config lessloc.update false` ([above](#turning-lessloc-off)) |

`LESSLOC_OFF` is for narrowing down a problem, and for measuring what each component is worth.

The other environment variables lessloc reads are listed in the [reference](/guide/reference#environment-variables).
