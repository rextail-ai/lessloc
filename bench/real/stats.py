"""The published results of per-task replays, no tool against lessloc, as Markdown tables.

  stats.py <results.json> <prepared dir> [<results.json> <prepared dir> ...]

Prints one summary row per project and, for more than one project, all of them together; then each project's tasks in the
order their changes were merged. Each task counts once, as the mean of its sessions, and every interval is a 95% bootstrap
over tasks (4,000 resamples, fixed seed), paired by task. Lines are the non-blank lines a session's diff adds to .py files:
production lines outside the tests, test lines in tests/, test/ or testing/, test_*.py, *_test.py and conftest.py.
"""
import json
import random
import re
import sys
from collections import defaultdict

ARMS = ('none', 'lessloc')


def lines(diff):
    out, path = defaultdict(int), None
    for line in (diff or '').splitlines():
        if line.startswith('+++ '):
            path = line[6:] if line.startswith('+++ b/') else None
        elif path and path.endswith('.py') and line.startswith('+') and line[1:].strip():
            test = re.search(r'(^|/)(tests?|testing)/|(^|/)test_[^/]*\.py$|_test\.py$|conftest\.py$', path)
            out['test' if test else 'prod'] += 1
    return out


def tasks(results, prepared):
    meta = json.load(open(f'{prepared}/tasks.json'))
    by = defaultdict(lambda: defaultdict(list))
    for r in json.load(open(results))['results']:
        if not r.get('lost') and r.get('passed') is not None:
            by[r['task']][r['arm']].append(r)
    mean = lambda xs: sum(xs) / len(xs)
    rows = []
    for t in sorted((t for t in meta['tasks'] if all(by[t['id']][a] for a in ARMS)), key=lambda t: t['merged']):
        row = {'id': t['id'], 'merged': t['merged'][:10]}
        for a in ARMS:
            rs = by[t['id']][a]
            row[a] = {'n': len(rs), 'passes': sum(1 for r in rs if r['passed']), 'passed': mean([1.0 if r['passed'] else 0.0 for r in rs]),
                      'prod': mean([lines(r.get('diff'))['prod'] for r in rs]), 'test': mean([lines(r.get('diff'))['test'] for r in rs]),
                      'cost': mean([r.get('cost') or 0 for r in rs]), 'broke': mean([len(r.get('regressions') or []) for r in rs])}
        rows.append(row)
    return meta['project']['repo'].split('/')[-1], rows


def total(rows, arm, k):
    return sum(r[arm][k] for r in rows)


def change(rows, k):
    return total(rows, 'lessloc', k) / total(rows, 'none', k) - 1


def boot(rows, f, n=4000):
    random.seed(7)
    xs = sorted(f([random.choice(rows) for _ in rows]) for _ in range(n))
    return xs[int(.025 * n)], xs[int(.975 * n)]


def summary(name, rows):
    pct = lambda x: f'{x:+.0%}'.replace('-', '−')
    num = lambda x: f'{x:+.1f}'.replace('-', '−').replace('+0.0', '0')
    d = lambda s: total(s, 'lessloc', 'passed') - total(s, 'none', 'passed')
    rate = lambda a: f"{total(rows, a, 'passed') / len(rows):.1%}"
    per = lambda a, k, f: f.format(total(rows, a, k) / len(rows))
    cell = lambda k, f: f"{per('none', k, f)} → {per('lessloc', k, f)}, {pct(change(rows, k))} ({' to '.join(map(pct, boot(rows, lambda s: change(s, k))))})"
    return (f"| {name} | {len(rows)} | {rate('none')} → {rate('lessloc')}, {num(d(rows))} ({' to '.join(map(num, boot(rows, d)))}) "
            f"| {cell('prod', '{:.1f}')} | {cell('cost', '${:.4f}')} | {per('none', 'broke', '{:.2f}')} → {per('lessloc', 'broke', '{:.2f}')} "
            f"| {per('none', 'test', '{:.1f}')} → {per('lessloc', 'test', '{:.1f}')} |")


projects = [tasks(sys.argv[i], sys.argv[i + 1]) for i in range(1, len(sys.argv) - 1, 2)]
print('| | Tasks | Passed: no tool → lessloc, difference in tasks | Production lines per task | Cost per task | Earlier changes broken per task | Test lines per task |')
print('|---|--:|--:|--:|--:|--:|--:|')
for name, rows in projects:
    print(summary(name, rows))
if len(projects) > 1:
    print(summary('**All**', [r for _, rows in projects for r in rows]))
for name, rows in projects:
    print(f'\n#### {name}\n\n| Task | Merged | Passed: no tool | lessloc | Production lines: no tool | lessloc | Cost: no tool | lessloc |\n|---|---|--:|--:|--:|--:|--:|--:|')
    for r in rows:
        n, l = r['none'], r['lessloc']
        print(f"| {r['id']} | {r['merged']} | {n['passes']}/{n['n']} | {l['passes']}/{l['n']} | {n['prod']:g} | {l['prod']:g} | ${n['cost']:.3f} | ${l['cost']:.3f} |")
