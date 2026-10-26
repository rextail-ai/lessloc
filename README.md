<!-- Plain-text docs for AI agents: https://lessloc.org/llms.txt (index), https://lessloc.org/llms-full.txt (all docs in one file), https://lessloc.org/agents (what an agent runs when its user asks about lessloc). Installing for a user: https://lessloc.org/install.md. Removing: https://lessloc.org/remove.md. Current install count: the <title> of https://lessloc-counter.rextail.ai/slime-light.svg. -->

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://lessloc.org/lessloc-pixel-transition.webp">
    <img alt="lessloc: less lines of code" src="https://lessloc.org/lessloc-pixel-transition-light-page.webp" width="640">
  </picture>
</p>

<h1 align="center">Your AI coding agent, without the bloat</h1>

<p align="center"><b>Up to 36% less code and 26% lower cost, with the same results.</b></p>

<p align="center">For Claude Code, Codex, OpenCode, GitHub Copilot, Gemini CLI, Cursor and <a href="https://lessloc.org/guide/getting-started#supported-agent-tools">many more</a>.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lessloc"><img alt="npm version" src="https://img.shields.io/npm/v/lessloc"></a>
  <a href="https://github.com/rextail-ai/lessloc/actions/workflows/test.yml"><img alt="tests" src="https://github.com/rextail-ai/lessloc/actions/workflows/test.yml/badge.svg"></a>
  <a href="https://github.com/rextail-ai/lessloc/blob/main/LICENSE"><img alt="license: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
</p>

<p align="center"><a href="https://lessloc.org/start"><picture><source media="(prefers-color-scheme: dark)" srcset="https://lessloc-counter.rextail.ai/slime-dark.svg"><img alt="lessloc installs, counted live" src="https://lessloc-counter.rextail.ai/slime-light.svg" width="360" height="240"></picture></a></p>

## Install in one sentence

Tell your coding agent:

```
Install lessloc for this project by following https://lessloc.org/install.md
```

Claude Code? Or type these in its prompt box:

```
/plugin marketplace add https://get.lessloc.org/claude/lessloc.git
/plugin install lessloc@lessloc
```

To remove it: `Remove lessloc by following https://lessloc.org/remove.md`

**On npm?** Install it with the sentence above; your agent sets up the hooks.

## Measured on real work

<p align="center"><a href="https://lessloc.org/benchmarks"><picture><source media="(prefers-color-scheme: dark)" srcset="https://lessloc.org/results-dark.svg"><img alt="117 real changes in 3 open-source projects, judged by hidden tests: 27% less code, 23% lower cost, the same results" src="https://lessloc.org/results-light.svg" width="880"></picture></a></p>

## How it works

<p align="center"><a href="https://lessloc.org/guide/how-it-works"><picture><source media="(prefers-color-scheme: dark)" srcset="https://lessloc.org/mechanism-dark.svg"><img alt="How lessloc works inside your agent's own loop, through the hooks your agent tool already has: at session start it adds a short working standard, at each prompt it points to code you already have, before a write it refuses placeholders and junk, after a write it flags secrets and swallowed errors, and at the end of the turn it sends unfinished work back once. Principles: the least code that stays correct, reuse before new code, act in the loop with no reports, the agent's test runs as proof, review only the change. Built on Node.js with no dependencies, no API key and no model calls, git for snapshots, one table for 20+ agent tools, and a code index for 16 languages." src="https://lessloc.org/mechanism-light.svg" width="880"></picture></a></p>

## What changes

- **Less code to review.** It reuses what your project already has.
- **A smaller bill.** Fewer tokens per task.
- **No junk.** Placeholders, commented-out code and stray backup files are refused.
- **It finishes the job.** If its own tests still fail at "done", it goes back to fix them.

## Free and private

Open source (Apache-2.0). No account, no API key, no network calls of its own, no dependencies.

## Learn more

[Getting started](https://lessloc.org/guide/getting-started) · [How it works](https://lessloc.org/guide/how-it-works) · [Settings](https://lessloc.org/guide/configuration) · [Commits and CI](https://lessloc.org/guide/ci) · [FAQ](https://lessloc.org/guide/faq)

[Contributing](https://github.com/rextail-ai/lessloc/blob/main/CONTRIBUTING.md) · [Security](https://github.com/rextail-ai/lessloc/blob/main/SECURITY.md) · [Changelog](https://github.com/rextail-ai/lessloc/blob/main/CHANGELOG.md) · [License](https://github.com/rextail-ai/lessloc/blob/main/LICENSE)
