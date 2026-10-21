---
title: "Why your AI coding agent bill grows"
description: "Where the money goes in an AI coding agent session, why every extra turn costs more than it looks, what lessloc itself costs, and which levers work."
---

# Why your agent bill grows

A coding agent's bill is not only the code it writes. With every model call, the agent reads its whole session again, and it thinks before it acts. This page shows where the money goes in a session, why every extra turn costs more than it looks, what lessloc itself costs, and which levers work.

On the [benchmarks](/benchmarks#results), lessloc cost 23% less per task, its own hooks included, with the same results on the projects' own tests.

## Where the money goes

With prompt caching, as Claude Code uses it, a model call is billed in these parts:

| Part of the bill | What it is |
|---|---|
| Writing to the cache | What is new to the session: the agent tool's own system prompt and tool definitions when a session starts, then each new message and tool output |
| Reading from the cache | What is already in the session, sent again with each model call |
| Output | The model's reasoning and its replies |
| Uncached input | Input that is neither written to nor read from the cache |

Reading from the cache costs much less per token than writing to it, so the tokens a session carries cost less than their count suggests.

To see how the parts add up, follow one session. Every model call sends the whole session again: the agent tool's system prompt and tool definitions, your instructions, every message and every tool output so far. What was sent before is read from the cache. What is new, such as the output of the last command, is written to the cache. Then the model thinks and answers, and that is output.

Three things follow:

- **A new session pays an entry fee** before it reads a single file of yours: the agent tool's own system prompt and tool definitions, written to the cache.
- **Every tool output is paid for more than once.** It is written to the cache when it arrives, then read again by every later call in the session. A long test log read early in a long session is carried to the end.
- **Output, the model's reasoning and replies, is paid for on every call**, and what you tell an agent changes how much it thinks.

lessloc's hooks run on your machine and call no model ([how long they take](/guide/faq#does-lessloc-slow-my-agent-down)). In money, lessloc costs the text it adds to a session, and whatever that text and its holds make the agent do.

## Why each extra turn costs

A turn runs from your prompt to the agent's final reply. When something sends the agent back after it said it was done, the session goes on: at least one more model call that reads the whole session from the cache, new reasoning, usually a command or two whose output is written to the cache and read by every call after it, and a new final message. The longer the session, the more each of those calls re-reads. A turn added at the end of a session is the most expensive kind.

A turn that changes nothing, such as one spent on work that was already done, costs all of this too.

## What lessloc itself costs

[A session at a glance](/guide/how-it-works#a-session-at-a-glance) lists the tokens lessloc adds at each hook event, and in one scripted session. [Benchmarks](/benchmarks#results) has what each setup cost per task.

The tokens of a rule are cheap: a short standard is small next to the agent tool's own system prompt and tool definitions. What a rule makes agents do is not cheap: extra test runs, longer thinking, turns sent back. That is [why the standard is short](/guide/how-it-works#why-the-standard-is-short).

## The levers that work

### Say less

Every sentence an agent reads at the start of a session is a behavior it may act on, and it may act on it more widely than you meant: a rule written for bug fixes can be applied to new features too. Keep the sentences that change outcomes and cut the rest.

The same goes for your own instruction files and for what tools print. lessloc notes always-loaded instructions that grow past `instructionBudget` or gain a directory tour ([long instructions](/patterns/long-instructions)). And since every tool output is carried to the end of the session, a quiet test run, such as `pytest -q` or a `tail` that keeps the summary line, costs less to carry. lessloc still reads its result.

### Never force a turn without near-certainty

A hold is the most expensive thing a tool can do to a session, and a wrong hold buys nothing: send an agent back only when you are nearly sure, once, with exactly what to fix ([Hold only on near-certain evidence](/guides/verification#hold-only-on-near-certain-evidence)).

### Give facts that save exploration

An agent that has to find something pays for every search, every file it opens and every output it reads, until the session ends. A fact handed over at the right moment is cheaper.

- **Existing code.** When a specific word of the prompt names existing code, lessloc points the agent to it ([hints](/guide/how-it-works#each-prompt-what-your-code-already-has)).
- **The test command.** An agent that does not know how to run the project's tests spends calls finding out. Put the test command in one line of the instructions your agent tool already loads, such as AGENTS.md or CLAUDE.md, so the agent knows it up front ([your part](/guides/verification#your-part)).
- **Unfinished work.** When the last session left uncommitted changes, the next one starts with [a record of them](/guide/how-it-works#the-handoff) instead of rediscovering them.

### Leave less code for every later session

Every line an agent leaves is read again by later sessions that touch it. How much code agents with and without lessloc added on real changes to real projects is on the [Benchmarks](/benchmarks#results) page. [Why less code](/why-less-code) collects the outside evidence on what extra code costs later.
