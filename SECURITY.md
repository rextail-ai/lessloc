# Security policy

## Supported versions

Security fixes go into the latest release. Update to the newest version to get them.

## Reporting a vulnerability

Report it privately at https://github.com/rextail-ai/lessloc/security/advisories/new. Do not open a public issue or pull request.

Include the lessloc version, the agent tool and its version, the steps that show the problem, and what an attacker gains. We answer and fix it in the advisory, and credit you in the release notes unless you ask us not to.

## What lessloc touches on your machine

lessloc runs as you, with your permissions: in your agent tool's hooks, in the git hooks `lessloc init` installs, and when you run its command line. It has no dependencies, makes no network calls of its own and sends no telemetry. In a partial clone (`git clone --filter`), git fetches from your own remote the objects lessloc reads that the clone does not have yet; use a full clone where no fetch may happen.

It reads:

- the repository: its working tree, its git history and objects, and `.lessloc.json`;
- what your agent tool passes its hooks: your prompts, the agent's tool calls and their results, and its last message;
- environment variables that tell which agent tool is running.

It writes:

- its state in `~/.cache/lessloc/` (or `$XDG_CACHE_HOME/lessloc`, `%LOCALAPPDATA%\lessloc` on Windows, or `$LESSLOC_STATE`). For each checkout this holds session state and journals, test evidence, handoff records, the definitions index and logs. Session state and handoff records keep a shortened copy of your prompts, and handoff records also keep the agent's last message. Beside the checkout folders sits `originals.json`, which keeps what each agent tool's hook or settings file held before `init` changed it. Only your user can open this folder: lessloc creates it, and each checkout's folder, with mode 700. On Windows, where folders have no mode, keep `$LESSLOC_STATE` and `$XDG_CACHE_HOME` inside your user profile, which keeps `%LOCALAPPDATA%` private to you. Session files go after a week, handoff records after two weeks, and a checkout's folder when the checkout is gone or a month after lessloc first wrote it;
- snapshots of the working tree, as unreachable objects in `.git/objects`, which `git gc` prunes. Untracked environment and key files (`.env`, `.env.<name>` except examples and templates, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`) go in with every line blank but their PEM `BEGIN` and `END` lines, so their content never reaches `.git/objects` while a private key in one is still reported. Add every other file that holds a secret to `.gitignore`: a snapshot includes each untracked file git does not ignore;
- folders in the system's temporary folder that only your user can open, each removed when its command ends: clean checkouts (`lessloc-checkout-*`) for `verify`, `ci`, `probe` and `check --ratchet`, with git's record of each in `.git/worktrees/`, one (`lessloc-doctor-*`) where `doctor` runs each installed hook, and one per process (`lessloc-tmp-*`) for short-lived input and index files;
- only when you run `lessloc init`: `.git/hooks/pre-commit` and `.git/hooks/prepare-commit-msg` in this clone and, with their flags, `AGENTS.md`, `CLAUDE.md`, `.lessloc.json`, `.lessloc-baseline.json`, `.github/workflows/lessloc.yml` and `.github/hooks/review.json`;
- only when you run `lessloc init --<tool>` or `--agents`: that tool's user-level hook, plugin or settings file in your home folder. `lessloc remove` takes lessloc's entries out again, and gives a file back byte for byte when nothing else in it changed since.

[Files lessloc writes](https://lessloc.org/guide/reference#files-lessloc-writes) lists every file.

It runs:

- `git`, plus `ruff` and `python3` when they are installed. ruff runs with its fixes turned off, whatever the repository's ruff settings say, so it never changes a file. On Windows, the programs lessloc starts itself (git, ruff, python3, cargo, node) never come from the repository's folder. The agent hooks never run your repository's own commands;
- your `test` and `setup` commands from `.lessloc.json`, but only from `lessloc test`, `verify` and `ci`, and the `probe` command only from `lessloc probe`. `ci` runs `cargo clippy` in Rust projects, which builds them. `audit --tools` runs the analyzers you have installed, and some of them, the vulnerability scanners, look up advisories online. It runs knip from the repository's `node_modules` only when git tracks nothing there; a committed `node_modules` never runs, and knip then comes from your PATH. `doctor` runs each installed hook once to see that it answers and, when `CLAUDE_PID` is set, `ps` to read when that Claude Code process started.

The clone that installs lessloc, and the installs that Claude Code, Codex, Qwen Code, Pi and GitHub Copilot CLI make themselves, download it from get.lessloc.org, which serves this repository unchanged ([FAQ](https://lessloc.org/guide/faq#does-my-code-leave-my-machine) has the check).

For enforcement, make `lessloc ci` a required check ([What each layer stops](https://lessloc.org/guide/ci#what-each-layer-stops)). The agent hooks guide the agent; they do not confine it. They fail open by design, so a lessloc error never blocks your agent. An agent's shell can change files the hooks do not parse, and a git hook can be skipped; the required check reviews every pull request either way.

## Scope

In scope: lessloc running a command, writing a file or sending data anywhere this page does not list; content in a repository or a prompt (a file, a file name, `.lessloc.json`, a commit message) that makes it do so; lessloc's state readable by another user.

Out of scope: an agent that ignores a hold, and the bypasses that [What each layer stops](https://lessloc.org/guide/ci#what-each-layer-stops) already lists.
