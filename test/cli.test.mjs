import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { VERSION, save } from '../lib/repo.mjs';
import { CLI, ENTRY, ENV, FN, commit, findings, repo, run, tmp, write } from './helpers.mjs';

const ruff = !spawnSync('ruff', ['--version']).error;
const kinds = F => F.map(f => `${f.kind} ${f.file}${f.line ? `:${f.line}` : ''} ${f.msg}${f.cite ? ` (${f.cite})` : ''}`).join('\n');
const audit = dir => JSON.parse(run(dir, 'audit', '--json').stdout);
const stage = dir => execFileSync('git', ['add', '-A'], { cwd: dir });

test('check fails on tier-0 findings, and on any finding with --strict', () => {
  const dir = repo({ 'a.js': 'export const a = 1;\n' });
  assert.equal(run(dir, 'check').status, 0);
  write(dir, { 'a.js': 'export const a = 1;\n// const b = 2;\n' });
  assert.match(run(dir, 'check').stdout, /\[commented-out\] a\.js:2/);
  assert.equal(run(dir, 'check').status, 1);
  write(dir, { 'a.js': 'export const a = 1;\n// Initialize the cache\nexport const b = 2;\n' });
  assert.equal(run(dir, 'check').status, 0);
  assert.equal(run(dir, 'check', '--strict').status, 1);
  stage(dir);
  assert.equal(run(dir, 'check', '--staged', '--strict').status, 1);
});

test('copies are found however they were made: blocks, renamed functions, inline copies of a rule, and twins', () => {
  const page = (f, a, b) => `def ${f}(${a}, ${b}):\n    out = []\n    for i in range(0, len(${a}), ${b}):\n        out.append(${a}[i:i + ${b}])\n    return [x for x in out if x]\n`;
  const dir = repo({ 'src/a.py': FN, 'shop/money.py': 'def format_money(amount):\n    return f"${amount:,.2f}"\n', 'shop/pages.py': page('paginate', 'items', 'size') });
  write(dir, {
    'src/b.py': `import math\n\n\n${FN}`,
    'shop/rows.py': page('chunk_rows', 'rows', 'n'),
    'shop/invoice.py': 'def invoice_line(order):\n    return f"Total: ${order[\'total\']:,.2f}"\n',
    'shop/dates.py': 'import datetime\n\n\ndef parse_day(s):\n    return datetime.datetime.strptime(s, "%Y-%m-%d")\n\n\ndef parse_since(s):\n    return datetime.datetime.strptime(s, "%Y-%m-%d").date()\n',
  });
  const out = kinds(findings(dir));
  for (const re of [/copy src\/b\.py:\d+ lines \d+-\d+ repeat src\/a\.py:1/, /copy shop\/rows\.py:1 `chunk_rows` has the same body as `paginate` \(shop\/pages\.py:1, used in 1 file\(s\)\) with names changed/, /repeated-literal shop\/invoice\.py:2 repeats the rule `\$\{:,\.2f\}` of `format_money`/, /repeated-literal shop\/dates\.py:\d+ the rule `%Y-%m-%d` is added in 2 places/]) assert.match(out, re);
});

test('structure and knowledge checks: if-chains, swallowed errors, comment blocks, history, wrappers, flags, names, moves, stale docs', () => {
  const chain = extra => `def discount(code, subtotal):\n    if code == "SAVE10":\n        return subtotal * 0.1\n    if code == "FLAT5":\n        return 5\n${extra}    return 0\n`;
  const why = ['Invoices are rendered in the shop currency only. Multi-currency', 'support was rejected because the payment provider settles in one', 'currency and conversion would need a rates feed we do not have.', 'If that changes, start in format_money and keep the rounding rule:', 'half-up to cents, applied once at the end, never per line item.', 'Totals are therefore exact to the cent for every order we store.'];
  const dir = repo({ 'shop/pricing.py': chain(''), 'db.py': 'def get_user(user_id):\n    return {"id": user_id}\n', 'shop/validate.py': 'def check_address(value):\n    return bool(value)\n', 'shop/orders.py': 'x = 1\n', 'shop/ship.py': 'def ship_order(order):\n    return order\n', 'README.md': 'Call `ship_order` to send an order.\n' });
  write(dir, {
    'shop/pricing.py': chain('    if code == "BULK":\n        return subtotal * 0.15\n'),
    'shop/invoice.py': `${why.map(l => `# ${l}`).join('\n')}\n# renamed from bill() on 2026-08-08\ndef invoice(order):\n    try:\n        return order["total"]\n    except Exception:\n        pass\n`,
    'users.py': 'from db import get_user\n\n\ndef fetch_user(user_id):\n    return get_user(user_id)\n\n\ndef process_data(data):\n    return data\n',
    'utils.py': 'def main():\n    return 0\n',
    'shop/validate.py': 'def check_address(value, international=False):\n    return bool(value) or international\n',
  });
  execFileSync('git', ['mv', 'shop/orders.py', 'shop/order_book.py'], { cwd: dir });
  fs.rmSync(path.join(dir, 'shop/ship.py'));
  const out = kinds(findings(dir));
  for (const re of [/if-chain shop\/pricing\.py:2 3 if-branches on literal values of `code`/, /swallowed-error shop\/invoice\.py:11/, /comment-block shop\/invoice\.py:1/, /history shop\/invoice\.py:7/, /wrapper users\.py:4 `fetch_user` only forwards to `get_user`/, /vague-name users\.py:8 vague name `process_data`/, /junk-drawer utils\.py/, /mode-flag shop\/validate\.py:1 `check_address` gained flag parameter `international`/, /moved-files shop\/order_book\.py 1 file\(s\) moved or renamed \(shop\/orders\.py -> shop\/order_book\.py\)/, /stale-doc README\.md still mentions `ship_order`/]) assert.match(out, re);
  assert.doesNotMatch(out, /vague name `main`/);
});

test('copy-pasted tests, one helper written twice in one change, compressed lines and swollen files are flagged', () => {
  const big = Array.from({ length: 820 }, (_, i) => `v${i} = ${i}`).join('\n') + '\n';
  const dir = repo({ 'a.py': 'def add(a, b):\n    return a + b\n', 'big.py': big.split('\n').slice(0, 600).join('\n') + '\n' });
  const body = n => `def test_${n}():\n    result = add(${n}, 1)\n    assert result == ${n + 1}\n    assert isinstance(result, int)\n    assert result > ${n}\n    assert str(result) == "${n + 1}"\n`;
  const helper = (name, v) => `def ${name}(${v}, size):\n    out = []\n    for i in range(0, len(${v}), size):\n        out.append(${v}[i:i + size])\n    return [x for x in out if x]\n`;
  write(dir, { 'tests/test_a.py': `from a import add\n\n\n${body(1)}\n\n${body(2)}\n\n${body(3)}`, 'users.py': helper('paginate_items', 'items'), 'orders.py': helper('chunk_orders', 'rows'), 'big.py': big, 'calc.py': `def f(a, b, c):\n    return ${'a * b + c - a / (b + 1) + '.repeat(8)}0\n` });
  const out = kinds(findings(dir));
  for (const re of [/copied-tests tests\/test_a\.py/, /copy (orders|users)\.py:1 `(chunk_orders|paginate_items)` has the same body as `(paginate_items|chunk_orders)`/, /dense-lines calc\.py:2/, /swollen-file big\.py grew by \d+ lines to 820 code lines/]) assert.match(out, re);
});

test('docs are not comment bloat, but a doc that restates the name is; one-type-per-file languages keep their files and folders', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  const documented = Array.from({ length: 4 }, (_, i) => `def step_${i}(v):\n    """Move the cursor ${i} cells, wrapping at the row end for ragged tables."""\n    return v + ${i}\n`).join('\n\n');
  write(dir, { 'b.py': documented, 'c.py': 'def get_user(uid):\n    """Get the user."""\n    return uid\n', 'src/main/java/com/acme/billing/Invoice.java': 'package com.acme.billing;\n\npublic class Invoice {\n}\n' });
  const out = kinds(findings(dir));
  assert.doesNotMatch(out, /comment-density b\.py/);
  assert.match(out, /narration c\.py:1 1 comment\(s\) narrate the code, decorate it or restate a name/);
  assert.doesNotMatch(out, /(tiny-file|new-folder) src\/main/);
});

test('over-cutting is caught: weakened or skipped tests, removed logging, error handling and stated rules, deleted docs', () => {
  const dir = repo({
    'app.py': '# Never log the token: it grants full tenant access.\nimport logging\nlog = logging.getLogger(__name__)\n\n\ndef pay(amount):\n    if amount <= 0:\n        raise ValueError("amount")\n    log.info("paying %s", amount)\n    return amount\n',
    'tests/test_app.py': 'from app import pay\n\n\ndef test_pay():\n    assert pay(2) == 2\n    assert pay(3) == 3\n\n\ndef test_other():\n    assert pay(1) == 1\n',
    'README.md': Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n',
  });
  write(dir, { 'app.py': 'def pay(amount):\n    return amount\n', 'tests/test_app.py': 'import pytest\nfrom app import pay\n\n\ndef test_pay():\n    assert pay(2) == 2\n\n\n@pytest.mark.skip\ndef test_other():\n    assert pay(1) == 1\n', 'README.md': 'line 0\n' });
  const out = kinds(findings(dir));
  for (const re of [/weakened-tests tests\/test_app\.py 1 test assertion/, /weakened-tests tests\/test_app\.py 1 test\(s\) newly skipped/, /removed-safeguard app\.py removed 1 logging or metrics line\(s\), 1 error-handling or validation line\(s\), 1 comment stating a security rule/, /doc-removed README\.md 39 lines of documentation removed/]) assert.match(out, re);
});

test('a false positive is suppressed in place with a reason and stays visible; owner exceptions accept by kind; policy needs the owner', () => {
  const dir = repo({ '.lessloc.json': JSON.stringify({ exceptions: [{ path: 'legacy/**', finding: 'narration', why: 'vendored file, kept verbatim' }, { path: '**', finding: 'tiny-file' }] }), 'a.py': 'x = 1\n' });
  write(dir, { 'legacy/old.py': '# Initialize the counter\ncount = 0\n', 'new.py': '# Initialize the total\ntotal = 0\n', 'h.py': 'def f():\n    try:\n        return 1\n    # lessloc-ignore swallowed-error: the optional speedup may be missing\n    except Exception:\n        pass\n\n# lessloc-ignore: not really\n# y = compute(x)\n' });
  const r = run(dir, 'check'), out = r.stdout;
  assert.match(out, /1 accepted by exception; 1 suppressed/);
  assert.match(out, /\[narration\] new\.py:1/);
  assert.doesNotMatch(out, /legacy\/old\.py:1/);
  assert.match(out, /suppressed: \[swallowed-error\] h\.py:5: .* \(the optional speedup may be missing\)/);
  assert.match(out, /\[commented-out\] h\.py:9/, 'tier-0 findings cannot be suppressed in place');
  assert.match(out, /\[config\] \.lessloc\.json: .*each "exceptions" entry needs a "why"/, 'an exception without a reason is a broken setting');
});

test('a marker the change kept from a line it rewrote is not new; one it added is', () => {
  const dir = repo({ 'm.py': 'def g(kwargs):\n    kwargs["a"] = cast(  # type: ignore\n        1)\n    return kwargs\n' });
  write(dir, { 'm.py': 'def g(kwargs):\n    value = cast(  # type: ignore\n        1)\n    kwargs["a"] = value\n    return kwargs\n' });
  assert.doesNotMatch(kinds(findings(dir)), /suppression/);
  write(dir, { 'm.py': 'def g(kwargs):\n    value = cast(  # type: ignore\n        1)\n    kwargs["a"] = value  # type: ignore\n    return kwargs\n' });
  assert.match(kinds(findings(dir)), /suppression m\.py:4 /);
});

test('GitHub Actions get annotations on the diff: an error for a tier-0 finding, a warning for a tier-1 one', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  write(dir, { 'a.py': 'x = 1\n# y = compute(x)\ndef f():\n    try:\n        return 1\n    except Exception:\n        pass\n' });
  const r = run(dir, 'check', '--github').stdout;
  assert.match(r, /^::error file=a\.py,line=2,title=lessloc commented-out::commented-out code/m);
  assert.match(r, /^::warning file=a\.py,line=6,title=lessloc swallowed-error::/m);
});

test('audit measures duplication, copies, junk, tiny files, folders, comments, dead code and instruction weight', () => {
  const dir = repo({
    'src/a.py': FN, 'src/b.py': FN, 'FIX_SUMMARY.md': 'x\n', 'src/t.py': 'x = 1\n', 'deep/x.py': '# x = 1\ny = 2\n',
    'a.py': 'def used():\n    return 1\n\n\ndef unused_thing():\n    return used()\n',
    'b.py': 'from a import used\n\n\ndef format_money(x):\n    try:\n        return used()\n    except Exception:\n        pass\n',
    'c.py': 'def money_format(x):\n    return x\n',
    'CLAUDE.md': 'x'.repeat(4000),
    'native/fast.c': 'int fast(void) { return 1; }\n',
  });
  const r = audit(dir);
  assert.equal(r.clones.length, 1);
  assert.equal(r.copiedDefinitions.length, 1);
  assert.deepEqual(r.junk, ['FIX_SUMMARY.md']);
  assert.ok(r.tiny.includes('src/t.py'));
  assert.ok(r.commentedOutOrPlaceholder.some(s => s.startsWith('deep/x.py:1')));
  assert.deepEqual(r.singleEntryFolders, ['deep/', 'native/']);
  assert.ok(r.unreferenced.some(s => s.endsWith('unused_thing')) && !r.unreferenced.some(s => s.endsWith(' used')));
  assert.equal(r.similarNames.length, 1);
  assert.equal(r.catchAlls.length, 1);
  assert.equal(r.metrics.instructionTokens, 1000);
  assert.equal(r.testCommand, '');
  assert.deepEqual(r.unindexed, {}, 'C files are indexed');
});

test('the audit reads change locality from history, its own overhead, unpinned builds and a missing vulnerability scan', () => {
  const dir = repo({ 'a/x.py': 'x = 0\n', 'b/y.py': 'y = 0\n', 'package.json': '{"name": "x", "dependencies": {"left-pad": "^1.3.0"}}' });
  for (let i = 1; i <= 6; i++) {
    write(dir, { 'a/x.py': `x = ${i}\n`, 'b/y.py': `y = ${i}\n` });
    stage(dir);
    commit(dir);
  }
  execFileSync('node', [ENTRY], { cwd: dir, input: JSON.stringify({ cwd: dir, session_id: 'o', hook_event_name: 'SessionStart' }), env: ENV });
  const r = audit(dir);
  assert.equal(r.locality.filesPerChange, 2);
  assert.deepEqual(r.locality.together, ['a/ + b/  7 commits']);
  assert.ok(r.overhead.some(o => /^SessionStart: median \d+ ms, ~\d+ tokens added \(1 run\)$/.test(o)), JSON.stringify(r.overhead));
  assert.deepEqual(r.unpinned, ['package.json declares dependencies but has no lockfile']);
  assert.match(run(dir, 'audit').stdout, /vulnerability scan: not run/);
});

test('the ratchet lets measures fall and refuses to let them rise, test assertions included', () => {
  const dir = repo({ 'src/a.py': FN, 'tests/test_a.py': 'def test_a():\n    assert 1\n    assert 2\n' });
  assert.equal(run(dir, 'baseline').status, 0);
  write(dir, { 'src/b.py': FN, 'tests/test_a.py': 'def test_a():\n    assert 1\n' });
  const out = run(dir, 'check', '--ratchet');
  assert.match(out.stdout, /\[ratchet\] .*duplicateLines got worse: 0/);
  assert.match(out.stdout, /testAssertions got worse: 3 -> 2/);
  assert.equal(out.status, 1);
  assert.equal(run(dir, 'baseline').status, 1, 'raising needs a reason');
  assert.equal(run(dir, 'baseline', '--allow-worse', 'vendored copy, removed next sprint').status, 0);
  assert.equal(run(dir, 'check', '--ratchet').status, 0);
});

test('lessloc test prints only what failed and records evidence for the exact state; check requires it', () => {
  const dir = repo({ '.lessloc.json': '{"test": "python3 -c \\"import sys; [print(f\'ok line {i}\') for i in range(200)]; sys.exit(0)\\""}', 'a.py': 'x = 1\n' });
  write(dir, { 'a.py': 'x = 2\n' });
  const t = run(dir, 'test');
  assert.equal(t.status, 0);
  assert.equal(t.stdout.trim().split('\n').length, 1, 'a passing run is one line');
  stage(dir);
  assert.match(run(dir, 'check', '--staged').stdout, /tests passed at this exact state/);
  assert.equal(run(dir, 'check', '--staged', '--require-evidence').status, 0);
  write(dir, { 'a.py': 'x = 3\n' });
  stage(dir);
  assert.match(run(dir, 'check', '--staged').stdout, /tests not run at this exact state/);
  assert.equal(run(dir, 'check', '--staged', '--require-evidence').status, 1);
  const failing = repo({ '.lessloc.json': '{"test": "python3 -c \\"[print(f\'noise {i}\') for i in range(300)]; print(\'FAILED test_pay - AssertionError: 2 != 3\'); raise SystemExit(1)\\""}' });
  const f = run(failing, 'test');
  assert.equal(f.status, 1);
  assert.match(f.stdout, /FAILED test_pay - AssertionError/);
  assert.ok(f.stdout.split('\n').length < 40, 'failure output is cut to the failing parts');
});

test('verify runs the tests on a clean checkout of the exact state and fails closed', () => {
  const dir = repo({ '.lessloc.json': '{"test": "test -f needed.txt"}', 'a.py': 'x = 1\n' });
  write(dir, { 'needed.txt': 'only in the working tree\n' });
  assert.equal(run(dir, 'verify', 'HEAD').status, 1, 'a file present only in the working tree does not count');
  stage(dir);
  assert.equal(run(dir, 'verify').status, 0);
  assert.match(run(dir, 'check', '--staged').stdout, /tests passed at this exact state \(clean checkout\)/);
  const crash = repo({ '.lessloc.json': '{"test": "kill -9 $$"}' });
  assert.match(run(crash, 'verify', 'HEAD').stdout, /NOT verified: .* did not finish/);
  const drift = repo({ '.lessloc.json': '{"test": "true"}', 'package-lock.json': '{"v": 1}\n' });
  write(drift, { 'package-lock.json': '{"v": 2}\n', 'node_modules/x.js': '' });
  assert.match(run(drift, 'verify', 'HEAD').stdout, /package-lock\.json differ from the installed dependencies/);
});

test('init writes nothing into the repository unless asked, leaves shared or hand-written hooks alone, and remove undoes it', () => {
  const dir = repo({ 'tests/test_a.py': 'import unittest\n\n\nclass A(unittest.TestCase):\n    def test_a(self):\n        self.assertTrue(True)\n', 'a.py': 'x = 1\n', 'CLAUDE.md': '# Notes\n' });
  const status = () => execFileSync('git', ['status', '--porcelain', '--ignored', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' });
  const init = run(dir, 'init');
  assert.match(init.stdout, /git hooks in this clone only/);
  assert.match(init.stdout, /test command: `python3 -m unittest discover -s tests -q`\n/);
  assert.match(init.stdout, /nothing was written to the repository/);
  assert.equal(status(), '', 'no file appears in the working tree');
  const hook = fs.readFileSync(path.join(dir, '.git/hooks/pre-commit'), 'utf8');
  assert.match(hook, /^#!\/bin\/sh\nif command -v node >\/dev\/null 2>&1 && \[ -f ".*lessloc\.mjs" \]; then node ".*lessloc\.mjs" check --staged --gate \|\| exit 1; fi\n$/, 'a copy on another machine is a no-op, not a blocked commit');
  run(dir, 'init', '--rules', '--config');
  run(dir, 'init', '--rules');
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').match(/<!-- lessloc -->/g).length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), '# Notes\n\n@AGENTS.md\n', 'CLAUDE.md imports the rules once');
  assert.match(fs.readFileSync(path.join(dir, '.lessloc.json'), 'utf8'), /"test": "python3 -m unittest discover -s tests -q"/);
  const removed = run(dir, 'remove');
  assert.match(removed.stdout, /removed: git hook pre-commit; git hook prepare-commit-msg; AGENTS\.md \(it held only the rules\)/);
  assert.match(removed.stdout, /kept, because they are shared with the team: \.lessloc\.json/);
  assert.equal(fs.existsSync(path.join(dir, '.git/hooks/pre-commit')), false);

  const shared = repo({ '.githooks/pre-commit': '#!/bin/sh\nnpm run lint\n', 'a.py': 'x = 1\n' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: shared });
  assert.match(run(shared, 'init').stdout, /git hooks are shared or hand-written, so lessloc left them alone; add to \.githooks\/pre-commit: if command -v node/);
  assert.equal(fs.readFileSync(path.join(shared, '.githooks/pre-commit'), 'utf8'), '#!/bin/sh\nnpm run lint\n', 'a tracked hook every teammate runs is never edited');
  const own = repo({ 'a.py': 'x = 1\n' });
  fs.writeFileSync(path.join(own, '.git/hooks/pre-commit'), '#!/bin/sh\nmake lint\n');
  run(own, 'init');
  assert.equal(fs.readFileSync(path.join(own, '.git/hooks/pre-commit'), 'utf8'), '#!/bin/sh\nmake lint\n', 'a hand-written hook is left alone');
});

test('commits carry no trailers unless the team turns them on; then one line says what was verified at their exact state, and "all" adds what was left open', () => {
  const quiet = repo({ 'a.py': 'x = 1\n' });
  execFileSync('git', ['config', 'core.hooksPath', '.git/hooks'], { cwd: quiet });
  run(quiet, 'init');
  write(quiet, { 'a.py': 'x = 2\n' });
  stage(quiet);
  assert.equal(commit(quiet).status, 0);
  assert.doesNotMatch(execFileSync('git', ['log', '-1', '--format=%B'], { cwd: quiet, encoding: 'utf8' }), /Lessloc-/);
  const dir = repo({ '.lessloc.json': '{"trailers": "verified"}\n', 'tests/test_a.py': 'import unittest\n\n\nclass A(unittest.TestCase):\n    def test_a(self):\n        self.assertTrue(True)\n', 'a.py': 'x = 1\n' });
  execFileSync('git', ['config', 'core.hooksPath', '.git/hooks'], { cwd: dir });
  run(dir, 'init');
  const last = () => execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' });
  write(dir, { 'a.py': 'x = 1\n# Initialize the total\ntotal = 0\n' });
  stage(dir);
  assert.equal(run(dir, 'verify').status, 0);
  assert.equal(commit(dir).status, 0);
  assert.match(last(), /Lessloc-Verified: tests passed at this exact state \(clean checkout\)/);
  assert.doesNotMatch(last(), /Lessloc-Open/);
  write(dir, { '.lessloc.json': '{"trailers": "all"}\n', 'b.py': 'y = 1\n# Initialize the total\ntotal = 0\n', 'native/fast.c': 'int fast(void) { return 1; }\n', 'native/x.zig': 'const x = 1;\n' });
  stage(dir);
  assert.equal(commit(dir).status, 0);
  assert.match(last(), /Lessloc-Open: \d+ \(\[/);
  assert.match(last(), /Lessloc-Unchecked: definition checks for \.zig files/);
  write(dir, { 'x.js': '// foo();\n' });
  stage(dir);
  const blocked = commit(dir);
  assert.notEqual(blocked.status, 0, 'the pre-commit gate blocks tier-0 findings');
  assert.match(blocked.stdout + blocked.stderr, /Not committed\. Fix these first:\n- x\.js:1: commented-out code/);
  assert.doesNotMatch(blocked.stdout + blocked.stderr, /lessloc|\[commented-out\]/, 'whoever commits, often an agent, reads plain words');
  write(dir, { 'x.js': 'export const x = 1;\n', '.lessloc.json': '{"trailers": "all", "interupt": []}\n' });
  stage(dir);
  assert.equal(commit(dir).status, 0, 'a typo in lessloc\'s own settings never refuses a commit');
});

test('the handoff probe asks a fresh agent, on stdin, where the change lives', () => {
  const mk = probe => repo({ '.lessloc.json': JSON.stringify({ probe }), 'shop/money.py': 'def format_money(amount):\n    return amount\n' });
  const ask = dir => run(dir, 'probe', '--task', 'format money for invoices', 'HEAD');
  assert.equal(ask(mk('grep -q "Behavior: format money" && echo shop/money.py')).status, 0);
  assert.match(ask(mk('cat >/dev/null; echo somewhere/else.py')).stdout, /none of the changed files \(shop\/money\.py\)/);
  assert.match(ask(mk(`cat >/dev/null; node -e 'console.log(JSON.stringify({ result: "shop/money.py", num_turns: 14, usage: { input_tokens: 90000 } }))'`)).stdout, /needed 14 turns \(~90k tokens\)/);
});

test('doctor says what works and what broke', () => {
  const dir = repo({ '.lessloc.json': '{"test": "true", "interupt": []}', 'a.py': 'x = 1\n' });
  const r = run(dir, 'doctor');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗ \.lessloc\.json: unknown setting "interupt" \(did you mean "interrupt"\?\)/);
  assert.match(r.stdout, /! no lessloc hook has run in this repository yet/);
});

test('ci runs the tests for the commit and checks the change against its base with the ratchet', () => {
  const dir = repo({ '.lessloc.json': '{"test": "true"}', 'a.py': 'x = 1\n' });
  assert.equal(run(dir, 'baseline').status, 0);
  stage(dir);
  commit(dir);
  write(dir, { 'b.py': 'y = 2\n# z = compute(y)\n' });
  stage(dir);
  commit(dir);
  const r = run(dir, 'ci', '--base', 'HEAD~1');
  assert.match(r.stdout, /^passed: true/m);
  assert.match(r.stdout, /tests passed at this exact state/);
  assert.match(r.stdout, /\[commented-out\] b\.py:2/);
  assert.equal(r.status, 1);
});

test('brute-force code the language has a shorter idiom for is flagged on the new lines only', { skip: !ruff && 'ruff is not installed' }, () => {
  const dir = repo({ 'old.py': 'def legacy(x):\n    if x == True:\n        return True\n    else:\n        return False\n' });
  write(dir, { 'new.py': 'def has_refund(orders):\n    found = False\n    for order in orders:\n        if order["refunded"] == True:\n            found = True\n    if found:\n        return True\n    else:\n        return False\n' });
  const out = kinds(findings(dir));
  assert.match(out, /simpler new\.py:4 .*\(ruff E712\)/);
  assert.match(out, /simpler new\.py:6 .*\(ruff SIM103\)/);
  assert.doesNotMatch(out, /old\.py/, 'code this change did not write is not judged');
});

test('ruff never changes a file, whatever the repository sets, and every file name reaches it as a file name', { skip: !ruff && 'ruff is not installed' }, () => {
  const dir = repo({ 'ruff.toml': 'fix = true\nfix-only = true\nunsafe-fixes = true\n', 'victim.py': 'x = 1\n' });
  write(dir, { 'app.py': 'import os\n\nx = 1\n', '--output-file=victim.py': 'y = 2\n' });
  const out = run(dir, 'check').stdout;
  assert.equal(fs.readFileSync(path.join(dir, 'app.py'), 'utf8'), 'import os\n\nx = 1\n');
  assert.equal(fs.readFileSync(path.join(dir, 'victim.py'), 'utf8'), 'x = 1\n');
  assert.match(out, /\[unused\] app\.py:1/);
});

test('a boundary pattern that does not compile is a settings problem, and code with regex characters in its names stops no check', () => {
  const dir = repo({ '.lessloc.json': JSON.stringify({ boundaries: [{ files: '**', mustNotImport: '(' }] }), 'a.py': 'x = 1\n' });
  const box = 'class Box:\n    def __init__(self, a, b, sep=", (x"):\n        self.a = a\n        self.b = b\n        self.sep = sep\n        self.end = 1\n';
  write(dir, { 'a.py': `x = 1\nTOKEN = "${['ghp', 'Zq8Lm2Vt9Rw4Kp7Hn3Jd6Fg1Xc5Bs0Ya8Ue2W'].join('_')}"\n\n\n${box}` });
  const out = run(dir, 'check').stdout;
  assert.match(out, /\[config\] \.lessloc\.json: "mustNotImport" "\(" is not a valid regular expression/);
  assert.match(out, /\[secret\] a\.py:2/);
});

test('init sets up no hooks from a lessloc folder whose path a hook command cannot quote', () => {
  const copy = tmp('less$loc-');
  for (const f of ['lessloc.mjs', 'hook.mjs', 'package.json', 'RULES.md', 'PATTERNS.md', 'lib']) fs.cpSync(path.join(path.dirname(CLI), f), path.join(copy, f), { recursive: true });
  const dir = repo({ 'a.py': 'x = 1\n' }), r = spawnSync('node', [path.join(copy, 'lessloc.mjs'), 'init'], { cwd: dir, encoding: 'utf8', env: ENV });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^lessloc init cannot set up hooks from .*less\$loc-\w+: hook commands cannot quote the \$ in it/);
  assert.ok(!fs.existsSync(path.join(dir, '.git/hooks/pre-commit')));
});

test('audit --tools runs knip from node_modules only when it was installed there, never from a node_modules the repository commits', { skip: process.platform === 'win32' && 'a shell script stands in for knip' }, () => {
  const knip = { 'node_modules/.bin/knip': '#!/bin/sh\ntouch RAN-FROM-REPO\n' }, env = { ...ENV, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` };
  const audit = dir => {
    fs.chmodSync(path.join(dir, 'node_modules/.bin/knip'), 0o755);
    spawnSync('node', [CLI, 'audit', '--tools'], { cwd: dir, encoding: 'utf8', env });
    return fs.existsSync(path.join(dir, 'RAN-FROM-REPO'));
  };
  const installed = repo({ '.gitignore': 'node_modules/\n', 'a.py': 'x = 1\n' });
  write(installed, knip);
  assert.ok(audit(installed), 'an installed knip runs');
  const committed = repo({ 'a.py': 'x = 1\n', ...knip });
  assert.ok(!audit(committed), 'a committed one never runs');
});

test('--help after any command prints the usage and does nothing else', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  assert.equal(run(dir, 'init').status, 0);
  const hooks = () => fs.readdirSync(path.join(dir, '.git', 'hooks')).filter(f => !f.endsWith('.sample')).sort();
  const before = hooks();
  for (const args of [['remove', '--help'], ['remove', '--agents', '-h'], ['init', '--help']]) {
    const r = run(dir, ...args);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^lessloc \S+: keeps AI coding agents/);
  }
  assert.deepEqual(hooks(), before, 'remove --help removed nothing');
});

test('a command that cannot start says why and exits 2: an unknown command, an unknown base, a missing folder', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  const typo = run(dir, 'chek', '--staged');
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /^lessloc: unknown command "chek"\n\nlessloc \S+: keeps AI coding agents/);
  assert.match(typo.stderr, /^ {2}version, --version, -v +print the version$/m);
  assert.equal(run(dir).status, 0, 'no command prints the usage');
  for (const v of ['version', '--version', '-v']) assert.equal(run(dir, v).stdout, `${VERSION}\n`, v);
  const base = run(dir, 'check', '--base', 'bogus');
  assert.equal(base.status, 2);
  assert.match(base.stderr, /^lessloc check cannot find the base "bogus"/);
  const audit = run(dir, 'audit', path.join(dir, 'nowhere'));
  assert.equal(audit.status, 2);
  assert.match(audit.stderr, /^lessloc audit cannot find the folder .*nowhere\n$/);
});

test('in GitHub Actions, check --json stays valid JSON and its annotations go to stderr', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  write(dir, { 'a.py': 'x = 1\n# y = compute(x)\n' });
  const r = spawnSync('node', [CLI, 'check', '--json'], { cwd: dir, encoding: 'utf8', env: { ...ENV, GITHUB_ACTIONS: 'true' } });
  assert.deepEqual(JSON.parse(r.stdout).findings.map(f => f.kind), ['commented-out']);
  assert.match(r.stderr, /^::error file=a\.py,line=2,title=lessloc commented-out::/m);
});

test("init --ci writes a workflow on the current Node LTS with the action versions lessloc's own workflows use", () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  run(dir, 'init', '--ci');
  const yaml = fs.readFileSync(path.join(dir, '.github/workflows/lessloc.yml'), 'utf8'), own = new URL('../.github/workflows/', import.meta.url);
  const uses = t => [...t.matchAll(/uses: (actions\/(?:checkout|setup-node)@\S+)/g)].map(m => m[1]);
  assert.match(yaml, /node-version: 24\n/);
  assert.deepEqual(uses(yaml), ['actions/checkout@v7', 'actions/setup-node@v7']);
  assert.deepEqual([...new Set(fs.readdirSync(own).flatMap(f => uses(fs.readFileSync(new URL(f, own), 'utf8'))))].sort(), uses(yaml));
});

test('init --rules leaves a CLAUDE.md it cannot write as it is, and shows the line to add only when the import is missing', { skip: process.getuid?.() === 0 && 'root writes a read-only file' }, () => {
  for (const [body, shown] of [['# Notes\n\n@AGENTS.md\n', false], ['# Notes\n', true]]) {
    const dir = repo({ 'a.py': 'x = 1\n', 'CLAUDE.md': body });
    fs.chmodSync(path.join(dir, 'CLAUDE.md'), 0o444);
    const r = run(dir, 'init', '--rules');
    assert.equal(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /<!-- lessloc -->/);
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), body);
    assert.equal(/- lessloc cannot write CLAUDE\.md, so it was left as it is: add the line @AGENTS\.md to it/.test(r.stdout), shown, r.stdout);
  }
});

test('init adds a shared file only where nothing is: a symlink in its place is left as it is, never written through', () => {
  const dir = repo({ 'a.py': 'x = 1\n' }), outside = tmp('outside-');
  fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
  fs.symlinkSync(path.join(outside, 'lessloc.yml'), path.join(dir, '.github/workflows/lessloc.yml'));
  fs.symlinkSync(path.join(outside, 'lessloc.json'), path.join(dir, '.lessloc.json'));
  const out = run(dir, 'init', '--ci', '--config').stdout;
  assert.match(out, /- \.github\/workflows\/lessloc\.yml already exists, so it was left as it is\n/);
  assert.match(out, /- \.lessloc\.json already exists, so it was left as it is\n/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('the workflow from init --ci reads only, keeps no credentials in the checkout, gets lessloc from npm at exactly this version, and runs no expression in its script', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  run(dir, 'init', '--ci');
  const yaml = fs.readFileSync(path.join(dir, '.github/workflows/lessloc.yml'), 'utf8');
  assert.match(yaml, /^on: \[pull_request\]\npermissions:\n {2}contents: read\n/m);
  assert.match(yaml, /fetch-depth: 0\n {10}persist-credentials: false\n/);
  assert.ok(yaml.includes(`- run: npx --yes lessloc@${VERSION} ci --base "origin/$GITHUB_BASE_REF"\n`));
  assert.doesNotMatch(yaml, /\$\{\{/);
  const fork = repo({ 'a.py': 'x = 1\n' });
  spawnSync('node', [CLI, 'init', '--ci'], { cwd: fork, env: { ...ENV, LESSLOC_SOURCE: 'github:someone/lessloc#v1.0.0' } });
  assert.match(fs.readFileSync(path.join(fork, '.github/workflows/lessloc.yml'), 'utf8'), /- run: npx --yes github:someone\/lessloc#v1\.0\.0 ci /);
});

test('a snapshot keeps the content of untracked keys and environment files out of git, and still reports an environment file or a private key about to be committed', () => {
  const label = (w, what) => [`-----${w}`, `${what}-----`].join(' '), key = `${label('BEGIN', 'OPENSSH PRIVATE KEY')}\nnot a real key 0123\n${label('END', 'OPENSSH PRIVATE KEY')}\n`;
  const dir = repo({ 'a.py': 'x = 1\n' }), files = { '.env': 'TOKEN=not-a-real-value-0123456789\n', '.env.production': 'TOKEN=also-not-real-9876543210\n', id_rsa: key, 'certs/site.pem': `${label('BEGIN', 'CERTIFICATE')}\nnot a real certificate 0123\n`, '.env.example': 'TOKEN=\n', 'b.py': 'y = 2\n' };
  write(dir, files);
  const out = run(dir, 'check').stdout, stored = f => spawnSync('git', ['cat-file', '-e', execFileSync('git', ['hash-object', f], { cwd: dir, encoding: 'utf8' }).trim()], { cwd: dir }).status === 0;
  assert.match(out, /\[secret\] \.env: environment file would be committed/);
  assert.match(out, /\[secret\] \.env\.production: environment file would be committed/);
  assert.match(out, /\[secret\] id_rsa:1: credential `-----BEG\.\.\.`/);
  assert.doesNotMatch(out, /certs\/site\.pem/, 'a certificate is no secret');
  for (const f of ['.env', '.env.production', 'id_rsa', 'certs/site.pem']) assert.ok(!stored(f), `${f} is not in .git/objects`);
  for (const f of ['.env.example', 'b.py']) assert.ok(stored(f), `${f} is reviewed as usual`);
  write(dir, { '.gitignore': '.env*\n', '.env': 'TOKEN=changed-not-real-0123456789\n' });
  assert.doesNotMatch(run(dir, 'check').stdout, /environment file/, 'an ignored environment file is not committed');
  assert.ok(!stored('.env'), 'nor is it taken in once it is ignored');
});

test('lessloc keeps its state in folders only the user can open, a root an earlier version made included', { skip: process.platform === 'win32' && 'Windows has no POSIX modes' }, () => {
  const root = path.join(tmp('cache-'), 'lessloc'), dir = repo({ 'a.py': 'x = 1\n' });
  fs.mkdirSync(root);
  fs.chmodSync(root, 0o755);
  spawnSync('node', [CLI, 'check'], { cwd: dir, encoding: 'utf8', env: { ...ENV, LESSLOC_STATE: root } });
  const own = fs.readdirSync(root).map(f => path.join(root, f)).filter(f => fs.statSync(f).isDirectory());
  assert.equal(own.length, 1);
  for (const f of [root, ...own]) assert.equal(fs.statSync(f).mode & 0o777, 0o700, f);
});

test('a settings file lessloc rewrites keeps its permissions, and a symlinked one stays a symlink', { skip: process.platform === 'win32' && 'Windows has no POSIX modes' }, () => {
  const dir = tmp('settings-'), real = path.join(dir, 'real.json'), link = path.join(dir, 'link.json');
  fs.writeFileSync(real, '{}');
  fs.chmodSync(real, 0o600);
  fs.symlinkSync(real, link);
  save(link, { a: 1 });
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.deepEqual(JSON.parse(fs.readFileSync(real, 'utf8')), { a: 1 });
  assert.equal(fs.statSync(real).mode & 0o777, 0o600);
  fs.chmodSync(real, 0o644);
  save(real, {}, 0o600);
  assert.equal(fs.statSync(real).mode & 0o777, 0o600, 'an explicit mode wins');
});
