// The pattern catalog (PATTERNS.md) as tests: every bad form is caught under its kind, and the good form next to it is not, so a
// push for less code never flags what the code needs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { line } from '../lib/voice.mjs';
import { CASES } from './cases.mjs';
import { agentWrite, findings, hook, repo, stop, turn, write } from './helpers.mjs';


test('every catalogued bad form is caught under its kind, and the good form beside it is not', () => {
  const dir = repo({ 'README.md': 'x\n' });
  write(dir, Object.fromEntries(CASES.flatMap(([, , file, bad, good], i) => [[`bad${i}/${file}`, bad], [`good${i}/${file}`, good]])));
  const F = findings(dir), got = (i, side, kind) => F.filter(f => f.kind === kind && f.file.startsWith(`${side}${i}/`));
  const misses = [], wrong = [];
  CASES.forEach(([, kind, file], i) => {
    if (!got(i, 'bad', kind).length) misses.push(`${kind} ${file}`);
    for (const f of got(i, 'good', kind)) wrong.push(`${kind} ${f.file}:${f.line} ${f.msg}`);
  });
  assert.deepEqual(misses, [], 'bad forms not caught');
  assert.deepEqual(wrong, [], 'good forms flagged');
  // Any of these can reach an agent at the end of a turn or in a handoff, in the agent's voice.
  const loud = F.map(line).filter(t => /lessloc|\((?:CWE-|Sonar|ESLint|typescript-eslint|unicorn|staticcheck|ruff [\w-]+\)|ruff [A-Z]|clippy|pylint|golangci|PEP \d|Effective|Clean Code|Google|Fowler|Meyer|TDD|xUnit|Anthropic|package hallucination|Bloch|Raymond|arXiv|\.NET CA\d)|et al\./i.test(t));
  assert.deepEqual(loud, [], 'a finding read by an agent names lessloc or cites a source');
});

test('new code in a codebase: versions side by side, one-implementation interfaces, dead code and duplicate libraries', () => {
  const dir = repo({ 'shop/dates.py': 'def parse_date(s):\n    return s\n', 'shop/use.py': 'from shop.dates import parse_date\n\nprint(parse_date("x"))\n', 'package.json': '{\n  "dependencies": {\n    "moment": "^2.30.0"\n  }\n}\n', 'package-lock.json': '{}\n' });
  write(dir, {
    'shop/dates2.py': 'def parse_date_v2(s):\n    return s.strip()\n',
    'shop/repo.ts': 'export interface Repo {\n  get(id: string): string;\n}\nexport class SqlRepo implements Repo {\n  get(id: string) {\n    return id;\n  }\n}\n',
    'shop/base.py': 'from abc import ABC, abstractmethod\n\n\nclass Notifier(ABC):\n    @abstractmethod\n    def send(self, msg):\n        ...\n\n\nclass EmailNotifier(Notifier):\n    def send(self, msg):\n        return msg\n',
    'shop/tools.py': 'import json\nimport os\n\n\ndef _slug(s):\n    return s.lower()\n\n\ndef dump(x):\n    return json.dumps(x)\n\n\nprint(dump(1))\n',
    'package.json': '{\n  "dependencies": {\n    "moment": "^2.30.0",\n    "dayjs": "^1.11.0"\n  }\n}\n',
  });
  const out = findings(dir).map(f => `${f.kind} ${f.file}:${f.line} ${f.msg}${f.cite ? ` (${f.cite})` : ''}`).join('\n');
  for (const re of [/versioned-copy shop\/dates2\.py:1 `parse_date_v2` sits beside `parse_date`/, /single-impl shop\/repo\.ts:1 interface `Repo` has one implementation/, /single-impl shop\/base\.py:4 abstract class `Notifier` has one implementation/, /unused shop\/tools\.py:5 new `_slug` is never called/, /new-dependency package\.json:4 .*`moment` already does this job; package-lock\.json does not pin it/]) assert.match(out, re);
  assert.doesNotMatch(out, /unused shop\/tools\.py:\d+ new `dump`/, 'a function something calls is used');
  assert.match(out, /unused shop\/tools\.py:2 imports `os`|ruff F401/, 'an import nothing uses');
});

test('behavior without a test is asked for one when the project has tests; a refactor and a test-less project are not', () => {
  const dir = repo({ 'shop/cart.py': 'def total(xs):\n    return sum(xs)\n', 'tests/test_cart.py': 'from shop.cart import total\n\n\ndef test_total():\n    assert total([1]) == 1\n' });
  write(dir, { 'shop/cart.py': 'def total(xs):\n    return sum(xs)\n\n\ndef discount(xs, code):\n    if code == "HALF":\n        return total(xs) / 2\n    return total(xs)\n' });
  assert.match(findings(dir).map(f => `${f.kind} ${f.msg}`).join('\n'), /untested this change adds behavior \(shop\/cart\.py\) and no test changed/);
  write(dir, { 'tests/test_cart.py': 'from shop.cart import discount, total\n\n\ndef test_total():\n    assert total([1]) == 1\n\n\ndef test_half():\n    assert discount([4], "HALF") == 2\n' });
  assert.doesNotMatch(findings(dir).map(f => f.kind).join(' '), /untested/);
  const bare = repo({ 'app.py': 'x = 1\n' });
  write(bare, { 'app.py': 'x = 1\n\n\ndef greet(name):\n    if name:\n        return f"hi {name}"\n    return "hi"\n' });
  assert.doesNotMatch(findings(bare).map(f => f.kind).join(' '), /untested/, 'no tests to extend: the rules ask, the check does not');
});

test('files: secrets, caches, demo folders, junk-drawer folders and barrels; framework route folders and root tests are fine', () => {
  const dir = repo({ 'app/page.tsx': 'export default function Page() {\n  return null;\n}\n', 'README.md': 'x\n' });
  write(dir, {
    '.env': 'STRIPE_KEY=sk_live_abc\n', 'src/__pycache__/a.cpython-312.pyc': 'x', 'debug.log': 'x\n',
    'examples/demo.py': 'print(1)\n', 'helpers/a.py': 'x = 1\n', 'helpers/b.py': 'y = 1\n', 'helpers/c.py': 'z = 1\n',
    'components/index.ts': 'export * from "./button";\nexport { Card } from "./card";\n', 'components/button.ts': 'export const Button = 1;\n', 'components/card.ts': 'export const Card = 1;\n',
    'app/dashboard/page.tsx': 'export default function Dashboard() {\n  return null;\n}\n', 'test_app.py': 'def test_x():\n    assert 1 + 1 == 2\n',
  });
  const F = findings(dir), out = F.map(f => `${f.kind} ${f.file} ${f.msg}`).join('\n');
  for (const re of [/secret \.env environment file would be committed/, /junk-file \S+ 2 cache, build-output or log file/, /new-folder examples\/ examples or demo folder nobody asked for/, /junk-drawer helpers\/ junk-drawer folder name/, /wrapper components\/index\.ts file only re-exports/]) assert.match(out, re);
  assert.doesNotMatch(out, /app\/dashboard/, 'a route folder holding only its page is the framework convention');
  assert.doesNotMatch(out, /junk-file test_app\.py/, 'with no tests folder, a root test file is how tests are added');
});

test('instructions: a directory tour in an always-loaded file is flagged; an index of where to look is not', () => {
  const dir = repo({ 'README.md': 'x\n' });
  write(dir, { 'CLAUDE.md': '# Notes\n\n## Project structure\n\n```\nsrc/\n├── api/\n└── db/\n```\n' });
  assert.match(findings(dir).map(f => `${f.kind} ${f.file}:${f.line} ${f.msg}${f.cite ? ` (${f.cite})` : ''}`).join('\n'), /long-instructions CLAUDE\.md:3 directory tour/);
  const ok = repo({ 'README.md': 'x\n' });
  write(ok, { 'AGENTS.md': '# Notes\n\nRun `npm test` before finishing. Payments live in src/pay; never log card data.\n' });
  assert.doesNotMatch(findings(ok).map(f => f.kind).join(' '), /long-instructions/);
});


test('demo blocks in imported modules are flagged; a script nothing imports keeps its main block', () => {
  const dir = repo({ 'shop/money.py': 'def fmt(x):\n    return f"${x:.2f}"\n', 'shop/report.py': 'from shop.money import fmt\n\nprint(fmt(1))\n', 'tools/seed.py': 'def seed():\n    return 1\n' });
  write(dir, { 'shop/money.py': 'def fmt(x):\n    return f"${x:.2f}"\n\n\nif __name__ == "__main__":\n    print(fmt(3.5))\n', 'tools/seed.py': 'def seed():\n    return 1\n\n\nif __name__ == "__main__":\n    seed()\n' });
  const out = findings(dir).map(f => `${f.kind} ${f.file}`).join('\n');
  assert.match(out, /demo-code shop\/money\.py/);
  assert.doesNotMatch(out, /demo-code tools\/seed\.py/);
});

test('size and churn: long functions, reformatting, net growth, tiny files and one-file folders', () => {
  const long = n => `def build(rows):\n${Array.from({ length: n }, (_, i) => `    v${i} = rows[${i}] * ${i}`).join('\n')}\n    return v0\n`;
  const quoted = Array.from({ length: 12 }, (_, i) => `NAME_${i} = 'value ${i}'`).join('\n') + '\n';
  const dir = repo({ 'app/report.py': long(90), 'app/names.py': quoted, 'app/main.py': 'x = 1\n' });
  write(dir, { 'app/report.py': long(115), 'app/names.py': quoted.replace(/'/g, '"'), 'app/main.py': `x = 1\n${Array.from({ length: 160 }, (_, i) => `y${i} = ${i}`).join('\n')}\n`, 'lib/one/tiny.py': 'def helper():\n    return 1\n' });
  const out = findings(dir).map(f => `${f.kind} ${f.file}`).join('\n');
  for (const re of [/long-function app\/report\.py/, /churn app\/names\.py/, /net-growth/, /tiny-file lib\/one\/tiny\.py/, /new-folder lib\//]) assert.match(out, re);
});

test('policy and refactors: forbidden imports and dependencies outside the approved list are flagged, and a refactor that changes existing tests is handed over', () => {
  const dir = repo({ '.lessloc.json': JSON.stringify({ boundaries: [{ files: 'ui/**', mustNotImport: '^from db|import db' }], approvedDependencies: ['flask'] }), 'ui/view.py': 'x = 1\n', 'requirements.txt': 'flask==3.0\n' });
  write(dir, { 'ui/view.py': 'import db\n\nx = db.load()\n', 'requirements.txt': 'flask==3.0\nrequests==2.31\n' });
  const out = findings(dir).map(f => `${f.kind} ${f.file} ${f.msg}`).join('\n');
  assert.match(out, /boundary ui\/view\.py ui\/\*\* must not import/);
  assert.match(out, /dependency requirements\.txt dependency `requests` is not in approvedDependencies/);
  // Only an agent session knows the request, so the refactor is judged at the turn's end and reaches the next session.
  const handover = prompt => {
    const app = repo({ 'app.py': 'def total(xs):\n    return sum(xs)\n', 'tests/test_app.py': 'from app import total\n\n\ndef test_total():\n    assert total([1, 2]) == 3\n' });
    turn(app, prompt);
    agentWrite(app, { 'tests/test_app.py': 'from app import total\n\n\ndef test_total():\n    assert total([1, 2, 3]) == 6\n' });
    stop(app);
    return hook(app, { hook_event_name: 'SessionStart', session_id: 'next' })?.hookSpecificOutput?.additionalContext ?? '';
  };
  assert.match(handover('Refactor total'), /tests\/test_app\.py: a refactor changed existing tests/);
  assert.doesNotMatch(handover('Make total accept any iterable'), /a refactor changed existing tests/, 'a change of behavior may change its tests');
});

test('values copied from tests into production branches are flagged; real rules are not', () => {
  const dir = repo({ 'shop/orders.py': 'def fee(order_id):\n    return 5\n', 'tests/test_orders.py': 'from shop.orders import fee\n\n\ndef test_vip():\n    assert fee("ORD-1234") == 0\n', 'shop/rules.py': 'VIP = "VIP-2024"\n' });
  write(dir, { 'shop/orders.py': 'def fee(order_id):\n    if order_id == "ORD-1234":\n        return 0\n    if order_id.startswith("VIP-2024"):\n        return 1\n    return 5\n' });
  const out = findings(dir).map(f => `${f.kind} ${f.file}:${f.line} ${f.msg}${f.cite ? ` (${f.cite})` : ''}`).join('\n');
  assert.match(out, /test-logic shop\/orders\.py:2 branches on `"ORD-1234"`, a value that appears only in tests/);
  assert.doesNotMatch(out, /VIP-2024`, a value that appears only in tests/, 'a value production code also defines is a rule');
});

test('imports no manifest declares are flagged; declared, built-in, relative and aliased imports are not', () => {
  const dir = repo({ 'package.json': '{\n  "dependencies": {\n    "react": "^18.3.1"\n  }\n}\n', 'tsconfig.json': '{"compilerOptions": {"paths": {"@/*": ["./src/*"]}}}\n', 'src/a.ts': 'export const a = 1;\n' });
  write(dir, { 'src/b.ts': 'import React from "react";\nimport fs from "node:fs";\nimport path from "path";\nimport { a } from "./a";\nimport { x } from "@/lib/x";\nimport pad from "left-padd";\nexport const b = [React, fs, path, a, x, pad];\n' });
  const out = findings(dir).filter(f => f.kind === 'made-up-api').map(f => `${f.file}:${f.line} ${f.msg}`);
  assert.equal(out.length, 1, out.join('\n'));
  assert.match(out[0], /src\/b\.ts:6 imports `left-padd`, which no manifest declares/);
});

test('a JSON manifest declares packages only in its dependency objects: a homepage, repository or bugs URL is not a dependency', () => {
  const dir = repo({ '.lessloc.json': JSON.stringify({ approvedDependencies: ['express'] }), 'package.json': '{\n  "name": "shop",\n  "dependencies": {\n    "express": "^4.0.0"\n  }\n}\n', 'package-lock.json': '{}\n' });
  write(dir, { 'package.json': '{\n  "name": "shop",\n  "homepage": "https://shop.example",\n  "repository": {\n    "type": "git",\n    "url": "git+https://github.com/acme/shop.git"\n  },\n  "bugs": {\n    "url": "https://github.com/acme/shop/issues"\n  },\n  "dependencies": {\n    "express": "^4.0.0",\n    "left-pad": "^1.3.0"\n  }\n}\n' });
  const out = findings(dir).filter(f => /dependency/.test(f.kind)).map(f => `${f.kind} ${f.file}:${f.line} ${f.msg}`);
  assert.equal(out.length, 1, out.join('\n'));
  assert.match(out[0], /^dependency package\.json:13 dependency `left-pad` is not in approvedDependencies/);
});

test('an import used through a spread is used; one read only as a property of something else is not', () => {
  const dir = repo({ 'lib/keys.js': 'export const nameKey = d => [d];\nexport const DEFAULTS = { a: 1 };\nexport const other = 1;\n' });
  write(dir, { 'lib/use.js': 'import { DEFAULTS, nameKey, other } from "./keys.js";\n\nexport const keys = d => [...nameKey(d)];\nexport const settings = o => ({ ...DEFAULTS, ...o });\nexport const pick = cfg => cfg.other;\n' });
  assert.deepEqual(findings(dir).filter(f => f.kind === 'unused').map(f => `${f.file}:${f.line} ${f.msg}`), ['lib/use.js:1 imports `other` that nothing uses: delete it']);
});

test('history is judged by sentence: a wrapped comment line that goes on with a past-tense verb is not history', () => {
  const dir = repo({ 'a.py': 'x = 1\n' });
  write(dir, { 'gate.py': '# The gate holds a turn once, when the\n# changed code is asked to finish it\ndef hold(turn):\n    return turn\n', 'parse.py': '# Updated the parser to handle empty input\ndef parse(s):\n    return s.strip()\n', 'cache.py': '# Cache helpers\n# Removed the old cache layer\ndef get(k):\n    return k\n' });
  assert.deepEqual(findings(dir).filter(f => f.kind === 'history').map(f => `${f.file}:${f.line}`), ['cache.py:2', 'parse.py:1'], 'a capitalized line under a heading starts its own sentence');
});
