---
title: "Start here: lessloc in one sentence"
description: "Install lessloc by telling your AI coding agent one sentence. What you will notice, how to check that it works, and how to remove it the same way."
---

# Start here

## Install it

Open your coding agent in your project, such as Claude Code, Codex or Cursor, and tell it:

> Install lessloc for this project by following https://lessloc.org/install.md

Your agent checks your computer, installs lessloc for the coding tools it finds, and tells you what it did. Then start a new session. That is all.

## What you will notice

Almost nothing. Your agent works as before and writes less code. Now and then:

- when it says "done" but its own tests still fail, it is sent back to fix them first;
- a placeholder, commented-out code or a stray backup file is refused, and the agent writes the real thing;
- a commit with problems like these is stopped until they are fixed;
- when it tries to edit `.lessloc.json`, `.lessloc-baseline.json` or a file you protected, or to skip the project's checks, such as with `git commit --no-verify`, you are asked first, in a prompt that starts with `lessloc:`. [The gate](/guide/how-it-works#before-each-write-the-gate) says what tools that cannot show such a prompt do instead.

## Check that it works

Tell your agent:

> Check that lessloc works, as https://lessloc.org/agents describes

## Remove it

Tell your agent:

> Remove lessloc by following https://lessloc.org/remove.md

## Works with

Claude Code, Codex, OpenCode, GitHub Copilot, Gemini CLI, Cursor and many more: see [the full list](/guide/getting-started#supported-agent-tools).

## Free and private

Open source under the Apache-2.0 license. No account and no API key. lessloc makes no network calls of its own, so your code and your prompts stay on your computer ([every network contact](/guide/faq#does-my-code-leave-my-machine)).

## More

[How it works](/guide/how-it-works) · [Settings](/guide/configuration) · [Benchmarks](/benchmarks) · [Getting started, for developers](/guide/getting-started)
