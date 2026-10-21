// The catalog is the list of bad practices lessloc answers for. Every pattern in it must be proven handled: by bad and good forms,
// by a named test, or by a rule agents are given. Every kind lessloc reports must be in it, and PATTERNS.md must be it, rendered.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { PATTERNS, renderCatalog } from '../lib/catalog.mjs';
import { CHECKS } from '../lib/kinds.mjs';
import { CASES } from './cases.mjs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const titles = fs.readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.test.mjs')).flatMap(f => [...read(f).matchAll(/^test\('([^']+)'/gm)].map(m => m[1]));
const rules = read('../RULES.md').toLowerCase();

test('every catalogued pattern is proven handled: bad and good forms, a named test, or a rule agents get', () => {
  const unproven = [];
  for (const p of PATTERNS) for (const proof of p.proof) {
    const [how, what = ''] = proof.split(/:\s(.*)/s);
    const ok = how === 'cases' ? CASES.some(c => c[0] === p.id) : how === 'test' ? titles.some(t => t.includes(what)) : how === 'rule' && rules.includes(what.toLowerCase());
    if (!ok) unproven.push(`${p.id}: ${proof}`);
  }
  assert.deepEqual(unproven, []);
  assert.deepEqual(CASES.filter(c => !PATTERNS.some(p => p.id === c[0])).map(c => c[0]), [], 'cases name patterns that do not exist');
  assert.deepEqual(PATTERNS.filter(p => /\{[a-z-]+\}/.test(p.does) && p.proof.every(x => x.startsWith('rule'))).map(p => p.id), [], 'a detected pattern needs cases or a test, not only a rule');
});

test('every finding kind is in the catalog, and every kind the catalog names exists', () => {
  const named = new Set(PATTERNS.flatMap(p => [...p.does.matchAll(/\{([a-z-]+)\}/g)].map(m => m[1])));
  assert.deepEqual(Object.keys(CHECKS).filter(k => !named.has(k)), [], 'kinds missing from the catalog');
  assert.deepEqual([...named].filter(k => !(k in CHECKS)), [], 'the catalog names unknown kinds');
  assert.equal(new Set(PATTERNS.map(p => p.id)).size, PATTERNS.length, 'pattern ids are unique');
});

test('PATTERNS.md shows exactly the catalog', () => {
  assert.equal(read('../PATTERNS.md').split('<!-- catalog:start -->\n')[1].split('\n<!-- catalog:end -->')[0], renderCatalog(), 'run `node lessloc.mjs catalog --write`');
});
