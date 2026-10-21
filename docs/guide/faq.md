---
title: "lessloc FAQ: install, tokens, speed and supported agents"
description: "lessloc keeps AI coding agents to the least code that does the job and still works. Answers on install, tokens, speed, privacy and supported agents."
---

# FAQ

Short answers on installing lessloc, the time and tokens it adds, where your code goes, and the agent tools and languages it supports.

## What is lessloc?

lessloc is a free, open-source (Apache-2.0) tool that keeps AI coding agents to the least code that does the job and still works. It runs inside your AI coding agent through the agent tool's hooks. [How it works](/guide/how-it-works) follows one session from start to handoff.

## How do I install lessloc?

Tell your coding agent: `Install lessloc for this project by following https://lessloc.org/install.md`. The agent follows [the install steps](/install). Using Claude Code? Type these two commands in its prompt box instead:

```
/plugin marketplace add rextail-ai/lessloc
/plugin install lessloc@lessloc
```

[Getting started](/guide/getting-started#_1-install-lessloc) has the commands for every agent tool.

## Does lessloc slow my agent down?

Each hook event adds some time: Node starts once, then lessloc runs the checks for that moment. `lessloc doctor` measures it in your own repository. It ends with one line per hook event, over the runs recorded there: the median time of lessloc's own work after Node has started (Node's start is not included), the tokens it added, and how many runs that covers ([doctor](/guide/reference#doctor)).

- The hooks run at session start, on each prompt, around writes and shell commands (in Claude Code also around subagents and MCP tool calls), and at the end of each turn. They do not run on the agent tool's own read and search tools, such as Claude Code's Read, Grep and Glob.
- Right after a write, only fast checks run, on the lines just written. Checks that need the whole codebase, such as finding copies, wait for the end of the turn.
- lessloc never runs your tests during a session. It reads the agent's own runs.
- If `doctor` warns about how your Node was built, see [Requirements](/guide/getting-started#requirements).

## How many tokens does it add?

lessloc adds about 175 tokens at session start, for its working standard. Most other hook events add nothing, and a turn held with one unfinished item gets about 55 to 135. One scripted session added 264 tokens in all: 175 at session start and 89 at the turn end. [A session at a glance](/guide/how-it-works#a-session-at-a-glance) lists the tokens each hook event adds. What a rule makes agents do costs more than its tokens, which is [why the standard is short](/guide/how-it-works#why-the-standard-is-short). [Why your agent bill grows](/guides/costs) explains where the money goes.

## Does my code leave my machine?

Not through lessloc. lessloc makes no network calls and has no dependencies. It is plain JavaScript that imports only Node's own built-in modules. You can check this in your clone:

```sh
cd ~/.lessloc
grep -rhoE "from '[^']+'" lessloc.mjs hook.mjs lib bridge opencode amp cline pi | sort -u
```

Every line it prints is either one of lessloc's own files or one of Node's own `node:` modules, and none of those is a network module such as `node:http`, `node:https`, `node:net` or `node:dns`. lessloc needs no account and no API key.

**What it runs.**

- During a session, the hooks run git, ruff when it is installed, and, in Python projects, `python3` once per checkout to list Python's standard-library modules. They never run your project's own commands: the agent runs the tests, and lessloc reads the result.
- Commands you run yourself can run more. `test`, `verify` and `ci` run your `test` and `setup` commands. `probe` runs your `probe` agent command in a clean checkout of the repository: a paid agent session, whose model provider gets the code that agent reads. `ci` runs clippy in Rust projects. `audit --tools` runs the analyzers you have installed: knip, vulture, cargo-machete, deadcode, osv-scanner, pip-audit, cargo-audit and govulncheck. Those are separate programs with their own behavior; the vulnerability scanners, for example, look up advisories online.
- The CI workflow that `init --ci` writes downloads lessloc from GitHub.
- In a partial clone (`git clone --filter`), git fetches from your own remote the objects a review reads that the clone does not have yet.

**What it stores.** In the repository it adds two git hooks in `.git/hooks`, and keeps snapshots of the working tree as unreachable objects in `.git/objects`, untracked files that git does not ignore included, until `git gc` prunes them. Untracked environment and key files, such as `.env`, `*.pem` and `id_rsa`, go in empty, so their content stays out of git. Git never pushes either. Its own files are in your user cache, among them a shortened copy of your prompts. [Files lessloc writes](/guide/reference#files-lessloc-writes) lists every file, what it holds, who on your machine can read it, and whether your team gets it. `lessloc remove` deletes only the current checkout's folder in your user cache. To delete what lessloc stored outside your repositories, close every agent session and run `rm -rf ~/.cache/lessloc ~/.lessloc` ([`remove`](/guide/reference#remove) says how the snapshots go).

Your agent tool still sends your code and prompts to its model provider. lessloc does not change that.

## The agent was held for something intended. What now?

A hold costs at most one extra round per agent and turn. The agent may answer in one line why something is intended, and an item held once is not raised again in that session. [Making agents verify their work](/guides/verification#cases-that-are-easy-to-misread) lists the cases that are easy to misread, and how lessloc reads each.

For a hold you do not want:

1. **Find out why.** The session's journal is `sessions/<session>.log` in lessloc's folder, which `lessloc doctor` prints. It has one `held` line per item, with its kind and, for the tests and the agent's reply, the reason: `failed` or `redefined` for the tests, `admitted` or `suspected` for the reply.
2. **Choose what holds.** `interrupt` in `.lessloc.json` lists exactly the kinds that hold a turn. Leave out the ones you do not want ([Configuration](/guide/configuration#interrupt)).
3. **Accept one case for good.** For a finding about code, add an `exceptions` entry with a `why` ([exceptions](/guide/configuration#exceptions)), or a `lessloc-ignore <kind>: <reason>` comment on its line ([suppressing one finding](/guide/configuration#suppressing-one-finding-in-the-code)). Holds about the tests, requested names and the agent's own reply are not affected by these; use `interrupt`, `LESSLOC_OFF=tests`, `LESSLOC_OFF=requests` or `LESSLOC_OFF=unfinished` for them.
4. **Report it** at https://github.com/rextail-ai/lessloc/issues, with the command the agent ran and what it was told. Leave out anything private.

## My project has no tests. Does lessloc still help?

Yes. Most of lessloc works without tests: hints about existing code, the gate, notes right after writes, the holds that do not need tests, and `check`.

Without a test command, lessloc has nothing to check the final state against, and when the agent runs no tests, the handoff says the project has no test command. If the agent runs tests anyway, their result is read and recorded, and a failing run holds the turn. Without test files either, it does not ask for a test of new behavior.

`lessloc doctor` warns when there is no test command. Setting `test` in `.lessloc.json` turns on the checks that need one.

## Will "less code" make my agent cut tests or error handling?

No. The standard says "Never cut correctness, security, tests or anything asked for". The hold never asks the agent to cut tests or error handling; it lists what is unfinished and says to add nothing else. [Patterns](/patterns/#what-lessloc-never-pushes-an-agent-toward) lists the counterweight to each over-correction, and [Why less code](/why-less-code) explains what lessloc counts as unneeded.

## Which agent tools and languages does it support?

lessloc works with Claude Code, Codex, OpenCode, GitHub Copilot, Gemini CLI, Cursor and many more. [Supported agent tools](/guide/getting-started#supported-agent-tools) lists each agent tool and how it was tested.

A tool lessloc has no hooks for gets [the rules tier](/guide/getting-started#tools-without-hooks). An agent you build yourself connects through [the hook protocol](/guide/any-agent).

Languages:

- Definitions, used by the hints and the checks on definitions, are indexed for Python, JavaScript and TypeScript, Go, Rust, Java, Kotlin, Scala, C#, Swift, Dart, C and C++, Ruby, PHP and shell.
- Shorter idioms are built in for Python, JavaScript and TypeScript, Go, Rust, Java and C#. ruff adds more for Python wherever it is installed, and clippy adds more for Rust in `ci`.
- Test runs are recognized for the common test runners ([the list](/guides/verification#the-runners-lessloc-recognizes)).
- Comment classification uses English.
- In Java, Kotlin, C#, Scala and Go, the file- and folder-count checks stay quiet, because one type per file and one package per folder are those languages' conventions.

The benchmarks run on Python projects, with Haiku in Claude Code ([scope](/benchmarks#scope)).

## How is it different from a linter?

A linter checks files against rules, whoever wrote them. lessloc works on an agent's change while it happens:

- before the agent writes, it points to code that already does part of the task;
- when the agent writes with its edit tools, it refuses placeholders, commented-out code and junk files;
- it judges only the lines the change wrote, and lines that only moved are not judged as new;
- it compares new code with the whole codebase, so it finds copies under other names;
- it checks the change against the request and against the agent's own test runs;
- it sends the agent back once with what is unfinished, and hands the rest to the next session.

Keep your linters. lessloc does not replace them, and it runs two of them for shorter idioms: ruff for Python and clippy for Rust. A linter or type checker run after the tests does not count as changing the state the tests ran on. In reports for people, findings name the standard behind them where there is one (Sonar, ESLint, ruff, clippy and others); agents never see those names.

## How do I enforce lessloc's checks?

Run `lessloc init --ci` and make the lessloc job a required status check in your branch protection ([GitHub Actions](/guide/ci#github-actions)). That check is the one that binds. The agent hooks fail open by design, so a lessloc error never blocks your agent, and a git hook can be skipped; the required check reviews every pull request either way. [What each layer stops](/guide/ci#what-each-layer-stops) shows what each layer covers.

## How do I turn parts of it off?

Set `LESSLOC_OFF` to a comma-separated list of parts, such as `LESSLOC_OFF=tests`, to turn those parts off. To turn lessloc off in the agent, start the agent tool with `LESSLOC=off` for one run, for example `LESSLOC=off claude`, or set `"mode": "off"` in `.lessloc.json` for a repository. [Turning lessloc off](/guide/configuration#turning-lessloc-off) lists every switch, from one component to everything.

## What is the license?

[Apache-2.0](https://github.com/rextail-ai/lessloc/blob/main/LICENSE).
