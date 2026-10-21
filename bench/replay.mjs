// The precision gate: replays a repository's recent commits through lessloc's review, as `check --base <parent>` sees each one,
// and through the turn end's check of requested names, with the commit's message as the request.
// Code that humans already merged is the false-positive test: a kind that stops agents should not fire on it.
//   node bench/replay.mjs <repo> [commits=30] [--json <file>] [--show <kind,kind>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.LESSLOC_STATE) {
  const state = (process.env.LESSLOC_STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-replay-')));
  process.on('exit', () => fs.rmSync(state, { recursive: true, force: true }));
}
const { changes, config, git, index } = await import('../lib/repo.mjs');
const { review } = await import('../lib/review.mjs');
const { anchors } = await import('../lib/requirements.mjs');
const { unaddressed } = await import('../lib/agent.mjs');

const args = process.argv.slice(2), opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const [top, n = '30'] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')), cfg = config(top);
const counts = {}, samples = {}, all = [];
const t0 = Date.now();
index(top);
const indexMs = Date.now() - t0;
let ms = 0, asked = 0, replayed = 0;
for (const c of git(top, ['log', '--no-merges', '--format=%H', '-n', n]).split('\n').filter(Boolean)) {
  const from = git(top, ['rev-parse', `${c}^`]), to = git(top, ['rev-parse', `${c}^{tree}`]), t = Date.now();
  if (!from) continue; // a root commit, or a shallow clone's oldest, has no parent to compare with
  replayed++;
  const message = git(top, ['log', '-1', '--format=%B', c]), list = changes(top, from, to), F = review(top, list, cfg, { from, to });
  F.push(...unaddressed(top, { base: from, prompt: message }, to, list));
  ms += Date.now() - t;
  asked += anchors(message).length;
  for (const f of F) {
    counts[f.kind] = (counts[f.kind] || 0) + 1;
    (samples[f.kind] ||= []).push(`${c.slice(0, 7)} ${f.file}${f.line ? `:${f.line}` : ''} ${f.msg.slice(0, 150)}`);
    all.push(`${c.slice(0, 7)}|${f.kind}|${f.file}|${f.line}|${f.msg}`);
  }
}
console.log(`index ${indexMs} ms, review ${Math.round(ms / replayed)} ms per commit, ${all.length} findings over ${replayed} commits asking for ${asked} names`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(4)} ${k}`);
for (const k of (opt('--show') || '').split(',').filter(Boolean)) console.log(`\n== ${k}\n${(samples[k] || []).slice(0, 12).join('\n')}`);
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(all.sort(), null, 1));
