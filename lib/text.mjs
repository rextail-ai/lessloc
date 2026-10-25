// Source text analysis without I/O: language tables, line typing, definitions with their body shape and literals, clone windows, retrieval.
import { createHash } from 'node:crypto';
import path from 'node:path';

// Comment syntax per language. Only `code` families get comment, duplication and size checks.
const FAMILIES = [
  [/\.(c|h|cc|cpp|cxx|hpp|hh|cs|java|kt|kts|scala|go|rs|swift|dart|js|jsx|mjs|cjs|ts|tsx|php|zig|sol|groovy|gradle|proto)$/i, { line: ['//'], block: [['/*', '*/']], code: true }],
  [/\.py$/i, { line: ['#'], block: [['"""', '"""'], ["'''", "'''"], ['r"""', '"""'], ["r'''", "'''"], ['u"""', '"""'], ["u'''", "'''"]], code: true }],
  [/\.(rb|sh|bash|zsh|pl|r|jl|ex|exs|nim|ps1|tf|nix)$|(^|\/)(Makefile|Dockerfile|Rakefile|Gemfile)$/i, { line: ['#'], block: [], code: true }],
  [/\.(sql|lua|hs|elm)$/i, { line: ['--'], block: [['/*', '*/']], code: true }],
  [/\.(html?|vue|svelte)$/i, { line: ['//'], block: [['<!--', '-->'], ['/*', '*/']], code: true }],
  [/\.xml$/i, { line: [], block: [['<!--', '-->']], code: false }],
  [/\.(css|scss|sass|less)$/i, { line: ['//'], block: [['/*', '*/']], code: false }],
  [/\.(ya?ml|toml|ini|cfg|conf)$/i, { line: ['#', ';'], block: [], code: false }],
];
// Definition lines per language: group 1 is the indent (indented means a method), group 2 the name.
export const DEFS = [
  [/\.py$/i, [/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, /^(\s*)class\s+([A-Za-z_]\w*)/]],
  [/\.(js|jsx|mjs|cjs|ts|tsx)$/i, [/^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/, /^(\s*)(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, /^()(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=\s*(?:async\s*)?(?:<[^=]*?>\s*)?(?:\((?:[^()]|\([^()]*\))*(?:\)(?:\s*:[^=]*?)?\s*=>|$)|[A-Za-z_$][\w$]*\s*=>)/, /^()export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/]],
  [/\.go$/i, [/^()func\s+(?:\([^)]*\)\s*)?([A-Za-z]\w*)\s*[([]/, /^()type\s+([A-Za-z]\w*)\s/]],
  [/\.rs$/i, [/^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe)\s+)*fn\s+([A-Za-z]\w*)/, /^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type|union)\s+([A-Za-z]\w*)/]],
  [/\.(java|kt|kts|scala|cs|swift|dart)$/i, [/^(\s*)(?:(?:public|private|protected|internal|static|final|abstract|open|override|sealed|data|suspend|async|virtual|partial)\s+)*(?:class|interface|enum|record|struct|object|trait|protocol|fun|func)\s+([A-Za-z]\w*)/, /^(\s+)(?:(?:public|private|protected|internal|static|final|abstract|synchronized|override|virtual|async|sealed|default)\s+)+(?:<[^>]+>\s*)?[\w<>[\],.?]+\s+([A-Za-z_]\w*)\s*\(/]],
  [/\.(c|h|cc|cpp|cxx|hpp|hh)$/i, [/^()(?!(?:if|for|while|switch|return|else|do|case|typedef|static_assert)\b)(?:[\w:*&<>,~]+\s+)+[*&]*([A-Za-z_~][\w:~]*)\s*\([^;]*$/, /^()(?:class|struct)\s+([A-Za-z_]\w*)\s*(?:final\s*)?(?::|\{|$)/]],
  [/\.rb$/i, [/^(\s*)def\s+(?:self\.)?([a-z]\w*[?!]?)/, /^(\s*)(?:class|module)\s+([A-Z]\w*)/]],
  [/\.php$/i, [/^(\s*)(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+([A-Za-z]\w*)/, /^(\s*)(?:abstract\s+|final\s+)?class\s+([A-Za-z]\w*)/]],
  [/\.(sh|bash|zsh)$/i, [/^()(?:function\s+)?([A-Za-z][\w-]*)\s*\(\)\s*\{?\s*$/]],
];

const DIRECTIVE = /^(!\/|-\*-|eslint|prettier|@ts-|noqa|type:|pylint|pyright:|pragma|nolint|go:|\+build|safety:|clang-|istanbul|c8 |biome-|rubocop|fmt:|#?(end)?region|mark:|spdx|copyright|licen[sc]e|<reference|@jsx|@flow|isort|mypy|shellcheck|cspell|deno-|nosec|lessloc-ignore|shortcut:)/i;
// Comments that admit the code is not the real thing: a stub, made-up data, simulated behavior, a demo shortcut.
const STUB_TALK = /\b(in a real (app|application|implementation|scenario|system|project|world|environment|setting|codebase|deployment)|in production,? (you|we|this|it)('d| would| should| might| will)|for (simplicity|the sake of (simplicity|brevity|this example|the example|demonstration)|demo(nstration)? purposes|this (example|demo)|testing purposes)|for now,? (we |just |simply )?(return|use|hard-?code|mock|fake|skip|ignore|assume|pretend|simulate|stub)|(this|here) is (just )?an? (simplified|basic|mock|dummy|fake|placeholder|sample|minimal|naive) (version|implementation|example|approach)|(mock|dummy|fake|placeholder|hard-?coded|simulated) (data|response|result|value|implementation|users?|api|backend|database|db|payment)|replace (this|it|these) with (your|the|an?) (own|real|actual)|simulat(e|es|ed|ing) (a |an |the )?(api|network|server|database|db|request|call|delay|latency|response|fetch|payment|upload|login|auth)|not (yet )?implemented|implement (this|me|later))\b/i;
// A divider or section banner (`# ===== Helpers =====`, `// ---------`): structure belongs in functions and files.
const DECO = '[=\\-*#~_+<>|]';
const BANNER = new RegExp(`^${DECO}{3,}\\s*[\\w&/,:'() -]{0,40}?\\s*${DECO}*\\s*(\\*/)?$|^[\\w&/,:'() -]{1,40}?\\s*${DECO}{3,}\\s*(\\*/)?$`);
const banner = t => /^[=\-*#~_+<>|/\\.]{6,}$/.test(t.replace(/\s/g, '')) || (t.length <= 300 && BANNER.test(t.replace(/^\s*(\/\/+|#+|\/\*+|--+|;+)\s*/, '')));
const EMOJI = /\p{Extended_Pictographic}/u;
// A whole-comment placeholder, or a comment block shaped like code with no prose in it.
const PLACEHOLDER = /^(existing|remaining|rest of( the)?|previous|other|same as before|unchanged)( (code|implementation|logic|functions?|methods?|class|body|file|module|component|imports|content))?( (here|below|above|unchanged|as before|remains?( the same)?|stays( the same)?))?$/i;
const STUB = /^(your (code|logic|implementation) here|todo:? implement( this| me)?)$/i;
const PROSE = /\b[a-z]+( [a-z]+){4}\b|\b(the|an|we|you|each|every|our|your|should|must|because|when)\b/i;
const CODE_LIKE = [
  /^[}\])]+[;,)]*$/,
  /^(if|elif|else|for|while|switch|catch|function|fn|func|def|class|try|except|with|async def)\b(?!.*[.!?]\s)[^!?]*[{:]$/,
  /^[\w.$]+(\[[^\]]*\])*\(.*\)\s*;?$/,
  /^(import\s+[\w.]+(\s+as\s+\w+)?|from\s+[\w.]+\s+import\s+[\w, *]+|import\s.+\sfrom\s+['"][^'"]+['"];?|#include\s*[<"].+[>"]|use\s+[\w:]+(::\{.*\})?;)$/,
  /^((const|let|var|val|auto)\s+)?[\w.$]+(\[[^\]]*\])*\s*[-+*/%|&]?=\s*([^\s=;<][^\s;]*|(await\s+|new\s+)?[\w.$]+\(.*\));?$/,
  /^(const|let|var|val|auto)\s+[\w$]+\s*=.*;$/,
  /^return(\s+[^\s;]+)?;?$/,
];
const NOISE = /^(step \d+|first(ly)?,|then,|next,|now,? (we|let|i)\b|finally,|here,? we|this (function|method|class|file|module|component|hook|block|line|variable|helper)\b|helper (function|method)|(added|updated|changed|fixed|modified|removed|refactored|renamed|moved|replaced) )|\b(as requested|per (your|the user'?s?) request)\b|^(imports?|constants?|variables?|types?|helpers?|helper functions|utils|utilities|main( function| logic)?|constructor|getters?( and setters)?|exports?|event handlers|handlers|routes|config(uration)?|setup|initiali[sz]ation|state|props|styles|dependencies)$/i;
const VERB = /^(import|initiali[sz]e|define|declare|create|set ?up|get|return|call|loop|iterate|check|handle|update|increment|calculate|compute|add|store|save|load|fetch|parse|convert|validate|render|print|log|send|build|instantiate|assign|process|read|write|open|close|connect|start|run|execute|apply|filter|sort|format|reset)(s|ing)?$/i;
const DETERMINER = /^(the|a|an|all|each|every|new|our|if|over|through|whether|it|them|this|that)$/i;
const WHY_WORDS = /\b(because|since|so that|otherwise|to avoid|in order|unless|until|why|workaround|hack|note|must|never|always|only|instead|but|except|careful|important|warning|fixme|todo|e\.g|i\.e)\b/i;
const WHY = new RegExp(`${WHY_WORDS.source}|[:;!?()—]`, 'i');
// History in a comment: a date, or a phrase about what the code was. Phrases like "used to" or "no longer" also explain whys, so they do not count.
const HISTORY = /\b(renamed (from|to)|previously (called|named|was|in)|formerly|moved (here )?from|was (renamed|moved|added|removed|replaced) (from|in|on|by)|(added|changed|removed|fixed|introduced) (in|on) (v?\d|version|pr\b|#\d|commit))/i;
// A change told in the past tense ("Updated the parser to ...") is a commit message; with a reason attached it may be a why.
const PAST = /^(fixed|updated|changed|added|removed|modified|refactored|rewrote|rewritten|replaced|renamed|moved|reverted|switched|migrated|converted|tweaked|adjusted|improved|optimized|simplified|cleaned up)\s+(to|the|a|an|this|that|these|it|from|for|so|bug|logic|code|function|method|version|implementation|handling|support|check|validation|call|import|test|issue|error|typo)\b/i;
// Words meant for the person who asked, or about who wrote the code: they belong in the reply, not in the file.
const AUDIENCE = /\b(as (you )?requested|per (your|the user'?s?) request|as (you|we) (asked|discussed)|you can (now )?(customize|change|modify|adjust|tweak|replace|extend)|feel free to|I('ve| have) (added|updated|changed|created|fixed|implemented|modified|removed|kept|left|moved)|we('ve| have) (added|updated|changed|created|fixed|implemented|modified|removed)|let me know|hope this helps|(generated|written) (by|with) (claude|chatgpt|gpt-?\d*|copilot|cursor|an? ai|the ai)|ai[- ]generated)\b/i;
// A date is history only next to a change (split out on such a day); a date that is a value (an epoch, a fixture) is not.
const DATED = /\b(19|20)\d\d-\d\d-\d\d\b/, CHANGE = /\b(added|changed|removed|renamed|moved|split|extracted|refactored|introduced|rewritten|replaced|reverted|merged|until|as of|on)\b/i;
// Tombstones: what was removed, or kept only for compatibility nobody named, and comments citing the task that caused them.
const TOMBSTONE = /^(removed|deleted)\b|\b(no longer (used|needed|called)|kept for (backward|backwards) compat(ibility)?|(unused|deprecated),? (but )?kept|added for (the )?[\w-]+ (flow|feature|task|ticket|request)|(for|per) (ticket|task|story) [A-Z]*-?\d+)\b/i;
export const isHistory = body => HISTORY.test(body) || AUDIENCE.test(body) || (DATED.test(body) && CHANGE.test(body)) || ((PAST.test(body) || TOMBSTONE.test(body)) && !WHY_WORDS.test(body));
// A bare `except: pass` or an empty catch block. A promise's `.catch(() => undefined)` is the fire-and-forget idiom for best-effort cleanup, so it does not count.
const CATCH_ALL = /^\s*except(\s+(Base)?Exception)?(\s+as\s+\w+)?\s*:\s*$|catch\s*(\([^)]*\))?\s*\{\s*\}/;
const SWALLOW = /^\s*(pass|continue|return( None)?|\.\.\.)\s*$/;
// A catch block opened at the end of its line, and Go's error check. Either swallows when its body is empty (comments aside); a
// catch-all type (Exception, Throwable) also swallows with a bare default return or a printed stack trace, and Go with `return nil`.
const CATCH_OPEN = /\bcatch\s*(?:\(([^)]*)\))?\s*\{\s*$/, GO_ERR = /^if\s+err\s*!=\s*nil\s*\{$/;
const CATCH_ANY = /^(final\s+)?\\?(\w+\.)*(Exception|Throwable|RuntimeException)\s+\$?\w+$|^\w+\s*:\s*(Exception|Throwable)$/;
const DROP = /^(return\s*(null|nil|undefined|false|None|-1|0|''|""|\[\]|\{\})?|[\w.]*printStackTrace\(\)|continue|break)\s*;?$/;
const DROP_GO = /^(return\s+nil(\s*,\s*nil)*|continue|break)$/;
const LITERAL_IF = /^\s*(?:\}\s*else\s+|el)?if\s*\(?\s*([\w.[\]'"]+)\s*===?\s*(['"`]|\d)/;
const ATTRIBUTE = /^(@\w|#\[)/;
// Languages whose doc comments are plain line comments above the definition.
const LINE_DOCS = /\.(go|rb)$/i;
// Lines that carry no logic of their own: brackets, keywords alone, and one-token lines such as a formatter's one-argument-per-line calls.
// `} else {` with spaces is its own case, so `}else{` reads one way only and a long run of it takes linear time.
const TRIVIAL = /^([{}()[\];,]|end|else|pass|break|continue|return|fi|done|esac|try:|finally:|else:|\}(?:\s+else\s*|else\s+)\{)*;?$|^[\w.:&*$'"-]+[,([{]?$|^[)\]}>]+[;,.)?]*$/;
const IMPORT = /^(import|from|use|using|#include|require|package)\b/;
// Python's string tokens: a delimiter inside a one-line literal (`'"""'`) opens no multi-line string.
const PY_STRINGS = /"""|'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;

// Naming and test conventions the detectors share.
export const COMMENT_LINE = /^\s*(#|\/\/|\/\*|\*|--|"""|''')/;
export const ASSERTION = /\b(assert\w*|expect|should)\s*[(.]|^\s*(self\.)?assert|\b(it|test|describe)\s*\(\s*['"`]|^\s*(async\s+)?(def|func|fn)\s+test|#\[test\]|\bt\.(Error|Fatal)\w*\(/;
export const ENTRY_NAME = /^(main|run|init|setup|teardown|index|app|cli)$/i;
// Methods every type of a kind implements alike by contract: equal bodies there are not duplication.
export const CONVENTIONAL = /^(main|run|handler|equals|hashCode|toString|__\w+__|constructor|init|new|default|from|into|fmt|clone|drop|copy|deepcopy|serialize|deserialize|to_dict|from_dict|toJSON|fromJSON|setUp|tearDown|as_str|as_ref|as_mut|to_string|from_str|try_from|from_row|deref|eq|cmp|partial_cmp|hash|len|is_empty|iter|next|poll|call|index)$/;

const family = f => FAMILIES.find(([re]) => re.test(f))?.[1];
export const isCode = f => Boolean(family(f)?.code);
const defPatterns = f => DEFS.find(([re]) => re.test(f))?.[1] ?? [];
export const clip = (s, n = 70) => (s.length > n ? s.slice(0, n - 3) + '...' : s);
const indentOf = s => /^\s*/.exec(s)[0].length;

// Types each line as code, comment or blank. `doc` marks block comments, docstrings, doc comments (///, //!) and comments attached to a definition.
export function typeLines(file, text) {
  const fam = family(file), defs = defPatterns(file), raw = text.split(/\r?\n/);
  // A multi-line string opened in the middle of a code line (`x = """`, a JS template): its lines are text, not code, so no
  // code check reads TOML, SQL or prose inside it as Python or JavaScript.
  let close = null, quote = null;
  const delims = PY.test(file) ? ['"""', "'''"] : JS.test(file) ? ['`'] : [];
  const odd = (t, d) => (PY.test(file) ? (t.match(PY_STRINGS) || []).filter(x => x === d).length + 1 : t.split(d).length) % 2 === 0;
  const ls = raw.map((r, i) => {
    const t = r.trim();
    let kind = t ? 'code' : 'blank', body = '', doc = false;
    if (quote) {
      // The closing line is the string's too, so its delimiter never opens a docstring.
      if (t.includes(quote) && odd(t, quote)) quote = null;
      return { n: i + 1, t, ind: indentOf(r), kind: t ? 'string' : 'blank', doc: false, directive: false, body: '' };
    } else if (t && fam && !close && !fam.block.some(([a]) => t.startsWith(a))) {
      const d = delims.find(x => odd(t, x));
      if (d && !fam.line.some(m => t.startsWith(m))) quote = d;
    }
    if (t && fam) {
      if (close) {
        kind = 'comment'; doc = true; body = t;
        if (t.includes(close)) close = null;
      } else {
        const ln = fam.line.find(m => t.startsWith(m)), bl = !ln && fam.block.find(([a]) => t.startsWith(a));
        if (ln) { kind = 'comment'; body = t.slice(ln.length); doc = /^(\/\/\/|\/\/!)/.test(t); }
        else if (bl) {
          kind = 'comment'; doc = true; body = t.slice(bl[0].length);
          if (!body.includes(bl[1])) close = bl[1];
        }
      }
    }
    body = body.trim();
    return { n: i + 1, t, ind: indentOf(r), kind, doc, directive: kind === 'comment' && DIRECTIVE.test(body), body: body.replace(/^[*/#!\s-]+|\s*(\*\/|-->|"""|''')$/g, '') };
  });
  // A run of comment lines is dead code only when every line in it is shaped like code; a prose run right above a definition documents it.
  for (let i = 0, j; i < ls.length; i = j) {
    for (j = i; j < ls.length && ls[j].kind === 'comment'; j++);
    if (j === i) { j++; continue; }
    // Directive lines (noqa, lessloc-ignore) neither make nor hide dead code.
    const run = ls.slice(i, j), plain = run.filter(l => !l.directive), dead = plain.length > 0 && plain.every(l => !l.doc && !PROSE.test(l.body) && CODE_LIKE.some(re => re.test(l.body)));
    let k = j;
    while (k < ls.length && ATTRIBUTE.test(ls[k].t)) k++;
    const attached = !dead && LINE_DOCS.test(file) && k < ls.length && defs.some(re => re.test(raw[k]));
    for (const l of run) Object.assign(l, { solo: run.length === 1, dead: dead && !l.directive, doc: l.doc || attached });
  }
  return ls;
}

// Narration is a short standalone comment; longer or multi-line comments are usually whys. Docs and directives are never narration,
// but a doc can admit a stub as well as a comment can.
export function classify(l) {
  if (l.kind !== 'comment' || l.directive) return null;
  if (STUB_TALK.test(l.body)) return 'stub';
  if (l.doc || l.body.length > 2000) return null;
  const core = l.body.replace(/^[\s.…(\[]+|[\s.…)\]]+$/g, '');
  if ((/\.\.\.|…/.test(l.body) && (!core || PLACEHOLDER.test(core))) || STUB.test(core)) return 'placeholder';
  if (l.dead) return 'commented-out';
  if (banner(l.t)) return 'narration';
  // Up to 8 words, a comment that names or narrates the code (or decorates it with emoji) is noise; up to 16, a verb-led one is
  // too unless it gives a reason.
  const body = l.body.replace(/^[\p{Extended_Pictographic}️‍\s]+/u, ''), w = body.split(/\s+/), told = VERB.test(w[0]) && (w.length <= 4 || DETERMINER.test(w[1]));
  return l.solo && ((w.length <= 8 && (NOISE.test(body) || told || EMOJI.test(l.body))) || (w.length <= 16 && told && !WHY.test(body))) ? 'narration' : null;
}

// Language groups for the line rules and idioms below. C-like means `if (...) {`, `catch (e) {` and `a ? b : c`.
const PY = /\.py$/i, JS = /\.(js|jsx|mjs|cjs|ts|tsx)$/i, TS = /\.tsx?$/i, GO = /\.go$/i, RS = /\.rs$/i, JAVA = /\.java$/i;
const CLIKE = /\.(js|jsx|mjs|cjs|ts|tsx|java|cs|kt|kts|scala|swift|dart|php|groovy|c|h|cc|cpp|cxx|hpp)$/i;
const TERNARY = /\.(js|jsx|mjs|cjs|ts|tsx|java|cs|swift|dart|php|groovy|c|h|cc|cpp|cxx|hpp)$/i;
// Credentials in a well-known format; values that look made up (repeats, "example", "test") are test data.
const SECRET = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bsk_live_[0-9a-zA-Z]{20,}|\bsk-(?:proj-|ant-(?:api\d+-)?)?[A-Za-z0-9_-]{32,}|\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_\w{50,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{35}\b|\bglpat-[0-9A-Za-z_-]{20,}|\bnpm_[A-Za-z0-9]{36}\b/;
export const secretIn = t => {
  const m = SECRET.exec(t);
  return m && !/(.)\1{5}|example|test|fake|dummy|sample|xxxx|1234|abcd/i.test(m[0]) ? m[0] : null;
};
// Problems one written line shows on its own, each with the standard that calls it a bad practice: [kind, files, pattern, message,
// flags]. `p`: production code only. `l` (late): judged when the turn ends, since mid-work the line may still be in use (a debug
// print) or about to be finished (a stub). `s`: judged on the code alone, without strings and comments; `c`: without strings,
// keeping the comment, where suppression markers live.
const LINE_RULES = [
  ['suppression', null, /@ts-ignore|@ts-nocheck|@ts-expect-error\s*(\*\/\s*)?$|eslint-disable(-next-line|-line)?\s*(\*\/|-->)?\s*$/, 'blanket suppression: fix the cause, or name the rule and say why (typescript-eslint ban-ts-comment; eslint-comments no-unlimited-disable)', 'c'],
  ['suppression', PY, /#\s*(type:\s*ignore|noqa|pyright:\s*ignore)\b(?!\s*[[:])/, 'blanket `type: ignore`/`noqa`: fix it, or name the error code and say why (ruff PGH003, PGH004)', 'c'],
  ['suppression', RS, /#!?\[allow\([^)]*\b(dead_code|unused\w*|warnings|clippy::all)\b/, '`allow(dead_code)`-style suppression hides code nothing uses: delete that code instead (Clean Code G4: overridden safeties)', 'c'],
  ['suppression', GO, /\/\/\s*nolint\b(?!:\w[^/]*\/\/\s*\S)/, '`nolint` needs a linter name and a reason (golangci-lint nolintlint)', 'c'],
  ['suppression', /\.(java|kt|kts)$/i, /@Suppress(Warnings)?\(\s*"(all|unused|UNUSED\w*)"/, 'blanket warning suppression: fix the cause, or suppress the one warning and say why (Clean Code G4)'],
  ['suppression', TS, /(?<![\w$])(:\s*any\b(?!\s*[\w$])|as\s+any\b|<any>|[<,]\s*any\s*[>,\]]|\bany\[\])/, '`any` turns type checking off: use the real type, or `unknown` with a check (typescript-eslint no-explicit-any)', 'ps'],
  ['debug-leftover', null, /^\s*debugger\s*;?\s*$|\bbreakpoint\(\s*\)|\b(i?pdb|pudb)\.set_trace\(|^\s*import\s+(i?pdb|pudb)\s*$|\bbinding\.pry\b|^\s*byebug\s*$|\bdbg!\(|\b(var_dump|print_r)\s*\(/, 'debugger statement or dump left in: remove it (CWE-489: active debug code)', 'plc'],
  ['debug-leftover', null, /\b(console\.(log|debug)|print|println!?|fmt\.Print(ln|f)?|System\.out\.print(ln)?|puts)\s*\(?\s*f?(["'`])\s*(debug\b|dbg\b|xxx\b|>>>|(here|got here|reached here|checkpoint)\s*[!.:]*\s*\5)/i, 'debug print left in: remove it, or log through the project logger if production needs it (CWE-489)', 'pl'],
  ['debug-leftover', PY, /\bprint\(\s*f["'][^"']*\{[^}]*=\}/, 'debug print (`{x=}`) left in: remove it (CWE-489)', 'pl'],
  ['stub', RS, /\b(todo|unimplemented)!\(/, 'stub left in: finish it, or tell the user plainly what is not done yet', 'pl'],
  ['stub', /\.(js|jsx|mjs|cjs|ts|tsx|dart|php)$/i, /throw\s+new\s+Error\(\s*["'`]\s*(not\s+(yet\s+)?implemented|todo|unimplemented)\b/i, 'stub left in: finish it, or tell the user plainly what is not done yet', 'pl'],
  ['stub', GO, /\bpanic\(\s*"(not\s+(yet\s+)?implemented|todo|unimplemented)\b/i, 'stub left in: finish it, or tell the user plainly what is not done yet', 'pl'],
  ['stub', /\.(java|cs|kt|kts)$/i, /throw\s+(new\s+)?(NotImplementedException|NotImplementedError)\b|throw\s+new\s+UnsupportedOperationException\(\s*"\s*(not\s+(yet\s+)?implemented|todo)|\bTODO\(\s*("[^"]*")?\s*\)/i, 'stub left in: finish it, or tell the user plainly what is not done yet', 'pl'],
  ['stub', null, /^\s*(?:export\s+)?(?:const|let|var|val)\s+(mock|fake|dummy)[A-Z_]\w*\s*[:=]|^\s*(?:MOCK|FAKE|DUMMY)_[A-Z0-9_]+\s*[:=]|^\s*(?:mock|fake|dummy)_\w+\s*=/, 'mock data in production code: use the real source, or tell the user it is not wired up yet (xUnit Test Patterns: test logic in production)', 'pl'],
  ['test-logic', null, /\b(special[- ]cas(e|ed|ing) for (the )?tests?|(to|so) (make |that )?(the )?tests? pass|hack (for|to pass) (the )?tests?|only (needed|used) (for|by|in) (the )?tests?)\b/i, 'code shaped to pass a test rather than to work: fix the behavior itself (Anthropic system cards: special-casing tests)', 'pl'],
  // Hand-rolled versions of what the platform does safely.
  ['unsafe', null, /\.(?:execute|executemany|query|raw|exec|run|all|get)\(\s*f?(?<q1>["'`])\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b(?:(?!\k<q1>)[^\n])*?(?:\{|\$\{)|\.(?:execute|query|raw)\(\s*(?<q2>["'`])\s*(?:SELECT|INSERT|UPDATE|DELETE)\b(?:(?!\k<q2>)[^\n])*\k<q2>\s*(?:\+|%\s*[\w(])/i, 'builds SQL from values: pass them as query parameters (CWE-89: SQL injection)', 'p'],
  ['unsafe', null, /\.replace\(\s*(\/<\/g?|["']<["'])\s*,\s*["']&lt;|\.innerHTML\s*[+]?=\s*(`[^`]*\$\{|[^;]*\+\s*\w)|dangerouslySetInnerHTML=\{\{\s*__html:\s*(?!["'`])\w/, 'builds or escapes HTML by hand: use textContent or the framework\'s rendering (CWE-79, CWE-116)', 'p'],
  ['unsafe', null, /Math\.random\(\)[^;\n]*\b(token|secret|password|passwd|nonce|salt|otp|session|api_?key)\b|\b(token|secret|password|passwd|nonce|salt|otp|session|api_?key)\w*\s*[:=][^;\n]*Math\.random\(\)|\b(token|secret|password|nonce|salt|otp)\w*\s*=\s*[^#\n]*\brandom\.(random|randint|choice|choices|getrandbits)\(/i, 'predictable randomness for a secret: use crypto.randomUUID()/getRandomValues() or the secrets module (CWE-338)', 'p'],
  ['unsafe', null, /\b(hashlib\.(md5|sha1|sha256)|createHash\(\s*["'](md5|sha1|sha256)["']\))[^\n]*\bpass(word|wd)?\b|\bpass(word|wd)\w*[^\n]*\b(hashlib\.(md5|sha1|sha256)|createHash\(\s*["'](md5|sha1|sha256)["']\))/i, 'a fast hash for passwords: use bcrypt, scrypt or argon2 (CWE-916)', 'p'],
  ['unsafe', null, /\bverify\s*=\s*False\b|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED[^\n]*["']?0|InsecureSkipVerify\s*:\s*true|danger_accept_invalid_certs\(\s*true/, 'turns certificate checks off: anyone in the middle can read and change the traffic (CWE-295)', 'p'],
  ['unsafe', /\.(js|jsx|mjs|cjs|ts|tsx|py)$/i, /(^|[^\w.])(eval|exec)\s*\((?!\s*["'`])|\bnew\s+Function\s*\(/, 'runs text as code: parse it instead (CWE-95)', 'ps'],
  // Another language's API, the commonest kind of made-up call: it fails the first time the line runs.
  ['made-up-api', PY, /\b(null|undefined|true|false)\b|===|!==|\bconsole\.log\(|\bJSON\.(parse|stringify)\(|\.(toLowerCase|toUpperCase|forEach|startsWith|endsWith)\(/, 'JavaScript in a Python file: this name or call does not exist in Python', 's'],
  ['made-up-api', JS, /(?<![\w$.])(None|True|False|elif)\b|\.(strip|lower|upper|startswith|endswith)\(\)|(?<![\w$.])len\(/, 'Python in a JavaScript file: this name or call does not exist in JavaScript', 's'],
  ['made-up-api', GO, /(?<![\w.])(null|None|undefined)\b/, 'not Go: Go spells the zero pointer `nil`', 's'],
  ['test-logic', null, /PYTEST_CURRENT_TEST|["']pytest["']\s+in\s+sys\.modules|sys\.modules\.get\(\s*["']pytest|["']unittest["']\s+in\s+sys\.modules|\bJEST_WORKER_ID\b|process\.env\.(VITEST|JEST)\b|typeof\s+(jest|vitest)\s*!==?\s*["']undefined/, 'production code branches on running under a test framework: it must behave the same under test (xUnit Test Patterns: test logic in production)', 'pl'],
];
const CLOSING = /^[}\])]+[;,)]*\s*(\/\/|#|\/\*)\s*(end\b|(if|for|while|function|class|switch|try|method|loop)\b\s*$)/i;
// A test named for "it runs" checks that nothing throws; any other test must assert something.
const SMOKE = /smoke|runs?\b|no_?crash|does_?not_?(raise|throw|crash|fail)|doesnt_?(raise|throw)|works/i;
// The line without its string literals, its comment (unless `comment`) and, outside Python, its regex literals, for rules about
// code: a "null" inside a string is not a null. A slash opens a regex only where a value starts: after an operator, an opening
// bracket or `return`, so `a / b / c` stays a division.
const NONCODE = {
  py: /(["'`])(?:\\.|(?!\1)[^\\])*\1|#.*$/g,
  other: /(["'`])(?:\\.|(?!\1)[^\\])*\1|(?<=(?:^|[-+*%=<>!&|^~?:,;([{]|\breturn)\s*)\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\[])+\/[a-z]*|\/\/.*$|\/\*.*?\*\//g,
};
const blankLiterals = (file, t, comment = false) => t.replace(NONCODE[PY.test(file) ? 'py' : 'other'], m => {
  if (!/^(#|\/\/|\/\*)/.test(m)) return '""';
  return comment ? m : '';
});
export function lineFindings(file, l, test) {
  // What a rule reads: the code alone (`s`), the line without its strings (`c`), or else the line as written. After a multi-line
  // string's closing delimiter, the line is code again (`""")  # noqa`).
  const close = PY.test(file) ? /"""|'''/ : '`';
  const tail = l.kind === 'string' ? l.t.split(close).slice(1).at(-1) ?? '' : l.t;
  const res = [], read = { s: l.kind === 'comment' ? '' : blankLiterals(file, tail), c: blankLiterals(file, tail, true) };
  for (const [kind, files, re, msg, flags = ''] of LINE_RULES) if ((!files || files.test(file)) && !(flags.includes('p') && test) && re.test(read[/[sc]/.exec(flags)?.[0]] ?? l.t)) res.push({ kind, msg, late: flags.includes('l') });
  // Only a module-level function is a stub when it raises NotImplementedError; a method doing so is the abstract-method idiom.
  if (PY.test(file) && !test && l.ind === 4 && /^raise NotImplementedError\b/.test(l.t)) res.push({ kind: 'stub', msg: 'stub left in: finish it, or tell the user plainly what is not done yet', late: true, top: true });
  if (TERNARY.test(file) && (l.t.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1|\/\/.*$/g, '').match(/\s\?\s/g) || []).length >= 2) res.push({ kind: 'clever', msg: 'nested ternary: an if/else or a lookup table reads faster (ESLint no-nested-ternary; Sonar S3358)' });
  if (PY.test(file)) {
    const t = l.t.replace(/(["'])(?:\\.|(?!\1)[^\\])*\1|#.*$/g, '');
    if ((t.match(/\belse\b/g) || []).length >= 2 && /\bif\b.*\belse\b.*\bif\b/.test(t) && !/^\s*(el)?if\b/.test(t)) res.push({ kind: 'clever', msg: 'nested conditional expression: an if statement reads faster (Google Python style: conditional expressions)' });
    if (/[[({][^\])}]*\bfor\b[^\])}]*\bfor\b/.test(t)) res.push({ kind: 'clever', msg: 'comprehension with several `for` clauses: a loop reads faster (Google Python style: "optimize for readability, not conciseness")' });
  }
  if (l.kind === 'code' && CLOSING.test(l.t)) res.push({ kind: 'narration' });
  return res;
}

// Doc lines that restate a parameter's name (`name (str): The name.`, `@param id the id`) or say a function returns its result.
const PARAM_DOC = /^(?:@param\s+(?:\{[^}]*\}\s*)?\[?([\w$.]+)\]?|:param\s+(?:[\w[\], ]+\s+)?(\w+):|(\w+)\s*(?:\([^)]*\))?\s*:)\s*-?\s*(.+)$/;
const RETURN_DOC = /^(@returns?|:returns?:|returns?:)\s*(\{[^}]*\}\s*)?(the )?(result|value|return value)?\.?$/i;
export const restatesParam = l => {
  if (!l.doc || l.kind !== 'comment') return false;
  if (RETURN_DOC.test(l.body)) return true;
  const m = PARAM_DOC.exec(l.body), name = m && (m[1] || m[2] || m[3]), content = m ? canon(words(m[4]).filter(w => !STOP.has(w))).filter(w => !DOC_FILLER.has(w)) : [];
  return Boolean(name) && content.length > 0 && content.every(w => nameKey(name).has(w));
};

// Shorter idioms the language already has, for code a change wrote: [files, pattern, message, the ruff rule that also finds it,
// flags]. Each message names the standard rule that calls the long form a bad practice. `a`: not where array libraries are
// imported, since `if arr:` and `arr == True` mean something else for a NumPy array or a pandas column.
const IDIOMS = [
  [PY, /(?<![=!<>])[=!]=\s*(True|False)\b/, 'compares to `True`/`False`: test the value itself (PEP 8; ruff E712)', 'E712', 'a'],
  [PY, /(?<![=!<>])[=!]=\s*None\b/, '`== None`: use `is None` (PEP 8; ruff E711)', 'E711', 'a'],
  [PY, /\bif\s+(not\s+)?len\([^()]+\)\s*((==|!=|>)\s*0\s*)?:/, 'tests a length: test the sequence itself (`if items:`, `if not items:`) (PEP 8)', '', 'a'],
  [PY, /^\s*([\w.]+)\[([^\]]+)\]\s*=\s*\1\.get\(\s*\2\s*,\s*0\s*\)\s*\+\s*1\s*$/, 'hand-built counter: `collections.Counter` counts in one line (know and use the libraries)'],
  [PY, /\bfor\s+\w+\s+in\s+[\w.]+\.keys\(\)\s*:/, 'iterates `.keys()`: iterate the dict itself (ruff SIM118)', 'SIM118'],
  [JS, /\.filter\((?:[^()]|\([^()]*\))*\)\.length\s*(>\s*0|!==?\s*0|>=\s*1|===?\s*0|<\s*1)(?![\w.])/, '`.filter(...).length` as a test: `.some(...)` stops at the first match (unicorn prefer-array-some)'],
  [JS, /\.filter\((?:[^()]|\([^()]*\))*\)\[0\]/, '`.filter(...)[0]`: `.find(...)` stops at the first match (unicorn prefer-array-find)'],
  [JS, /\.indexOf\((?:[^()]|\([^()]*\))*\)\s*(!==?\s*-1|>\s*-1|>=\s*0|===?\s*-1|<\s*0)(?![\w.])/, '`.indexOf(x) !== -1`: `.includes(x)` (unicorn prefer-includes)'],
  [TERNARY, /\?\s*true\s*:\s*false\b|\?\s*false\s*:\s*true\b/, '`cond ? true : false` is `cond` (or `!cond`) (ESLint no-unneeded-ternary)'],
  [JS, /(?<=(?:^|[(,]|[^=!<>]=|\breturn|=>)\s*)(?!(?:undefined|null|true|false|\d)\b)([\w$]+(?:\.[\w$]+)*)\s+\?\s+\1\s+:/, '`x ? x : y` is `x || y` (or `x ?? y`) (ESLint no-unneeded-ternary)'],
  [JS, /\.map\((?:[^()]|\([^()]*\))*\)\.flat\(\s*\)/, '`.map(...).flat()`: `.flatMap(...)` (unicorn prefer-array-flat-map)'],
  [JS, /\bnew Date\(\)\.getTime\(\)/, '`new Date().getTime()`: `Date.now()` (unicorn prefer-date-now)'],
  [TS, /\b(const|let|var)\s+[\w$]+\s*:\s*(string|number|boolean)\s*=\s*(['"`]|-?\d|true\b|false\b)/, 'annotates a type the compiler infers from the value: drop it (typescript-eslint no-inferrable-types)'],
  [JS, /(?<![\w$.])([\w$]+)\s*&&\s*\1\.[\w$]+\s*&&\s*\1\.[\w$]+\.[\w$]+/, '`a && a.b && a.b.c`: `a?.b?.c` (typescript-eslint prefer-optional-chain)'],
  [JAVA, /\.size\(\)\s*(==\s*0|!=\s*0|>\s*0|>=\s*1|<\s*1)(?![\w.])/, '`.size() == 0`: `.isEmpty()` (Sonar S1155)'],
  [/\.cs$/i, /\.Count\(\)\s*(>\s*0|!=\s*0|>=\s*1|==\s*0)(?![\w.])/, '`.Count() > 0`: `.Any()` stops at the first item (.NET CA1827)'],
  [/\.(go|rs|java)$/i, /(?<![=!<>])[=!]=\s*(true|false)\b/, 'compares to `true`/`false`: test the value itself (Sonar S1125; staticcheck S1002; clippy bool_comparison)'],
  [GO, /\bstrings\.Index\([^()]*\)\s*(!=\s*-1|>=\s*0|>\s*-1|==\s*-1|<\s*0)(?![\w.])/, '`strings.Index(s, x) != -1`: `strings.Contains(s, x)` (staticcheck S1003)'],
  [RS, /\.len\(\)\s*(==\s*0|!=\s*0|>\s*0|>=\s*1)(?![\w.])/, '`.len() == 0`: `.is_empty()` (clippy len_zero)'],
  [RS, /\.map\(\|(\w+)\|\s*\1\.clone\(\)\)/, '`.map(|x| x.clone())`: `.cloned()` (clippy map_clone)'],
  [RS, /\bif\s+[^{]+\{\s*(true|false)\s*\}\s*else\s*\{\s*(true|false)\s*\}/, '`if c { true } else { false }` is `c` (clippy needless_bool)'],
];
const RETURNS_BOOL = 'an if that returns `true`/`false`: return the condition';
// The same over several lines. Indentation stands in for structure, which formatted code makes reliable.
const BLOCK_IDIOMS = [
  [CLIKE, /^[ \t]*if\s*\(.*\)\s*\{[ \t]*\n[ \t]*return\s+(true|false)\s*;?[ \t]*\n[ \t]*\}(?:\s*else\s*\{)?[ \t]*\n[ \t]*return\s+(?!\1\b)(?:true|false)\b/gm, `${RETURNS_BOOL} (Sonar S1126)`],
  [CLIKE, /^[ \t]*if\s*\(.*\)\s*return\s+(true|false)\s*;?[ \t]*\n[ \t]*(?:else\s+)?return\s+(?!\1\b)(?:true|false)\b/gm, `${RETURNS_BOOL} (Sonar S1126)`],
  [GO, /^[ \t]*if\s+.+\{[ \t]*\n[ \t]*return\s+(true|false)[ \t]*\n[ \t]*\}[ \t]*\n[ \t]*return\s+(?!\1\b)(?:true|false)\b/gm, `${RETURNS_BOOL} (staticcheck S1008)`],
  [PY, /^([ \t]*)if\s+.+:[ \t]*\n\1[ \t]+return\s+(True|False)[ \t]*\n(?:\1else:[ \t]*\n\1[ \t]+|\1)return\s+(?!\2\b)(?:True|False)\b/gm, `${RETURNS_BOOL} (ruff SIM103)`, 'SIM103'],
  [CLIKE, /\bcatch\s*\(\s*(?:[\w.<>[\]]+(?:\s*\|\s*|\s+))*\$?(\w+)(?:\s*:\s*\w+)?\s*\)\s*\{[ \t]*\n?[ \t]*throw\s+\$?\1\s*;?[ \t]*\n?[ \t]*\}(?![ \t]*catch)/g, 'a catch that only rethrows: delete the try/catch (ESLint no-useless-catch; Sonar S2737)'],
  [PY, /^([ \t]*)except\b.*:[ \t]*\n\1[ \t]+raise(?:[ \t]+\w+)?[ \t]*\n(?!\n*\1(?:except|else|finally)\b)/gm, 'an except that only re-raises: delete it (ruff TRY203; Sonar S2737)', 'TRY203'],
  [CLIKE, /\bcatch\s*\(\s*(?:[\w.<>[\]]+(?:\s*\|\s*|\s+))*(\w+)(?:\s*:\s*\w+)?\s*\)\s*\{[ \t]*\n[ \t]*(?:console\.(?:error|log|warn)|(?:this\.)?(?:logger|log|LOG|LOGGER)\.\w+|System\.(?:err|out)\.println)\(.*\)\s*;?[ \t]*\n[ \t]*throw\s+\1\s*;?[ \t]*\n[ \t]*\}/g, 'logs and rethrows: whoever catches it logs it again; handle it here or let it propagate (log-and-throw anti-pattern)'],
  [PY, /^([ \t]*)except\b.*:[ \t]*\n\1([ \t]+)(?:\w*log\w*\.\w+|print)\(.*\)[ \t]*\n\1\2raise[ \t]*$/gm, 'logs and re-raises: whoever catches it logs it again; handle it here or let it propagate (log-and-throw anti-pattern)'],
  [JS, /new Promise\(\s*(?:async\s*)?\(?\s*(\w+)\s*(?:,\s*\w+\s*)?\)?\s*=>[\s\S]{0,300}?\.then\(\s*\1\s*[,)]/g, 'wraps a promise in `new Promise`: return the promise itself (explicit-construction anti-pattern)'],
  [CLIKE, /\belse\s*\{[ \t]*\n([ \t]+)if\b.*\{[ \t]*\n(?:\1[ \t]+\S.*\n|\n)*\1\}[ \t]*\n[ \t]*\}/g, '`else { if ... }` is `else if ...` (ESLint no-lonely-if)'],
  [CLIKE, /^[ \t]*if\s*\(.*\)\s*\{[ \t]*\n([ \t]+)if\s*\(.*\)\s*\{[ \t]*\n(?:\1[ \t]+\S.*\n|\n)*\1\}[ \t]*\n[ \t]*\}(?![ \t]*else)/gm, 'nested `if` with nothing else in it: one condition with `&&` (Sonar S1066)'],
  [PY, /^([ \t]*)if\s+(\S+)\s+in\s+([\w.]+):[ \t]*\n\1[ \t]+\3\[\2\]\s*\+=\s*1[ \t]*\n\1else:[ \t]*\n\1[ \t]+\3\[\2\]\s*=\s*1\b/gm, 'hand-built counter: `collections.Counter` counts in one line (know and use the libraries)'],
];
// Index loops whose index only reads xs[i]: [files, header (indent, index, sequence), how the body reads an item, message].
const INDEX_LOOPS = [
  [JS, /^(\s*)for\s*\(\s*(?:let|var)\s+(\w+)\s*=\s*0\s*;\s*\2\s*<\s*([\w$.]+)\.length\s*;\s*(?:\2\+\+|\+\+\2|\2\s*\+=\s*1)\s*\)\s*\{\s*$/, (s, i) => `${s}\\[${i}\\]`, 'index loop that only reads `xs[i]`: `for (const x of xs)` (typescript-eslint prefer-for-of)'],
  [JAVA, /^(\s*)for\s*\(\s*int\s+(\w+)\s*=\s*0\s*;\s*\2\s*<\s*([\w.]+)\.(?:size\(\)|length)\s*;\s*(?:\2\+\+|\+\+\2)\s*\)\s*\{\s*$/, (s, i) => `(?:${s}\\.get\\(${i}\\)|${s}\\[${i}\\])`, 'index loop that only reads one item at a time: an enhanced `for` (Effective Java Item 58)'],
  [GO, /^(\s*)for\s+(\w+)\s*:=\s*0\s*;\s*\2\s*<\s*len\(([\w.]+)\)\s*;\s*\2\+\+\s*\{\s*$/, (s, i) => `${s}\\[${i}\\]`, 'index loop that only reads `xs[i]`: `for _, x := range xs` (Effective Go: for)'],
  [RS, /^(\s*)for\s+(\w+)\s+in\s+0\s*\.\.\s*([\w.]+)\.len\(\)\s*\{\s*$/, (s, i) => `${s}\\[${i}\\]`, 'index loop that only reads `xs[i]`: `for x in &xs` (clippy needless_range_loop)'],
  [PY, /^(\s*)for\s+(\w+)\s+in\s+range\(\s*(?:0\s*,\s*)?len\(([\w.]+)\)\s*\)\s*:\s*$/, (s, i) => `${s}\\[${i}\\]`, '`range(len(xs))` that only reads `xs[i]`: `for x in xs` (pylint C0200)'],
];
export const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A block's lines by indentation. A multi-line string's lines belong to the block whatever their indentation, so a test whose
// expected text starts at column 0 keeps the assertion after it.
const bodyOf = (ls, i) => {
  const ind = indentOf(ls[i]), body = [];
  let quote = null;
  for (let k = i + 1; k < ls.length; k++) {
    if (!quote && ls[k].trim() && indentOf(ls[k]) <= ind) break;
    body.push(ls[k]);
    for (const m of ls[k].matchAll(/"""|'''/g)) quote = quote === m[0] ? null : quote ?? m[0];
  }
  return body;
};
// Shorter idioms in `text`, as {n: line, msg}; `ruff` drops what ruff already reported.
export function idioms(file, text, ruff = false) {
  const res = [], ls = text.split('\n'), at = i => text.slice(0, i).split('\n').length, arrays = /^\s*(import|from)\s+(numpy|pandas|torch|tensorflow|jax|polars)\b/m.test(text);
  ls.forEach((t, i) => {
    for (const [files, re, msg, rule, flags = ''] of IDIOMS) if (files.test(file) && !(ruff && rule) && !(arrays && flags.includes('a')) && re.test(t)) res.push({ n: i + 1, msg });
    for (const [files, head, item, msg] of INDEX_LOOPS) {
      const m = files.test(file) && head.exec(t);
      if (!m) continue;
      const body = bodyOf(ls, i).join('\n'), [, , idx, seq] = m, reads = new RegExp(item(esc(seq), idx), 'g'), all = body.match(new RegExp(`\\b${idx}\\b`, 'g')) || [];
      if (!all.length || new RegExp(`${item(esc(seq), idx)}\\s*([-+*/%]?=[^=]|\\+\\+|--)`).test(body)) continue;
      const only = (body.match(reads) || []).length === all.length;
      if (only) res.push({ n: i + 1, msg });
      else if (PY.test(file) && (body.match(reads) || []).length) res.push({ n: i + 1, msg: 'uses both the index and `xs[i]`: `for i, x in enumerate(xs)` (pylint C0200)' });
    }
    // A flag set before a loop and flipped inside one `if` is any()/all(), or .some()/.every().
    const flag = (PY.test(file) && /^(\s*)(\w+) = (True|False)\s*$/.exec(t)) || (JS.test(file) && /^(\s*)(?:let|var)\s+(\w+)\s*=\s*(true|false);?\s*$/.exec(t));
    if (flag && ls[i + 1]?.startsWith(`${flag[1]}for`) && /^\s+if\b/.test(ls[i + 2] ?? '') && indentOf(ls[i + 2]) > flag[1].length) {
      const opp = { True: 'False', False: 'True', true: 'false', false: 'true' }[flag[3]], set = new RegExp(`^\\s+${flag[2]}\\s*=\\s*${opp};?\\s*$`);
      const loop = bodyOf(ls, i + 1).filter(s => s.trim() && !/^\s*\}\s*$/.test(s)), branch = bodyOf(ls, i + 2).filter(s => s.trim() && !/^\s*\}\s*$/.test(s));
      if (set.test(ls[i + 3] ?? '') && branch.every(s => set.test(s) || /^\s*break;?\s*$/.test(s)) && loop.length === branch.length + 1) res.push({ n: i + 2, msg: `flag loop: ${PY.test(file) ? '`any(...)`/`all(...)`' : '`.some(...)`/`.every(...)`'} says it in one expression (Fowler: Replace Loop with Pipeline)` });
    }
    // An __init__ that only stores its parameters is what @dataclass writes.
    const init = PY.test(file) && /^(\s*)def __init__\(self,\s*([^)]*)\)\s*(->\s*None\s*)?:\s*$/.exec(t);
    if (init) {
      const params = init[2].split(',').map(p => p.trim().split(/[:=\s]/)[0]).filter(Boolean), body = bodyOf(ls, i).filter(s => s.trim());
      const cls = ls.slice(0, i).reverse().find(s => /^\s*class\s/.test(s) && indentOf(s) < init[1].length) || '';
      if (params.length >= 3 && !params.some(p => p.startsWith('*')) && body.length === params.length && body.every((s, k) => new RegExp(`^\\s*self\\.${esc(params[k])}\\s*(:[^=]+)?=\\s*${esc(params[k])}\\s*$`).test(s)) && /^\s*class\s+\w+\s*(\(\s*(object)?\s*\))?\s*:/.test(cls)) res.push({ n: i + 1, msg: 'an `__init__` that only stores its parameters: `@dataclass` writes it (PEP 557)' });
    }
  });
  for (const [files, re, msg, rule] of BLOCK_IDIOMS) if (files.test(file) && !(ruff && rule)) for (const m of text.matchAll(re)) res.push({ n: at(m.index + m[0].search(/\S/)), msg });
  return res;
}

// An Effect whose only job is to set state from other values: React computes that during render. Effects that sync with
// something outside React (storage, the DOM, timers, the network) or run once on mount are left alone.
const EFFECT = /useEffect\(\s*\(\)\s*=>\s*\{\s*set[A-Z]\w*\((?:[^;{}()]|\((?:[^()]|\([^()]*\))*\))*\);?\s*\}\s*,\s*\[\s*[^\]\s][^\]]*\]\s*\)/g;
const OUTSIDE = /\b(window|document|localStorage|sessionStorage|navigator|fetch|setTimeout|setInterval|addEventListener|matchMedia|await|ref|current)\b/;
export const derivedEffects = (file, text) => (JS.test(file) && /from\s+['"]react['"]/.test(text) ? [...text.matchAll(EFFECT)].filter(m => !OUTSIDE.test(m[0])).map(m => text.slice(0, m.index).split('\n').length) : []);
// Work left undone, and log lines that narrate each step instead of saying what an operator needs.
export const TODO = /\b(TODO|FIXME|HACK|XXX)\b/;
export const CHATTER = /\b(console\.(log|info|debug)|logger\.(info|debug)|log\.(info|debug)|logging\.(info|debug))\s*\(\s*f?(["'`])\s*(starting|started|beginning|entering|exiting|leaving|calling|processing|successfully|done\b|finished|completed|initializ(ing|ed)|loading|loaded|fetching|fetched|creating|created|saving|saved|step \d)/i;
// Parameters of the definition at line `i` (0-based), counted across a multi-line signature; self, cls and this do not count.
export function paramCount(ls, i) {
  const text = ls.slice(i, i + 15).join('\n'), open = text.indexOf('(');
  // `r => ...`: one bare parameter, before any bracket.
  if (/^[^(]*?=\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(text)) return 1;
  if (open < 0) return 0;
  const sig = text.slice(open);
  let depth = 0, n = 0, any = false;
  for (const [k, ch] of [...sig].entries()) {
    if ('([{<'.includes(ch)) depth++;
    // The > of => or -> is an arrow, not a closing bracket.
    else if (')]}>'.includes(ch) && !(ch === '>' && '=-'.includes(sig[k - 1])) && --depth === 0) break;
    else if (ch === ',' && depth === 1) n++;
    else if (depth === 1 && /\S/.test(ch)) any = true;
  }
  const params = text.slice(open + 1).split(')')[0];
  return any ? n + 1 - (/^\s*(self|cls|this)\b/.test(params) ? 1 : 0) - (/,\s*$/.test(params) ? 1 : 0) : 0;
}

// Statements nested inside 3 or more control blocks (if, loop, try, with, switch), as {n, depth}: guard clauses flatten them.
const CONTROL = /^(\}\s*)?(if|else|elif|for|foreach|while|do|switch|match|try|catch|except|finally|with|loop|select|unless|until|when)\b/;
export function deepNesting(typed) {
  const code = typed.filter(l => l.kind === 'code'), res = [];
  code.forEach((l, i) => {
    if (!CONTROL.test(l.t) || /^\}?\s*(else|elif|catch|except|finally)\b/.test(l.t)) return;
    let depth = 0, limit = l.ind;
    for (let j = i - 1; j >= 0 && limit > 0; j--) {
      const d = code[j].ind;
      if (d >= limit || /^[}\])]/.test(code[j].t)) continue;
      limit = d;
      if (CONTROL.test(code[j].t)) depth++;
    }
    if (depth >= 3) res.push({ n: l.n, depth: depth + 1 });
  });
  return res;
}

// Checks for cases that cannot happen, as {n, msg}: a null or empty check of a value created a few lines earlier and untouched since,
// a type re-checked inside a private function whose signature already declares it, and `?.` on an object the code just created.
const CREATED = { py: /^(\s*)(\w+)\s*=\s*([A-Z]\w*\(|\[|\{|["']|\d)/, js: /^(\s*)(?:const|let|var)\s+(\w+)\s*=\s*(new\s+\w|\[|\{|["'`]|\d)/ };
// The created value as [text, shape], with strings and then brackets emptied, when it is the whole right-hand side: `[a].find(f)`,
// `"a" if c else None` or `x || null` may still be empty.
const whole = rhs => {
  const flat = rhs.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""').replace(/\s(#|\/\/).*$/, '').replace(/;?\s*$/, '');
  let s = flat, prev;
  do [prev, s] = [s, s.replace(/\([^()]*\)|\[[^[\]]*\]|\{[^{}]*\}/g, m => m[0] + m.at(-1))];
  while (s !== prev);
  return /[)\]}"]\s*(\??\.|\[|\()|\s(if|or|and)\s|[?|&]/.test(s) ? null : [flat, s];
};
// Never falsy: in JavaScript an object, array or `new`; a string or number literal that is not empty or zero; in Python a display
// with an item, but no comprehension or `*xs` (a class may define its own truth).
const truthy = (py, rhs, [flat, s]) => {
  if (!py && /^(new\s|\[|\{)/.test(rhs)) return true;
  if (s === '""') return /^(["'])(?!\1)/.test(rhs) || /^`(?!`)(?![^`]*\$\{)/.test(rhs);
  if (/^\d[\d_]*(\.\d*)?$/.test(s)) return /[1-9]/.test(s);
  return py && (s === '[]' || s === '{}') && /\S/.test(flat.slice(1, -1)) && !/\bfor\b|(^|[,([{])\s*\*/.test(flat.slice(1, -1));
};
// `not v` or `!v`; `!v.length` or `!v[0]` tests something else.
const NOT = { py: v => `not\\s+${v}(?![\\w.[(])|`, js: v => `!\\s*${v}(?![\\w$]|\\s*[.[?])|` };
export function defensiveChecks(file, text) {
  const py = PY.test(file), js = JS.test(file), lang = py ? 'py' : 'js';
  if (!py && !js) return [];
  const ls = text.split('\n'), res = [], code = i => ls[i]?.trim() && !/^\s*(#|\/\/)/.test(ls[i]);
  ls.forEach((t, i) => {
    const made = CREATED[lang].exec(t), rhs = made && t.slice(made[0].length - made[3].length), shape = made && whole(rhs);
    if (shape) {
      // A None or null check never passes, nor does `not v` when the value is never falsy.
      const v = made[2], name = esc(v), not = truthy(py, rhs, shape) ? NOT[lang](name) : '';
      const check = new RegExp(py ? `^\\s*(el)?if\\s+(${not}${name}\\s*(is|==)\\s*None\\b)` : `^\\s*(\\}\\s*else\\s+)?if\\s*\\(\\s*(${not}${name}\\s*[=!]==?\\s*(null|undefined)\\b)`);
      for (let k = i + 1, seen = 0; k < ls.length && seen < 3; k++) {
        if (!code(k)) continue;
        seen++;
        if (check.test(ls[k])) { res.push({ n: k + 1, msg: `checks \`${v}\`, which was created on line ${i + 1} and cannot be empty here: drop the check (Meyer: no redundant tests)` }); break; }
        if (new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(ls[k])) break;
      }
      if (js && /^(new\s|\{)/.test(made[3])) {
        const at = ls.slice(i + 1, i + 30).findIndex(s => new RegExp(`(?<![\\w$.])${name}\\?\\.`).test(s));
        if (at >= 0 && !ls.slice(i + 1, i + 1 + at).some(s => new RegExp(`(?<![\\w$.])${name}\\s*=[^=]`).test(s))) res.push({ n: i + 2 + at, msg: `\`${v}\` was just created, so \`?.\` never short-circuits: use \`.\` (typescript-eslint no-unnecessary-condition)` });
      }
    }
    // A private function re-checking the type its own signature declares.
    const sig = py ? /^\s*def\s+_\w+\s*\((.*)\)/.exec(t) : TS.test(file) && !/^\s*export\b/.test(t) && /^\s*(?:async\s+)?function\s+\w+\s*\((.*)\)/.exec(t);
    if (sig) for (const [, name, type] of sig[1].matchAll(/(\w+)\s*:\s*(str|int|float|bool|list|dict|string|number|boolean)\b/g)) {
      const body = bodyOf(ls, i), re = py ? new RegExp(`isinstance\\(\\s*${name}\\s*,\\s*${type}\\s*\\)`) : new RegExp(`typeof\\s+${name}\\s*[!=]==?\\s*["']${type}["']`);
      const hit = body.findIndex(s => re.test(s));
      if (hit >= 0) res.push({ n: i + 2 + hit, msg: `re-checks that \`${name}\` is a ${type}, which the signature already declares: trust the type inside private code, validate at the boundary (Meyer: no redundant tests)` });
    }
  });
  return res;
}

// Tests that replace the code they test with a mock, as {n, msg}: a Python test that patches a function and then calls it, and a
// JS test file that mocks the module it is named after.
export function mockedSubjects(file, text) {
  const ls = text.split('\n'), res = [];
  if (PY.test(file)) ls.forEach((t, i) => {
    if (!/^\s*(async\s+)?def\s+test_\w+/.test(t)) return;
    let k = i;
    while (k > 0 && /^\s*@/.test(ls[k - 1])) k--;
    const body = bodyOf(ls, i), scope = [...ls.slice(k, i), ...body].join('\n');
    for (const m of scope.matchAll(/patch(?:\.object)?\(\s*(?:\w+\s*,\s*)?["']([\w.]+)["']/g)) {
      const name = m[1].split('.').pop(), call = body.findIndex(s => new RegExp(`(?<![\\w.])${name}\\(`).test(s) && !/patch/.test(s));
      if (call >= 0) { res.push({ n: i + 2 + call, msg: `patches \`${name}\` and then calls it, so it checks the mock, not the code (TDD anti-patterns: The Mockery)` }); break; }
    }
  });
  const subject = path.basename(file).replace(/\.(test|spec)\.\w+$/, '');
  if (JS.test(file) && subject !== path.basename(file)) ls.forEach((t, i) => {
    const m = /\b(jest|vi)\.mock\(\s*["'`]([^"'`]+)["'`]/.exec(t);
    if (m && path.basename(m[2]).replace(/\.\w+$/, '') === subject) res.push({ n: i + 1, msg: `mocks \`${m[2]}\`, the module this test is for, so it checks the mock, not the code (TDD anti-patterns: The Mockery)` });
  });
  return res;
}

// Test cases in a test file, as {name, n, body}: Python, JS/TS, Go, Rust and JVM/.NET test functions.
const TEST_HEAD = [
  [PY, /^(\s*)(?:async\s+)?def\s+(test_\w+)\s*\(/],
  [JS, /^(\s*)(?:it|test)(?:\.(?:only|concurrent))?\s*\(\s*(["'`])(.*?)\2/],
  [GO, /^()func\s+(Test\w+)\s*\(\s*\w+\s+\*testing\.T\s*\)/],
];
// Assertions in any common framework, a call handing the test context `t` to a helper that asserts, and Go's non-asserting t methods excluded.
const ASSERTS = /\bassert\b|\bt\.(?!Run|Helper|Parallel|Logf?|Cleanup|Setenv|TempDir|Name|Skip\w*|Deadline|Context|Chdir)\w+\s*\(|\b\w+\((?:[^()]*,\s*)?t\s*[,)]|\b(assert\w+|expect\w*|should\w*|raises|warns|deprecated_call|simplefilter|verify\w*|check\w*|ensure\w*|must\w*|fail\w*|t\.(Error|Errorf|Fatal|Fatalf|Fail|FailNow)|require\.\w+|panic!?|unwrap\w*|to(Be|Equal|Match|Throw|Have|Contain)\w*|rejects|resolves|throws|doesNotThrow|deepEqual|strictEqual|snapshot\w*|Assert\.\w+|ok|equal|match)\b\s*[(!.]/;
const TAUTOLOGY = /\bassert\s+(True|1|not\s+False)\s*(#.*)?$|\bassert(True|Equal)\(\s*(True|1)\s*(,\s*(True|1)\s*)?\)|expect\(\s*(true|1)\s*\)\.(toBe|toEqual|toBeTruthy)\(\s*(true|1)?\s*\)|assert\.(ok|equal|strictEqual)\(\s*(true|1)\s*(,\s*(true|1)\s*)?\)|assert!\(\s*true\s*\)|assert_eq!\(\s*(true|1)\s*,\s*(true|1)\s*\)/;
export function emptyTests(file, text) {
  const ls = text.split('\n'), res = [], heads = TEST_HEAD.filter(([re]) => re.test(file)).map(([, h]) => h);
  ls.forEach((t, i) => {
    const m = heads.map(h => h.exec(t)).find(Boolean), rust = RS.test(file) && /^\s*#\[(tokio::)?test\]/.test(ls[i - 1] ?? '') && /^\s*(async\s+)?fn\s+(\w+)/.exec(t);
    if (!m && !rust) return;
    // A multi-line signature ends at the line that opens the body.
    let open = i;
    while (open < ls.length - 1 && !/[:{]\s*(#.*|\/\/.*)?$/.test(ls[open]) && !/=>/.test(ls[open])) open++;
    const name = rust ? rust[2] : m[3] ?? m[2], body = [t, ...ls.slice(i + 1, open + 1), ...bodyOf(ls, open).filter(s => !s.trim() || indentOf(s) > indentOf(t))].join('\n');
    if (TAUTOLOGY.test(body.split('\n').find(s => TAUTOLOGY.test(s)) ?? '')) res.push({ n: i + 1, name, msg: 'asserts a constant, so it can never fail' });
    else if (!ASSERTS.test(body.split('\n').slice(1).join('\n') || t.replace(m?.[0] ?? '', '')) && !SMOKE.test(name)) res.push({ n: i + 1, name, msg: 'asserts nothing, so it proves nothing' });
  });
  return res;
}

export const swallowed = (typed, l) => {
  if (l.kind !== 'code') return false;
  if (CATCH_ALL.test(l.t)) return !/^except/.test(l.t) || SWALLOW.test(typed[l.n]?.t ?? '');
  const open = CATCH_OPEN.exec(l.t), go = !open && GO_ERR.test(l.t);
  if (!open && !go) return false;
  const [next = '', after = ''] = typed.slice(l.n).filter(x => x.kind === 'code').slice(0, 2).map(x => x.t);
  return next.startsWith('}') || (after.startsWith('}') && (go ? DROP_GO.test(next) : CATCH_ANY.test((open[1] ?? '').trim()) && DROP.test(next)));
};

// Comment blocks of six or more lines that this change mostly added; docs and licenses excluded.
export function commentBlocks(typed, added) {
  const res = [];
  for (let i = 0, j; i < typed.length; i = Math.max(j, i + 1)) {
    for (j = i; j < typed.length && typed[j].kind === 'comment' && !typed[j].directive && !typed[j].doc; j++);
    const run = typed.slice(i, j);
    if (run.length > 5 && run.filter(l => added.has(l.n)).length * 2 > run.length && !/licen[sc]e|copyright/i.test(run.map(l => l.body).join(' '))) res.push(run[0].n);
  }
  return res;
}

// If-branches on literal values of one variable, where this change added at least one: accretion that a table removes.
export function literalChains(typed, added) {
  const byVar = new Map();
  for (const l of typed) {
    const m = l.kind === 'code' && LITERAL_IF.exec(l.t);
    if (m) byVar.set(m[1], [...(byVar.get(m[1]) || []), l.n]);
  }
  return [...byVar].filter(([, ns]) => ns.length >= 3 && ns.some(n => added.has(n)));
}

// Word handling for names and task text: synonyms folded so `is_valid_email` meets `validate_email`.
const STOP = new Set('the a an to of and or in on for with that this it is be as at by from add make new use should must can please into when then than also only each all any some not no do does how what why which who would could there their its our your my me we you they them was were has have had will just so like need want true false none null nil undefined'.split(' '));
const SYN_WORDS = { is: 'valid', check: 'valid', validate: 'valid', verify: 'valid', fetch: 'get', load: 'get', read: 'get', retrieve: 'get', find: 'get', lookup: 'get', fmt: 'format', render: 'format', display: 'format', calc: 'compute', calculate: 'compute', make: 'create', build: 'create', remove: 'delete', del: 'delete', num: 'number', str: 'string', util: '', utils: '', helper: '', helpers: '', to: '', of: '', by: '', from: '' };
const stem = w => {
  if (w.length > 4) w = w.replace(/(ing|ed|es|s)$/, '').replace(/([^aeiou])\1$/, '$1');
  return w.length > 3 ? w.replace(/e$/, '') : w;
};
const SYN = Object.fromEntries(Object.entries(SYN_WORDS).map(([k, v]) => [stem(k), v && stem(v)]));
export const GENERIC = new Set('get set create delete valid format compute parse update handle process run main init data value item list result new string number test default'.split(' ').map(stem));
export const VAGUE = new Set([...GENERIC, ...'helper util manager handler thing stuff misc common base temp tmp obj foo bar info service processor impl do my'.split(' ').map(stem)]);
const DOC_FILLER = new Set('return returns get gets this function method class helper given value object instance specified provided simple basic utility wrapper'.split(' ').map(stem));
const words = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
const canon = ws => ws.map(w => SYN[stem(w)] ?? stem(w)).filter(Boolean);
export const nameKey = n => new Set(canon(words(n)));
export const isType = n => /^[A-Z]/.test(n);

// A short doc that only restates the name ("Get the user." on get_user) is narration in doc form.
export function restates(d) {
  if (!d.d || d.d.split(/\s+/).length > 8) return false;
  const name = nameKey(d.n), content = canon(words(d.d).filter(w => !STOP.has(w))).filter(w => !DOC_FILLER.has(w));
  return content.length > 0 && content.every(w => name.has(w));
}

// Body shape: identifiers, numbers and strings abstracted, so a copy with renamed variables hashes the same.
const TOKEN = /[A-Za-z_$][\w$]*|\d[\w.]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`|[^\s\w]/g;
const KEYWORDS = new Set('if else elif for while do return def function fn func class let const var new try catch except finally raise throw await async yield import from in not and or is None null nil true false True False self this super switch case break continue with as lambda match where struct impl pub static void'.split(' '));
const fnv = s => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};
// Only bare local names (variables, parameters) are abstracted. Calls, fields, paths, types, constants and string contents stay,
// because two functions that call different things are different code however alike they look. Types keep every name.
const shapeTokens = (code, name, type) => {
  const toks = code.match(TOKEN) || [];
  return toks.map((t, i) => {
    if (/^["'`]/.test(t)) return normLit(t);
    if (t === name && toks[i - 1] !== '.') return 'i';
    if (type || KEYWORDS.has(t) || !/^[a-z_$][\w$]*$/.test(t)) return t;
    const before = toks[i - 1], after = toks[i + 1];
    return before === '.' || after === '(' || after === '!' || (after === ':' && toks[i + 2] === ':') || (before === ':' && toks[i - 2] === ':') ? t : 'i';
  });
};
// Bottom-k sketch of 5-token shingles: estimates how much of two bodies is the same code.
const sketchOf = toks => [...new Set(toks.slice(4).map((_, i) => fnv(toks.slice(i, i + 5).join(' '))))].sort((a, b) => a - b).slice(0, 16);
export function similarity(a, b) {
  if (!a?.length || !b?.length) return 0;
  const A = new Set(a), B = new Set(b), all = [...new Set([...a, ...b])].sort((x, y) => x - y).slice(0, Math.min(16, a.length, b.length));
  return all.filter(h => A.has(h) && B.has(h)).length / all.length;
}

// String literals that encode a rule (a format spec, a strftime or printf pattern, a regex, SQL): repeating one repeats the rule.
const STRING_LIT = /(?:\b[frbuFRBU]{1,2})?("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)/g;
const RULE_LIT = [/\{:[^}]+\}/, /(%[-+ #0]*\d*(?:\.\d+)?[a-zA-Z].*){2}/, /\\[dwsbDWS.]|\[[^\]]+\][*+?]|\(\?[:=!<]/, /\b(SELECT|INSERT|UPDATE|DELETE)\b.*\b(FROM|INTO|SET|WHERE)\b/i];
const normLit = s => s.slice(1, -1).replace(/\{([^{}:!]*)((?:![rsa])?(?::[^{}]*)?)\}/g, '{$2}');
export const literalsIn = line => [...line.matchAll(STRING_LIT)].map(m => normLit(m[1])).filter(s => s.length >= 6 && RULE_LIT.some(re => re.test(s)));

// Definitions with location, signature, first doc line, body extent, body shape, rule literals and the words the body uses most.
export function defsIn(file, text) {
  const res = defPatterns(file), ls = text.split('\n'), defs = [], marks = family(file)?.line ?? [];
  if (!res.length) return defs;
  const isComment = t => marks.some(m => t.startsWith(m)) || /^\*/.test(t), kinds = typeLines(file, text).map(l => l.kind);
  ls.forEach((line, i) => {
    const m = res.map(re => re.exec(line)).find(Boolean), prev = ls[i - 1]?.trim() ?? '', next = ls[i + 1]?.trim() ?? '';
    if (!m || kinds[i] !== 'code' || /^(test_|Test[A-Z_])/.test(m[2]) || /^#\[(\w+::)*(test|rstest|bench)\b|^@(pytest|test\b|Test\b)/.test(prev)) return;
    let j = i - 1;
    while (j > 0 && isComment(ls[j - 1].trim())) j--;
    const doc = isComment(prev) ? ls[j].trim() : /^("""|''')/.test(next) ? next : '';
    const ind = indentOf(line);
    let end = i;
    for (let k = i + 1; k < ls.length; k++) {
      const t = ls[k].trim();
      if (!t) continue;
      // A multi-line signature ends at the definition's own indent with the line that opens the body: keep going.
      if (indentOf(ls[k]) > ind || t === '{' || (/^[)\]}>]/.test(t) && /(?:[{:<]|=>)\s*$/.test(t))) end = k;
      else { if (/^[)\]}]/.test(t)) end = k; break; }
    }
    const body = ls.slice(i, end + 1).filter((_, k) => kinds[i + k] !== 'comment').join('\n'), toks = shapeTokens(body, m[2], isType(m[2]));
    const counts = new Map();
    for (const w of words(body.replace(TOKEN, t => (/^["'`]/.test(t) ? ' ' : t)))) if (!STOP.has(w) && !KEYWORDS.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
    defs.push({
      n: m[2], f: file, l: i + 1, end: end + 1, top: !m[1], s: line.trim().slice(0, 100), d: doc.replace(/^[/#*\-"'\s]+|["'\s]+$/g, '').slice(0, 80),
      ...(toks.length >= 30 ? { shape: createHash('sha1').update(toks.join(' ')).digest('base64').slice(0, 16), size: toks.length, sketch: sketchOf(toks) } : {}),
      lits: [...new Set(literalsIn(body))].slice(0, 5),
      w: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w),
    });
  });
  return defs;
}

// A definition whose whole body hands its own parameters, in order, to one other call.
export function forwardsTo(text, d) {
  const ls = text.split('\n'), indent = indentOf(ls[d.l - 1]), body = [];
  const arrow = /=>\s*(?:await\s+)?([\w.$:]+)\((.*)\);?$/.exec(d.s), head = arrow && /=\s*(?:async\s*)?(?:\(([^)]*)\)|([\w$]+))\s*=>/.exec(d.s);
  const params = (head ? head[1] ?? head[2] : /\(([^)]*)\)/.exec(d.s)?.[1] ?? '').split(',').map(p => p.trim().replace(/^[*&]+/, '').split(/[\s:=]/)[0]).filter(p => p && !/^(self|this|cls)$/.test(p));
  for (let i = d.l; !arrow && i < ls.length && body.length < 2; i++) {
    const t = ls[i].trim();
    if (!t || /^("""|'''|#|\/\/|\/?\*)/.test(t)) continue;
    if (indentOf(ls[i]) <= indent && !/^[})\]]/.test(t)) break;
    if (!/^[})\]]+;?$/.test(t)) body.push(t);
  }
  const call = arrow ?? (body.length === 1 ? /^(?:return\s+)?(?:await\s+)?([\w.$:]+)\((.*)\);?$/.exec(body[0]) : null);
  return call && call[1] !== d.n && !isType(call[1].split(/\.|::/).pop()) && params.length && call[2].split(',').map(a => a.trim()).join() === params.join() ? call[1] : null;
}

// Windows of k substantive lines, hashed; `literals` also abstracts strings and numbers (for copy-pasted test cases).
// A multi-line signature is one line, as a parser reads it: `__new__` repeating `__init__`'s parameters is no copy.
export function windows(file, text, k, literals = false) {
  const defs = defPatterns(file), raw = text.split(/\r?\n/), depth = t => [...blankLiterals(file, t)].reduce((d, ch) => d + (ch === '(') - (ch === ')'), 0);
  const sub = [];
  let open = 0, head = null;
  for (const l of typeLines(file, text)) {
    if (l.kind !== 'code') continue;
    if (open > 0) {
      open = Math.max(0, open + depth(l.t));
      head.t += ` ${l.t}`;
    } else if (defs.some(re => re.test(raw[l.n - 1]))) {
      open = Math.max(0, depth(l.t));
      sub.push((head = { ...l }));
    } else if (l.t.length > 3 && !TRIVIAL.test(l.t) && !IMPORT.test(l.t)) sub.push(l);
  }
  const res = [];
  for (let i = 0; i + k <= sub.length; i++) {
    const w = sub.slice(i, i + k).map(l => l.t.replace(/\s+/g, ' '));
    res.push({ h: createHash('sha1').update((literals ? w.map(t => t.replace(/(['"]).*?\1|\b\d+(\.\d+)?\b/g, '_')) : w).join('\n')).digest('base64'), lines: sub.slice(i, i + k).map(l => l.n), texts: sub.slice(i, i + k).map(l => l.t) });
  }
  return res;
}

// Definitions whose names share the text's words, best first: names sharing a specific word of the text first (generic words
// only when nothing specific matches, and then at most three), rarest words weighing most; matches far weaker than the best are
// dropped. `strong` keeps only matches on a specific word of a name: what an agent is shown unasked must be worth reading.
export function relevant(defs, text, k = 10, strong = false) {
  const q = [...new Set(canon(words(text).filter(w => !STOP.has(w))))];
  if (!q.length || !defs.length) return [];
  const docs = defs.map(d => ({ d, name: nameKey(d.n), rest: new Set(canon(words(`${d.f} ${d.d} ${(d.w || []).join(' ')}`))) })), df = new Map();
  for (const x of docs) for (const w of new Set([...x.name, ...x.rest])) df.set(w, (df.get(w) || 0) + 1);
  const idf = w => Math.log(1 + defs.length / df.get(w));
  const hits = docs.filter(x => q.some(w => x.name.has(w)))
    .map(x => ({ d: x.d, specific: q.some(w => x.name.has(w) && !GENERIC.has(w)), score: q.reduce((s, w) => s + (x.name.has(w) ? 2 * idf(w) : x.rest.has(w) ? idf(w) : 0), 0) }))
    .sort((a, b) => b.score - a.score);
  const specific = hits.filter(h => h.specific), pool = specific.length ? specific : strong ? [] : hits.slice(0, 3);
  return pool.filter(h => h.score >= 0.4 * pool[0].score).slice(0, k).map(h => h.d);
}
export const fmtDefs = ds => ds.map(d => `- ${d.f}:${d.l}  ${d.s}${d.d ? `  # ${d.d}` : ''}`).join('\n');
export const ext = f => path.extname(f) || path.basename(f);
