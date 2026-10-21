// Turn-end detectors that compare what a change wrote with the rest of the codebase: copies, versions side by side, needless
// abstractions, dead code and copied rules.
import path from 'node:path';
import { EXEMPT, GENERATED, SKIP, TESTFILE, blobs, git, read, repoFiles } from '../repo.mjs';
import { COMMENT_LINE, CONVENTIONAL, ENTRY_NAME, GENERIC, clip, defsIn, ext, forwardsTo, isType, literalsIn, nameKey, similarity, windows } from '../text.mjs';

// A new abstraction: an interface, trait or protocol, an abstract class, a Python ABC.
const ABSTRACT = /\b(interface|trait|protocol)\s+[A-Za-z]|\babstract\s+class\b|\bclass\s+\w+\s*\([^)]*\b(ABC|ABCMeta)\b/;
const implementers = n => new RegExp(`\\b(?:implements|extends)\\s+(?:[\\w.$<>]+\\s*,\\s*)*${n}\\b|\\bclass\\s+\\w+(?:\\s*<[^>]*>)?\\s*\\((?:[^)]*[,\\s(])?${n}\\b|\\b(?:class|struct|enum|object|record)\\s+\\w+[^{\\n=]*?:[ \\t]*(?:[^{\\n]*[,\\s])?${n}\\b|\\bimpl(?:\\s*<[^>]*>)?\\s+${n}(?:\\s*<[^>]*>)?\\s+for\\b|\\bwith\\s+${n}\\b`, 'g');
// Old and new versions side by side: a name that is an existing one plus a version marker.
const VERSIONED_NAME = /^_*(?:old|legacy|improved|updated|fixed|refactored|enhanced|better|simplified)(?:_|(?=[A-Z]))_?(.+)$|^(.+?)(?:_?(?:[vV]\d+|[Nn]ew|[Oo]ld|[Ll]egacy|[Ff]ixed|[Ii]mproved|[Uu]pdated|[Rr]efactored|[Ff]inal|[Cc]opy|[Bb]ackup|[Oo]rig(?:inal)?)|_2)$/;
const flat = n => n.toLowerCase().replace(/[_-]/g, '');
const uses = (top, tree, name) => git(top, ['grep', '-l', '-w', '-F', name, tree]).split('\n').filter(Boolean).length;
const where = (ctx, e) => `\`${e.n}\` (${e.f}:${e.l}${ctx.to ? `, used in ${uses(ctx.top, ctx.to, e.n)} file(s)` : ''})`;
// Existing definitions a new one could duplicate: everything in the index but the change's own new definitions.
const existing = ctx => ctx.once('existing', () => {
  const born = new Set(ctx.fresh().map(d => `${d.f}:${d.l}`));
  return ctx.index().filter(e => !born.has(`${e.f}:${e.l}`) && !CONVENTIONAL.test(e.n));
});

// One-word names (`resolve`, `Args`) repeat by convention, so a match needs two words, and either the same words or two specific words in common.
function similarDef(d, pool) {
  const a = nameKey(d.n);
  return a.size > 1 && pool.find(e => {
    const b = nameKey(e.n), shared = [...a].filter(w => b.has(w)), specific = shared.filter(w => !GENERIC.has(w)).length;
    return b.size > 1 && shared.length / new Set([...a, ...b]).size >= 0.6 && (specific >= 2 || (specific && shared.length === a.size && a.size === b.size));
  });
}

// Each new definition against the codebase: same body, mostly the same body, a look-alike name, a pass-through, an old version.
// Memoized, because the copied-rule detector skips definitions that are copies already.
const definitions = ctx => ctx.once('definitions', () => {
  const out = [], copied = new Set(), fresh = ctx.fresh(), have = existing(ctx);
  for (const [i, d] of fresh.entries()) {
    if (CONVENTIONAL.test(d.n)) continue;
    const pool = [...have, ...fresh.slice(i + 1)].filter(e => ext(e.f) === ext(d.f) && isType(e.n) === isType(d.n) && !(e.f === d.f && e.n === d.n));
    const same = d.shape && pool.find(e => e.shape === d.shape);
    const near = !same && d.sketch && pool.map(e => [e, e.sketch && Math.abs(e.size - d.size) <= 0.3 * d.size ? similarity(d.sketch, e.sketch) : 0]).filter(([, s]) => s >= 0.75).sort((a, b) => b[1] - a[1])[0];
    const named = !same && !near && !isType(d.n) && similarDef(d, pool.filter(e => e.f !== d.f && !isType(e.n)));
    if (same || near) copied.add(`${d.f}:${d.l}`);
    if (same) out.push(['copy', d.f, d.l, `\`${d.n}\` has the same body as ${where(ctx, same)} with names changed: call or merge into one`]);
    else if (near) out.push(['near-copy', d.f, d.l, `\`${d.n}\` is ${Math.round(100 * near[1])}% the same code as ${where(ctx, near[0])}: if both serve one responsibility, keep one`]);
    else if (named) out.push(['similar-name', d.f, d.l, `new \`${d.n}\` looks like ${where(ctx, named)}: reuse it if it serves the same responsibility`]);
    const target = forwardsTo(ctx.texts.get(d.f), d);
    if (target) out.push(['wrapper', d.f, d.l, `\`${d.n}\` only forwards to \`${target}\`: call \`${target}\` directly, unless the wrapper guards a boundary (authorization, a dependency seam)`]);
    const v = VERSIONED_NAME.exec(d.n), base = v && (v[1] || v[2]), old = base && base.length >= 4 && [...nameKey(base)].some(w => !GENERIC.has(w)) && [...have, ...fresh].find(e => e !== d && ext(e.f) === ext(d.f) && flat(e.n) === flat(base));
    if (old) out.push(['versioned-copy', d.f, d.l, `\`${d.n}\` sits beside ${where(ctx, old)}: change \`${old.n}\` in place and delete the copy; git keeps history`]);
  }
  return { out, copied };
});

// Blocks of k substantive lines this change mostly added that also exist elsewhere at `tree`. One `git grep` over the tree finds
// the candidate files, so no codebase-wide index is built per review.
function repeatedBlocks(top, tree, list, k) {
  const mine = [];
  for (const c of list) for (const w of windows(c.file, c.text, k)) if (w.lines.filter(n => c.mine.has(n)).length * 2 >= k) mine.push({ c, w });
  const anchors = [...new Set(mine.flatMap(({ w }) => w.texts.filter(t => t.length >= 12)))];
  if (!anchors.length) return [];
  const exts = [...new Set(list.map(c => path.extname(c.file)).filter(Boolean))].map(e => `*${e}`);
  const files = git(top, ['grep', '-l', '-F', '--no-color', '-f', '-', tree, '--', ...exts], anchors.join('\n')).split('\n').map(l => l.slice(tree.length + 1)).filter(f => f && !EXEMPT.test(f) && !SKIP.test(f)).slice(0, 400);
  const at = new Map();
  blobs(top, files.map(f => `${tree}:${f}`)).forEach((text, i) => {
    if (text == null || GENERATED.test(text.slice(0, 400))) return;
    for (const w of windows(files[i], text, k)) at.set(w.h, [...(at.get(w.h) || []), { f: files[i], from: w.lines[0], to: w.lines.at(-1) }]);
  });
  const runs = [];
  let run = null;
  for (const { c, w } of mine) {
    const from = w.lines[0], to = w.lines.at(-1), other = (at.get(w.h) || []).find(b => b.f !== c.file || b.to < from || b.from > to);
    if (!other) { run = null; continue; }
    if (run?.f === c.file && from <= run.to + 1) run.to = to;
    else runs.push((run = { f: c.file, from, to, other: `${other.f}:${other.from}` }));
  }
  return runs;
}

// CSS rules as { n, sel, key }: `key` is the sorted declarations, so the same styles under another selector compare equal.
const cssRules = text => [...text.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map(m => {
  const sel = m[1].trim().split('\n').pop().trim(), decls = m[2].split(';').map(d => d.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean);
  return { n: text.slice(0, m.index + m[0].lastIndexOf(sel)).split('\n').length, sel, size: decls.length, key: decls.sort().join(';') };
});
const CLASSES = /\bclass(?:Name)?\s*=\s*\{?\s*["'`]([^"'`{}]+)["'`]/g;

export default [
  {
    // Styles written twice: the same declarations under another selector, or the same long utility-class string again and again.
    id: 'style-copy', when: 'turn',
    run(ctx) {
      const css = f => /\.(css|scss|sass|less)$/i.test(f), changed = ctx.live.filter(c => css(c.file));
      if (changed.length) {
        const all = new Map();
        for (const f of repoFiles(ctx.top).filter(css).slice(0, 300)) for (const r of cssRules(read(ctx.top, f) || '')) if (r.size >= 3) all.set(r.key, [...(all.get(r.key) || []), { ...r, f }]);
        for (const c of changed) for (const r of cssRules(c.text).filter(r => r.size >= 3 && c.mine.has(r.n)).slice(0, 5)) {
          const twin = (all.get(r.key) || []).find(o => o.sel !== r.sel && !(o.f === c.file && o.n === r.n));
          if (twin) ctx.put('style-copy', c.file, r.n, `\`${clip(r.sel, 40)}\` repeats the ${r.size} declarations of \`${clip(twin.sel, 40)}\` (${twin.f}:${twin.n}): share one rule or class (DRY)`);
        }
      }
      const seen = new Map();
      for (const c of ctx.live.filter(c => /\.(jsx|tsx|vue|svelte|html?)$/i.test(c.file))) c.text.split('\n').forEach((t, i) => {
        if (!c.mine.has(i + 1)) return;
        for (const m of t.matchAll(CLASSES)) {
          const names = m[1].trim().split(/\s+/);
          if (names.length >= 6) seen.set(names.sort().join(' '), [...(seen.get(names.sort().join(' ')) || []), { f: c.file, n: i + 1, size: names.length }]);
        }
      });
      for (const at of seen.values()) if (at.length >= 3) ctx.put('style-copy', at[0].f, at[0].n, `the same ${at[0].size} utility classes appear ${at.length} times in this change: make a component or one shared class (Tailwind docs: reusing styles)`);
    },
  },
  {
    // Production code branching on a value that only tests contain: the code was shaped to pass a test, not to work.
    id: 'test-values', when: 'turn',
    run(ctx) {
      if (!ctx.to) return;
      const found = [];
      for (const c of ctx.code()) c.text.split('\n').forEach((t, i) => {
        if (!c.mine.has(i + 1) || !/^\s*(\}\s*)?(else\s+)?(if|elif|case|when)\b|[=!]==?\s*["']|["']\s*[=!]==?/.test(t)) return;
        for (const m of t.matchAll(/(["'])([^"'\n]{5,40})\1/g)) if (/\d|@/.test(m[2]) && /\w/.test(m[2])) found.push({ c, n: i + 1, value: m[2] });
      });
      // A value the request itself names is what was asked for, not a test's.
      for (const x of found.filter(f => !ctx.prompt.includes(f.value)).slice(0, 20)) {
        const files = git(ctx.top, ['grep', '-l', '-F', x.value, ctx.to]).split('\n').map(l => l.slice(ctx.to.length + 1)).filter(Boolean), tests = files.filter(f => TESTFILE.test(f));
        if (tests.length && !files.some(f => !TESTFILE.test(f) && f !== x.c.file)) ctx.put('test-logic', x.c.file, x.n, `branches on \`"${clip(x.value, 30)}"\`, a value that appears only in tests (${tests[0]}): code shaped to pass a test rather than to work (Anthropic system cards: special-casing tests)`);
      }
    },
  },
  {
    id: 'repeated-blocks', when: 'turn',
    run(ctx) {
      const code = ctx.code();
      if (ctx.to && code.length) for (const r of repeatedBlocks(ctx.top, ctx.to, code, ctx.cfg.dupLines).slice(0, 5)) ctx.put('copy', r.f, r.from, `lines ${r.from}-${r.to} repeat ${r.other}: if both serve one responsibility, keep one and call it`);
    },
  },
  {
    id: 'definitions', when: 'turn',
    run(ctx) {
      if (ctx.fresh().length || ctx.code().length) for (const f of definitions(ctx).out) ctx.put(...f);
    },
  },
  {
    // Abstractions with one implementation, and new definitions nothing uses: speculative code the next reader must still understand.
    id: 'speculative', when: 'turn',
    run(ctx) {
      const { top, to, put } = ctx, fresh = ctx.fresh();
      if (!to || !(fresh.length || ctx.code().length)) return;
      for (const d of fresh.filter(d => ABSTRACT.test(d.s))) {
        const files = git(top, ['grep', '-l', '-w', '-F', d.n, to]).split('\n').map(l => l.slice(to.length + 1)).filter(Boolean).slice(0, 200), re = implementers(d.n);
        const impls = blobs(top, files.map(f => `${to}:${f}`)).flatMap((t, i) => [...(t || '').matchAll(re)].map(() => files[i]));
        const base = /\babstract\s+class\b|\bABC/.test(d.s);
        if (impls.length === 1 || (base && !impls.length)) put('single-impl', d.f, d.l, `${base ? 'abstract class' : 'interface'} \`${d.n}\` has ${impls.length ? `one implementation (${impls[0]})` : 'no implementation'}: use the concrete code until a second implementation exists (Fowler: Speculative Generality)`);
      }
      // Only where a definition is private by default: exported JS, pub Rust, capitalized Go and JVM/.NET types are public API.
      // A definition the user asked for by name is the requested API, not dead code, even before anything calls it.
      const text = d => ctx.texts.get(d.f), asked = d => new RegExp(`(^|[^\\w])${d.n}([^\\w]|$)`).test(ctx.prompt);
      const lone = fresh.filter(d => d.top && /\.(py|js|jsx|mjs|cjs|ts|tsx|go|rs)$/.test(d.f) && !CONVENTIONAL.test(d.n) && !ENTRY_NAME.test(d.n) && !ABSTRACT.test(d.s) && !/^(export|pub)\b/.test(d.s) && !(/\.go$/.test(d.f) && /^[A-Z]/.test(d.n)) && !asked(d)
        && !/^\s*(@|#\[)/.test(text(d).split('\n')[d.l - 2] ?? '') && !new RegExp(`__all__[^\\]]*['"]${d.n}['"]`).test(text(d)));
      if (!lone.length) return;
      // Uses are the name's occurrences minus its definitions: two functions that share a name do not call each other.
      const seen = new Map(), named = new Map();
      for (const w of git(top, ['grep', '-w', '-F', '-h', '-o', ...lone.flatMap(d => ['-e', d.n]), to]).split('\n')) seen.set(w, (seen.get(w) || 0) + 1);
      for (const e of new Map([...ctx.index(), ...fresh].map(e => [`${e.f}:${e.n}`, e])).values()) named.set(e.n, (named.get(e.n) || 0) + 1);
      for (const [n, k] of seen) seen.set(n, k - (named.get(n) || 1) + 1);
      for (const d of lone.filter(d => (seen.get(d.n) || 0) <= 1)) put('unused', d.f, d.l, `new \`${d.n}\` is never called, imported or tested: delete it, or wire it in (CWE-561: dead code)`);
      // A one-line helper used once is a name standing in for one line: inline it unless the name says what the line cannot.
      const body = d => text(d).split('\n').slice(d.l, d.end).filter(t => t.trim() && !/^[}\])]+[;,)]*$/.test(t.trim()) && !COMMENT_LINE.test(t));
      for (const d of lone.filter(d => seen.get(d.n) === 2 && !isType(d.n) && body(d).length <= 1)) put('single-use', d.f, d.l, `\`${d.n}\` is a one-line helper used once: inline it, unless its name says something the line cannot (Fowler: Inline Function)`);
    },
  },
  {
    // Rule literals: a copy of an existing function's format, pattern or query, or one new rule written in several places.
    id: 'rule-literals', when: 'turn',
    run(ctx) {
      if (!(ctx.fresh().length || ctx.code().length)) return;
      const { copied } = definitions(ctx), owners = new Map(), placed = new Map();
      for (const e of existing(ctx)) for (const L of e.lits || []) owners.set(L, [...(owners.get(L) || []), e]);
      for (const c of ctx.code()) {
        const defs = defsIn(c.file, c.text), inside = n => defs.filter(d => d.l <= n && n <= d.end).at(-1);
        c.text.split('\n').forEach((t, i) => {
          if (!c.mine.has(i + 1)) return;
          const host = inside(i + 1);
          if (host && copied.has(`${c.file}:${host.l}`)) return;
          for (const lit of literalsIn(t)) {
            const [rule, all] = [...owners].find(([L, os]) => lit.includes(L) && os.some(o => !(o.f === c.file && o.n === host?.n))) || [], owner = all?.find(o => !(o.f === c.file && o.n === host?.n));
            if (owner) ctx.put('repeated-literal', c.file, i + 1, `repeats the rule \`${clip(rule, 40)}\` of ${where(ctx, owner)}: call it instead of copying the rule`);
            placed.set(lit, [...(placed.get(lit) || []), { f: c.file, l: i + 1, host: host ? `${c.file}:${host.l}` : `${c.file}:${i + 1}` }]);
          }
        });
      }
      for (const [lit, at] of placed) if (new Set(at.map(a => a.host)).size > 1) ctx.put('repeated-literal', at[0].f, at[0].l, `the rule \`${clip(lit, 40)}\` is added in ${at.length} places (${at.slice(1, 4).map(a => `${a.f}:${a.l}`).join(', ')}): give it one home`);
    },
  },
];
