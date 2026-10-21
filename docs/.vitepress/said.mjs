// What the site says about each catalogued pattern, shared by the page generator and the site's config: its name, whether it
// has a page of its own, and its "does" in sentences.
import { PATTERNS } from '../../lib/catalog.mjs';
import { CASES } from '../../test/cases.mjs';

// A catalog row's "does", in sentences, for its pattern page and its description. The row is the shorthand of PATTERNS.md's
// key: **Rule** is a line of the rules every session gets, a sentence that opens with only kinds names what lessloc reports,
// the hook events (**When**) are left to the reference page, and "denied at write" is a refusal before the edit lands. `kind`
// writes each kind: quoted by default, as a description has no code spans.
const KIND = /\{([a-z-]+)\}/g, KINDS = /^\{[a-z-]+\}(?:(?:,? and |, )\{[a-z-]+\})*/;
const WHEN = /^[:;] *(write|turn|check|audit)(, (write|turn|check|audit))*(?= *[;(.]|$)/, RULE = 'lessloc gives every session';
const expand = (s, kind) => {
  if (s.startsWith('**When:**')) return '';
  if (s.startsWith('**Rule:**')) return s.replace(/^\*\*Rule:\*\* ([^;]*)(?:; (.*))?$/, (_, rule, more) => `${RULE} the rule: ${rule}${more ? `. ${more[0].toUpperCase()}${more.slice(1)}` : ''}`);
  if (s.startsWith('**Rule.**')) {
    const rest = expand(s.slice(9).trim(), kind);
    return rest.startsWith('lessloc catches') ? `${RULE} a rule against it and ${rest.slice(8)}` : `${RULE} a rule against it.${rest && ` ${rest}`}`;
  }
  s = s.replace(/^\*\*Kinds?:\*\* /, '');
  const list = s.match(KINDS)?.[0], rest = list && s.slice(list.length).replace(/^ \(note\)/, '');
  // A sentence that opens with "Not detected" or "Judged" leaves out what it is about.
  if (!list || /^ \w/.test(rest)) return /^(Not [a-z]+|[A-Z][a-z]+)ed\b/.test(s) ? `It is ${s[0].toLowerCase()}${s.slice(1)}` : s;
  return `lessloc catches it as ${[...list.matchAll(KIND)].map(m => kind(m[1])).join(', ').replace(/, ([^,]*)$/, ' and $1')}${rest.replace(WHEN, '')
    .replace(/^: denied at write/, ' and refuses it before it lands').replace(/; (?=\{)/g, ', and as ')}`;
};
export const said = (does, kind = k => `"${k}"`) => does.split(/(?<=\.) +/).map((s, i) => {
  const out = expand(s, kind);
  return i || !out || /^(lessloc|It is) /.test(out) ? out : `What lessloc does: ${out}`;
}).filter(Boolean).join(' ').replace(KIND, (_, k) => kind(k));

// A pattern's name in page titles, the sidebar and lists: its catalog title, or the longest leading part of it that fits a
// search result (60 characters), cut where its examples start, never inside code, quotes or parentheses. NAMES words the
// titles that no cut reads well, tells apart the two that start alike, and turns a title that opens with a verb into a name
// that also reads inside a sentence, as in the questions a pattern page answers.
const NAMES = {
  'reuse-helper': 'Reimplementing a helper the project already has',
  'copied-rule': 'Copying a rule another function owns',
  'side-by-side': 'Keeping old and new versions side by side',
  'rebuilt-library': 'Rebuilding what the standard library or framework has',
  'second-library': 'A second library for a job an installed one already does',
  'single-impl': 'An interface or abstract class with one implementation',
  'demo-code': 'A demo __main__ block or demo folder nobody asked for',
  'removed-safeguard': 'Removing validation or error handling to shrink code',
  'sql-from-values': 'SQL built from values instead of query parameters',
  'weak-randomness': 'Math.random() or random for tokens and passwords',
  'unrequested-docs': 'Doc files and README growth nobody asked for',
  'long-instructions': 'Always-loaded instructions that grow',
  scaffolding: 'CI workflows and Dockerfiles nobody asked for',
  bypass: 'Skipping commit hooks with --no-verify or LESSLOC=off',
  'weakened-tests': 'Deleted, skipped or force-passed tests',
  'test-shaped': 'Production code that branches on a value from the tests',
  config: 'A broken or misspelled .lessloc.json',
  ratchet: 'Duplication, dead code or swallowed errors getting worse',
  footprint: 'Tool state cluttering the repository',
  unaddressed: 'Stopping short: a requested function never written',
  unfinished: 'Stopping short: part of the problem left failing',
};
// The positions of a title's own words: outside code spans, quotes and parentheses (each parenthesis itself included).
export const bare = t => {
  const at = [];
  let code = false, quote = false, depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '`') code = !code;
    else if (!code && t[i] === '"') quote = !quote;
    else if (!code && !quote) {
      if (t[i] === ')') depth--;
      if (!depth) at.push(i);
      if (t[i] === '(') depth++;
    }
  }
  return at;
};
const cut = (t, mark) => t.slice(0, bare(t).find(i => t[i] === mark) ?? t.length);
const unparen = t => (t.at(-1) === ')' && bare(t).at(-1) === t.length - 1 ? t.slice(0, bare(t).findLast(i => t[i] === '(')) : t);
const NAME = new Map(PATTERNS.map(({ id, title: t }) => [id, NAMES[id]
  || [t, cut(t, ';'), unparen(cut(t, ';')), cut(t, ':'), unparen(cut(t, ':'))].map(c => c.replace(/`/g, '').trim()).find(c => c.length <= 60 && !/[<>&]/.test(c)) || id]));
for (const [id, name] of NAME) if (name === id || [...NAME.values()].filter(n => n === name).length > 1) console.warn(`patterns/${id}: its title has no short, unique name; add one to NAMES`);
export const nameOf = p => NAME.get(p.id);
// The name inside a sentence: lower-case unless it opens with a code name or an acronym, its examples after a ":" in
// parentheses, and "; " read as "and".
export const topic = p => {
  const n = nameOf(p), at = bare(n).find(i => n[i] === ':'), t = (at === undefined ? n : `${n.slice(0, at)} (${n.slice(at + 1).trim()})`).replace(/; /g, ' and ');
  return /^[A-Z][a-z-]*(?=[\s,]|$)/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
};
// A pattern has a page of its own when it has examples or a standard to show; the others are sections of the catalog page.
export const ownPage = p => (p.standard && p.standard !== '—') || CASES.some(c => c[0] === p.id);
export const linkTo = p => (ownPage(p) ? `/patterns/${p.id}` : `/patterns/#${p.id}`);
// The id VitePress gives a heading.
export const slug = s => s.normalize('NFKD').replace(/[\u0300-\u036F]/g, '').replace(/[\u0000-\u001f]/g, '').replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, '-')
  .replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, '_$1').toLowerCase();
