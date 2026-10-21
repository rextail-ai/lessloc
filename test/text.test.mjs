import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, defensiveChecks, defsIn, idioms, lineFindings, literalsIn, paramCount, relevant, restates, similarity, typeLines, windows } from '../lib/text.mjs';
import { clineTool } from '../lib/hosts.mjs';
import { anchors } from '../lib/requirements.mjs';

const kinds = (file, text) => typeLines(file, text).map(classify);
const one = (file, line) => kinds(file, `${line}\nx = 1\n`)[0];
const found = (file, line) => lineFindings(file, typeLines(file, line)[0], false).map(x => x.kind);

test('placeholders and commented-out code are recognized, and whys, examples and directives are not', () => {
  assert.equal(one('a.py', '# ... existing code ...'), 'placeholder');
  for (const line of ['# x = compute(a)', '# print(result)', '# return total', '# if user.active:', '# import os']) assert.equal(one('a.py', line), 'commented-out', line);
  for (const line of ['// const b = foo();', '// }', '// doThing(a, b)']) assert.equal(one('a.js', line), 'commented-out', line);
  for (const line of ['# x = horizontal offset in pixels', '# if the user cancels, keep the draft', '# e.g. foo(bar) returns 2', '# retry once: the API drops the first call after idle', '# noqa: E501', '# shortcut: in-memory cache, move to redis past one process', '# lessloc-ignore copy: generated twin', '# ...and its tests, which is where the floors live', '# QUIET_STARTUP=1 (or any truthy value; 0 means off)']) {
    assert.equal(one('a.py', line), null, line);
  }
  assert.equal(one('lib.rs', '// let x = foo(1);'), 'commented-out');
  assert.equal(one('lib.rs', '/// let x = foo(1);'), null, 'doc examples are not dead code');
});

test('narration is a short standalone comment; docs are never narration, and a doc that restates the name is caught separately', () => {
  assert.deepEqual(kinds('p.py', '# Initialize the result list\nresult = []\n# Retry once: the feed drops the first read after idle\nx = 1\n').filter(Boolean), ['narration']);
  assert.equal(kinds('a.go', '// Initialize the cache\nfunc Init() {}\n')[0], null, 'a Go comment above a declaration is its doc');
  assert.equal(kinds('a.py', '# Initialize the cache\ndef init(): pass\n')[0], 'narration', 'Python documents with docstrings, so a comment above a def is a comment');
  const [get, len] = defsIn('a.py', 'def get_user(uid):\n    """Get the user."""\n    return uid\n\n\ndef count_items(xs):\n    """How many items a basket holds, refunds excluded."""\n    return len(xs)\n');
  assert.equal(restates(get), true);
  assert.equal(restates(len), false);
});

test('definitions carry a body shape, so a copy with renamed names matches and different code does not', () => {
  const body = (f, a, b) => `def ${f}(${a}, ${b}):\n    out = []\n    for i in range(0, len(${a}), ${b}):\n        out.append(${a}[i:i + ${b}])\n    return [x for x in out if x]\n`;
  const [a] = defsIn('a.py', body('paginate', 'items', 'size')), [b] = defsIn('b.py', body('chunk_rows', 'rows', 'n')), [c] = defsIn('c.py', 'def other(v, w):\n    if v > w:\n        raise ValueError("too big")\n    return {"value": v, "limit": w, "ok": True}\n');
  assert.ok(a.shape && a.shape === b.shape);
  assert.equal(similarity(a.sketch, b.sketch), 1);
  assert.ok(similarity(a.sketch, c.sketch || []) < 0.3);
  const [js] = defsIn('a.js', 'export function total(items) {\n  let sum = 0;\n  for (const item of items) sum += item.price * item.qty;\n  return Math.round(sum * 100) / 100;\n}\nconst after = 1;\n');
  assert.equal(js.end, 5, 'a brace body ends at its closing brace');
});

test('rule literals are formats, patterns and queries, not ordinary strings', () => {
  assert.deepEqual(literalsIn('    return f"${value:,.2f}"'), ['${:,.2f}']);
  assert.deepEqual(literalsIn('d = datetime.strptime(s, "%Y-%m-%d")'), ['%Y-%m-%d']);
  assert.equal(literalsIn('EMAIL = re.compile(r"^[\\w.+-]+@[\\w-]+\\.[\\w.]+$")').length, 1);
  assert.equal(literalsIn('cur.execute("SELECT * FROM orders WHERE id = ?", (oid,))').length, 1);
  assert.deepEqual(literalsIn('print("Hello, world: welcome back")'), []);
});

test('retrieval prefers specific words, falls back to generic ones, and drops weak matches', () => {
  const defs = [...defsIn('shop/money.py', 'def format_money(amount):\n    return amount\n'), ...defsIn('shop/orders.py', 'def checkout(user, items):\n    return items\n')];
  assert.deepEqual(relevant(defs, 'Add an invoice summary that shows the money totals').map(d => d.n), ['format_money']);
  assert.deepEqual(relevant(defs, 'invoice(order_id) returns the total formatted like $1,234.50').map(d => d.n), ['format_money'], 'stems and generic words still reach a small repo');
  assert.deepEqual(relevant(defs, 'thanks, looks good'), []);
});

test('a multi-line signature does not end the body: handlers that share a signature are not copies of each other', () => {
  const handler = (name, call) => `pub async fn ${name}(\n    State(state): State<AppState>,\n    headers: HeaderMap,\n) -> Response {\n    let user = authorize(&state, &headers).await;\n    ${call}(user).await.into_response()\n}\n`;
  const [a] = defsIn('a.rs', handler('list_orders', 'load_orders')), [b] = defsIn('b.rs', handler('show_cart', 'load_cart'));
  assert.equal(a.end, 7);
  assert.notEqual(a.shape, b.shape);
  const [py] = defsIn('c.py', 'def total(\n    items,\n    tax,\n):\n    return sum(items) * tax\n');
  assert.equal(py.end, 5);
});

test('a longer comment that only narrates is caught, and one that gives a reason is not', () => {
  assert.equal(one('a.py', '# Loop through each customer and collect the emails of active ones'), 'narration');
  assert.equal(one('a.py', '# Check the cache first because the API is rate limited'), null);
  assert.equal(one('a.py', '# Retry once: the feed drops the first read after idle'), null);
});

test('a check of a created value is redundant only when the value can never fail it', () => {
  const lines = (file, text) => defensiveChecks(file, text).map(x => x.n);
  assert.deepEqual(lines('a.py', 'def f(items):\n    xs = [x for x in items if x]\n    if not xs:\n        return None\n    return xs\n'), [], 'a comprehension can be empty');
  assert.deepEqual(lines('a.py', 'def f(items):\n    xs = [x for x in items if x]\n    if xs is None:\n        return None\n    return xs\n'), [3], 'it is never None');
  assert.deepEqual(lines('a.py', 'def f(c):\n    x = Config(c).get("k")\n    if x is None:\n        return 0\n    return x\n'), [], 'a call on the created value may return None');
  assert.deepEqual(lines('a.js', 'export function f(s) {\n  const q = [s.trim()].filter(Boolean);\n  if (!q.length) return null;\n  return q;\n}\n'), [], '`!q.length` tests the length, not the array');
  assert.deepEqual(lines('a.js', 'export function f(s) {\n  const q = "";\n  if (!q) return s;\n  return q;\n}\n'), [], 'an empty string is falsy');
  assert.deepEqual(lines('a.js', 'export function f(xs, x) {\n  const hit = [...xs].find(v => v === x);\n  if (hit === undefined) return null;\n  return hit;\n}\n'), [], 'find may return undefined');
  assert.deepEqual(lines('a.js', 'export function f(s) {\n  const q = [s];\n  if (!q) return null;\n  return q;\n}\n'), [3], 'an array is always truthy');
  assert.deepEqual(lines('a.js', 'export function f(s) {\n  const q = "none";\n  if (!q) return s;\n  return q;\n}\n'), [3], 'a string that holds text is truthy');
  assert.deepEqual(lines('a.py', 'def f(a):\n    xs = [a, 1]\n    if not xs:\n        return None\n    return xs\n'), [3], 'a list that holds an item is never empty');
  assert.deepEqual(lines('a.py', 'def f(a):\n    xs = [*a]\n    if not xs:\n        return None\n    return xs\n'), [], 'an unpacked list can be empty');
});

test('regex literals and strings are not code: the rules for code and for silenced checks ignore what they hold', () => {
  assert.deepEqual(found('a.js', 'const KEYWORD = /^(if|elif|else)\\b/;'), []);
  assert.deepEqual(found('a.js', 'export const isPy = s => /None|True/.test(s);'), []);
  assert.deepEqual(found('a.js', 'const ratio = total / len(items) / 2;'), ['made-up-api'], 'a division is not a regex literal');
  assert.deepEqual(found('a.js', 'const RULE = /@ts-ignore|eslint-disable/;'), []);
  assert.deepEqual(found('a.js', "const title = 'Silenced checks: `@ts-ignore`, `eslint-disable`';"), []);
  assert.deepEqual(found('a.js', "const tip = 'remove breakpoint() and debugger';"), []);
  assert.deepEqual(found('a.py', 'TIP = "never leave breakpoint() in"'), []);
  assert.deepEqual(found('a.ts', 'const s = "x"; // @ts-ignore'), ['suppression'], 'a marker in a comment still counts');
  const closing = (file, text) => lineFindings(file, typeLines(file, text).at(-2), false).map(x => x.kind);
  assert.deepEqual(closing('a.py', 'X = """\nnever # noqa here\n"""  # noqa\n'), ['suppression'], 'after a multi-line string closes, its line is code again');
  assert.deepEqual(closing('a.py', 'X = """\nnever # noqa here\n'), [], 'inside the string, a marker is text');
  assert.deepEqual(found('a.py', 'x = os.sep  # type: ignore'), ['suppression']);
  assert.deepEqual(found('a.py', 'breakpoint()'), ['debug-leftover']);
});

test('a comparison with a number ends at the number: `< 10` is not `< 1`', () => {
  const msgs = (file, text) => idioms(file, text).map(x => x.msg.split(':')[0]);
  assert.deepEqual(msgs('a.js', 'export const few = xs => xs.filter(f).length < 10;\nexport const many = xs => xs.filter(f).length >= 10;\nexport const late = xs => xs.indexOf(x) >= 0.5 * xs.length;\n'), []);
  assert.deepEqual(msgs('a.js', 'export const none = xs => xs.filter(f).length < 1;\n'), ['`.filter(...).length` as a test']);
  assert.deepEqual(msgs('A.java', 'class A {\n  boolean big(List<String> xs) {\n    return xs.size() >= 10;\n  }\n}\n'), []);
});

test('parameters are counted from the signature: a bare arrow parameter is one, and `=>` inside it closes nothing', () => {
  assert.equal(paramCount(['const api = db => ({ get: id => db.get(id), put: (id, v) => db.put(id, v) });'], 0), 1);
  assert.equal(paramCount(['const send = r => {', '  return post(r.url, r.body, r.a, r.b, r.c, r.d, r.e, r.f);', '};'], 0), 1);
  assert.equal(paramCount(['function f(a, cb = x => x, b) {', '  return cb(a + b);', '}'], 0), 3);
  assert.equal(paramCount(['const f = (a, b) => ({ a, b });'], 0), 2);
  assert.equal(paramCount(['def f(self, a, b):', '    return a'], 0), 2);
});

test('lines built to slow a review down take no longer than their length: escaped quotes, catch clauses, banners, unclosed SEARCH blocks, `}else{` runs, paths after a command', () => {
  const fast = (what, f) => {
    const t0 = performance.now();
    f();
    assert.ok(performance.now() - t0 < 1000, what);
  };
  fast('a Rust lifetime before escaped quotes', () => found('a.rs', `let s: &'static str = "${'\\"'.repeat(26)}`));
  fast('a Python string of escapes that never closes', () => found('a.py', `s = '${'\\"'.repeat(26)}`));
  fast('a catch clause that never closes', () => idioms('a.js', `try { f(); } catch (${' '.repeat(3000)}`));
  fast('a long banner comment', () => kinds('a.js', `// ${'-'.repeat(4000)}!`));
  fast('SEARCH markers that never close', () => clineTool('replace_in_file', { path: 'a.py', diff: '------- SEARCH\n'.repeat(40000) }));
  fast('a long run of `}else{`', () => windows('a.js', `function f() {\n  ${'}else{'.repeat(40)}x\n}\n`, 4));
  fast('a prompt with many paths after a command', () => anchors(`Add support: go ${'a/b/c '.repeat(40)}x --fast`));
});
