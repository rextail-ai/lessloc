// Reviews a change: builds what every detector needs once, runs the detectors the moment calls for, then ranks, accepts, suppresses
// and prints the findings. What counts as a bad practice lives in the detectors (lib/detect); tiers and default stops in kinds.mjs.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHECKS } from './kinds.mjs';
import { DETECTORS } from './detect/index.mjs';
import { ruff, SIMPLIFIERS } from './detect/simpler.mjs';
import { EXEMPT, GENERATED, SKIP, TESTFILE, discoverTest, evidence, glob, index } from './repo.mjs';
import { DEFS, defsIn, ext, isCode, typeLines } from './text.mjs';

// What a review sees: the change, the lines it wrote (lines that only moved are not new), and the codebase, each computed once.
function context(top, list, cfg, opts) {
  const allow = cfg.allow.map(glob), memo = new Map(), F = [];
  const live = list.filter(c => !c.deleted && !SKIP.test(c.file) && !allow.some(re => re.test(c.file)) && !GENERATED.test(c.text.slice(0, 400)));
  const moved = new Set(list.flatMap(c => c.gone.map(t => t.trim()).filter(t => t.length >= 8)));
  for (const c of live) {
    const ls = c.text.split('\n');
    c.mine = new Set([...c.added].filter(n => !moved.has((ls[n - 1] || '').trim())));
  }
  const once = (key, make) => (memo.has(key) ? memo.get(key) : (memo.set(key, make()), memo.get(key)));
  const ctx = {
    top, list, live, cfg, F, ...opts, once,
    texts: new Map(live.map(c => [c.file, c.text])),
    has: f => fs.existsSync(path.join(top, f)),
    allowed: f => allow.some(re => re.test(f)),
    put: (kind, file, line, msg, tier) => F.push({ kind, file, line, msg, ...(tier === undefined ? {} : { tier }) }),
    role: c => once(`role:${c.file}`, () => ({ code: isCode(c.file), exempt: EXEMPT.test(c.file), test: TESTFILE.test(c.file) })),
    typed: c => once(`typed:${c.file}`, () => (isCode(c.file) ? typeLines(c.file, c.text) : [])),
    added: c => once(`added:${c.file}`, () => ctx.typed(c).filter(l => c.mine.has(l.n))),
    defs: c => once(`defs:${c.file}`, () => (isCode(c.file) ? defsIn(c.file, c.text) : [])),
    born: c => ctx.defs(c).filter(d => c.mine.has(d.l)),
    code: () => once('code', () => live.filter(c => isCode(c.file) && !EXEMPT.test(c.file))),
    fresh: () => once('fresh', () => ctx.code().flatMap(c => ctx.born(c))),
    index: () => once('index', () => index(top)),
    ruff: () => once('ruff', () => ruff(ctx)),
  };
  return ctx;
}

// Findings for a change. `agent` marks a change an agent made this turn; `quick` is the fast path right after each write, which
// runs only write-time detectors. `build` lets simplifiers that compile the code run. `complete` marks a change finished as a
// whole (a turn, a commit, a pull request), so whether it brought tests is fair to ask.
export function review(top, list, cfg, { prompt = '', agent = false, quick = false, build = false, complete = true, asked = [], from = '', to = '' } = {}) {
  const ctx = context(top, list, cfg, { prompt, agent, quick, build, complete, asked, from, to });
  for (const d of DETECTORS) {
    if (quick && d.when === 'turn') continue;
    const t0 = process.env.LESSLOC_PROFILE && performance.now();
    d.run(ctx);
    if (t0) process.stderr.write(`lessloc ${d.id}: ${Math.round(performance.now() - t0)} ms\n`);
  }
  return finish(ctx.F, list, cfg);
}

// Owner exceptions (in .lessloc.json, with a why) accept a finding; a `lessloc-ignore <kind>: <reason>` comment on the line or
// the line above suppresses it visibly. Policy kinds (tier 0) can only be accepted by the owner.
const IGNORE = /lessloc-ignore(?:\s+([\w-]+))?\s*:\s*(\S.{2,})/;
// The source a detector's message ends with, in parentheses: a CWE, a lint rule, a book, a paper. It is split off into
// `cite` once, here, so a person's report can show it and the agent's voice never does.
const CITATION = /\s*\((?:CWE-\d|Sonar S\d|ESLint |typescript-eslint |eslint-comments |unicorn |staticcheck |ruff (?:[A-Z]|[\w-]+\))|clippy |pylint |golangci-lint |PEP \d|Effective (?:Java|Go)|Clean Code|Google [\w ]*style|Google eng-practices|Fowler:|Meyer:|TDD anti-patterns|xUnit Test Patterns|Anthropic system cards|package hallucination|know and use the libraries|Vite |React docs|Tailwind docs|Bloch,|Raymond|arXiv:|\.NET CA\d|Rule of |[\w-]+ anti-pattern\)|(?:DRY|YAGNI|KISS)\))[^()]*\)?\s*$/;
const ORDER = Object.keys(CHECKS);
const pattern = s => {
  try { return new RegExp(s); } catch { return /$^/; }
};
function finish(F, list, cfg) {
  const lines = new Map(list.filter(c => c.text).map(c => [c.file, c.text.split('\n')])), kept = [], suppressed = [];
  let accepted = 0;
  for (const f of F) {
    f.tier ??= CHECKS[f.kind];
    const cite = CITATION.exec(f.msg);
    if (cite) [f.msg, f.cite] = [f.msg.slice(0, cite.index), cite[0].trim().replace(/^\(|\)$/g, '')];
    const ls = lines.get(f.file) || [];
    f.fp = `${f.kind}|${f.file}|${(ls[f.line - 1] || f.msg).trim().slice(0, 120)}`;
    if (cfg.exceptions.some(e => glob(e.path || '**').test(f.file || '') && (!e.finding || e.finding === f.kind || (!(e.finding in CHECKS) && pattern(e.finding).test(f.msg))))) { accepted++; continue; }
    const why = f.tier > 0 && f.line ? [ls[f.line - 1], ls[f.line - 2]].map(t => IGNORE.exec(t || '')).find(m => m && (!m[1] || m[1] === f.kind)) : null;
    if (why) suppressed.push({ ...f, why: why[2].replace(/\s*(\*\/|-->)\s*$/, '') });
    else kept.push(f);
  }
  kept.sort((a, b) => a.tier - b.tier || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.file || '').localeCompare(b.file || '') || a.line - b.line);
  return Object.assign(kept, { accepted, suppressed });
}

export const summary = list => {
  const added = list.reduce((s, c) => s + c.added.size, 0), removed = list.reduce((s, c) => s + c.removed, 0), n = list.filter(c => c.isNew).length;
  return `+${added} −${removed} lines, ${n} new file${n === 1 ? '' : 's'}`;
};
export const fmt = f => `[${f.kind}] ${f.file ? `${f.file}${f.line ? `:${f.line}` : ''}: ` : ''}${f.msg}${f.cite ? ` (${f.cite})` : ''}`;
export const format = (F, head, foot = '', max = 12) => [head, ...F.slice(0, max).map(f => `- ${fmt(f)}`), F.length > max ? `- ... ${F.length - max} more (add --all to list every finding)` : '', foot].filter(Boolean).join('\n');
// GitHub Actions annotations: tier 0 errors, tier 1 warnings, the rest and every suppression notices, so a reviewer sees them on the diff.
export function annotations(F) {
  const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'), prop = s => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
  const one = (f, level, msg) => `::${level} ${f.file ? `file=${prop(f.file)},${f.line ? `line=${f.line},` : ''}` : ''}title=${prop(`lessloc ${f.kind}`)}::${esc(msg)}`;
  const msg = f => `${f.msg}${f.cite ? ` (${f.cite})` : ''}`;
  return [...F.map(f => one(f, ['error', 'warning'][f.tier] || 'notice', msg(f))), ...(F.suppressed || []).map(f => one(f, 'notice', `suppressed (${f.why}): ${msg(f)}`))].join('\n');
}

// What a check could not cover, so "no findings" never reads as "nothing wrong".
const installed = bin => !spawnSync(bin, ['--version'], { stdio: 'ignore' }).error;
export const unchecked = (cfg, top, list) => {
  const code = list.filter(c => !c.deleted && isCode(c.file)), exts = [...new Set(code.map(c => ext(c.file)))];
  return [
    !(cfg.test || discoverTest(top)) && 'tests (no test command)',
    ...new Set(code.filter(c => !DEFS.some(([re]) => re.test(c.file))).map(c => `definition checks for ${ext(c.file)} files`)),
    ...exts.filter(e => !SIMPLIFIERS.has(e)).map(e => `shorter-idiom checks for ${e} files`),
    exts.includes('.py') && !installed('ruff') && 'deeper shorter-idiom and unused-code checks for .py files (install ruff)',
  ].filter(Boolean);
};
export const verifiedAt = (top, tree, cfg) => {
  const ev = evidence(top, tree);
  return !(cfg.test || discoverTest(top)) ? 'no test command' : !ev ? 'tests not run at this exact state' : `tests ${ev.ok ? 'passed' : 'FAILED'} at this exact state (${ev.where})`;
};
