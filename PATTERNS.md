# What lessloc catches, and why each is a bad practice

AI coding agents bloat software in recurring, documented ways. This catalog lists each one, the software-engineering standard that already calls it a bad practice, and what lessloc does about it:

- **Rule**: the line in [RULES.md](RULES.md) that prevents it. Every session gets the rules; in Claude Code, each subagent gets a one-line working standard.
- **Kind**: the finding lessloc reports when it happens anyway. **Stops** marks a kind that holds an agent's turn once, sending it back with what is unfinished. Tier-0 kinds also fail `lessloc check`, except `tests-failed`, `policy` and `protected`, which only agent sessions report, and `weakened-tests`, which `check` reports at tier 1. All other kinds are notes to the user.
- **When**: *write* means right after each edit, while the code is still open; *turn* means when the agent says it is done; *check* means commit and CI; *audit* means the whole codebase.

Every detected row is proven by a test: bad and good forms in [test/cases.mjs](test/cases.mjs), where the bad form must be caught and the good form must not be, so the push for less code never flags what the code needs; or a named test. [test/catalog.test.mjs](test/catalog.test.mjs) fails when a row has neither.

The standards cited are the ones engineers already use:
- **CWE weaknesses.** Those in the maintainability measure of ISO/IEC 5055:2021, the international standard for automated source-code quality, are 561, 1041, 1047, 1064, 1074, 1080, 1085 and 1121.
- **Linter rules** that ship enabled in common configurations.
- **Refactoring, clean-code and testing literature.**
- **The model vendor's own guidance.** Anthropic's prompting guide says recent Claude models "have a tendency to overengineer by creating extra files, adding unnecessary abstractions, or building in flexibility that wasn't requested."

Sonar now ships a quality profile for agent-written code that targets "code duplication and structural drift" and "hallucinated APIs and supply-chain risks".

## Why unneeded size does more harm than good

Code, text, files and folders that a requirement does not need cost something every time anyone works on the software:

- **Every line is spent, not produced.** Dijkstra (EWD1036): "if we wish to count lines of code, we should not regard them as 'lines produced' but as 'lines spent'."
- **Complexity grows unless someone reduces it.** Lehman's second law: "As an evolving program is continually changed, its complexity, reflecting deteriorating structure, increases unless work is done to maintain or reduce it."
- **Errors grow with size.** McConnell, *Code Complete*, ch. 27: error density rises with program size.
- **Duplicated knowledge breaks.** A rule written in two places gets fixed in one. DRY says "every piece of knowledge must have a single, unambiguous, authoritative representation within a system."
- **Big changes get worse reviews.** Google's engineering practices: "100 lines is usually a reasonable size for a CL, and 1000 lines is usually too large."
- **For AI agents, size is attention.**
  - Models do worse as their input grows: "performance grows increasingly unreliable as input length grows" ([Chroma, Context Rot](https://research.trychroma.com/context-rot)).
  - Models miss what sits in the middle of long contexts ([Liu et al., TACL 2024](https://aclanthology.org/2024.tacl-1.9/)).
  - Anthropic calls context "a finite resource with diminishing marginal returns." Every extra line, comment, file or doc is read by every later agent session, and it competes with what matters.
- **Comments and docs that restate code drift into lies.** CWE-1116, Inaccurate Source Code Comments. *Code Complete* counts a comment that repeats the code as unacceptable in finished code.
- **Fragmentation costs navigation.** Shallow files and folders hold little behind each name (Ousterhout). Always-loaded overviews raised agents' cost by more than 20% without helping ([arXiv:2602.11988](https://arxiv.org/abs/2602.11988)).

None of this applies to code a requirement needs. Tests, validation, error handling, security and the docs a reader needs are never "bloat", and duplication is still cheaper than the wrong abstraction (Metz). lessloc targets growth nobody needs, and the counterweights at the end of this file keep it from going further.

## Why agents need this more than people do

- **Duplication up, reuse down.** From 2021 to 2024, copy-pasted lines rose from 8.3% to 12.3% of changed lines, and moved or refactored lines fell from 25% to under 10% (211M lines; [GitClear 2025](https://www.gitclear.com/ai_assistant_code_quality_2025_research)).
- **Lasting complexity.** Adopting Cursor brought +30% static-analysis warnings and +42% cognitive complexity in about 800 repositories. Both persisted while the speed gain faded ([arXiv:2511.04427](https://arxiv.org/abs/2511.04427)).
- **Short-lived code.** Functions and classes that agents add are deleted after a median of 3 days, against 34 for human code ([arXiv:2601.17627](https://arxiv.org/abs/2601.17627)).
- **Debris in passing patches.**
  - In passing patches, 18–33% of the patch could be removed with the tests still passing ([arXiv:2607.18161](https://arxiv.org/abs/2607.18161)).
  - 29% of passing SWE-bench patches wrapped obsolete code in a guard instead of deleting it ([arXiv:2607.28887](https://arxiv.org/abs/2607.28887)).
- **Weak tests.**
  - 80% of agent test patches have a weak oracle or none ([arXiv:2606.18168](https://arxiv.org/abs/2606.18168)).
  - Agent commits add mocks more often than human commits: 36% against 26% ([arXiv:2602.00409](https://arxiv.org/abs/2602.00409)).
- **Type escapes.** In TypeScript agent pull requests, `any` appears at 9 times the human rate ([arXiv:2602.17955](https://arxiv.org/abs/2602.17955)).
- **Made-up packages.** Between 5.2% and 21.7% of the packages that models recommend do not exist ([Spracklen et al., USENIX Security 2025](https://www.usenix.org/conference/usenixsecurity25/presentation/spracklen)).
- **The cost lands on the next agent.** Cleaner code cut Claude Code's tokens by 7–8% and its file revisits by 34%, at an equal pass rate ([arXiv:2605.20049](https://arxiv.org/abs/2605.20049)).
- **Less stable delivery.** A 25% rise in AI adoption went with 7.2% lower delivery stability ([DORA 2024](https://dora.dev/ai/gen-ai-report/)).

The figures come from the cited studies, as each reports them, not from lessloc. lessloc's own measurements are in [bench/README.md](bench/README.md).

<!-- catalog:start -->
## 1. Code that already exists

| Pattern | Standard that calls it bad | lessloc |
|---|---|---|
| Reimplements a helper the project already has, under the same or another name | DRY (Hunt & Thomas, *The Pragmatic Programmer*); Fowler, *Refactoring*: Duplicated Code; CWE-1041 Use of Redundant Code; Sonar S4144 | **Rule:** take what is already in the codebase before new code; hints name existing code before the task and inside each subagent's prompt. **Kinds:** `copy` (**stops**), `near-copy`, `similar-name`. **When:** turn, check, audit |
| Copies a rule another function owns: a format, regex, SQL or date pattern | DRY; Sonar S1192 | `repeated-literal`: turn, check |
| Keeps old and new versions side by side (`parse_date_v2`, `fooFixed`, `legacyFoo`, `app_new.py`) | DRY; Clean Code G9 Dead Code | **Rule:** one implementation per rule. **Kinds:** `versioned-copy` (**stops**); `junk-file` (tier 0) for files. **When:** write (files), turn (definitions) |
| Rebuilds what the standard library or framework has: counters, flag loops, CSV, date math, argument parsing | Bloch, *Effective Java* Item 59: Know and use the libraries | **Rule.** `simpler` and `reinvented`. The working standard puts the standard library and the platform before new code. `simpler` catches hand-built counters, flag loops and `range(len())`. `reinvented` catches deep clone, UUID, debounce, slugify, CSV and flag parsing written by hand, and retry loops where the project already retries |
| Copy-pasted test cases instead of one parametrized test | Meszaros, *xUnit Test Patterns*: Test Code Duplication | `copied-tests`: turn, check |
| Adds a second library for a job an installed one already does (dayjs beside moment) | One obvious way to do it (PEP 20); OWASP Top 10 A06:2021 and A03:2025 Software Supply Chain Failures | `new-dependency` names the library that is already installed |
| The same data shape in several layers (DTO, model, entity) | DRY | `copy` (**stops**) catches identical type bodies |
| The same CSS declarations under another selector; the same long utility-class string again and again | DRY; Tailwind docs: Reusing Styles | `style-copy` |

## 2. Code nobody needs

| Pattern | Standard that calls it bad | lessloc |
|---|---|---|
| Options, flags, parameters or config for needs nobody named | YAGNI (Extreme Programming); Fowler: Speculative Generality; Clean Code F3 Flag Arguments; Google engineering practices: over-engineering, "functionality that isn't presently needed" | **Rule.** `mode-flag` |
| An interface, trait, protocol or abstract class with one implementation | Fowler: Speculative Generality (Collapse Hierarchy); Ousterhout, *A Philosophy of Software Design*: classitis | `single-impl` |
| Wrappers that only forward; barrel files that only re-export | Fowler: Middle Man, Lazy Element; Ousterhout: Pass-Through Method, Shallow Module; Vite performance guide: avoid barrel files | `wrapper` |
| A new function or import that nothing calls or tests | CWE-561 Dead Code; CWE-563 Assignment to Variable without Use; Sonar S1128, S1144 | `unused`: turn, check (ruff adds unused variables) |
| Obsolete code kept behind a guard or flag instead of deleted | CWE-561; Fowler: Remove Dead Code | **Rule:** delete what the change makes dead |
| Tombstones: `// removed X`, "kept for backward compatibility", comments citing the task | Clean Code C1 Inappropriate Information | `history` |
| Stubs and fake success: "in a real app you would...", `raise NotImplementedError`, `todo!()`, `throw new Error("Not implemented")`, `mockUsers` in production code | CWE-546 Suspicious Comment; Meszaros: Test Logic in Production | `stub` (**stops**): turn; it asks to finish the code or to tell the user what is not real yet |
| Placeholders: `# ... existing code ...`, "your code here" | CWE-546 | `placeholder` (tier 0): denied at write |
| Commented-out code | CWE-1085; Clean Code C5; Sonar S125 | `commented-out` (tier 0): denied at write |
| Debug leftovers: `debugger`, `breakpoint()`, `print("here")`, `print(f"{x=}")`, `dbg!` | CWE-489 Active Debug Code; ESLint no-debugger; Sonar S4507; clippy dbg_macro | `debug-leftover` (**stops**). Judged at turn end, because mid-work the print may still be in use |
| A demo `if __name__ == "__main__":` block in a module other code imports; an examples or demo folder nobody asked for | YAGNI | `demo-code`, `new-folder` |
| Hand-written boilerplate a language feature writes (an `__init__` that only stores its parameters) | PEP 557 (dataclasses) | `simpler` |
| A one-line helper used once | Fowler: Inline Function; Anthropic's prompting guide: "Don't create helpers, utilities, or abstractions for one-time operations" | `single-use` |
| TODO and FIXME left behind: work the agent did not finish and did not mention | CWE-546 Suspicious Comment; Sonar S1135 | `todo`: turn; it asks to finish the work, or to record known debt as `shortcut:` and tell the user |

## 3. Code longer than it needs to be

| Pattern | Standard that calls it bad | lessloc |
|---|---|---|
| Brute-force idioms: `== True`, an if/else that returns a boolean, index loops that only read `xs[i]`, `.filter(...).length > 0`, `indexOf(x) !== -1`, `x ? true : false`, `x ? x : y`, `.map().flat()`, `strings.Index(...) != -1`, `.len() == 0` | Sonar S1125, S1126, S1066, S1155; ESLint no-unneeded-ternary, no-lonely-if; typescript-eslint prefer-for-of, prefer-optional-chain; unicorn prefer-array-some, prefer-array-find, prefer-includes; PEP 8; ruff E712, SIM103; staticcheck S1002, S1003, S1008; clippy needless_bool, len_zero | `simpler`, built in for Python, JS/TS, Go, Rust, Java and C#. ruff (in every hook) and clippy (in `ci`) go deeper. **When:** turn, check |
| Hand-built counters and flag loops | Fowler: Replace Loop with Pipeline | `simpler` |
| A catch that only rethrows; logging an error and rethrowing it | ESLint no-useless-catch; Sonar S2737; ruff TRY203; McCune, "Exception-Handling Antipatterns": Log and Throw | `simpler` |
| A promise wrapped in `new Promise` | Bluebird: the explicit-construction anti-pattern | `simpler` |
| Annotating types the compiler infers | typescript-eslint no-inferrable-types | `simpler` |
| A React Effect that only sets state from other values | React docs: "You Might Not Need an Effect" | `simpler` |
| Functions with many parameters (8 or more) | CWE-1064 (ISO/IEC 5055 maintainability); Sonar S107; Clean Code F1 Too Many Arguments | `long-params` |
| Deep nesting | CWE-1124 Excessively Deep Nesting; Sonar S134; Fowler: Replace Nested Conditional with Guard Clauses | `deep-nesting`: turn |
| Long functions | Fowler: Long Function; Sonar S138; CWE-1121 | `long-function`: turn |
| If-chains on literal values | Fowler: Repeated Switches | `if-chain` |
| A file that keeps growing | CWE-1080 Source Code File with Excessive Number of Lines of Code | `swollen-file` |
| Reformatting lines the task did not change | Google engineering practices: small, focused changes | **Rule.** `churn` |
| Net growth past a budget | Lehman's law of increasing complexity | `net-growth` (note) |
| Golfed code: nested ternaries, comprehensions with several `for` clauses, lines over 160 characters | Google Python Style Guide: "Optimize for readability, not conciseness"; ESLint no-nested-ternary; Sonar S3358 | `clever`, `dense-lines`. The counterweight to `simpler`, so shorter never means cryptic |

## 4. Errors and checks hidden

| Pattern | Standard that calls it bad | lessloc |
|---|---|---|
| Swallowed errors: `except: pass`, an empty catch, `catch (Exception e) { return null; }`, Go's `if err != nil { return nil }` | CWE-390 Detection of Error Condition Without Action; CWE-1069 Empty Exception Block; CWE-396 | `swallowed-error` (**stops**): write, turn |
| Silenced checks: `@ts-ignore`, `any`, blanket `# type: ignore` or `# noqa`, `eslint-disable` without a rule, `#[allow(dead_code)]`, `//nolint` without a reason | Clean Code G4 Overridden Safeties; typescript-eslint ban-ts-comment and no-explicit-any; eslint-comments no-unlimited-disable; ruff PGH003, PGH004; golangci-lint nolintlint | `suppression` (**stops**): turn, check |
| Checks, fallbacks and catches for cases that cannot happen | Meyer, "Applying Design by Contract" (IEEE Computer, 1992): "never in both… avoid redundant tests"; Ousterhout: Define Errors Out of Existence; Anthropic's prompting guide: "Don't add error handling, fallbacks, or validation for scenarios that can't happen" | `defensive` catches a null check of a value just created, a type re-checked inside private code and `?.` on a fresh object |
| Removing validation, error handling, logging or stated rules to shrink code | lessloc's own "Never cut" list | `removed-safeguard` |

## 5. Shortcuts that trade away safety

Hand-written versions of what the platform does safely. They are short, which is why agents reach for them.

| Pattern | Standard that calls it bad | lessloc |
|---|---|---|
| SQL built from values with f-strings, concatenation or template strings | CWE-89 SQL Injection; OWASP Top 10 A03:2021 Injection | `unsafe` (**stops**): pass values as query parameters |
| HTML built or escaped by hand: `innerHTML` from values, `.replace('<', '&lt;')` | CWE-79 Cross-site Scripting; CWE-116 Improper Encoding or Escaping of Output | `unsafe` (**stops**): use `textContent` or the framework's rendering |
| `Math.random()` or `random` for tokens, passwords and session ids | CWE-338 Use of Cryptographically Weak Pseudo-Random Number Generator | `unsafe` (**stops**): `crypto.randomUUID()`, `getRandomValues()` or the `secrets` module |
| Fast hashes (MD5, SHA-1, SHA-256) for passwords | CWE-916 Use of Password Hash With Insufficient Computational Effort | `unsafe` (**stops**): bcrypt, scrypt or argon2 |
| Certificate checks turned off: `verify=False`, `rejectUnauthorized: false`, `InsecureSkipVerify: true` | CWE-295 Improper Certificate Validation | `unsafe` (**stops**) |
| Running text as code: `eval`, `exec`, `new Function` | CWE-95 Eval Injection | `unsafe` (**stops**): parse the input instead |

## 6. Calls and packages that do not exist

| Pattern | Standard that calls it bad | lessloc |
|---|---|---|
| Another language's API: `null` or `===` in Python, `.strip()`, `None` or `len()` in JavaScript, `null` in Go | Sonar's quality profile for agent-written code targets "hallucinated APIs"; a call that does not exist fails the first time it runs | `made-up-api` (**stops**) |
| Imports of packages no manifest declares: a made-up name, or one never installed | Spracklen et al., USENIX Security 2025 (5.2–21.7% of recommended packages do not exist); OWASP Top 10 A03:2025 Software Supply Chain Failures | `made-up-api` (**stops**): checked against every package.json, Python manifest, the standard library and the project's own modules |

## 7. Comments and text

| Pattern | Standard that calls it bad | lessloc |
|---|---|---|
| Comments that narrate what the code does ("Loop through the users") | Clean Code C3 Redundant Comment and Noise Comments; McConnell, *Code Complete* §32.4 (a comment that repeats the code is not acceptable in finished code); Ousterhout: Comment Repeats Code | `narration`: turn, check. Comments that give a reason are kept |
| Banners, dividers, closing-brace comments, emoji decoration | Clean Code: Position Markers, Closing Brace Comments | `narration` |
| Docs that restate the name (`"""Get the user."""`, `name: The name.`, `@returns The result.`) | Clean Code: Mandated Comments; Google Python Style Guide (no types in docstrings where annotations exist) | `narration` |
| History and messages to the requester ("Updated the parser to...", "As requested", "Generated by AI", dated change notes) | Clean Code C1 and Journal Comments: history belongs in source control | `history` |
| Comment blocks and comment-heavy changes | Clean Code: Too Much Information | `comment-block`, `comment-density` |
| Log lines that narrate each step ("Starting...", "Successfully saved") | Raymond, *The Art of Unix Programming*, Rule of Silence: "When a program has nothing surprising to say, it should say nothing" | `narration` (three or more in a file) |
| Docs that still name what a change removed | CWE-1116 Inaccurate Source Code Comments | `stale-doc` |
| Summary, report and notes files (`IMPLEMENTATION_SUMMARY.md`, `FIXES.md`) | — | `junk-file` (tier 0): denied at write |
| Doc files nobody asked for, and READMEs that grow by 40 or more lines nobody asked for | YAGNI | `unrequested-doc`: turn |
| Docs deleted wholesale to shrink a change | lessloc's own "Never cut" list | `doc-removed` |
| Always-loaded instructions that grow, or that include a directory tour | arXiv:2602.11988 (context files with overviews raised cost by more than 20% and did not help) | `long-instructions` |
| Commit messages that recap the diff file by file | DRY: the diff already lists every file | The commit hook warns when a message lists the files the diff shows |

## 8. Files and folders

| Pattern | Standard that calls it bad | lessloc |
|---|---|---|
| Scratch, backup, copy and harness files (`debug_x.py`, `.bak`, `utils_old.py`, `tmpclaude-*`) | — | `junk-file` (tier 0): denied at write. A root `test_*.py` is allowed when the project has no tests folder |
| Caches, build output and logs about to be committed | — | `junk-file` (tier 0) |
| Dockerfiles, compose files, CI workflows and deploy configs nobody asked for | YAGNI; Google engineering practices: "functionality that isn't presently needed" | `unrequested-file`: turn |
| Tiny one-function files; file-per-concern splits | Ousterhout: Shallow Module | `tiny-file`, `new-files` |
| New folders for one or two files; layer trees for small apps | Ousterhout: shallow modules; Martin's Common Closure Principle | `new-folder`. Framework route folders (Next.js, SvelteKit, Expo) are exempt |
| Junk-drawer `utils` and `helpers` modules and folders | Fowler: Mysterious Name | `junk-drawer` |
| Vague names (`process_data`, `handle`) | Fowler: Mysterious Name; Ousterhout: Vague Name | `vague-name` |
| Moving or renaming files without a reason | Google engineering practices: separate refactoring changes | `moved-files` |
| Secrets: a committed `.env`, API keys, private keys | CWE-798 Use of Hard-coded Credentials; CWE-540 | `secret` (tier 0) |

## 9. Tests and verification

| Pattern | Standard that calls it bad | lessloc |
|---|---|---|
| Behavior added with no test changed in the same change | Google engineering practices: tests ship with the change they test | **Rule:** new behavior gets one focused test. `untested` (**stops**): turn, check. Not raised for refactors, for fixes that do not grow the code, or for projects without tests |
| Tests that assert nothing, or assert a constant | Carr, TDD anti-patterns: The Liar | `empty-test` (**stops**) |
| Deleted, skipped, focused (`.only`), exited (`sys.exit(0)`) or force-passed tests | Clean Code T4 (an ignored test is a question); GitHub's AGENTS.md guidance: never remove a failing test | `weakened-tests` (tier 0). Skips that depend on the environment are allowed |
| Test-only branches in production code; code shaped to pass a test | Meszaros: Test Logic in Production; Anthropic system cards: special-casing tests | `test-logic` (**stops**) |
| Tests that mock the code they test | Carr, TDD anti-patterns: The Mockery | `empty-test` (**stops**) |
| Production code that branches on a value copied from the tests | Anthropic system cards: special-casing tests; Meszaros: Test Logic in Production | `test-logic` (**stops**) |
| Stopping short: a function, option or flag the request asked for is never written | ISO/IEC 25010 functional completeness | `unaddressed` (**stops**): names a request asks to exist ("add a `--status` flag", "implement `export_csv()`") are looked for in the final repository; one that appears nowhere holds the turn. A name the request only mentions, a test or a private helper the agent names itself never counts, and names joined by "or" are alternatives |
| Stopping short: leaving part of the reported problem failing, and saying so | ISO/IEC 25010 functional completeness | `unfinished` (**stops**): in a turn that changed code, the agent's last reply is read sentence by sentence, with headings and lead-ins speaking for what is under them. An explicit marker that something is left broken ("Not fixed:", "Known limitation:") with a failure stated now, a neutral scope note ("Not changed:", "I left it alone") with a present-tense defect tied to the request (a name from its code, or the report's own example), the report's own example still failing, or the same problem suspected elsewhere and unchecked, holds the turn once, quoting the sentence. A fixed state, a cause, a condition, an offer, a tool's report or housekeeping never counts |
| Saying "done" without a passing run on the final state | — | `tests-failed` (tier 0), `unverified` (**stops**): the agent's own test runs, as its host reported them, are the evidence for the exact tree; a run that fails on the final state, or a change to how the tests run, holds the turn once, and a final state no run verified is written to the record; `lessloc test`, `verify` and `ci` record evidence too |
| A refactor that changes existing tests | Fowler: refactoring preserves behavior | `refactor-tests` |

## 10. Getting around the checks

| Pattern | lessloc |
|---|---|
| `--no-verify` on `git commit`, `push`, `merge`, `rebase`, `am` or `cherry-pick`; `git commit -n`; `HUSKY=0`, `SKIP=`, `LESSLOC=off` or `LESSLOC_OFF=` before a command; `core.hooksPath` in a `git` command | The gate asks the user before the command runs |
| Editing lessloc's policy or a protected path | `policy` (tier 0) and `protected` (tier 0); the gate asks the user |
| Suppressing a finding without a reason | `lessloc-ignore` works only with a reason. `check` and CI list every suppression |
| Fixing a review by adding layers, checks or tests | The turn's hold ends with "Fix only these and add nothing else for this note" |

## 11. Project policy

These kinds hold what the project's owner decided, so an agent cannot change them on its own.

| Pattern | lessloc |
|---|---|
| A broken or misspelled `.lessloc.json` that would silently fall back to defaults | `config` (tier 0) |
| Imports across a boundary the project forbids (for example, UI importing the database) | `boundary` (tier 0) |
| A dependency outside the approved list | `dependency` (tier 0) |
| Duplication, dead code, comment weight, swallowed errors or test assertions getting worse | `ratchet` (tier 0). It warns, comparing with the base commit; with a committed baseline, it fails |

## 12. Context and handoff

| Problem | lessloc |
|---|---|
| Test output re-read again and again | `lessloc test`, for people and CI (agents run the project's own command), prints one line on success and only the failing parts on failure |
| The next agent cannot tell what was verified or left open | The next session in the checkout gets the last one's uncommitted work, verification and open problems in its own words; evidence tied to the exact tree; commit trailers when the team turns them on |
| Hunting for where things live | Existing code named on a prompt when a specific word of its name matches; the last session's uncommitted work handed over |
| Several agents in one checkout, editing the same files | Each session reviews only what its own tools wrote, so two agents in one checkout never review each other's work |
| Tool state cluttering the repository, its history or teammates' setups | Nothing in the working tree unless asked; state in the user's cache; one trailer line; shared hook folders left alone ([what lessloc writes](docs/guide/reference.md#files-lessloc-writes)) |
<!-- catalog:end -->

## What lessloc never pushes an agent toward

"Less code" taken too far is its own failure. Each of these has a counterweight:

| Over-correction | Counterweight |
|---|---|
| Cutting tests, validation, error handling or logging | "Never cut correctness, security, tests" in the rules; `removed-safeguard`, `weakened-tests` |
| Golfing code into one-liners | `clever` (nested ternaries, comprehensions with several `for` clauses; Google Python style: optimize for readability, not conciseness), `dense-lines` |
| Inlining everything to avoid files and helpers | `long-function`, `deep-nesting`, `swollen-file` |
| Merging code that only looks alike | The rule keeps code that changes for different reasons separate (Metz, "The Wrong Abstraction": duplication is far cheaper than the wrong abstraction). Copy findings show how widely each copy is used |
| Deleting comments that carry a reason | `narration` spares comments with a why (because, so that, must, never, a colon) |
| Hiding errors in fewer lines | `contextlib.suppress` is excluded from `simpler` and still counts as a swallowed error |
| Syntax the project's runtime does not support | ruff follows the project's target version; truthiness rules are skipped in NumPy and pandas code |
| Breaking framework conventions | Route folders and convention files (`page.tsx`, `+page.svelte`, `__init__.py`, `mod.rs`) never count as needless |
| Blocking the tests the rules ask for | A root test file counts as scratch only when the project keeps tests in a folder |
| Review loops that add code | At most one hold per turn, and it says to fix only what it lists and add nothing else |
