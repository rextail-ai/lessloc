// The whole-codebase audit: duplication, copies, dead code, comment weight, junk, structure, change locality and lessloc's own
// overhead, and the measures the ratchet holds.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ENTRY_FILE, EXEMPT, FILE_PER_TYPE, GENERATED, INSTRUCTIONS, LOCKS, SKIP, TESTFILE, costs, discoverTest, git, index, junk, read, repoFiles } from './repo.mjs';
import { ASSERTION, CONVENTIONAL, DEFS, GENERIC, classify, clip, defsIn, ext, forwardsTo, isCode, isType, lineFindings, nameKey, swallowed, typeLines, windows } from './text.mjs';

const tokens = s => Math.round(s.length / 4);
const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;

// Change locality from history: how many files and folders a typical commit touches, and which folders move together.
function locality(top) {
  const folder = f => f.split('/').slice(0, -1).slice(0, 2).join('/') || '.';
  const commits = git(top, ['log', '--no-merges', '-n', '300', '--name-only', '--format=%x00']).split('\0').map(c => [...new Set(c.split('\n').filter(f => f && !SKIP.test(f)))]).filter(c => c.length);
  if (commits.length < 5) return null;
  const pairs = new Map();
  for (const c of commits) {
    const dirs = [...new Set(c.map(folder))].sort().slice(0, 30);
    for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) pairs.set(`${dirs[i]}/ + ${dirs[j]}/`, (pairs.get(`${dirs[i]}/ + ${dirs[j]}/`) || 0) + 1);
  }
  return { commits: commits.length, filesPerChange: median(commits.map(c => c.length)), foldersPerChange: median(commits.map(c => new Set(c.map(folder)).size)), together: [...pairs].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k}  ${n} commits`) };
}

// Analyzers that already know a language better than regexes do; run only when installed.
const ANALYZERS = [['knip', 'node_modules/.bin/knip', []], ['vulture', 'vulture', ['.', '--min-confidence', '80']], ['cargo-machete', 'cargo-machete', []], ['deadcode', 'deadcode', ['./...']],
  ['osv-scanner', 'osv-scanner', ['-r', '.']], ['pip-audit', 'pip-audit', []], ['cargo-audit', 'cargo-audit', ['audit']], ['govulncheck', 'govulncheck', ['./...']]];
const VULN = new Set(['osv-scanner', 'pip-audit', 'cargo-audit', 'govulncheck']);
function tools(top) {
  const found = {};
  for (const [name, bin, args] of ANALYZERS) {
    const r = spawnSync(bin.includes('/') ? path.join(top, bin) : bin, args, { cwd: top, encoding: 'utf8', timeout: 120000 });
    if (!r.error) found[name] = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(0, 30);
  }
  return found;
}

// Duplicate blocks across the whole codebase, for the audit.
function allClones(top, files, k) {
  const at = new Map(), all = [];
  for (const f of files) {
    const text = read(top, f);
    if (text == null || GENERATED.test(text.slice(0, 400))) continue;
    for (const w of windows(f, text, k)) {
      const loc = { f, from: w.lines[0], to: w.lines.at(-1), h: w.h };
      all.push(loc);
      at.set(w.h, [...(at.get(w.h) || []), loc]);
    }
  }
  const runs = [];
  let run = null;
  for (const a of all) {
    const b = at.get(a.h).find(b => b.f !== a.f || b.to < a.from || b.from > a.to);
    if (!b || b.f < a.f || (b.f === a.f && b.from < a.from)) { run = null; continue; }
    if (run?.f === a.f && a.from <= run.to + 1) run.to = a.to;
    else runs.push((run = { at: `${a.f}:${a.from}`, f: a.f, from: a.from, to: a.to, same: `${b.f}:${b.from}`, copies: at.get(a.h).length }));
  }
  return runs.map(r => ({ at: `${r.f}:${r.from}-${r.to}`, lines: r.to - r.from + 1, same: r.same, copies: r.copies }));
}

// Line findings the audit lists, by the field that holds them.
const AUDITED = { suppression: 'suppressions', 'debug-leftover': 'debugLeftovers', stub: 'stubs' };
// `within` limits the audit to one folder of the repository (paths stay relative to its root).
export function auditData(top, cfg, withTools = false, within = '') {
  const files = repoFiles(top).filter(f => !within || f.startsWith(`${within}/`)), all = new Set(files);
  const r = { files: 0, folders: 0, codeLines: 0, commentLines: 0, docLines: 0, tokens: 0, instructionTokens: 0, instructions: [], clones: [], copiedDefinitions: [], similarNames: [], unreferenced: [], commentedOutOrPlaceholder: [], stubs: [], suppressions: [], debugLeftovers: [], narrating: [], catchAlls: [], wrappers: [], commentHeavy: [], largest: [], junk: [], tiny: [], singleEntryFolders: [], deep: [], shortcuts: [], testAssertions: 0, unindexed: {} };
  const entries = new Map(), code = [], counts = new Map(), sizes = [];
  for (const f of files) {
    const text = read(top, f);
    if (text == null) continue;
    r.files++;
    r.tokens += tokens(text);
    for (let c = f, p = path.posix.dirname(f); ; c = p, p = path.posix.dirname(p)) {
      if (!entries.has(p)) entries.set(p, new Set());
      entries.get(p).add(c);
      if (p === '.') break;
    }
    if (INSTRUCTIONS.test(f)) {
      r.instructions.push(`${f}  ~${tokens(text)} tokens`);
      r.instructionTokens += tokens(text);
    }
    if (junk(f, x => all.has(x))) r.junk.push(f);
    if (f.split('/').length > 6) r.deep.push(f);
    if (!isCode(f) || GENERATED.test(text.slice(0, 400))) continue;
    for (const w of text.match(/[A-Za-z_]\w*/g) || []) counts.set(w, (counts.get(w) || 0) + 1);
    const typed = typeLines(f, text), exempt = EXEMPT.test(f);
    if (TESTFILE.test(f)) r.testAssertions += typed.filter(l => l.kind === 'code' && ASSERTION.test(l.t)).length;
    if (!DEFS.some(([re]) => re.test(f))) r.unindexed[ext(f)] = (r.unindexed[ext(f)] || 0) + 1;
    for (const d of exempt ? [] : defsIn(f, text).filter(d => d.top)) {
      const target = forwardsTo(text, d);
      if (target) r.wrappers.push(`${f}:${d.l}  ${d.n} -> ${target}`);
    }
    let cc = 0, cm = 0;
    for (const l of typed) {
      if (l.kind === 'code') cc++;
      if (!exempt && swallowed(typed, l)) r.catchAlls.push(`${f}:${l.n}  ${clip(l.t)}`);
      for (const x of exempt && !TESTFILE.test(f) ? [] : lineFindings(f, l, TESTFILE.test(f))) if (AUDITED[x.kind]) r[AUDITED[x.kind]].push(`${f}:${l.n}  ${clip(l.t)}`);
      if (l.kind !== 'comment') continue;
      if (l.directive) {
        // `shortcut:` marks deliberate debt.
        if (/^shortcut:/i.test(l.body)) r.shortcuts.push(`${f}:${l.n}  ${clip(l.body)}`);
        continue;
      }
      if (l.doc) { r.docLines++; continue; }
      cm++;
      const k = !exempt && classify(l);
      if (k) (k === 'narration' ? r.narrating : k === 'stub' ? r.stubs : r.commentedOutOrPlaceholder).push(`${f}:${l.n}  ${clip(l.t)}`);
    }
    r.codeLines += cc;
    r.commentLines += cm;
    if (cc + cm >= 20 && cm / (cc + cm) > cfg.maxCommentRatio && !exempt) r.commentHeavy.push(`${f}  ${Math.round((100 * cm) / (cc + cm))}%`);
    if (!exempt) {
      code.push(f);
      sizes.push([f, cc]);
      if (cc < 10 && !ENTRY_FILE.test(path.basename(f)) && !FILE_PER_TYPE.test(f)) r.tiny.push(f);
    }
  }
  const defs = index(top, code.filter(f => DEFS.some(([re]) => re.test(f)))), names = new Map(), shapes = new Map();
  r.unreferenced = defs.filter(d => d.top && counts.get(d.n) === 1 && !/^(main|test|handler|setup|teardown)/i.test(d.n)).map(d => `${d.f}:${d.l}  ${d.n}`);
  for (const d of defs.filter(d => !CONVENTIONAL.test(d.n))) {
    if (d.shape) shapes.set(d.shape, [...(shapes.get(d.shape) || []), d]);
    const key = [...nameKey(d.n)];
    if (d.top && !isType(d.n) && key.length > 1 && key.some(w => !GENERIC.has(w))) names.set(`${ext(d.f)} ${key.sort().join(' ')}`, [...(names.get(`${ext(d.f)} ${key.sort().join(' ')}`) || []), d]);
  }
  r.copiedDefinitions = [...shapes.values()].filter(g => g.length > 1).map(g => g.map(d => `${d.f}:${d.l} ${d.n}`).join('  =  '));
  r.similarNames = [...names.values()].filter(g => new Set(g.map(d => d.f)).size > 1).map(g => g.map(d => `${d.f}:${d.l} ${d.n}`).join('  =  '));
  r.folders = entries.size;
  r.singleEntryFolders = [...entries].filter(([d, s]) => {
    const only = [...s][0];
    return s.size === 1 && all.has(only) && d !== '.' && !/(^|\/)\.|(^|\/)(src|bin|cmd)$/.test(d) && !EXEMPT.test(d + '/') && !ENTRY_FILE.test(path.basename(only)) && !FILE_PER_TYPE.test(only);
  }).map(([d]) => d + '/');
  r.clones = allClones(top, code, cfg.dupLines).sort((a, b) => b.lines - a.lines);
  r.commentHeavy.sort((a, b) => parseInt(b.split('  ')[1]) - parseInt(a.split('  ')[1]));
  r.largest = sizes.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, n]) => `${f}  ${n} code lines`);
  r.locality = locality(top);
  r.unpinned = LOCKS.filter(([m, locks, declares]) => declares(read(top, m) || '') && !locks.some(l => fs.existsSync(path.join(top, l)))).map(([m]) => `${m} declares dependencies but has no lockfile`);
  r.overhead = Object.entries(costs(top)).map(([e, xs]) => `${e}: median ${median(xs.map(x => x[0]))} ms${median(xs.map(x => x[1])) ? `, ~${median(xs.map(x => x[1]))} tokens added` : ''} (${xs.length} run${xs.length === 1 ? '' : 's'})`);
  r.testCommand = cfg.test || discoverTest(top) || (/`[^`\n]*\btest\b[^`\n]*`/.test(read(top, 'README.md') || '') ? 'documented in README.md' : '');
  if (withTools) r.tools = tools(top);
  return r;
}

// What the ratchet holds: none may get worse, and test assertions may not fall. Raw size is not here, because features need code.
const HIGHER_IS_BETTER = new Set(['testAssertions']);
export const metrics = r => ({
  duplicateLines: r.clones.reduce((s, c) => s + c.lines, 0),
  copiedDefinitions: r.copiedDefinitions.length,
  similarNames: r.similarNames.length,
  unreferenced: r.unreferenced.length,
  commentPercent: Math.round((1000 * r.commentLines) / Math.max(1, r.codeLines + r.commentLines)) / 10,
  commentedOut: r.commentedOutOrPlaceholder.length,
  swallowedErrors: r.catchAlls.length,
  passThroughWrappers: r.wrappers.length,
  junkFiles: r.junk.length,
  instructionTokens: r.instructionTokens,
  testAssertions: r.testAssertions,
});
export const worse = (k, now, prev, slack = 0) => prev !== undefined && (HIGHER_IS_BETTER.has(k) ? now < prev - slack : now > prev + slack);

export function auditText(r, m, cfg) {
  const loc = r.locality, sec = (title, items) => (items.length ? [`${title} (${items.length}):`, ...items.slice(0, 10).map(x => `  ${x}`), items.length > 10 ? `  ... ${items.length - 10} more` : ''] : []);
  return [
    `lessloc audit: ${r.files} files in ${r.folders} folders, ${r.codeLines} code + ${r.commentLines} comment lines (${m.commentPercent}% comments; ${r.docLines} doc lines not counted), ~${Math.round(r.tokens / 1000)}k tokens to read it all`,
    ...sec(`always-loaded instructions, ~${r.instructionTokens} tokens per session`, r.instructions),
    ...sec(`duplicate blocks, ~${m.duplicateLines} lines`, r.clones.map(c => `${c.at} = ${c.same}${c.copies > 2 ? ` (${c.copies} copies)` : ''}`)),
    ...sec('definitions with the same body under different names', r.copiedDefinitions),
    ...sec('same-named functions in different files (likely duplicate implementations)', r.similarNames),
    ...sec('definitions nothing references (dead-code candidates; check dynamic use first)', r.unreferenced),
    ...sec('swallowed errors', r.catchAlls),
    ...sec('wrappers that only forward to another call (keep those that guard a boundary)', r.wrappers),
    ...sec('commented-out code and placeholders', r.commentedOutOrPlaceholder),
    ...sec('stubs, mock data and demo shortcuts (finish them, or mark them `shortcut:`)', r.stubs),
    ...sec('silenced checks (blanket suppressions, `any`, allow(dead_code))', r.suppressions),
    ...sec('debugger statements and debug prints', r.debugLeftovers),
    ...sec('comments that narrate the code', r.narrating),
    ...sec(`comment-heavy files (over ${Math.round(100 * cfg.maxCommentRatio)}% non-doc comments)`, r.commentHeavy),
    ...sec('backup, copy, scratch and report files', r.junk),
    ...sec('tiny files (under 10 code lines)', r.tiny),
    ...sec('single-entry folders', r.singleEntryFolders),
    ...sec('largest files (consolidate inside them; split only by responsibility)', r.largest),
    ...sec('paths deeper than 6 levels', r.deep),
    ...sec('shortcut markers (deliberate debt)', r.shortcuts),
    ...sec('builds that are not reproducible', r.unpinned),
    Object.keys(r.tools || {}).some(n => VULN.has(n)) ? '' : 'vulnerability scan: not run (install osv-scanner, pip-audit, cargo-audit or govulncheck and pass --tools)',
    ...sec("lessloc's own overhead per hook", r.overhead),
    r.testCommand ? '' : 'no discoverable way to run the tests (none in .lessloc.json, package.json, a Makefile, pytest, unittest, cargo, go or the README): the next agent cannot verify its change',
    loc ? `change locality over the last ${loc.commits} commits: median ${loc.filesPerChange} files in ${loc.foldersPerChange} folders per change` : '',
    ...sec('folders that change together (candidates to merge, or a missing shared module)', loc?.together ?? []),
    `test assertions: ${r.testAssertions} (the ratchet keeps them from falling)`,
    Object.keys(r.unindexed).length ? `not covered: definitions are not indexed for ${Object.values(r.unindexed).reduce((a, b) => a + b, 0)} code file(s) (${Object.keys(r.unindexed).join(', ')}), so reuse hints and definition checks skip them` : '',
    ...Object.entries(r.tools || {}).flatMap(([name, out]) => sec(`${name} says`, out)),
  ].filter(Boolean).join('\n');
}

