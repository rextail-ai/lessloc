// Turn-end detectors that judge the change as a whole: what it removed, the folders and files it added, whether it brought tests,
// how far it grew, and what it did to instructions and docs.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, DEMO_DIR, ENTRY_FILE, EXEMPT, FILE_PER_TYPE, INSTRUCTIONS, JUNK_DRAWER, SKIP, TESTFILE, git, instructionTokens, mentioned, read, repoFiles, testCommand } from '../repo.mjs';
import { ASSERTION, COMMENT_LINE, clip, defsIn, isCode, nameKey, typeLines, windows } from '../text.mjs';

// What a push for less code must never remove: tests, logging and metrics, error handling and validation, stated rules.
// Tests switched off, focused so the others stop running, ended early, or reported as passing whatever happened. A skip that
// depends on the environment (skipif, a skip inside an if, #[ignore = "needs postgres"]) is not a weakened test.
const SKIPPED = /@(pytest\.mark\.skip\b|pytest\.mark\.xfail\b(?!\s*\((?!\s*(reason|strict|raises|run)\s*=))|unittest\.(skip|expectedFailure)\b)|\bpytest\.(skip|xfail)\(|\braise\s+(unittest\.)?SkipTest\b|\.skipTest\(|\b(it|test|describe)\.(skip|only|todo)\(|\b(x|f)(it|describe|test)\(|#\[ignore\]|\bt\.Skip(Now)?\(|@(Disabled|Ignore)\b|\b(sys\.exit|os\._exit)\(\s*0?\s*\)|\.outcome\s*=\s*['"]passed|add_marker\(\s*pytest\.mark\.(skip|xfail)|\bcollect_ignore\b/;
const LOGGING = /\b(logger|logging|log|console)\.(debug|info|warn|warning|error|exception|critical|fatal)\(|\b(metrics?|meter|tracer|span|counter|histogram|gauge|statsd)\.\w+\(/;
const GUARD = /^\s*(raise|throw)\b|\breturn Err\(|\bpanic!\(|^\s*(except|catch)\b/;
const CONTRACT = /\b(secur\w*|auth\w*|tenant|permission|privacy|secret|invariant|must|never|always|compat\w*|deprecat\w*|idempot\w*|race|thread[- ]safe|do not|don't)\b/i;
const REFACTOR = /\b(refactor\w*|restructure|simplify|clean ?up|consolidate|reorgani[sz]e|dedupe|deduplicate)\b/i;
const BRANCH = /^\s*(\}\s*)?(if|elif|else\s+if|case|when|match|switch)\b/;
const CONFIG_CODE = /(^|\/)[\w.-]*\.config\.\w+$|\.d\.ts$|(^|\/)(setup\.py|conftest\.py|manage\.py|noxfile\.py)$/;

export default [
  {
    // Over-cutting. Lines moved elsewhere in the same change do not count as removed.
    id: 'safeguards', when: 'turn',
    run(ctx) {
      const { list, put } = ctx, addedTexts = new Set(list.flatMap(c => (c.text ? c.text.split('\n').filter((_, i) => c.added.has(i + 1)).map(t => t.trim()) : [])));
      const lost = (c, re, also = /./) => c.gone.filter(t => re.test(t) && also.test(t) && !addedTexts.has(t.trim())).length - (c.text || '').split('\n').filter((t, i) => c.added.has(i + 1) && re.test(t) && also.test(t)).length;
      for (const c of list.filter(c => /\.md$/i.test(c.file) && !INSTRUCTIONS.test(c.file) && c.removed - c.added.size > 20)) put('doc-removed', c.file, 0, `${c.removed - c.added.size} lines of documentation removed: stale docs can go, but say which; keep what readers need`);
      for (const c of list.filter(c => !SKIP.test(c.file) && !ctx.allowed(c.file) && isCode(c.file))) {
        if (TESTFILE.test(c.file)) {
          const code = typeLines(c.file, c.text || '').filter(l => l.kind === 'code');
          const weakened = lost(c, ASSERTION), skipped = code.filter((l, i) => c.added.has(l.n) && SKIPPED.test(l.t) && !/^(\}\s*)?(if|elif|else|except)\b.*[:{]$/.test(code[i - 1]?.t ?? '')).length;
          if (weakened > 0) put('weakened-tests', c.file, 0, `${weakened} test assertion(s) or test(s) removed: never weaken tests to make a change pass; if the behavior itself is gone, say so`, ctx.agent ? 0 : 1);
          if (skipped) put('weakened-tests', c.file, 0, `${skipped} test(s) newly skipped: fix the cause instead of skipping`, ctx.agent ? 0 : 1);
          if (REFACTOR.test(ctx.prompt) && !c.isNew && c.removed) put('refactor-tests', c.file, 0, 'a refactor changed existing tests: behavior should stay the same, so existing tests should pass unchanged');
        } else if (!EXEMPT.test(c.file)) {
          const gone = [[lost(c, LOGGING), 'logging or metrics'], [lost(c, GUARD), 'error-handling or validation'], [lost(c, COMMENT_LINE, CONTRACT), 'comment stating a security rule or contract']].filter(([n]) => n > 0);
          if (gone.length) put('removed-safeguard', c.file, 0, `removed ${gone.map(([n, what]) => `${n} ${what} line(s)`).join(', ')}: keep what production needs, or confirm the behavior is still enforced elsewhere`);
        }
      }
    },
  },
  {
    // New folders, new files, and files that should never be committed.
    id: 'layout', when: 'turn',
    run(ctx) {
      const { top, from, live, list, put } = ctx, baseDirs = new Set(['.']), newDirs = new Set();
      for (const f of from ? git(top, ['ls-tree', '-r', '--name-only', '-z', from]).split('\0') : []) for (let d = path.posix.dirname(f); !baseDirs.has(d); d = path.posix.dirname(d)) baseDirs.add(d);
      for (const c of from ? live.filter(c => c.isNew) : []) for (let d = path.posix.dirname(c.file); !baseDirs.has(d); d = path.posix.dirname(d)) newDirs.add(d);
      for (const d of newDirs) {
        const base = path.posix.basename(d);
        if (DEMO_DIR.test(base) && !mentioned(d, ctx.prompt)) put('new-folder', d + '/', 0, 'examples or demo folder nobody asked for: delete it, or turn what it shows into a test');
        else if (JUNK_DRAWER.test(base)) put('junk-drawer', d + '/', 0, 'junk-drawer folder name: name the folder after its one responsibility');
        if (newDirs.has(path.posix.dirname(d)) || /(^|\/)\./.test(d) || EXEMPT.test(d + '/') || /^[[(@]/.test(base)) continue;
        let entries;
        try { entries = fs.readdirSync(path.join(top, d)); } catch { continue; }
        if (entries.length < 3 && !entries.every(e => ENTRY_FILE.test(e)) && !entries.some(e => FILE_PER_TYPE.test(e))) put('new-folder', d + '/', 0, `new folder with ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}: put ${entries.length === 1 ? 'it' : 'them'} in an existing folder`);
      }
      const newCode = ctx.code().filter(c => c.isNew).length;
      if (newCode > ctx.cfg.maxNewFiles) put('new-files', '', 0, `${newCode} new code files: could fewer, existing files hold this?`);
      const cached = list.filter(c => c.isNew && CACHE.test(c.file) && !EXEMPT.test(c.file));
      if (cached.length) put('junk-file', cached[0].file, 0, `${cached.length} cache, build-output or log file(s) would be committed (${clip(cached.slice(0, 3).map(c => c.file).join(', '))}): delete them and add the pattern to .gitignore`);
      const renamed = (list.renames || []).filter(([, b]) => !EXEMPT.test(b));
      if (renamed.length && !REFACTOR.test(ctx.prompt)) put('moved-files', renamed[0][1], 0, `${renamed.length} file(s) moved or renamed (${clip(renamed.map(([a, b]) => `${a} -> ${b}`).join(', '))}): restructuring working code needs a concrete reason; say it, or keep the structure`);
    },
  },
  {
    // Copy-pasted test cases: the same five lines, literals aside, three or more times in one test file, at least once newly written.
    id: 'copied-tests', when: 'turn',
    run(ctx) {
      for (const c of ctx.live.filter(c => TESTFILE.test(c.file) && isCode(c.file))) {
        const ws = windows(c.file, c.text, 5, true), seen = new Map();
        for (const w of ws) seen.set(w.h, [...(seen.get(w.h) || []), w]);
        const apart = g => g.filter((w, i) => !i || w.lines[0] > g[i - 1].lines.at(-1));
        if (ws.some(w => w.lines.every(n => c.mine.has(n)) && apart(seen.get(w.h)).length >= 3)) ctx.put('copied-tests', c.file, 0, 'copy-pasted test cases: one table-driven test covers them with less code');
      }
    },
  },
  {
    // Docs and instructions: names a change removed but docs still mention, directory tours, and the always-loaded budget.
    id: 'knowledge', when: 'turn',
    run(ctx) {
      const { top, to, list, live, put } = ctx;
      // Only compound names (ship_order, formatMoney): a one-word name like `parse` also appears in docs as plain English.
      const alive = new Set(ctx.index().map(d => d.n)), removed = [...new Set(list.flatMap(c => (isCode(c.file) ? defsIn(c.file, c.gone.join('\n')).map(d => d.n) : [])))].filter(n => !alive.has(n) && nameKey(n).size > 1).slice(0, 10);
      if (removed.length && to) {
        for (const f of git(top, ['grep', '-l', '-w', '--no-color', ...removed.flatMap(n => ['-e', n]), to, '--', '*.md']).split('\n').map(l => l.slice(to.length + 1)).filter(Boolean)) {
          const t = read(top, f) || '', named = removed.filter(n => new RegExp(`\\b${n}\\b`).test(t));
          if (named.length) put('stale-doc', f, 0, `still mentions ${named.map(n => `\`${n}\``).join(', ')}, which this change removed or renamed: update the doc`);
        }
      }
      // A directory tour in always-loaded instructions costs every session and does not help agents, who list folders on demand.
      for (const c of live.filter(c => INSTRUCTIONS.test(c.file))) {
        const tour = c.text.split('\n').findIndex((t, i) => c.mine.has(i + 1) && (/[├└]──/.test(t) || /^#+\s*(project|directory|folder|repo(sitory)?|file|code(base)?)\s+(structure|layout|tree|overview|map)\b/i.test(t)));
        if (tour >= 0) put('long-instructions', c.file, tour + 1, 'directory tour in always-loaded instructions: agents list folders when they need to, and an overview there costs tokens every session without helping (arXiv:2602.11988)');
      }
      const instr = list.some(c => INSTRUCTIONS.test(c.file)) ? instructionTokens(top) : 0;
      if (instr > ctx.cfg.instructionBudget) put('long-instructions', '', 0, `always-loaded instructions are ~${instr} tokens (budget ${ctx.cfg.instructionBudget}): keep an index there and move details into docs agents open on demand`);
    },
  },
  {
    // Behavior added without a test changing in the same change: nothing proves it, and the next agent cannot tell it works.
    id: 'untested', when: 'turn',
    run(ctx) {
      const { top, cfg, list } = ctx;
      if (!ctx.complete || REFACTOR.test(ctx.prompt) || list.some(c => TESTFILE.test(c.file) && !c.deleted)) return;
      // Growth only: a change that removes more than it adds, or only edits lines that existed, is a fix or a refactor the old tests cover.
      const grew = ctx.code().filter(c => !CONFIG_CODE.test(c.file)).filter(c => {
        const ls = c.text.split('\n'), mine = [...c.mine].filter(n => ls[n - 1]?.trim()), net = mine.length - c.gone.filter(t => t.trim()).length, had = new Set(defsIn(c.file, c.gone.join('\n')).map(d => d.n));
        return net > 0 && (ctx.defs(c).some(d => c.mine.has(d.l) && !had.has(d.n)) || mine.filter(n => BRANCH.test(ls[n - 1])).length >= 2 || net >= 10);
      });
      if (grew.length && (testCommand(top, cfg) || repoFiles(top).some(f => TESTFILE.test(f)))) ctx.put('untested', grew[0].file, 0, `this change adds behavior (${grew.slice(0, 3).map(c => c.file).join(', ')}) and no test changed: add or extend a test that drives it the way users do and asserts the result; if no behavior changed, say so (Google eng-practices: tests ship with the change)`);
    },
  },
  {
    id: 'net-growth', when: 'turn',
    run(ctx) {
      const net = ctx.list.filter(c => !SKIP.test(c.file) && !EXEMPT.test(c.file)).reduce((s, c) => s + c.added.size - c.removed, 0);
      if (ctx.cfg.maxNetLines && net > ctx.cfg.maxNetLines) ctx.put('net-growth', '', 0, `net +${net} lines: delete what the change made dead, reuse what it duplicated, and replace special cases with one rule where that leaves less code`);
    },
  },
];
