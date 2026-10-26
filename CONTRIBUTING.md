# Contributing to lessloc

lessloc has no dependencies, so a fresh clone is ready to work on.

## Set up

You need Node 20 or newer, git, Python 3 and a POSIX shell (Linux, macOS, or WSL on Windows). With ruff installed, one more test runs.

```sh
git clone https://github.com/rextail-ai/lessloc
cd lessloc
npm test
```

To try your checkout in an agent tool:

- Claude Code: `/plugin marketplace add /path/to/lessloc`, then `/plugin install lessloc@lessloc`.
- Other tools: `node /path/to/lessloc/lessloc.mjs init --<tool>` (for example `--codex`), run in the repository you test on, installs that tool's hooks for your user, running this checkout, and the git hooks of that repository. `remove --<tool>` there takes them out again.
- `node /path/to/lessloc/lessloc.mjs doctor`, run in the repository you test on, says what works.
- A clean checkout on `main` updates itself like an install, once a day, to a newer published release; one with changes or commits of your own stays as it is. `git config lessloc.update false` in the checkout keeps it where it is.

## Tests

- `npm test` runs every `*.test.mjs` file in `test/` and takes a few minutes. To run one file: `node --test test/hooks.test.mjs`.
- Each test process works in a temporary folder with its own home folder and lessloc state, so the tests never touch your agent tools' settings or your cache. lessloc's own update is off in them, and `test/update.test.mjs`, which tests it, reaches only local repositories.
- A test's name says what behavior it proves. Rows in `lib/catalog.mjs` cite tests by name (`test: <title>`), and `test/catalog.test.mjs` fails if a rename breaks one.
- Some files are generated, and the tests fail until they match. After changing `lib/catalog.mjs` or `lib/kinds.mjs`, run `node lessloc.mjs catalog --write` (PATTERNS.md). After changing `TOOLS` in `lib/install.mjs`, run `node lessloc.mjs hosts --write` (the status table in `docs/guide/getting-started.md`).

## The golden test

`test/golden.test.mjs` replays `test/golden/claude.jsonl`, a recorded Claude Code session. It requires the same stdout, stderr, exit code and state on every event, byte for byte. It guards what Claude Code receives in that session.

- Never edit or re-record `test/golden/claude.jsonl` to make a change pass. If the test fails, your change altered what Claude Code gets. Find another way, or open an issue first: that kind of change needs a new benchmark run.
- For the same reason, `test/install.test.mjs` pins the hooks in `.claude-plugin/plugin.json` by hash.
- Every text an agent reads is put together in `lib/voice.mjs`, around the findings' own messages, whose cited sources the review splits off. None of it may name lessloc, show its paths or commands, tag a finding kind or cite a source; only the approval prompt, which is written for the user, names lessloc. The tests check this on every host.

## Proposing a pattern

Open an issue with the New pattern template. Give what agents do (with a real example), the standard that already calls it bad (a CWE, a linter rule that ships enabled, a book or paper), and a bad and a good form of the same intent.

To build it, follow [Adding a pattern](ARCHITECTURE.md#adding-a-pattern). A new kind starts as a note. It may stop turns only once `node bench/replay.mjs`, run on public repositories, shows that its hits on code humans already merged are real.

## Adding an agent tool

Follow [Adding an agent tool](ARCHITECTURE.md#adding-an-agent-tool). The tool's status says "tested against documented payloads" until a recorded end-to-end session backs it, and then "tested end to end on <version>" for exactly the version recorded.

## Benchmarks

- Free, without a model: `node bench/replay.mjs <clone>` (findings on commits humans merged), `node bench/candidates.mjs <prepared dir> <clone>` (holds on finished and unfinished work), and `node bench/weight.mjs <clone> --file <path> --prompt <text>` (what the hooks add to a session).
- With a model: `node bench/real/run.mjs` starts paid agent sessions, so run it with `--dry-run` first. [bench/README.md](bench/README.md) has the method and how to reproduce the published results.
- A pull request that claims better correctness, smaller code or lower cost includes the command it ran and the versions recorded in its results JSON.

## Commits and pull requests

- One change per pull request, with its tests and its docs (`docs/guide`) in the same pull request. `npm test` must pass.
- A commit subject says what the change does, in plain words, with no type prefix and no closing period. Example: `Hooks for Crush and Antigravity, Aider's lint command, and the rules tier for tools without hooks`. Add a body only to say why.
- When you submit a contribution, you license it under the [Apache License 2.0](LICENSE), as section 5 of that license says.
- Report security problems privately, as [SECURITY.md](SECURITY.md) explains.

## Releasing (maintainers)

1. Write what changed under `## [Unreleased]` at the top of CHANGELOG.md.
2. Run `npm version patch`, `minor`, `major` or an exact version, on a clean `main`. It sets the version in `package.json`, in every agent tool's manifest (`test/install.test.mjs` checks that they match) and in `docs/guide/ci.md`, turns the Unreleased section into the version's section, then commits, tags `v<version>` and pushes both (`scripts/version.mjs`).
3. The tag starts the release workflow. It checks that the tagged commit is on `main` and that the tag matches `package.json`, runs the tests, publishes the GitHub release with the Gemini CLI and Qwen Code extension as its asset and the version's CHANGELOG.md section as its notes, then publishes the package to npm with provenance, through the trusted publisher set for `release.yml` and its `npm` environment on npmjs.com, and only then tags the commit `released/v<version>`. Installs update only to a `released/` tag on the commit its version tag names; the repository's tag rulesets let only maintainers create version tags, or move or delete either kind. The workflow holds no npm token. Its jobs run in the `release` and `npm` environments, whose rules on GitHub decide which tags may deploy and who approves. `init --ci` and `init --copilot --repo` install exactly this npm version, so it must be published.

Installs update themselves, and the entries `init` wrote in the agent tools' files are written again only by the new version's first session start. So `hook.mjs` and every path an installed entry names must keep working from one version to the next.
