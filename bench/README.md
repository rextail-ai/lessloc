# lessloc benchmark

lessloc is measured on real changes to real open-source projects. Each task is a change a human merged. A fresh agent session gets the project's code from just before that change and the text of its issue or pull request. It is judged by the tests the human's change added, which the agent never sees. The [results](#results) come from this benchmark. The other tools on this page replay finished code without a model.

## Results

lessloc 0.10.0 against no tool, with Haiku (claude-haiku-5-5) in Claude Code 2.1.303. There are 117 tasks from three Python projects, two sessions per task for each setup, 468 sessions in all.

<picture><source media="(prefers-color-scheme: dark)" srcset="https://lessloc.org/results-dark.svg"><img alt="117 real changes in 3 open-source projects, judged by hidden tests: 27% less code, 23% lower cost, the same results" src="https://lessloc.org/results-light.svg" width="880"></picture>

lessloc wrote less code on every project and cost 23% less overall, with the same results: tasks passed show no measurable difference.

- **Same results.** lessloc's sessions passed 157 times out of 234, and no tool's 161: a difference of 2 tasks, with a 95% confidence interval from 5 fewer to 0.5 more, which includes zero.
- **Less code.** It wrote 27% fewer production lines per task, with an interval of 23% to 32% fewer.
- **Lower cost.** It cost 23% less per task, with an interval of 10% to 31% less, its own hooks included.

<picture><source media="(prefers-color-scheme: dark)" srcset="https://lessloc.org/projects-dark.svg"><img alt="On every project tested: 23 to 36% less code and 15 to 26% lower cost" src="https://lessloc.org/projects-light.svg" width="880"></picture>

| | Pass rate: no tool | Pass rate: lessloc | Production code | Cost per task |
|---|--:|--:|--:|--:|
| starlette, 43 tasks | 76.7% | 75.6% | 26% less | 26% lower |
| pydantic-settings, 45 tasks | 60.0% | 57.8% | 23% less | 22% lower |
| w3lib, 29 tasks | 70.7% | 69.0% | 36% less | 15% lower |
| **All 117 tasks** | **68.8%** | **67.1%** | **27% less** | **23% lower** |

Dollar figures are Claude Code's own estimates at API prices. The run measured the lessloc 0.10.0 release candidate; the release adds the precision and command fixes made after the run.

In full, as `bench/real/stats.py` prints it from the run's results. Each cell reads no tool → lessloc, with the 95% interval of the difference in parentheses:

| | Tasks | Passed: no tool → lessloc, difference in tasks | Production lines per task | Cost per task | Earlier changes broken per task | Test lines per task |
|---|--:|--:|--:|--:|--:|--:|
| starlette | 43 | 76.7% → 75.6%, −0.5 (−1.5 to 0) | 14.0 → 10.4, −26% (−30% to −19%) | $0.0201 → $0.0148, −26% (−39% to +2%) | 0.30 → 0.16 | 30.5 → 16.8 |
| pydantic-settings | 45 | 60.0% → 57.8%, −1.0 (−3.0 to 0) | 17.1 → 13.1, −23% (−33% to −16%) | $0.0250 → $0.0195, −22% (−33% to −9%) | 0.67 → 0.67 | 29.6 → 19.1 |
| w3lib | 29 | 70.7% → 69.0%, −0.5 (−2.0 to +1.0) | 14.0 → 8.9, −36% (−49% to −28%) | $0.0129 → $0.0109, −15% (−22% to −7%) | 0.00 → 0.00 | 17.1 → 8.6 |
| **All** | 117 | 68.8% → 67.1%, −2.0 (−5.0 to +0.5) | 15.2 → 11.1, −27% (−32% to −23%) | $0.0202 → $0.0156, −23% (−31% to −10%) | 0.37 → 0.32 | 26.8 → 15.6 |

### Every task

The tasks of each project, in the order their changes were merged. Each setup ran every task twice: passed is how many of the two sessions passed, and lines and cost are the mean of the two.

#### starlette

| Task | Merged | Passed: no tool | lessloc | Production lines: no tool | lessloc | Cost: no tool | lessloc |
|---|---|--:|--:|--:|--:|--:|--:|
| pr3410 | 2026-08-05 | 2/2 | 2/2 | 48 | 40.5 | $0.016 | $0.022 |
| pr3418 | 2026-08-06 | 2/2 | 2/2 | 37.5 | 28.5 | $0.011 | $0.010 |
| pr3419 | 2026-08-07 | 2/2 | 2/2 | 2 | 1.5 | $0.009 | $0.008 |
| pr3420 | 2026-08-07 | 2/2 | 2/2 | 7 | 5 | $0.011 | $0.007 |
| pr3421 | 2026-08-07 | 2/2 | 2/2 | 16.5 | 15.5 | $0.008 | $0.007 |
| pr3389 | 2026-08-08 | 2/2 | 2/2 | 1 | 1 | $0.005 | $0.005 |
| pr3430 | 2026-08-08 | 2/2 | 2/2 | 14 | 4 | $0.012 | $0.011 |
| pr3431 | 2026-08-08 | 0/2 | 0/2 | 9 | 7 | $0.011 | $0.011 |
| pr3130 | 2026-08-08 | 0/2 | 0/2 | 13 | 7 | $0.013 | $0.008 |
| pr3471 | 2026-08-25 | 0/2 | 0/2 | 6.5 | 5 | $0.007 | $0.007 |
| pr3472 | 2026-08-26 | 2/2 | 2/2 | 50 | 36 | $0.037 | $0.025 |
| pr3436 | 2026-08-26 | 2/2 | 2/2 | 7.5 | 6.5 | $0.017 | $0.013 |
| pr2767 | 2026-08-30 | 0/2 | 0/2 | 2 | 6 | $0.009 | $0.010 |
| pr3489 | 2026-08-30 | 0/2 | 0/2 | 3 | 3 | $0.016 | $0.014 |
| pr3492 | 2026-08-30 | 0/2 | 0/2 | 9.5 | 6.5 | $0.022 | $0.024 |
| pr3510 | 2026-09-05 | 2/2 | 2/2 | 3 | 3 | $0.008 | $0.008 |
| pr3376 | 2026-09-05 | 2/2 | 2/2 | 2 | 2 | $0.008 | $0.007 |
| pr3516 | 2026-09-05 | 2/2 | 1/2 | 16.5 | 11 | $0.014 | $0.011 |
| pr3517 | 2026-09-05 | 2/2 | 2/2 | 13 | 6 | $0.014 | $0.013 |
| pr3372 | 2026-09-06 | 2/2 | 2/2 | 3 | 3 | $0.006 | $0.008 |
| pr3201 | 2026-09-06 | 2/2 | 2/2 | 3 | 2.5 | $0.006 | $0.006 |
| pr3476 | 2026-09-06 | 2/2 | 2/2 | 6 | 5.5 | $0.010 | $0.009 |
| pr3271 | 2026-09-07 | 2/2 | 2/2 | 6 | 6 | $0.006 | $0.006 |
| pr3532 | 2026-09-12 | 2/2 | 2/2 | 6 | 4.5 | $0.008 | $0.008 |
| pr3545 | 2026-09-12 | 2/2 | 2/2 | 2 | 2 | $0.006 | $0.007 |
| pr3563 | 2026-09-20 | 0/2 | 0/2 | 26 | 20.5 | $0.020 | $0.019 |
| pr3568 | 2026-09-23 | 2/2 | 2/2 | 6 | 5 | $0.007 | $0.008 |
| pr3583 | 2026-09-26 | 0/2 | 0/2 | 2 | 2 | $0.009 | $0.008 |
| pr3567 | 2026-09-27 | 2/2 | 2/2 | 3 | 2.5 | $0.010 | $0.007 |
| pr3565 | 2026-10-03 | 2/2 | 2/2 | 20 | 11.5 | $0.021 | $0.015 |
| pr3618 | 2026-10-04 | 2/2 | 2/2 | 5.5 | 6 | $0.007 | $0.007 |
| pr3617 | 2026-10-04 | 2/2 | 2/2 | 8 | 8 | $0.007 | $0.006 |
| pr3186 | 2026-10-04 | 2/2 | 2/2 | 2 | 2 | $0.005 | $0.004 |
| pr3640 | 2026-10-06 | 2/2 | 2/2 | 1 | 1 | $0.004 | $0.005 |
| pr3651 | 2026-10-09 | 2/2 | 2/2 | 1 | 3 | $0.005 | $0.011 |
| pr3631 | 2026-10-13 | 2/2 | 2/2 | 9 | 6.5 | $0.011 | $0.017 |
| pr3671 | 2026-10-17 | 0/2 | 0/2 | 4 | 3 | $0.009 | $0.007 |
| pr3622 | 2026-10-17 | 2/2 | 2/2 | 12.5 | 6.5 | $0.014 | $0.012 |
| pr3491 | 2026-10-18 | 0/2 | 0/2 | 202.5 | 140 | $0.418 | $0.214 |
| pr3585 | 2026-10-18 | 2/2 | 2/2 | 2.5 | 2 | $0.008 | $0.009 |
| pr3542 | 2026-10-18 | 2/2 | 2/2 | 6 | 4 | $0.008 | $0.010 |
| pr3675 | 2026-10-18 | 2/2 | 2/2 | 2 | 1 | $0.005 | $0.006 |
| pr3679 | 2026-10-18 | 2/2 | 2/2 | 3 | 3 | $0.006 | $0.008 |

#### pydantic-settings

| Task | Merged | Passed: no tool | lessloc | Production lines: no tool | lessloc | Cost: no tool | lessloc |
|---|---|--:|--:|--:|--:|--:|--:|
| pr878 | 2026-06-03 | 0/2 | 0/2 | 50.5 | 20.5 | $0.033 | $0.023 |
| pr876 | 2026-06-05 | 2/2 | 2/2 | 24 | 23 | $0.029 | $0.023 |
| pr882 | 2026-06-07 | 0/2 | 0/2 | 4 | 8 | $0.011 | $0.008 |
| pr889 | 2026-06-19 | 2/2 | 2/2 | 17.5 | 1 | $0.013 | $0.012 |
| pr860 | 2026-06-29 | 0/2 | 0/2 | 71 | 65 | $0.218 | $0.105 |
| pr898 | 2026-07-06 | 2/2 | 2/2 | 18 | 7.5 | $0.018 | $0.017 |
| pr900 | 2026-07-07 | 0/2 | 0/2 | 18 | 10.5 | $0.017 | $0.014 |
| pr902 | 2026-07-08 | 2/2 | 2/2 | 39 | 39 | $0.030 | $0.029 |
| pr905 | 2026-07-08 | 2/2 | 2/2 | 8.5 | 2 | $0.017 | $0.010 |
| pr910 | 2026-07-14 | 2/2 | 0/2 | 13.5 | 6.5 | $0.010 | $0.009 |
| pr912 | 2026-07-15 | 2/2 | 2/2 | 2 | 2 | $0.007 | $0.008 |
| pr913 | 2026-07-16 | 0/2 | 0/2 | 6 | 5.5 | $0.009 | $0.009 |
| pr914 | 2026-07-22 | 0/2 | 0/2 | 3 | 2 | $0.007 | $0.007 |
| pr920 | 2026-08-03 | 2/2 | 2/2 | 2 | 1 | $0.009 | $0.010 |
| pr926 | 2026-08-06 | 2/2 | 2/2 | 1 | 1 | $0.007 | $0.007 |
| pr940 | 2026-08-21 | 0/2 | 0/2 | 38 | 28.5 | $0.026 | $0.021 |
| pr945 | 2026-08-23 | 2/2 | 2/2 | 6 | 6 | $0.004 | $0.006 |
| pr947 | 2026-08-28 | 2/2 | 2/2 | 4.5 | 3 | $0.008 | $0.008 |
| pr958 | 2026-09-04 | 2/2 | 2/2 | 6 | 4 | $0.012 | $0.012 |
| pr959 | 2026-09-11 | 2/2 | 2/2 | 1 | 2 | $0.008 | $0.009 |
| pr968 | 2026-09-11 | 2/2 | 2/2 | 1 | 1 | $0.005 | $0.006 |
| pr975 | 2026-09-18 | 0/2 | 0/2 | 13.5 | 8 | $0.018 | $0.014 |
| pr973 | 2026-09-18 | 2/2 | 2/2 | 2 | 3 | $0.012 | $0.011 |
| pr972 | 2026-09-19 | 0/2 | 0/2 | 15.5 | 13 | $0.024 | $0.025 |
| pr977 | 2026-09-21 | 2/2 | 2/2 | 2 | 2.5 | $0.012 | $0.011 |
| pr976 | 2026-09-21 | 2/2 | 2/2 | 8.5 | 8 | $0.011 | $0.009 |
| pr979 | 2026-09-22 | 0/2 | 0/2 | 10 | 5 | $0.042 | $0.030 |
| pr980 | 2026-09-23 | 2/2 | 2/2 | 12.5 | 12.5 | $0.009 | $0.011 |
| pr981 | 2026-09-25 | 1/2 | 1/2 | 13 | 13.5 | $0.022 | $0.018 |
| pr988 | 2026-09-25 | 2/2 | 2/2 | 6 | 6 | $0.015 | $0.016 |
| pr989 | 2026-09-25 | 2/2 | 2/2 | 3 | 3 | $0.012 | $0.016 |
| pr992 | 2026-10-02 | 0/2 | 0/2 | 4.5 | 4 | $0.012 | $0.012 |
| pr1001 | 2026-10-02 | 2/2 | 2/2 | 16.5 | 13 | $0.017 | $0.018 |
| pr994 | 2026-10-02 | 2/2 | 2/2 | 3.5 | 3 | $0.012 | $0.011 |
| pr997 | 2026-10-09 | 0/2 | 0/2 | 31.5 | 25.5 | $0.018 | $0.022 |
| pr1009 | 2026-10-09 | 2/2 | 2/2 | 3 | 2.5 | $0.010 | $0.007 |
| pr1010 | 2026-10-09 | 0/2 | 0/2 | 7 | 6.5 | $0.013 | $0.012 |
| pr1006 | 2026-10-09 | 0/2 | 0/2 | 17 | 18.5 | $0.021 | $0.019 |
| pr1004 | 2026-10-12 | 0/2 | 0/2 | 36 | 27.5 | $0.028 | $0.038 |
| pr1008 | 2026-10-12 | 0/2 | 0/2 | 22 | 10.5 | $0.037 | $0.014 |
| pr1019 | 2026-10-13 | 2/2 | 2/2 | 6 | 6 | $0.019 | $0.015 |
| pr1025 | 2026-10-13 | 0/2 | 0/2 | 30 | 16 | $0.017 | $0.016 |
| pr1029 | 2026-10-13 | 2/2 | 2/2 | 25.5 | 18.5 | $0.037 | $0.019 |
| pr1022 | 2026-10-13 | 2/2 | 2/2 | 30 | 27 | $0.021 | $0.016 |
| pr1033 | 2026-10-14 | 1/2 | 1/2 | 116.5 | 98 | $0.188 | $0.144 |

#### w3lib

| Task | Merged | Passed: no tool | lessloc | Production lines: no tool | lessloc | Cost: no tool | lessloc |
|---|---|--:|--:|--:|--:|--:|--:|
| pr264 | 2026-06-15 | 2/2 | 2/2 | 1 | 1 | $0.005 | $0.005 |
| pr266 | 2026-06-15 | 2/2 | 2/2 | 1 | 1 | $0.007 | $0.006 |
| pr268 | 2026-06-17 | 2/2 | 2/2 | 2 | 2 | $0.009 | $0.007 |
| pr271 | 2026-06-22 | 2/2 | 2/2 | 2 | 2 | $0.006 | $0.007 |
| pr273 | 2026-07-09 | 2/2 | 2/2 | 1 | 1 | $0.006 | $0.006 |
| pr286 | 2026-07-23 | 2/2 | 2/2 | 1 | 1 | $0.009 | $0.008 |
| pr288 | 2026-07-24 | 2/2 | 2/2 | 18.5 | 9 | $0.035 | $0.021 |
| pr289 | 2026-07-24 | 2/2 | 2/2 | 13.5 | 12.5 | $0.011 | $0.009 |
| pr290 | 2026-07-27 | 2/2 | 2/2 | 6.5 | 1.5 | $0.010 | $0.008 |
| pr291 | 2026-07-28 | 2/2 | 2/2 | 7 | 7 | $0.007 | $0.005 |
| pr292 | 2026-07-29 | 2/2 | 2/2 | 3 | 2 | $0.008 | $0.007 |
| pr167 | 2026-08-03 | 0/2 | 0/2 | 18 | 12 | $0.011 | $0.007 |
| pr300 | 2026-08-13 | 1/2 | 1/2 | 14.5 | 10.5 | $0.010 | $0.011 |
| pr301 | 2026-08-13 | 2/2 | 2/2 | 8 | 1.5 | $0.009 | $0.009 |
| pr302 | 2026-08-13 | 2/2 | 2/2 | 2.5 | 1 | $0.009 | $0.007 |
| pr293 | 2026-08-13 | 1/2 | 1/2 | 41.5 | 13 | $0.021 | $0.016 |
| pr303 | 2026-08-13 | 0/2 | 0/2 | 7.5 | 1.5 | $0.006 | $0.005 |
| pr299 | 2026-08-13 | 0/2 | 0/2 | 25.5 | 12 | $0.013 | $0.012 |
| pr305 | 2026-08-17 | 2/2 | 2/2 | 7 | 7 | $0.009 | $0.009 |
| pr307 | 2026-08-30 | 2/2 | 2/2 | 8.5 | 3.5 | $0.008 | $0.010 |
| pr317 | 2026-09-08 | 2/2 | 1/2 | 8.5 | 3.5 | $0.014 | $0.012 |
| pr321 | 2026-09-09 | 2/2 | 2/2 | 4.5 | 5 | $0.005 | $0.006 |
| pr333 | 2026-09-17 | 0/2 | 0/2 | 111.5 | 85 | $0.023 | $0.014 |
| pr332 | 2026-09-17 | 0/2 | 1/2 | 16.5 | 11 | $0.023 | $0.022 |
| pr334 | 2026-09-17 | 1/2 | 0/2 | 25.5 | 20 | $0.022 | $0.016 |
| pr337 | 2026-09-17 | 0/2 | 0/2 | 16 | 9.5 | $0.013 | $0.014 |
| pr338 | 2026-09-18 | 0/2 | 0/2 | 10.5 | 5 | $0.016 | $0.018 |
| pr342 | 2026-09-21 | 2/2 | 2/2 | 3.5 | 1.5 | $0.008 | $0.008 |
| pr343 | 2026-09-22 | 2/2 | 2/2 | 19 | 15.5 | $0.041 | $0.029 |

### Measures

- **Passed:** every hidden test of the task passed after the session. A task's pass rate is the share of its sessions that passed. The difference is counted in tasks: the sum, over tasks, of lessloc's pass rate minus no tool's.
- **Production lines:** the non-blank lines a session's change added to the project's Python files outside its tests, comments and docstrings included. **Test lines** are the same count inside them: `tests/`, `test/`, `testing/`, `test_*.py`, `*_test.py` and `conftest.py`.
- **Cost per task:** the mean cost of a task's sessions, lessloc's own additions included. A session that runs out of its 20 minutes is priced from the tokens it streamed; in this run, none did.
- **Earlier changes broken:** how many of the project's earlier judged changes had hidden tests that failed after the session. In pydantic-settings, pr860 and pr979 show the same earlier changes broken in every session of both setups.
- **Intervals:** 95% bootstrap intervals over tasks, paired by task, from 4,000 resamples. Each task counts once, as the mean of its sessions.

### The projects

The tasks are the judged changes among each project's first 70 changes to its source after a release:

- **starlette** from 1.3.1: 43 tasks, merged from August 5 to October 18, 2026. One more judged change, pr3463, is left out, as planned before the run: its hidden tests need packages the project added after 1.3.1, so in the environment the benchmark builds at the start, even the human's change fails them.
- **pydantic-settings** from v2.14.1: 45 tasks, merged from June 3 to October 14, 2026.
- **w3lib** from v2.4.1: 29 tasks, merged from June 15 to September 22, 2026.

lessloc's checks were designed on other projects, tomlkit and click. pydantic-settings and w3lib were the validation projects: the checks were measured on both, this version was chosen on their results, and the note at a turn's 40th tool call came from long sessions on pydantic-settings. starlette was the held-out project: no version of lessloc was scored or tuned on it before this run.

Their project.json files, with `uv` on the PATH:

```json
{ "repo": "Kludex/starlette", "start": "1.3.1", "branch": "main", "source": ["starlette"], "tests": ["tests"], "max": 70,
  "setup": "UV_PYTHON=3.12 uv sync -q --frozen --no-default-groups --group dev",
  "python": ".venv/bin/python" }
```

```json
{ "repo": "pydantic/pydantic-settings", "start": "v2.14.1", "branch": "main", "source": ["pydantic_settings"], "tests": ["tests"], "max": 70,
  "setup": "UV_PYTHON=3.12 uv sync -q --frozen --no-default-groups --group testing --all-extras && uv pip uninstall -q -p .venv/bin/python pytest-pretty",
  "python": ".venv/bin/python" }
```

```json
{ "repo": "scrapy/w3lib", "start": "v2.4.1", "branch": "master", "source": ["w3lib"], "tests": ["tests"], "max": 70,
  "setup": "uv venv -q --allow-existing -p 3.12 .venv && uv pip install -q -p .venv/bin/python --exclude-newer 2026-10-18T00:00:00Z pytest-timeout -e . pytest && echo 'import os; os.environ.setdefault(\"PYTEST_TIMEOUT\", \"60\")' > .venv/lib/python3.12/site-packages/zz_bench_timeout.pth",
  "python": ".venv/bin/python" }
```

## How the benchmark works (`bench/real`)

`bench/real` turns a real open-source project's history into tasks. The start is a released version. The tasks are the later changes to its source, in the order each reached the main branch, up to the project's `max` (80 by default); a change of more than 1,000 source lines is skipped. Each task's text is the linked issue, else the pull request.

The agents cannot look up the real change. Their copy of the project has no history past the task's start and no remote. In Claude Code they have no web tools. In their shell, the usual ways online fail: `gh`, `curl` and `wget` on the PATH, git remotes, and the pip and uv package indexes.

A task is judged by the tests its real change added, which the agent never sees. Those tests are kept only if they fail before the change and pass after it, both in the layout the grader uses. A test that uses a name the change introduced, where the task text never mentions that name, is dropped, as SWE-bench Verified's review demands. A hidden test that a later real change broke on purpose retires at that change. After each task, the hidden tests of every earlier judged task run again.

The harness runs tasks in two ways:

- **Per-task replays**, which the results use. Each task starts from the project's own code just before its change landed, with no later commit in reach, so no task depends on another, as in SWE-bench.
- **Timelines.** One setup's run through the whole history: every task goes to a fresh session, on the code exactly as earlier sessions left it, with no resets, so each setup builds on its own code. Tasks without hidden tests are done too, so the code later sessions build on never misses a step. Timelines also measure code growth: how much the source folder grew, in non-whitespace characters of non-comment lines, so packing code onto fewer lines does not shrink it.

```sh
node bench/real/mine.mjs project.json clone > candidates.json      # changes and their texts, via the GitHub CLI
node bench/real/prepare.mjs candidates.json clone prepared/         # hidden tests, judged or not, retirement
node bench/real/run.mjs prepared/ clone --model haiku --dry-run     # the start fails every judged task; no commit after it
node bench/real/run.mjs prepared/ clone --model haiku --arms none,lessloc --runs 2 --replay list.json   # list.json: [{"task": "pr3410"}, ...]
python3 bench/real/stats.py <results.json> prepared/                # the tables above
```

The harness takes Python projects tested with pytest whose history is linear: every change on the main line is a squash commit or a pull-request merge. Pick projects without branch syncs, such as merges from a stable branch.

### Reproducing the results

For each project, mine and prepare its tasks from its project.json above, in a full clone with its tags. Then list the project's task ids from [Every task](#every-task) in a file, as `[{"task": "pr3410"}, {"task": "pr3418"}, ...]`, and run:

```sh
node bench/real/run.mjs <prepared dir> <clone> --model haiku --arms none,lessloc --runs 2 --replay <task list>
python3 bench/real/stats.py <starlette results.json> <starlette prepared dir> <pydantic-settings results.json> <pydantic-settings prepared dir> <w3lib results.json> <w3lib prepared dir>
```

Mining fetches each task's text from GitHub as it reads on that day, so an issue edited since this run gives a slightly different task. Keep your candidates.json to rerun the same texts later.

- `--model haiku` must be given, because the harness defaults to sonnet.
- `--runs` is sessions per task in a replay, and timelines per setup otherwise (default 3). `--jobs` is how many run at once (default 3).
- `--tasks <n>` takes the first n tasks of a timeline; without it, every task runs.
- `--replay <file>` runs single tasks. The file is a JSON list of `{"task": <task id>}`, each started from the project's own code just before the task's change landed. It can also list `{"repo": <kept timeline repository>, "task": <task id>}`, each started from the state that timeline reached just before the task.
- Each arm in `--arms` is one setup: `none`, `lessloc`, `lessloc-no-<component>` (an ablation), or `lessloc-old` (another lessloc checkout, given with `--old <dir>`). The first arm is the baseline.
- `--host claude` is the default, and `--claude <command>` picks the Claude Code command.
- `--host codex` or `--host opencode` runs the same tasks in Codex or OpenCode. Each timeline, and each replayed task, gets a config home of its own for the tool, so the user's own configuration never leaks in. Codex runs with `CODEX_HOME` set to a fresh folder that holds lessloc's hooks only in lessloc arms; it signs in with `OPENAI_API_KEY` or a link to your `~/.codex/auth.json`. Codex reports tokens but no cost, so `--price <in>,<cached in>,<out>` (dollars per million tokens) turns its tokens into one. OpenCode needs `--model <provider>/<model>`, runs with a fresh `XDG_CONFIG_HOME`, loads lessloc's bridge plugin only in lessloc arms, and reports its own cost estimate from tokens and the model's list price.
- A session cut short by a usage limit, or one that returned no result, runs again. One that runs out of its 20 minutes counts as it ended, priced from the tokens it streamed at what the run's complete sessions paid per input-side token, so it never counts as free.
- With [bubblewrap](https://github.com/containers/bubblewrap) installed (`bwrap`), each session sees only its own processes, so an agent's `pkill -f <pattern>` cannot end another session, its tests or the run. `LESSLOC_BENCH_SHARED_PIDS=1` turns this off.
- `TMPDIR` decides where the results JSON and each timeline's kept repository go, so point it at a disk with room. When uv's cache is on another filesystem, set `UV_LINK_MODE=copy`.
- The results JSON holds every session and records the versions (Claude Code, model, lessloc) and which code ran: the harness's commit and a hash of its uncommitted diff, and each lessloc setup's commit, diff hash and `LESSLOC_OFF` switches. Run from a clean checkout, so the diff hash is empty.

## Refusing unfinished work, without a model (`bench/candidates.mjs`)

For each judged task of a prepared real project, the human's change is a finished candidate. Variants of it leave work out: the tests, half of the fixed files, a block replaced by a stub, the final test run, or a test run that comes before the last edit. Each candidate is replayed through lessloc's hooks the way an agent would make it, with the request, one write per file, a real run of the project's tests and a final reply that claims they pass. The task's hidden tests say whether its code is finished. A hold on finished work is a false reject; a candidate with work left out that goes through is a false accept.

```sh
node bench/candidates.mjs <prepared dir> <clone> [--tasks pr471,pr486]
```

## Precision on code humans merged, without a model (`bench/replay.mjs`)

Commits humans already merged are the false-positive test. Each one is replayed through lessloc's review as `check --base <parent>` sees it, and through the turn end's check of requested names, with the commit's message as the request.

```sh
node bench/replay.mjs <clone> [commits=30] [--show copy,untested] [--json <file>]
```

In full clones at ripgrep 3fce3b5, ky 3541888, cobra adbc881, gson e2292f9 and click 2247b35:
- **30 commits each.** `copy` fired 10 times: 8 on code repeated verbatim, and 2 on ripgrep code with the same shape but different fields or values (two builder setters, two flag definitions). The other kinds that stop a turn fired 23 times: `weakened-tests` 9, `untested` 9, `suppression` 3 and `commented-out` 2; these 23 were counted, not hand-labeled.
- **200 commits each.** The messages ask for 121 names (ripgrep 18, ky 59, cobra 7, gson 12, click 25), and `unaddressed` would have held none of the 1,000 commits.

## What the hooks add to a session, without a model (`bench/weight.mjs`)

One scripted session (session start, a prompt, a search, an edit, a test run, the turn end) is replayed through a lessloc checkout's hooks on a throwaway clone of a repository. It prints each event's time and the tokens it adds to the agent's context.

```sh
node bench/weight.mjs <clone> --file <path to edit> --prompt <text> [--lessloc <dir>] [--test <command>] [--runs 5] [--show]
```

## Scope

The results cover three Python projects, all with Haiku in Claude Code. `--host` and `--model` run the same tasks in Codex or OpenCode and with other models. Correctness is judged by the hidden tests of each human change.
