import assert from 'node:assert/strict';
import { test } from 'node:test';
import { count } from '../scripts/installs.mjs';
import { slime } from '../scripts/slime.mjs';

const at = h => new Date(Date.UTC(2026, 10, 1, h));

test('the install count adds every channel, keeps each day at its highest count, and leaves out the days of its own clones', () => {
  const first = count({}, { clones: [['2026-10-31', 4], ['2026-11-01', 2]], npm: [['2026-11-01', 10]], assets: 3, ours: ['2026-11-01'], now: at(0) });
  assert.equal(first.total, 4 + (2 - 1) + 10 + 3);
  // GitHub and npm keep recent days only, and today's count grows: older days stay, and a day never goes down.
  const next = count(first, { clones: [['2026-11-01', 5]], npm: [['2026-11-01', 8], ['2026-11-02', 1]], assets: 2, now: at(1) });
  assert.deepEqual(next.clones, { '2026-10-31': 4, '2026-11-01': 5 });
  assert.deepEqual(next.npm, { '2026-11-01': 10, '2026-11-02': 1 });
  assert.equal(next.total, 4 + (5 - 1) + 11 + 3);
});

test('recent counts the installs of the last 24 hours, from the totals the ledger saw', () => {
  let l = count({}, { now: at(0) });
  assert.deepEqual([l.total, l.recent], [0, 0]);
  l = count(l, { npm: [['2026-11-01', 5]], now: at(2) });
  assert.deepEqual([l.total, l.recent], [5, 5]);
  l = count(l, { npm: [['2026-11-01', 5]], now: at(10) });
  assert.equal(l.history.length, 2, 'a total that did not change adds nothing');
  l = count(l, { npm: [['2026-11-01', 5], ['2026-11-02', 2]], now: at(27) });
  assert.deepEqual([l.total, l.recent], [7, 2], 'the 5 installs from hour 2 are older than 24 hours');
  assert.deepEqual(l.history.map(h => h.total), [5, 7], 'it keeps one total older than 24 hours, as the base');
});

test('the slime is one self-contained SVG with a single dark rule, so the README gets a light and a dark copy', () => {
  const svg = slime({ total: 12345, recent: 3 });
  assert.equal(svg, slime({ total: 12345, recent: 3 }), 'the same count draws the same image');
  assert.ok(svg.length < 25000 && svg.startsWith('<svg') && !/<script|<image|href="[^#]/.test(svg), 'nothing outside the file');
  assert.equal(svg.match(/@media \(prefers-color-scheme: ?dark\)/g).length, 1);
  assert.match(slime({ total: 1, recent: 0 }), />install</);
  assert.match(slime({ total: 0, recent: 0 }), />installs</);
});
