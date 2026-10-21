---
title: "Commits and CI with lessloc: check, commit gate, ratchet"
description: "lessloc for commits and CI: check, the commit gate, test evidence, ci, the ratchet and trailers. CI, a required check on every pull request, is what binds."
---

# Commits and CI

This page covers the commands for commits and CI: `check`, the commit gate, test evidence, `ci`, the ratchet and commit trailers. In a session, lessloc's hooks fail open: a bug in lessloc never blocks the agent. A git hook can be skipped with `--no-verify`. The check that binds is CI, run as a required check on every pull request.

## Review a change: `lessloc check`

```sh
lessloc check                      # uncommitted work: the working tree, untracked files included, against HEAD
lessloc check --staged             # what is staged, against HEAD; this is what the commit gate sees
lessloc check --base origin/main   # everything since the branch left origin/main, up to the working tree
```

For example:

```text
lessloc check (+8 −0 lines, 0 new files; tests not run at this exact state): 5 finding(s)
- [commented-out] shop/money.py:14: commented-out code: delete `# total = sum(xs)`
- [swallowed-error] shop/money.py:12: swallowed error: let it reach a boundary that handles it, or catch only the error you expect
- [untested] shop/money.py: this change adds behavior (shop/money.py) and no test changed: add or extend a test that drives it the way users do and asserts the result; if no behavior changed, say so (Google eng-practices: tests ship with the change)
- [unused] shop/money.py:9: new `load` is never called, imported or tested: delete it, or wire it in (CWE-561: dead code)
- [vague-name] shop/money.py:9: vague name `load`: name it after what it does, so the next agent can find it
Tier-0 findings (or any finding with --strict) fail the check.
Not checked: handoff probe (no "probe" command)
```

- The first line gives the size of the change, whether the tests passed at exactly this state, and how many findings were accepted by exception or suppressed.
- The review's findings are sorted by tier, tier 0 first. What the check adds itself (a missing test run, a worse ratchet measure, a broken setting) comes before them. Each finding shows its kind and, where there is one, the standard behind it. Agents never see this format.
- "Not checked" lists what the check could not cover, so a clean result never reads as "nothing wrong": tests without a test command, languages without definition or shorter-idiom checks, deeper Python checks without ruff, the handoff probe without a `probe` command.

Tier-0 findings fail the check. Here those are `placeholder`, `commented-out`, `junk-file`, `secret`, `boundary` (with `boundaries` set), `dependency` (with `approvedDependencies` set) and `config`; with `--ratchet`, also `ratchet` against a committed baseline that this lessloc version recorded; and with `--require-evidence`, `unverified`. Every other finding, such as `empty-test`, `swallowed-error`, or `weakened-tests` (tier 0 only in an agent session), is reported and does not fail the check, unless you pass `--strict`. What holds an agent's turn is another list, [`interrupt`](/guide/configuration#interrupt). The [Reference](/guide/reference#finding-kinds) lists every kind with its tier, and [`check`](/guide/reference#check) there lists every flag and the exit codes.

## The commit gate

`lessloc init` installs two git hooks in this clone's `.git/hooks`. Git never pushes that folder, so nothing changes for your teammates. This is `pre-commit`, with the absolute path of your lessloc clone:

```sh
#!/bin/sh
if command -v node >/dev/null 2>&1 && [ -f "/path/to/lessloc/lessloc.mjs" ]; then node "/path/to/lessloc/lessloc.mjs" check --staged --gate || exit 1; fi
```

`prepare-commit-msg` runs `lessloc trailers "$1" "$2"` the same way ([trailers](#trailers)). Each line runs only where lessloc is installed at that path, so a hook copied to another machine does nothing instead of blocking commits.

`check --staged --gate` reviews what is staged. When the commit may go ahead, it prints nothing. Otherwise it prints only what blocks the commit, in plain words, and the commit stops:

```text
Not committed. Fix these first:
- shop/money.py:14: commented-out code: delete `# total = sum(xs)`
```

- Only tier-0 findings block a commit: `placeholder`, `commented-out`, `junk-file`, `secret`, `boundary` and `dependency`.
- The message never names lessloc or shows a kind, because whoever commits is often an agent.
- A problem in `.lessloc.json` never blocks a commit. Fixing it is the owner's job, and `lessloc doctor` shows it.
- The result is saved, so `prepare-commit-msg` reuses it instead of reviewing the same state twice.

If your repository already has hooks you wrote, or a shared hook folder (husky, `core.hooksPath`), `init` leaves them alone and prints the line to add. `lessloc remove` takes lessloc's lines out again.

`git commit --no-verify` skips the gate. In a session, in the default `block` mode, an agent's command that skips it in the common ways goes to you for approval first ([the gate](/guide/how-it-works#before-each-write-the-gate)). Other ways around git hooks are not recognized, so the gate is not the last line. CI is.

## Test evidence

A test result counts only for the exact state of the files it ran on. With `--require-evidence`, the check fails unless a passing run is recorded for exactly the state being checked:

```text
- [unverified] no passing test run recorded for exactly this state (tests not run at this exact state): run `lessloc test`
```

Results are recorded by:

- the agent's own test runs in a session, read by the hooks ([what counts as evidence](/guides/verification#what-counts-as-evidence));
- [`lessloc test`](/guide/reference#test), on the working tree;
- [`lessloc verify`](/guide/reference#verify), on a clean checkout of a commit, or of the staged state;
- `lessloc ci`, on the commit being checked.

```sh
lessloc test                 # the project's test command, recorded for the working tree as it is now
lessloc test -- pytest -x    # another command; its result is not recorded
lessloc verify               # the staged state, on a clean checkout
lessloc verify HEAD~1        # one commit, on a clean checkout
```

[`verify`](/guide/reference#verify) in the reference says when a run counts as not verified, and how the clean checkout gets its dependencies.

The working tree's state includes untracked files that git does not ignore. If your tests leave caches that are not in `.gitignore`, such as Python's `__pycache__/`, the state changes with every run, and `lessloc check --require-evidence` on the working tree finds no passing run for it. Add the caches to `.gitignore`, or run `lessloc verify` and check with `--staged`.

## CI in one command: `lessloc ci`

```sh
lessloc ci --base origin/main
```

`ci` runs, in order:

1. `setup` from `.lessloc.json`, when it is set, for example `npm ci`. If it fails, `ci` fails.
2. The project's test command, when it has one, on the commit being checked. It prints `passed:` or `FAILED:` with the command, plus the output on failure, and records the result for that commit's state.
3. `check --base <base> --ratchet --require-evidence` on the commit, with GitHub annotations inside GitHub Actions. `--require-evidence` is left out when the project has no test command. In Rust projects with cargo installed, clippy's complexity lints add findings on the lines the change wrote. They run only in `ci`, because clippy builds the crate.

The base is `--base` when you give it. Without it, `ci` uses `origin/$GITHUB_BASE_REF` on a GitHub pull request, and `HEAD~1` anywhere else. `ci` fails when the setup fails, the tests fail or the check fails. The check fails only on the tier-0 kinds [listed above](#review-a-change-lessloc-check); in GitHub Actions, every other finding is a warning (tier 1) or a notice on the pull request, and the job passes.

`ci --strict` passes `--strict` on to the check, so the job fails on every finding it reports. To make the workflow from `init --ci` strict, add `--strict` at the end of its `run:` line. With `--strict`:

- Every `ratchet` finding fails the job, also a worse measure against the base commit, which is otherwise a warning. `exceptions` and `lessloc-ignore` comments cannot accept it. Fix the measure (`lessloc audit` shows where), or accept the new value in a baseline and commit `.lessloc-baseline.json`: `lessloc baseline` when the repository has no baseline, `lessloc baseline --allow-worse "<why>"` when it has one. From then on the baseline is the line, and a worse measure fails the job without `--strict` too ([the ratchet](#the-ratchet)).
- A finding below tier 0 that is tied to a line can be suppressed with a `lessloc-ignore <kind>: <reason>` comment, which anyone may add, an agent too. A tier-0 finding needs the owner's entry in `exceptions` ([Accepting a finding](#accepting-a-finding)).

To run the job's check on your machine, with your work committed and after `git fetch origin`, run `lessloc ci --base origin/main` with the flags of the workflow's `run:` line, such as `--strict`. Like the job, it runs `setup` and the tests, then checks the committed state with the ratchet. `lessloc check --base origin/main` checks less: it reviews the working tree, and leaves the ratchet out unless you add `--ratchet`.

For example, with `--base main`, on a branch that added two functions with the same body:

```text
passed: python3 -m pytest -q
lessloc check (+23 −0 lines, 2 new files; tests passed at this exact state (working tree)): 6 finding(s)
- [ratchet] copiedDefinitions got worse: 0 -> 1 since main (`lessloc audit` shows where)
- [ratchet] duplicateLines got worse: 0 -> 6 since main (`lessloc audit` shows where)
- [copy] shop/payouts.py:1: `payout_total` has the same body as `refund_total` (shop/payouts.py:10, used in 2 file(s)) with names changed: call or merge into one
...
```

### GitHub Actions

`lessloc init --ci` writes `.github/workflows/lessloc.yml`. For lessloc 0.10.0 it is:

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
      - run: npx --yes lessloc@0.10.0 ci --base "origin/$GITHUB_BASE_REF"
```

- `fetch-depth: 0` fetches the whole history, so git can find the merge base with the base branch, and the ratchet can measure the base commit.
- The job installs lessloc from npm at exactly the version that wrote the file. A published npm version never changes, and npm checks the package against the registry's hash. To install from somewhere else, such as a fork, set `LESSLOC_SOURCE` when you run `init --ci`, for example `LESSLOC_SOURCE=github:<owner>/lessloc#v0.10.0`.
- `lessloc ci` runs the pull request's own `setup` and tests, so the job's token can only read the repository, and the checkout keeps no credentials. Keep the trigger `pull_request`; never use `pull_request_target`, which runs with the base repository's secrets and a token that can write. If a step of yours needs more access, give it to that step's own job.
- The base branch reaches the command as the variable `GITHUB_BASE_REF`, never as an expression inside the script.
- The workflow sets up Node only. If your tests need a language toolchain, services or dependencies, add those steps before the lessloc step, and put the install command in `setup` in `.lessloc.json`.
- `init --ci` never overwrites a workflow file that exists.

::: tip Make it required
Make the lessloc job a required status check in your branch protection or ruleset, so a pull request cannot merge while it fails. A pull request runs the workflow file, and reads `.lessloc.json`, from its own branch, so changes to them need review. `protect` does not reach pull requests: `check` and CI ignore it. To require review of changes to `.github/workflows/` and `.lessloc.json` in pull requests, use a CODEOWNERS file with "Require review from Code Owners" in branch protection. Adding `.github/workflows/**` to `protect` only affects agent sessions: lessloc asks you before an agent's edit tools change those files, and holds the turn of an agent that changes them another way.
:::

### Other CI services

Any CI with Node 20 or newer and git can run the same command. The clone needs the base branch, with enough history for git to find the merge base; a full clone is simplest:

```sh
npx --yes lessloc@0.10.0 ci --base origin/main
```

Annotations are in GitHub's format. Elsewhere, read the plain output and the exit code.

## The ratchet

The ratchet keeps measures of the whole codebase from getting worse. Raw size is not one of them, because features need code.

| Measure | What it counts |
|---|---|
| `duplicateLines` | lines in duplicate blocks |
| `copiedDefinitions` | definitions with the same body under different names |
| `similarNames` | functions with the same name in different files |
| `unreferenced` | definitions nothing references |
| `commentPercent` | comment lines that are not docs, as a percentage of code and comment lines; it may rise by 0.5 |
| `commentedOut` | commented-out code and placeholders |
| `swallowedErrors` | swallowed errors |
| `passThroughWrappers` | wrappers that only forward to another call |
| `junkFiles` | backup, copy, scratch and report files |
| `instructionTokens` | tokens in always-loaded instruction files, such as CLAUDE.md and AGENTS.md |
| `testAssertions` | test assertions; this one may not fall |

`lessloc audit` shows where each measure comes from.

**Without a baseline, the default.** `check --ratchet --base <ref>`, and so `ci`, measures the base commit in a clean checkout and compares. A worse measure is a warning on the pull request (tier 1); with `--strict`, it fails the check. Nothing needs to be committed or merged. Without `--base` and without a baseline, `--ratchet` has nothing to compare with.

```text
- [ratchet] duplicateLines got worse: 0 -> 6 since main (`lessloc audit` shows where)
```

**With a committed baseline.** `lessloc baseline` writes `.lessloc-baseline.json` with the current measures. Commit it, and from then on a worse measure fails the check (tier 0):

```text
- [ratchet] .lessloc-baseline.json: duplicateLines got worse: 0 -> 6 (`lessloc audit` shows where)
```

`lessloc baseline` refuses to record a worse measure unless you say why:

```sh
lessloc baseline
# refusing to record a worse duplicateLines (0 -> 6), copiedDefinitions (0 -> 1): fix it, or pass --allow-worse "<why>"
lessloc baseline --allow-worse "two totals stay separate until the refund rules settle"
```

The reason, the measures it raised and the date are written into the file, so the change shows up in review. A baseline recorded by another lessloc version only informs (tier 2), because versions may measure differently: once you have reviewed the difference, record it again with `lessloc baseline`. `lessloc init --baseline` writes the first baseline if there is none.

## Trailers

Commit trailers are off by default. With `"trailers": "verified"` in `.lessloc.json`, each commit made through the git hooks gets one line saying what was verified at exactly that commit's state:

```text
Fix half-cent rounding in to_money

Lessloc-Verified: tests passed at this exact state (clean checkout)
```

The value is one of:

- `tests passed at this exact state` or `tests FAILED at this exact state`, followed by where the run happened: `(working tree (run by the agent))`, `(working tree)` or `(clean checkout)`;
- `tests not run at this exact state`;
- `no test command`.

With `"trailers": "all"`, a commit also gets `Lessloc-Open:` with the number of findings left open and the first two, and up to two `Lessloc-Unchecked:` lines for what was not checked, such as `Lessloc-Unchecked: definition checks for .zig files`.

- Any later agent or person reads them with `git log`, without lessloc.
- Merge and squash commits get no trailers, and a message that already has a `Lessloc-Verified:` line, as in an amend, is left alone.
- Only commits made through the git hooks get trailers. A commit made elsewhere, such as in a web editor, does not.
- A pass is recorded for one exact state. To have the trailer say `tests passed`, stage your change and run `lessloc verify` before you commit.

Whatever the trailers setting, `prepare-commit-msg` warns when a commit message recaps the diff, listing five or more files one by one: "This commit message lists N files, which the diff already shows; say what changed and why instead." ([Commit recaps](/patterns/commit-recaps))

## Accepting a finding

A finding can be suppressed in place with a reason, or accepted by the owner in `.lessloc.json`; both stay visible to reviewers ([Configuration](/guide/configuration#exceptions)).

## What each layer stops

| Layer | When it runs | Left to other layers |
|---|---|---|
| Agent hooks | during a session | a lessloc error, since hooks fail open; `LESSLOC=off` in the agent tool's environment; `"mode": "off"` written into `.lessloc.json` by a shell command |
| Commit gate | on each commit in this clone | `git commit --no-verify` and other ways around git hooks (lessloc asks you before the common forms an agent runs); changes to paths in `protect`, which only the agent hooks check |
| `lessloc ci` as a required check | on each pull request | changes to paths in `protect`, which only the agent hooks check; findings below tier 0, which it reports without failing; otherwise nothing, short of changing the workflow, the branch protection, or `.lessloc.json` and `.lessloc-baseline.json` in the pull request, which reviewers see in the diff |

`lessloc ci` also covers commits from machines without the hooks. Make it a required check in your branch protection, so no branch merges without it.
