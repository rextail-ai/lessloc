---
title: "Making AI coding agents verify their work"
description: "What counts as evidence that an AI coding agent's work is done, how agents run tests and how lessloc reads each way, and why it holds a turn at most once."
---

# Making agents verify their work

When an agent ends with "done, all tests pass", that is a claim. The run behind it may have tested an earlier version of the code, or one test file, or sat behind a pipe that hid the failure. There may have been no run at all.

This page explains what counts as evidence that work is done, how agents actually run tests and how lessloc reads each way, why lessloc sends an agent back at most once per turn, and why only on near-certain evidence.

lessloc never runs your tests during a session. The agent runs them, and lessloc reads the result from the agent tool. A turn runs from your prompt to the agent's final reply. When a run fails on the final code, or the turn changed how the tests run, lessloc holds the turn: before the agent may finish, it gets one message that lists what is unfinished.

## What counts as evidence

A test run shows that the work is done only when all of these are true:

1. **It ran on the final state.** lessloc snapshots the working tree, untracked files included, before and after each command that may change files or run tests, and keeps a result only for the exact tree it ran on. An edit after the run means the run no longer speaks for the code. The one exception: a run still counts when only files that are not code, such as a README or a test cache, changed since.
2. **It ran the whole suite.** A run of one file, a name filter (`-k`, `-t`, `--filter`, `go test -run`), the last failures (`--lf`) or one package of a monorepo (`cargo test -p`) is a part. A part that passes says nothing about the rest. A part that fails still counts as a failure. A Python run that names every test file the project has counts as the whole suite.
3. **It ran the project's own tests.** That is the `test` command in `.lessloc.json`, or [the one lessloc finds](/guide/configuration#test). A run of the configured command is the whole suite, and so is a whole-suite run of the same runner: for `uv run pytest -q`, also `pytest`, `python3 -m pytest -x` or `uv run pytest`; for a unittest command, pytest too; for `npm test`, the runner its test script calls, unless the script calls more than one. Only arguments that select a part narrow a run. A script lessloc cannot read, such as `./scripts/test.sh`, counts only when it is run itself. A command lessloc found is a guess, so a run must test the language the turn changed: a jest run says nothing about a Python change, and a pytest run counts for one even where the command found is `npm test`.
4. **Its result is the runner's own.** lessloc takes the result the agent tool reports: Claude Code's failure event, the exit code OpenCode reports, the exit code in Cursor's documented hook payload, or the test runner's own summary where Codex reports only output. Where the tool reports no exit code, or something hid it, only the runner's own summary line counts, in that runner's own format: `5 passed in 0.12s` for pytest, `Tests: 3 passed, 3 total` for jest, `test result: ok.` for cargo. The agent's own words never count.
5. **The turn did not change what the tests run.** If the agent edited `pytest.ini`, `tox.ini`, the pytest or coverage section of `pyproject.toml`, the test scripts in `package.json`, a Makefile test target, a jest or vitest config, Maven's surefire settings or the like, a pass no longer shows that the code works. This holds even when no code changed, because that is how checks get weakened. It does not apply when the request named the file.

Two problems hold the turn, each as one line of its note, from [lib/voice.mjs](https://github.com/rextail-ai/lessloc/blob/main/lib/voice.mjs): a run that failed on the final state, and a change to how the tests run.

```text
The tests fail on the final state (`python -m pytest -q`): fix the cause, or say why the failure is expected.
You changed how the tests run this turn (`pytest.ini`), so a pass no longer shows the code works: revert that, or say in one line why it is needed.
```

Every other gap, such as no run, a part of the suite, another runner, or a result lessloc cannot read, leaves the final state unverified without holding the turn. The handoff record says the tests did not run at the final state, and CI is where a passing run is required ([test evidence](/guide/ci#test-evidence)). A subagent is not held for tests either: its work is usually one part of a change, verified when the turn that holds it ends.

## How agents run tests, and how lessloc reads each

Agents run tests in many ways besides the bare command. Here are the common ones, and what lessloc makes of each. Where it cannot tell, it errs toward "not shown": a wrong "passed" would record unverified work as verified.

### The runners lessloc recognizes

The project's test command, and the common runners: pytest, unittest, tox, nox, `npm test` (and its yarn, pnpm and bun forms), `bun test`, jest, vitest, mocha, `node --test`, `go test`, `cargo test` and nextest, `dotnet test`, rspec, ctest, `deno test`, phpunit, `mix test`, `make test` or `make check`, Gradle's `test` or `check`, and Maven's `test` or `verify`.

### The plain run

```sh
python -m pytest -q
```

The exit status is the runner's, so it decides. It outranks any line of output, which a test name or a log message could echo.

### Wrappers and interpreter options

```sh
uv run pytest -x
env PYTHONPATH=. python3 -m pytest
python -I -m pytest -q
python3 -X dev -m unittest discover -s tests
bash -lc 'python -m pytest -q'
```

lessloc looks through wrappers such as `env`, `time`, `timeout`, `uv run`, `poetry run`, `npx` and `coverage run -m`, through interpreter options before `-m`, and into a command wrapped in `bash -lc '...'`.

### Pipes that trim the output

```sh
python -m pytest -q 2>&1 | tail -3
npm test 2>&1 | grep -E "^# (pass|fail)"
```

A pipeline returns the exit status of its last command, so the runner's own status is lost unless `set -o pipefail` came first. When it is lost, only the runner's summary counts. `grep`, `head`, `tail`, `sort` and `uniq` keep or drop whole lines, so they cannot print a summary the runner did not; a summary that survives them counts, pass or fail. If the summary was cut off, as with `| head -1`, the run shows nothing either way.

### Pipes that can rewrite lines

```sh
python -m pytest -q 2>&1 | tail -1 | cut -d, -f2
```

`sed`, `awk`, `cut`, `tr`, `jq`, `xargs`, `grep -o` and `head -c` can change what a line says. `cut -d, -f2` turns `1 failed, 21 passed in 0.1s` into `21 passed in 0.1s`, which reads as a pass. So after a stage like these, lessloc believes a failure it sees, and never a pass.

### Exit status thrown away

```sh
go test ./... || true
cargo test; exit 0
python -m pytest -q; git diff --stat
```

The command's exit status is no longer the runner's, so again only the runner's own summary counts.

### Chains

```sh
cargo fmt && cargo test
pip install -e . && python -m pytest -q
```

With `&&`, a failing exit can come from any command in the chain. It counts against the tests only when the runner's summary shows a failure. If `pip install` failed, pytest never ran, and the run shows nothing. A passing exit means every command passed.

lessloc also has to know which state a run tested. It takes the state before the command when nothing ahead of the runner can change files (only reading commands, such as `cd`, `ls`, `cat`, `grep` or `git status`, come before it), and the state after it when nothing behind the runner can. After `cargo fmt &&`, the run tested the formatted code, and that is the state it counts for.

### Checkers after the tests

```sh
black . && python -m pytest -q && ruff check . && mypy src
```

Linters and type checkers that only report, such as `ruff check`, `mypy`, `pyright`, `flake8`, `pylint`, `eslint`, `prettier --check`, `tsc --noEmit`, `go vet`, `cargo check` and `cargo clippy`, change no files, so the run still speaks for the final state. If one of them fails the chain, the runner's summary decides whether the tests passed. Their fix modes (`ruff check --fix`, `eslint --fix`, `prettier --write`, or `black` without `--check`) change files and count as changes.

### Stash and retest

```sh
git stash && python -m pytest -q 2>&1 | tail -3; git stash pop && python -m pytest -q
```

Agents do this to show that a test fails without the fix and passes with it. Both runs are in one command, so its output holds two summaries. For pytest, unittest and node's test runner, lessloc gives each run its own closing line, in order, when every run printed exactly one. The latest whole-suite run it can tie to a state speaks for the command: here, the last one, on the restored code. The stashed run's failure is never the final state's. If the summaries cannot be told apart, for example because one was cut off, the command counts as neither a pass nor a failure.

### Background runs

```sh
python -m pytest -q &
```

A run sent to the background, with `&` or the agent tool's own background option, has no result when the command returns. Neither has a run that was interrupted, timed out or denied. lessloc counts none of them.

### Somewhere else

```sh
cd ../other-checkout && python -m pytest -q
cd packages/api && npm test
```

lessloc follows `cd` and a runner's folder options (`make -C`, `npm --prefix`, `cargo --manifest-path`). A run outside this checkout proves nothing here. A run in a subfolder, such as one package of a monorepo, is a part, unless that folder is the test folder itself.

### Commands that run no tests

```sh
python -m pytest --collect-only
cargo test --no-run
npx jest --listTests
tox -e lint
```

Listing tests, compiling them, skipping them, rewriting snapshots, asking for help, or running an environment named for something other than tests runs no tests. None of these is a test run.

## Why one hold per turn

lessloc sends an agent back at most once per turn, with one message that lists what is unfinished ([how the hold works](/guide/how-it-works#end-of-turn-unfinished-work-is-held-once)).

There are three reasons:

- **Each hold is a whole extra turn.** A turn at the end of a session is the most expensive kind: the agent re-reads the whole session, thinks again and usually runs more commands. See [why your agent bill grows](/guides/costs).
- **One hold keeps a misread cheap.** It costs at most one turn, and the agent can answer it in a line. Without a limit, one misreading could send an agent back again and again.
- **Repeated review grows code.** An agent sent back over and over can start adding layers, checks or tests just to satisfy the reviewer ([review bloat](/patterns/#review-bloat)). One hold that lists everything, and asks for nothing more, avoids that loop.

The binding check is CI ([what each layer stops](/guide/ci#what-each-layer-stops)); the agent hooks fail open by design.

## Cases that are easy to misread

Some of what agents do looks like a failure, a hidden result or a trick when it is not. This is how lessloc reads each:

| What the agent did | How lessloc reads it |
|---|---|
| Stashed its fix, ran the tests to watch them fail, restored the fix and ran them again, all in one command | Each run owns its own closing summary, and the last run tied to a state speaks for the command |
| Piped the run through `grep` or `head` to shorten the output | A summary that survives counts; only stages that can rewrite lines, such as `sed`, `awk`, `cut`, `grep -o` or `head -c`, hide a pass |
| Ran `python -I -m pytest` | Interpreter options before `-m` are understood |
| Ran `ruff check`, `mypy`, `eslint` or `tsc --noEmit` after the tests | Checkers that only report count as changing nothing |
| Ran pytest 9, which prints subtest counts (`29 passed, 5 subtests passed in 0.16s`) | Subtest counts are read, failures included |
| Wrote a value the request itself named, such as an email domain the user asked to treat specially | A value the request names is what was asked for, not code shaped to pass a test |

## Hold only on near-certain evidence

A wrong "failed" costs a whole turn and changes nothing. A wrong "passed" records unverified work as verified. So lessloc holds only on a failure it can tie to the final state, or on a change to how the tests run, and its reading is checked:

- Each of the cases that are easy to misread has a test, in [test/evidence.test.mjs](https://github.com/rextail-ai/lessloc/blob/main/test/evidence.test.mjs) and [test/hooks.test.mjs](https://github.com/rextail-ai/lessloc/blob/main/test/hooks.test.mjs).
- `node bench/replay.mjs` replays commits that humans already merged, without a model, and counts how often each kind fires on that finished work ([results](/benchmarks#precision-on-code-humans-merged-without-a-model-bench-replay-mjs)).
- `bench/candidates.mjs` replays, through the hooks, the human change for each judged task of a real project, and variants of it that leave work out, to count false rejects and false accepts ([method](/benchmarks#refusing-unfinished-work-without-a-model-bench-candidates-mjs)).

When lessloc truly cannot tell, because a summary was cut off, a run is still in the background, or two runs cannot be told apart, it counts the run as neither a pass nor a failure, and the turn is not held.

The same rule applies to anything you build around an agent, such as a hook, a review bot or a CI loop that makes it retry. Send it back only when you are nearly sure, once, with exactly what to fix.

## Your part

- Tell the agent the test command, in one line of the instructions your agent tool already loads, so it does not spend calls guessing. Set `test` in `.lessloc.json` too, so a run of it counts as the whole suite (see [configuration](/guide/configuration#test)).
- Let the summary through. `-q`, `| tail -n 20` and `| grep` are fine as long as the runner's summary line survives. Avoid `|| true` and `; exit 0`.
- Make `lessloc ci` a required check, so evidence is checked where an agent cannot skip it.

## What a passing run cannot tell you

A passing suite shows only what the tests check. lessloc also holds a turn for new behavior with no test changed (`untested`, [with some exceptions](/guide/how-it-works#end-of-turn-unfinished-work-is-held-once)), for tests that assert nothing or mock the code they test (`empty-test`), and for tests deleted, skipped, focused or forced to pass (`weakened-tests`). See the [tests and verification patterns](/patterns/), and [unverified](/patterns/#unverified) for the hold described on this page.
