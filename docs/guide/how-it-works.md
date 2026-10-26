---
title: "How lessloc works: hooks from session start to handoff"
description: "lessloc runs inside your agent tool as hooks, small programs the tool starts at set moments, and steps in only where acting is cheapest."
---

# How it works

lessloc runs inside your agent tool as hooks: small programs the tool starts at set moments, such as when a session starts, before a file is written, or when the agent says it is done. lessloc watches what the agent already does (its prompt, its writes, its own test runs, its final message) and steps in only where acting is cheapest. The agent has no lessloc command to run, no file to write and no report to read.

This page follows one session from start to handoff. To install lessloc, and for what differs in each agent tool, see [Getting started](/guide/getting-started).

## A session at a glance

<img class="light-only" src="/mechanism-light.svg" alt="How lessloc works inside your agent's own loop, through the hooks your agent tool already has: at session start it adds a short working standard, at each prompt it points to code you already have, before a write it refuses placeholders and junk, after a write it flags secrets and swallowed errors, and at the end of the turn it sends unfinished work back once. Principles: the least code that stays correct, reuse before new code, act in the loop with no reports, the agent's test runs as proof, review only the change. Built on Node.js with no dependencies, no API key and no model calls, git for snapshots, one table for 20+ agent tools, and a code index for 16 languages." width="880" height="784" loading="lazy"><img class="dark-only" src="/mechanism-dark.svg" alt="How lessloc works inside your agent's own loop, through the hooks your agent tool already has: at session start it adds a short working standard, at each prompt it points to code you already have, before a write it refuses placeholders and junk, after a write it flags secrets and swallowed errors, and at the end of the turn it sends unfinished work back once. Principles: the least code that stays correct, reuse before new code, act in the loop with no reports, the agent's test runs as proof, review only the change. Built on Node.js with no dependencies, no API key and no model calls, git for snapshots, one table for 20+ agent tools, and a code index for 16 languages." width="880" height="784" loading="lazy">

| When | What the agent gets | Tokens |
|---|---|---|
| Session start | The working standard, the project's own rules, and a note when the last session left work open | about 175 for the standard; again after compaction, and in OpenCode in every model request |
| Each prompt | Nothing, unless a specific word of the prompt names code you already have: then up to five places that may already do part of the task | 0, or about 30 to 300 |
| Before each write (edit tools, heredocs, patches) | Nothing, unless the write adds a placeholder, commented-out code or a junk file: then the write is refused. Such writes to protected paths, and the common commands that skip the project's checks, go to you for approval | 0 |
| Right after a write | One line per problem, only for a credential, a swallowed error or an import the project forbids | 0, or about 40 |
| After the 40th tool call of a turn | Once, a note to finish what works and say what is left, for a request that has no natural end | 0, or about 50 |
| Each subagent (Claude Code) | One line of the standard, and the existing code relevant to its task, in its own prompt | about 80, plus its hints |
| End of turn | Nothing when the work is done. Otherwise, once per turn, what is unfinished, up to eight items | 0, or about 55 to 135 with one item, and about 15 to 95 for each further item |

The counts are estimates from the length of each text. `bench/weight.mjs` replays one scripted session through the hooks without a model: start, prompt, a search, an edit, a test run, turn end. On tomlkit at eddd27e, `node bench/weight.mjs <clone> --file tomlkit/items.py --prompt "Add a function that doubles a value"` shows lessloc adding 264 tokens: 175 at session start and 89 at the turn end, which asks for a test of the new function. In your own repository, `lessloc doctor` shows the median tokens each hook added.

## Session start

The agent gets up to three things, in one block of context.

**The working standard.** This is the whole text, from [RULES.md](https://github.com/rextail-ai/lessloc/blob/main/RULES.md):

> Every line you leave is read again, so solve the whole task with the least new code: the shortest diff that does all of it correctly wins. Project instructions take precedence.
>
> Take the first that works: not needed, already in this codebase, the standard library or platform, an installed dependency, new code. One implementation per rule. No wrapper, option, flag, config, interface or file nobody asked for; comment only a why the code cannot show. Delete what your change makes dead. Never cut correctness, security, tests or anything asked for; a case of the task you know still fails, or that your change broke, is unfinished. New behavior gets one focused test; reproduce a reported bug first.

"Project instructions take precedence" means your own CLAUDE.md or AGENTS.md wins where the two disagree. If `lessloc init --rules` already put this exact text in AGENTS.md, it is not sent again, because the agent tool loads AGENTS.md itself. In Claude Code that holds unless the repository has a CLAUDE.md that does not import AGENTS.md, which is why `init --rules` adds an `@AGENTS.md` line to an existing CLAUDE.md.

**The project's own rules**, when `.lessloc.json` sets `protect` or `boundaries`, as one line:

```text
In this project: only the user changes `migrations/**`; `shop/**` must not import `flask` (the shop core stays framework-free).
```

**A note from the last session**: what it left uncommitted. See [The handoff](#the-handoff).

When Claude Code compacts a long conversation, the standard and the project's rules are given again.

Once a day, session start also has lessloc check for its newest published release in a background process. The agent gets nothing from it and the session waits for nothing ([Update lessloc](/guide/getting-started#update-lessloc)).

### Why the standard is short

Every rule in the standard is something the agent may act on in every task, and acting costs tokens. A rule to prove that a test fails first can end up applied to new features too, a step that lists every place a change must reach makes agents think longer before their first edit, and a closing report makes them count lines. So the standard asks to reproduce a bug first only when one is reported, has no planning step, and asks for no closing report.

[Benchmarks](/benchmarks#results) has the results of lessloc with this standard.

## Each prompt: what your code already has

When a specific word of the prompt matches the name of something your code defines, the agent gets up to five places that may already do part of the task. For example, for the task "Bug: amounts that end in half a cent round down":

```text
Existing code that may already do part of this (matched by name; search for other names too):
- shop/money.py:1  def to_money(value):
- shop/money.py:5  def format_money(amount):
- shop/payouts.py:6  def round_payout(value):
```

- Matching uses names and doc words. When nothing matches, nothing is sent: no map of the codebase, no guesses.
- Definitions are indexed for [these languages](/guide/faq#which-agent-tools-and-languages-does-it-support). The index is kept in lessloc's own folder, outside your repository, and updated file by file as files change.
- In Claude Code, a subagent gets the hints for its own task inside its own prompt, so parallel subagents never receive each other's.

See [Reimplemented helpers](/patterns/reuse-helper) and [Findability](/patterns/#findability).

## Before each write: the gate

The gate sees writes made with Write, Edit and MultiEdit, files a shell command writes from a heredoc (`cat > file <<EOF` or `tee file <<EOF`), and patches (Codex's apply_patch, OpenCode's patch tool). It judges only the lines a write adds, never lines already in the file. For NotebookEdit it checks only which file is written, not the cells. Writes made any other way, such as by `sed -i` or a script, are checked by the review at the end of the turn and by the commit gate instead. In Cline's VS Code extension nothing is gated, because a hook there can only end the whole run ([Cline](/guide/getting-started#cline)). In Aider, lessloc runs as its lint command, so the same problems come back to the agent as lint errors after the edit has landed ([Aider](/guide/getting-started#aider)).

The gate refuses these, and the tool's own error tells the agent why:

- **A placeholder**, such as `# ... existing code ...` or "your code here". ([Placeholders](/patterns/placeholders))
- **Commented-out code.** ([Commented-out code](/patterns/commented-out))
- **A new backup, copy, scratch or report file**, such as `money.py.bak`, `money_old.py` next to `money.py`, `debug_x.py` or `repro.py` at the root, or `IMPLEMENTATION_SUMMARY.md`. A file the prompt names is allowed. ([Scratch files](/patterns/#scratch-files), [report files](/patterns/#report-files))

What the agent reads:

```text
Not applied: it adds a placeholder (`# ... existing code ...`). Write the real code, or tell the user plainly what is not done.
```

```text
Not applied: `shop/money_old.py` is a backup, copy, scratch or report file. Edit the real file instead; git keeps history.
```

These go to you for approval, because the agent should not decide them alone:

- such writes to `.lessloc.json`, `.lessloc-baseline.json` or a path listed in `protect` ([policy edits](/patterns/#policy-edits)). A change to them made another way, such as by `sed -i`, is a tier-0 finding (`policy` or `protected`) that holds the turn when it ends, unless that change turns lessloc off. These findings exist only in agent sessions: `lessloc check`, the commit gate and CI do not report them;
- commands that skip the project's checks in these forms: `--no-verify` on `git commit`, `push`, `merge`, `rebase`, `am` or `cherry-pick`, `git commit -n`, `HUSKY=0`, `SKIP=…`, `LESSLOC=off` or `LESSLOC_OFF=…` in front of a command, and a `git` command that names `core.hooksPath` in any letter case ([skipping the checks](/patterns/#bypass)). Text the command only hands a program as data is not read for these: a quoted message for `git commit`, `merge`, `tag`, `notes` or `stash` (`-m`, `--message`) or for `gh pr`, `issue` or `release` (`--title`, `--body`), Claude Code's `"$(cat <<'EOF' … EOF)"` form included, a quoted search pattern (`grep`, `rg`, `ag`, `ack`, `git grep`, `git log --grep`), and the body of a heredoc with a quoted delimiter that `cat` or `tee` writes to a text, docs, Python or JavaScript file or that Python or Node reads. If anything else in the command could run text (a shell, `eval`, `source`, `xargs`, `sudo` and the like, a `$( )` or backtick substitution, a variable or a path run as a command, a line continuation), all of it is read as before. Other ways around the git hooks are left to CI, the check that binds ([what each layer stops](/guide/ci#what-each-layer-stops)).

The approval prompt is written for you, so it is the one text that names lessloc:

```text
lessloc: `migrations/002.sql` is protected in this project. Only you change it, so approve only what you asked for.
```

In every tool except Claude Code, OpenCode 2.x, Factory Droid and VS Code's agent mode, an approval request becomes a refusal that tells the agent to ask you in its reply. Codex lets unanswered approval requests through, and Copilot's cloud agent has no one to ask, so a question there would stop nothing:

```text
Not applied: this command skips the project's own checks (`--no-verify`), and only the user may approve that. Ask them in your reply; if they agree, they can do it themselves.
```

The gate skips files outside the repository, paths in [`allow`](/guide/configuration#allow), and the files lessloc always leaves alone, listed there. `"mode": "warn"` in `.lessloc.json`, or `LESSLOC_OFF=gate`, turns the gate off.

What a tool call changed is read from snapshots of the working tree taken before and after it. Where lessloc cannot read a tool's input, the snapshots alone say which files changed, so the review keeps working even if an agent tool changes a write tool's input format.

## Right after a write

After each write, and after each shell command, patch or (in Claude Code) writing MCP tool that changed files, lessloc checks the lines just written with its fast checks. The agent hears one line per problem, at most three, and only about problems that are cheapest to fix while the code is still open:

- a credential in the source, or a new `.env` file ([secrets](/patterns/secrets));
- a swallowed error, such as `except Exception: pass` ([swallowed errors](/patterns/swallowed-error));
- an import that the project's `boundaries` forbid ([boundaries](/patterns/#boundary)).

```text
shop/config.py:4: swallowed error: let it reach a boundary that handles it, or catch only the error you expect
```

Each problem is said once per session. Everything else waits for the end of the turn: copy detection runs once, over the whole codebase, and a debug print or a stub may be on purpose while the work is in progress.

The note is added to the tool's result as context; it never replaces the result. `LESSLOC_OFF=lines` turns these notes off after Write and Edit calls, and `LESSLOC_OFF=shell` after shell commands, patches and MCP tools.

### A turn that does not end

A request with no natural end, such as "reach 100% coverage" or "fix every warning", can keep an agent going until something stops it. Almost every task takes far fewer than 40 tool calls, so after the 40th call of a turn the agent is told once:

```text
This turn has taken many steps. If what is left of the request has no natural end (all coverage, every warning, every case), finish with what works now and say exactly what is left. Otherwise carry on.
```

A task that simply needs more steps carries on. The count starts again with each prompt. `LESSLOC_OFF=pace` turns the note off.

## End of turn: unfinished work is held once

When the agent says it is done, lessloc reviews exactly the files this session changed during the turn, what the agent's own test runs showed, and what its last reply says is left. In Claude Code, when a subagent finishes, its own files are reviewed the same way.

If the work is done, the agent gets nothing. If not, it gets one note with what is unfinished, once per turn. The note lists up to eight items; the rest are not shown in that session. For example, after a fix for "amounts that end in half a cent round down" whose reply ends with a case it left alone:

```text
Before you finish (this turn: +6 −2 lines, 0 new files):
- You say: "Not fixed: `round_payout(2.675)` in shop/payouts.py still rounds down; I left it alone to keep the change small." That is part of the request and it still fails: fix it in this change. Leave it only if the request itself rules it out, and quote that line.
Fix only these and add nothing else for this note. If one is intended, say why in one line. Then finish.
```

What holds a turn by default:

- The tests fail on the final state, or the turn changed how the tests run. ([Unverified](/patterns/#unverified))
- A function, option or flag the request asked for appears nowhere in the code. ([Stopping short](/patterns/unaddressed))
- The agent's last reply says part of the reported problem still fails, or that the same problem may be elsewhere and it did not check. ([Leaving part of the problem failing](/patterns/unfinished))
- Tests were weakened: deleted, skipped, focused or forced to pass. ([Weakened tests](/patterns/weakened-tests))
- New behavior has no test. ([Untested](/patterns/untested))
- Stubs, debug prints, placeholders, commented-out code or junk files are left in. ([Stubs](/patterns/stubs), [debug leftovers](/patterns/debug-leftovers))
- New code copies code that already exists, or keeps old and new versions side by side. ([Reimplemented helpers](/patterns/reuse-helper), [side by side](/patterns/side-by-side))
- Credentials, swallowed errors, silenced checks, unsafe shortcuts, made-up APIs, test-only logic in production code, or tests that assert nothing.
- The project's policy is broken: a protected path, a boundary, or a dependency outside `approvedDependencies`.

The exact list is the [`interrupt`](/guide/configuration#interrupt) setting, which you can change. It is not what fails CI: `check` and CI fail only on [tier-0 findings](/guide/ci#review-a-change-lessloc-check), so tests that assert nothing, for example, hold a turn but only warn on a pull request. The [Reference](/guide/reference#finding-kinds) explains each kind.

How the hold stays cheap:

- **Once.** Each agent, and each subagent, is held at most once per turn, whatever its agent tool reports. An item held once is not raised again later in the session.
- **The agent may disagree.** If something is intended, the agent says why in one line and finishes.
- **Nothing new.** The note says to fix only what it lists and add nothing else, so a review does not make the code grow. ([Review bloat](/patterns/#review-bloat))
- **Only at the end.** Debug prints, stubs and behavior without a test are judged when the turn ends, never mid-work. Behavior without a test is not raised for a subagent's part of a change, for refactors, for fixes that do not grow the code, or in projects without tests.
- **Subagents are not asked for tests or for the whole request.** A subagent's work is often one part of a change, so the tests, the requested names and the final reply are checked when the turn that holds it ends.
- **No reports.** Everything else lessloc notices is never shown to the agent. It goes into the next session's handoff and into `lessloc check`.

In Claude Code and Codex, the note comes back as the reason the agent cannot stop yet. Other tools may deliver it another way, as each tool's section in [Getting started](/guide/getting-started#supported-agent-tools) says. [Cline](/guide/getting-started#cline), [Crush](/guide/getting-started#crush) and [Aider](/guide/getting-started#aider) cannot hold a turn.

### What a request asks for

A name in the request counts only when the request asks for it to exist: "add a `--status` flag", "implement `export_csv()`", "rename `x` to `y`". A name the request only mentions (the API a bug report is about, a test or helper it describes, a tool it ran, anything inside a URL) is no promise. Names joined by "or" are alternatives, and a close spelling that the change wrote counts, so a typo in the request holds nothing. When a requested name appears nowhere in the repository, the agent reads:

```text
The request asks for `--status`; it appears nowhere in this repository.
```

How often this check would have held commits that people merged is on the [Benchmarks](/benchmarks#precision-on-code-humans-merged-without-a-model-bench-replay-mjs) page.

### What the reply says is left

In a turn that changed code, lessloc reads the agent's last reply, sentence by sentence, for part of the request that the reply itself says still fails. These count:

- a sentence that marks something as left broken, such as "Not fixed:" or "Known limitation:", and states a failure now;
- a scope note, such as "Not changed:" or "I left it alone", with a defect that is still there and tied to the request: a name from the request's code, or the report's own example;
- the report's own example still failing;
- a suspicion that the same problem is elsewhere, not checked.

A heading or a lead-in speaks for the lines under it. A fixed state, a cause, a condition, an offer, a tool's report or housekeeping, such as the changelog or the docs, never counts. The agent reads its own sentence back, as in the note above; for a suspicion, it is asked to check it now and fix it in this change if it fails the same way. An item is known by the names it quotes in backticks, so the same admission reworded in a later turn is not held again. A subagent's reply is not read, and `LESSLOC_OFF=unfinished` turns this check off.

## How test runs are read

lessloc never runs your tests during a session. The agent runs them, as it would anyway, and lessloc reads the result from the agent tool. [Making agents verify their work](/guides/verification#what-counts-as-evidence) explains what counts as a passing run, and how lessloc reads each way agents run tests.

## The agent never sees lessloc

Nothing the agent reads names lessloc, shows one of its paths or commands, tags a finding with its kind, or cites a source. Every text an agent can read is in [lib/voice.mjs](https://github.com/rextail-ai/lessloc/blob/main/lib/voice.mjs). [test/hooks.test.mjs](https://github.com/rextail-ai/lessloc/blob/main/test/hooks.test.mjs), [test/hosts.test.mjs](https://github.com/rextail-ai/lessloc/blob/main/test/hosts.test.mjs) and [test/adapters.test.mjs](https://github.com/rextail-ai/lessloc/blob/main/test/adapters.test.mjs) check this for every agent tool.

- The command the hooks run is `hook.mjs`, a name that says nothing more, because some agent tools show it to their model.
- In Claude Code, lessloc answers as added context, not through exit code 2, which Claude Code shows to the model as a "blocking error" with the hook's command and plugin name.
- The `/lessloc` skill in Claude Code is for you. It is never listed to the agent.
- The handoff note leaves out any open item or closing message that names lessloc.
- Nothing appears in your working tree; lessloc's state is in your user cache ([Files lessloc writes](/guide/reference#files-lessloc-writes)).
- The only texts lessloc sends that name it are the approval prompts, because they are written for you. Commit trailers, when you turn them on, name lessloc in the history.
- Two files you can ask lessloc to write into the repository name it, and the agent can read them there: the markers of its block in AGENTS.md (`init --rules`), and the setup step that installs lessloc for Copilot's cloud agent (`init --copilot --repo`). The cloud agent's hook file and the folder it runs lessloc from have neutral names.

What was checked live in each agent tool is in [Supported agent tools](/guide/getting-started#supported-agent-tools).

## Several agents in one checkout

Several agents can work in one checkout at once, and in Claude Code a session can start subagents.

- Each session keeps its own journal of the files its tools wrote, and its review covers only those files. One agent is never held for another agent's files.
- A file that two sessions both edit holds both sessions' lines.
- A subagent's writes are tracked by its id. Its own work is reviewed when it finishes, and its hints go into its own prompt.
- Test results are kept one file per state, and handoff records one file per session. Each file is written whole, and the journals only grow by appended lines, so hooks running at the same time never lose each other's updates.
- Each checkout, and each git worktree, has its own state folder. Agents in separate worktrees share nothing.
- People who share one checkout under their own accounts each have their own state, in their own account's cache, so one person's agent is never told another person's prompts. Each account's lessloc folder is readable by that account alone ([In your user cache](/guide/reference#in-your-user-cache)). ([Busy sessions](/patterns/#busy-sessions))

## The handoff

At the end of each turn that changed files, lessloc keeps a record of it: the request, the files, whether the final state was verified, what was left open, and the agent's last words. "Left open" is what the review still found in those files, in plain words.

The next session in this checkout starts with that record if those files still have uncommitted changes and the record is less than two weeks old:

```text
The last session here (2h ago) was asked "Add a `--status` flag that prints the queue size" and left uncommitted changes in cli.py, tests/test_cli.py; its tests passed at its final state. It ended with: "Added --status with a test; the suite passes."
```

Once the work is committed, the note stops: from then on the commit is the handoff. To keep what was verified in the history itself, turn on [commit trailers](/guide/ci#trailers).

The record lives in your user cache, per checkout. It is not shared through git, so a teammate on another machine never gets it. `LESSLOC_OFF=handoff` stops the note. ([Handoff](/patterns/#handoff))

[ARCHITECTURE.md](https://github.com/rextail-ai/lessloc/blob/main/ARCHITECTURE.md) shows how the code is built.
