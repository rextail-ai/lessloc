// A name counts as requested only when the sentence asks for it to exist; a held turn over a name the request merely
// mentioned would teach agents to ignore the hold.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchors, unfinished } from '../lib/requirements.mjs';

test('a request names what it asks to exist, and nothing it only mentions', () => {
  const cases = [
    ['Add a `--status` flag to the CLI that prints the queue size.', [['--status']]],
    ['Implement `export_csv()` in shop/report.py so the admin page can download orders.', [['export_csv']]],
    ['Add a function order_count() to shop/orders.py that returns how many orders are stored.', [['order_count']]],
    ['Rename `get_user` to `fetch_user` everywhere.', [['fetch_user']]],
    ['Feature request: provide `literal: bool` or `quote_char: str` as an attribute.', [['literal', 'quote_char']]],
    ['Run pytest --lf to see the failures, then add a `--watch` option.', [['--watch']]],
    ['Remove the `legacy_mode` option.', []],
    ['The `dumps` function ignores sort_keys for parsed documents.', []],
    ["I don't see a clean way to define a specialized `StringTrivia` for this.", []],
    ['Verified with `uv run --no-project --with pytest pytest`.', []],
    ['Add tests named `test_invoice_rounding` and a helper `_round_cents`.', []],
    ['See https://github.com/x/y/blob/main/src/semantic_release/version.py for how they add it.', []],
    ['```py\n>>> add_item(x)\n```\nThis crashes.', []],
  ];
  assert.deepEqual(cases.filter(([text, want]) => JSON.stringify(anchors(text).map(a => a.names)) !== JSON.stringify(want)).map(([text, want]) => `${text}: ${JSON.stringify(anchors(text).map(a => a.names))}, expected ${JSON.stringify(want)}`), []);
});

// What a reply says it left failing of the request, in the words agents actually use; and what it never counts: a fixed state
// described, a cause, a condition, an offer, a hedge with no problem named.
test('a reply names what it left failing of the reported problem, and nothing it merely mentions', () => {
  const ask = 'Adding a key corrupts the table:\n```py\ndoc["a"]["d"] = 2\n```';
  const cases = [
    ['Fixed.\n\nTwo things I did not change:\n- **The issue\'s exact input doesn\'t parse in this repo.** The parser rejects a `#` comment inside an inline table.\n- Nothing else.', ['admitted']],
    ['Fixed.\n\n**Not fixed:** Your exact snippet doesn\'t parse in this repo; that is a separate parser change, and I haven\'t made it.', ['admitted']],
    ['Fixed.\n\nNot addressed: replacing `a` with a non-empty dict still renders `a.z = 1` under `[a]`, which reparses as `a.a.z`; a separate path I left alone.', ['admitted']],
    ['Fixed.\n\nNot fixed: inserting in the middle. `insert(1, 99)` on the same input still produces a double comma.', ['admitted']],
    ['Fixed.\n\nThis parser rejects comments inside inline tables, so the issue\'s input doesn\'t parse here.', ['admitted']],
    ['Fixed.\n\nI did not check whether `insert` has the same bug.', ['suspected']],
    ['Fixed.\n\nNot fixed: `insert(1, 99)` on the same input still produces a double comma; I left it alone.\n\nNot checked: `extend` may have the same problem; I did not test it.', ['admitted', 'suspected']],
    ['Fixed. **Cause:** the rebuild dropped `d`, so I pass it through. `__add__` has the same rebuild, but I left it alone because addition resets it anyway.', []],
    ['Fixed: adding a key no longer corrupts the table; your snippet now round-trips. I didn\'t touch the parser.', []],
    ['Fixed: the new key no longer writes invalid TOML; the issue\'s example now round-trips. I left the README unchanged.', []],
    ['Root cause: the indent was copied, so the same input produced invalid TOML. I did not touch `insert()`, which already handles this.', []],
    ['**Limitation:** Your exact config didn\'t reproduce on its own. The test covers that layout. If your original file still fails, send it and I\'ll check it against this change.', []],
    ['I implemented only `literal: bool`. Both could be added the same way if you want them.', []],
    ['Full test suite: 890 passed, fewer than the 972 in the issue, so I may not be running the same set. I did not check that.', []],
    ['Tests: the issue document, and a case where the header duplicates a key, which must still raise `ParseError`. I left the docs alone.', []],
    ['One thing I left alone: the new entry is joined with `,` and no space (`c = 1,d = 2`).', []],
    ['Fixed.\n\nI left the changelog alone; say if you want an entry.', []],
    ['Fixed. Before the fix the same input still produced a bad comma.', []],
    ['Not fixed: `insert` on the same input still produces a double comma, and I left it alone as you asked.', []],
  ];
  assert.deepEqual(cases.filter(([said, want]) => JSON.stringify(unfinished(ask, said).map(u => u.how)) !== JSON.stringify(want)).map(([said, want]) => `${said}: ${JSON.stringify(unfinished(ask, said).map(u => u.how))}, expected ${JSON.stringify(want)}`), []);
});
