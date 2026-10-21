// What a request asks to exist, so the end of a turn can tell whether it was done: the functions, options, flags and
// parameters the user asks for by name. A name only counts when the sentence asks for it ("add a `--status` flag",
// "implement `export_csv()`"); a name the request merely mentions (a bug report's API, a test it describes, a tool it ran)
// is no promise, so a missing one proves nothing. An agent free to choose its own names is never held to one.

// Inline code and flags in the prose: fenced and indented blocks are examples, URLs are references.
const prose = text => String(text || '').replace(/```[\s\S]*?(```|$)/g, '\n').replace(/^(?: {4}|\t).*$/gm, '').replace(/\bhttps?:\/\/\S+/g, ' ');
// Sentences, so a cue in one never reaches a name in the next.
const sentences = text => text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim());
// Words that ask for a name to exist, before it in its sentence: "add", "implement", "a … flag", "called", "rename … to".
const ASK = /\b(add(?:s|ing)?|create|implement(?:s|ing)?|introduce|support(?:s|ing)?|expose|provide|offer|accept(?:s|ing)?|define|new|named|called|rename\b.*\bto|should (?:have|accept|support|return|take)|(?:option|flag|parameter|argument|keyword|method|function|attribute|property|command|subcommand|endpoint|setting)s?)\b/i;
// ...unless the sentence asks for it to go away, or only wonders about it.
const AWAY = /\b(remove[sd]?|removing|delete[sd]?|deleting|drop(?:s|ped)?|deprecate[sd]?|get rid of|no longer|stop using|instead of|without)\b/i;
const MAYBE = /\b(don't|do not|doesn't|cannot|can't|couldn't|won't|no way|not sure|wonder(?:ing)?|whether|if there is|is there)\b/i;
// Other verbs: the name belongs to the nearest one, so "add a test and fix `x`" does not ask for `x`.
const OTHER = /\b(fix(?:es|ed|ing)?|update[sd]?|chang(?:e[sd]?|ing)|use[sd]?|using|call(?:s|ed|ing)?|handle[sd]?|make[sd]?|keep|move[sd]?|test(?:s|ed)?|check(?:s|ed)?|see|run|ran|bump(?:ed)?|clean(?:ed)? up|refactor(?:ed)?)\b/gi;
const lastAt = (re, text) => Math.max(-1, ...[...text.matchAll(new RegExp(re.source, 'gi'))].map(m => m.index));
// A bare flag typed right after a command someone ran (`uv run --no-project`) belongs to the tool, not to the request. Each word
// after the command is read once, in a lookahead, so a long run of words with dots takes linear time.
const COMMAND = /(?:^|[\s`$>])(?:uv|pip|pipx|pytest|python3?|npm|npx|pnpm|yarn|git|poetry|make|cargo|go|docker|tox|nox|ruff|mypy|curl)(?:\s+(?=(run|install|exec|test|add|-{1,2}\S+|\S*[/=.]\S*)(?!\S))\1)*\s+$/;

export function anchors(text) {
  const out = [];
  for (const s of sentences(prose(text))) {
    if (MAYBE.test(s)) continue;
    const found = [];
    for (const m of s.matchAll(/`([^`\n]{1,80})`|(?:^|[\s(,])(--[a-z][\w-]{1,40})\b|\b([A-Za-z][\w]{2,60})\(\)/g)) {
      const raw = (m[1] ?? m[2] ?? `${m[3]}()`).trim(), before = s.slice(0, m.index);
      let name, kind;
      if (/^--[a-z][\w-]*$/.test(raw.split(/[\s=]/)[0])) [name, kind] = [raw.split(/[\s=]/)[0], 'flag'];
      else if (/^[A-Za-z_][\w.]*(\(.*\))?(:\s*\w+)?$/.test(raw)) [name, kind] = [raw.replace(/\(.*$/, '').replace(/:.*$/, '').split('.').pop(), 'name'];
      else continue;
      // A test, a private helper or a command's flag is the agent's or the tool's to name.
      const after = s.slice(m.index + m[0].length);
      if (/^test_|^_[a-z]/.test(name) || name.length < 3 || (m[2] && COMMAND.test(before)) || !ASK.test(before) || AWAY.test(before)) continue;
      // Part of a name ("add `Annotation` suffix"), or the object of a nearer verb than the one that asks.
      if (/^\s*(suffix|prefix|postfix|ending|part|segment)\b/i.test(after) || lastAt(OTHER, before) > lastAt(ASK, before)) continue;
      found.push({ name, kind, at: m.index, end: m.index + m[0].length });
    }
    // Names joined by "or" are alternatives: any one of them does.
    for (let i = 0; i < found.length; i++) {
      const group = [found[i]];
      while (i + 1 < found.length && /^\W*\s*or\s*\W*$/.test(s.slice(found[i].end, found[i + 1].at))) group.push(found[++i]);
      if (!out.some(o => o.names.includes(group[0].name))) out.push({ names: group.map(g => g.name), kind: group[0].kind });
    }
  }
  return out;
}

// Whether any of the names is anywhere in a tree: a file's text, path or name. A failed git call counts as present, so an
// error never holds a turn. `added` (the lines the change wrote) also counts a name written with a slightly different
// spelling: a request's typo is no reason to hold the turn that wrote the name right.
export function present(top, tree, names, gitOrNull, added = []) {
  const files = (gitOrNull(top, ['ls-tree', '-r', '--name-only', tree]) ?? '').split('\n'), words = new Set(added.join('\n').match(/[A-Za-z_][\w-]{3,}/g) || []);
  return names.flatMap(spellings).some(w => files.some(f => f === w || f.endsWith(`/${w}`) || f.split('/').pop().replace(/\.\w+$/, '') === w) || gitOrNull(top, ['grep', '-F', '-w', '-q', '-I', '-e', w, tree]) != null || [...words].some(x => near(x, w)));
}
// Two spellings of one name: at most one edit in eight characters, and never for names shorter than six.
function near(a, b) {
  if (b.length < 6 || Math.abs(a.length - b.length) > 2) return false;
  const max = Math.floor(b.length / 8) || 1, d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] <= max;
}

// The forms a name takes in code: a flag `--dry-run` may be written `dry_run` or `dryRun`.
function spellings(name) {
  if (!name.startsWith('-')) return [name];
  const base = name.replace(/^-+/, '');
  return [name, base, base.replace(/-/g, '_'), base.replace(/-(\w)/g, (_, c) => c.toUpperCase())];
}

// What the agent's last reply says it left failing of the request itself, sentence by sentence. An explicit marker that
// something is left broken ("Not fixed:", "Known limitation:") needs only a failure in its sentence; a neutral scope note
// ("Not changed:", "I left it alone", or a short deferral right after the sentence) also needs a tie to the request: a name
// from its code, or the report's own example. The report's own example failing needs neither, and a suspicion that the same
// problem is elsewhere, unchecked, speaks for itself. A fixed state, a cause, a condition, an offer, a tool's report or
// housekeeping never counts. A heading or a lead-in speaks for what is under it.
const MARKED = /\bnot\s+(?:yet\s+)?(?:fixed|handled|addressed|resolved)\b|\bknown\s+limitations?\b/i;
const DEFER = /\b(?:left|leave|leaving)\s+(?:it|that|this|them|those|the\s+\w+(?:\s+\w+)?)?\s*(?:alone|out|as[\s-]+is|unchanged|for\s+(?:later|now|a\s+follow))|\bnot\s+(?:changed|done|verified|covered)\b|\bdid(?:\s+not|n't)\s+(?:change|check|reproduce)\b/i;
const BACK = /\b(?:left|leave)\s+(?:it|that|this|them|those|that\s+path|this\s+path)\s+(?:alone|out|as[\s-]+is|unchanged)\b|\bdid(?:\s+not|n't)\s+(?:change|fix|touch)\s+(?:it|that|this|them|those)\b/i;
// A defect there now: what the code still does (except still working), or a value lost; what the agent did itself is none.
const NOT_ME = String.raw`(?<!\b(?:I|we)\s)(?<!\b(?:I|we)\s(?:also|then|just)\s)`;
const DEFECT = new RegExp([
  String.raw`\bstill\s+(?!(?:works?|pass(?:es|ed)?(?!\s+(?:through|to|along))|succeeds?|holds?|appl(?:y|ies)|keeps?|matches|counts|covers?|exists?|compiles|green|correct|accurate|valid)\b)[a-z]+`,
  String.raw`\b(?:is|are|gets?)\s+(?:still\s+)?(?:lost|dropped)\b`, String.raw`${NOT_ME}\b(?:drops?|loses?)\s+(?:the\s+|its\s+)?\x60`,
].join('|'), 'gi');
const FAILS = /\bstill\s+(?:fails?|breaks?|raises?|errors?)\b|\b(?:doesn'?t|does\s+not|can'?t|cannot)\s+(?:be\s+)?(?:parsed?|load(?:ed)?|run)\b|\b(?:rejects?|refuses?)\b/gi;
const ASIDE = /\b(?:ruff|flake8|pylint|eslint|mypy|pyright|tsc|lint(?:er|ers|ing)?|pre-commit|CI|changelog|CHANGES\.(?:rst|md|txt)|README|docs|documentation|docstrings?)\b|\bas\s+before\b/i;
const SETTLED = /\bno\s+longer\b|\bnot\b[^.;]{0,30}\banymore\b|\bused\s+to\b|^\s*(?:root\s+cause|cause|before|fixed)\b/i;
const CONDITION = /\b(?:if|unless|whether|in\s+case|would|could|might|should|must|will|can)\b/i;
const stated = (s, re) => !SETTLED.test(s) && [...s.matchAll(re)].some(m => !CONDITION.test(s.slice(0, m.index).split(/[,;:]/).pop()));
const SUSPECT = /\b(?:may|might|could|probably|likely)\b[^.\n]{0,60}\b(?:have|has|hit|hits|show|shows|share|shares|cause|causes|be\s+affected\s+by|run\s+into)\s+(?:by\s+)?the\s+same\s+(?:[\w-]+\s+){0,2}(?:problem|bug|issue|failure|error|crash)\b|\b(?:did(?:\s+not|n't)|not)\s+(?:check|test|reproduce|verify|tr[yi])\w*\b[^.\n]{0,120}\bsame\s+(?:[\w-]+\s+){0,2}(?:problem|bug|issue|failure|error|crash)\b/i;
const OFFER = /\bif\s+you\s+(?:want|like|prefer)\b|\bsay\s+if\b|\btell\s+me\b|\bcan\s+(?:add|do|make)\b|\bas\s+you\s+(?:asked|requested|said)\b/i;
const REPORTED = /\b(?:the\s+)?(?:issue|report|reporter)'?s?\s+(?:own\s+|exact\s+|original\s+)?(?:input|example|case|code|snippet|repro\w*)\b|\b(?:exact|original)\s+(?:input|example|snippet|case)\s+(?:in|from|of)\s+the\s+(?:issue|report)\b/i;
const COMMON = new Set('import print from return self none true false'.split(' '));
const codeWords = text => new Set([...String(text || '').matchAll(/```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g)].flatMap(m => (m[1] ?? m[2]).match(/[A-Za-z_]\w{2,}/g) || []).filter(w => !COMMON.has(w.toLowerCase())));
const paragraphs = text => String(text || '').split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+\.)\s)/).map(p => p.replace(/\*\*|__/g, '').replace(/^#{1,6}\s*/, '').trim()).filter(Boolean);
const replySentences = p => p.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').split(/(?<=[.!?])(?<!\b(?:e\.g|i\.e|etc)\.)\s+(?=[A-Z`*])/);
const plain = s => s.replace(/\s+/g, ' ').trim();

export function unfinished(prompt, said) {
  const words = codeWords(prompt), out = [], kind = t => (MARKED.test(t) ? 'marked' : DEFER.test(t) ? 'deferred' : null);
  const tie = s => REPORTED.test(s) || (s.match(/[A-Za-z_]\w{2,}/g) || []).some(w => words.has(w));
  let lead = null;
  for (const p of paragraphs(said)) {
    const item = /^(?:[-*]|\d+\.)\s/.test(p), head = /^(?:(?:[-*]|\d+\.)\s+)?([^:\n.]{2,60}):/.exec(p)?.[1] ?? '';
    const inherited = (item && lead) || (head && kind(head)) || null;
    lead = item ? lead : /:\s*$/.test(p) || (p.length <= 60 && !/[.!?]$/.test(p) && !p.includes('\n')) ? kind(p) : null;
    const ss = replySentences(p);
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i], next = ss[i + 1] ?? '', own = REPORTED.test(s) && stated(s, FAILS);
      const gate = own || MARKED.test(s) || inherited === 'marked' ? 'marked' : DEFER.test(s) || inherited || (BACK.test(next) && !OFFER.test(next)) ? 'deferred' : null;
      if (!(gate || SUSPECT.test(s)) || OFFER.test(s) || ASIDE.test(s)) continue;
      const how = own || (gate && stated(s, DEFECT) && (gate === 'marked' || tie(s))) || (gate === 'marked' && stated(s, FAILS)) ? 'admitted' : SUSPECT.test(s) ? 'suspected' : null;
      if (how) { out.push({ quote: plain(s), how }); break; }
    }
  }
  return out;
}
