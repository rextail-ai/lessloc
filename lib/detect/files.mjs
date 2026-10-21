// Turn-end detectors that judge one changed file at a time: its structure, its comments, what it imports and declares.
import path from 'node:path';
import { ENTRY_FILE, FILE_PER_TYPE, INSTRUCTIONS, JUNK_DRAWER, LOCKS, git, junk, mentioned } from '../repo.mjs';
import { CHATTER, CONVENTIONAL, ENTRY_NAME, TODO, VAGUE, classify, clip, commentBlocks, deepNesting, defensiveChecks, derivedEffects, emptyTests, esc, literalChains, mockedSubjects, nameKey, paramCount } from '../text.mjs';

const LONG_STRING = /(['"`]).{60,}?\1|https?:\/\//;
// Deployment, container and CI files: scaffolding agents add on their own, which every later reader must then understand.
const INFRA = /(^|\/)(Dockerfile(\.\w+)?|\.dockerignore|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml|Procfile|Jenkinsfile|\.gitlab-ci\.yml|\.github\/workflows\/[^/]+\.ya?ml|\.circleci\/config\.yml|vercel\.json|netlify\.toml|fly\.toml|render\.yaml|(k8s|kubernetes|helm|terraform|\.devcontainer)\/[^/]+)$/;
const INFRA_ASK = /\b(docker|container|deploy\w*|ci|cd|pipeline|workflow|github actions|kubernetes|k8s|helm|terraform|vercel|netlify|fly|render|devcontainer|procfile|jenkins|gitlab)\b/i;
const DOC_ASK = /\b(readme|docs?|documentation|document|guide|explain|tutorial|changelog)\b/i;
const MAIN_GUARD = /^if\s+__name__\s*==\s*['"]__main__['"]\s*:|^if\s*\(\s*require\.main\s*===?\s*module\s*\)/;
const REEXPORT = /^export\s+(\*|\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+['"]|^export\s+(type\s+)?\{[^}]*\}\s+from\s+['"]/;
// A boolean parameter added to an existing function: the shape of a shared function stretched to serve diverging callers.
const FLAG_PARAM = /(\w+)\s*(?::\s*bool\w*)?\s*=\s*(?:True|False|true|false)\b|(\w+)\s*:\s*bool(?:ean)?\b/g;
const flagsOf = line => {
  const m = /\b(?:def|function|fn|func)\s+(\w+)\s*\(([^)]*)/.exec(line);
  return m && [m[1], [...m[2].matchAll(FLAG_PARAM)].map(x => x[1] || x[2])];
};
// Imports per language: JS default, namespace and named imports; Python's import and from-import.
const IMPORTS = [
  [/\.(js|jsx|mjs|cjs|ts|tsx)$/i, /^\s*import\s+(?:type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\*\s+as\s+([\w$]+)\s*)?(?:\{([^}]*)\})?\s*from\s*['"][^'"]+['"]/],
  [/\.py$/i, /^\s*from\s+(?!__future__)[\w.]+\s+import\s+([^()#*]+?)\s*(?:#.*)?$|^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)\s*(?:#.*)?$/],
];
const importedNames = (file, t) => {
  const m = IMPORTS.find(([re]) => re.test(file))?.[1].exec(t);
  if (!m) return [];
  const list = s => (s || '').split(',').map(x => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().split('.')[0]).filter(Boolean);
  return /\.py$/i.test(file) ? (m[1] ? list(m[1]) : list(m[2])) : [m[1], m[2], ...list(m[3])].filter(n => n && n !== 'React');
};
const DEPS = [
  [/(^|\/)(package|composer)\.json$/, /^\s*"@?[\w./-]+"\s*:\s*"(\^|~|>|<|=|\*|\d|workspace:|npm:|git|https?:|file:|link:)/],
  [/(^|\/)requirements[^/]*\.txt$/, /^\s*[A-Za-z][\w.-]*\s*(\[.*\])?\s*(==|>=|<=|~=|!=|>|<|$)/],
  [/(^|\/)pyproject\.toml$/, /^\s*"[A-Za-z][\w.-]*\s*(\[.*\])?\s*(==|>=|<=|~=|!=|>|<|")/],
  [/(^|\/)Cargo\.toml$/, /^\s*(?!(version|edition|name|rust-version|authors|license|description|readme|repository|homepage|publish|resolver)\b)[\w-]+\s*=\s*(\{|"[\^~=<>*\d])/],
  [/(^|\/)go\.mod$/, /^\s*(require\s+)?[\w.-]+\.[a-z]{2,}\/\S+\s+v\d/],
  [/(^|\/)Gemfile$/, /^\s*gem\s+["'][\w-]+/],
];
const depName = t => (t.replace(/^\s*(require\s+|gem\s+)/, '').match(/[@\w][\w./@-]*/) || [''])[0];
// The lines of a manifest that declare a dependency. In a JSON manifest only the top-level dependency objects declare packages,
// so a "homepage" or a repository's "url" is not one.
const SECTIONS = new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'require', 'require-dev']);
function declares(file, ls, dep) {
  if (!file.endsWith('.json')) return ls.map(t => dep.test(t));
  const open = [];
  return ls.map(t => {
    const hit = open.length === 2 && SECTIONS.has(open[1]) && dep.test(t);
    // The first brace a `"key": {` line opens belongs to that key.
    let key = /^\s*"([^"]*)"\s*:/.exec(t)?.[1] ?? '';
    for (const b of t.replace(/"(?:\\.|[^"\\])*"/g, '').match(/[{}]/g) || []) {
      if (b === '}') open.pop();
      else { open.push(key); key = ''; }
    }
    return hit;
  });
}
// Libraries that do the same job: a second one means two ways to do one thing.
const SAME_JOB = [['axios', 'node-fetch', 'got', 'superagent', 'ky', 'request', 'cross-fetch', 'isomorphic-fetch'], ['moment', 'dayjs', 'date-fns', 'luxon'], ['lodash', 'underscore', 'ramda'], ['jest', 'vitest', 'mocha', 'ava', 'jasmine'], ['express', 'koa', 'fastify', '@hapi/hapi'], ['uuid', 'nanoid', 'cuid', 'shortid'], ['chalk', 'kleur', 'colorette', 'picocolors'], ['yargs', 'commander', 'minimist', 'meow'], ['zod', 'yup', 'joi', 'superstruct', 'valibot'], ['winston', 'pino', 'bunyan', 'log4js'], ['bcrypt', 'bcryptjs'], ['requests', 'httpx'], ['pytest', 'nose', 'nose2'], ['arrow', 'pendulum'], ['flask', 'fastapi', 'django', 'bottle', 'sanic'], ['pydantic', 'marshmallow'], ['loguru', 'structlog'], ['reqwest', 'ureq', 'surf', 'isahc'], ['anyhow', 'eyre'], ['clap', 'structopt', 'argh']];

export default [
  {
    // What nobody asked for can only be judged against a request, so these wait for an agent's turn.
    id: 'unrequested', when: 'turn',
    run(ctx) {
      for (const c of ctx.agent ? ctx.live : []) {
        if (c.isNew && /\.md$/i.test(c.file) && !ENTRY_FILE.test(path.basename(c.file)) && !INSTRUCTIONS.test(c.file) && !/(^|\/)DECISIONS\.md$/.test(c.file) && !junk(c.file, ctx.has) && !mentioned(c.file, ctx.prompt)) ctx.put('unrequested-doc', c.file, 0, 'doc file nobody asked for: delete it, or merge what matters into the README');
        if (!c.isNew && /\.md$/i.test(c.file) && !INSTRUCTIONS.test(c.file) && c.added.size - c.removed >= 40 && !DOC_ASK.test(ctx.prompt)) ctx.put('unrequested-doc', c.file, 0, `grew by ${c.added.size - c.removed} lines nobody asked for: keep what a reader needs to use the change, and cut the rest`);
        if (c.isNew && INFRA.test(c.file) && !INFRA_ASK.test(ctx.prompt) && !mentioned(c.file, ctx.prompt)) ctx.put('unrequested-file', c.file, 0, 'deployment, container or CI file nobody asked for: delete it, or say why the task needs it (YAGNI)');
      }
    },
  },
  {
    // Comment weight: TODOs, progress chatter in logs, comment-heavy additions and long comment blocks.
    id: 'comments', when: 'turn',
    run(ctx) {
      for (const c of ctx.live) {
        const { code, exempt } = ctx.role(c), added = ctx.added(c);
        if (code && !exempt) {
          const todos = added.filter(l => l.kind === 'comment' && !l.directive && TODO.test(l.body) && classify(l) !== 'stub');
          if (todos.length) ctx.put('todo', c.file, todos[0].n, `${todos.length} TODO/FIXME left (line ${todos.slice(0, 5).map(l => l.n).join(', ')}): finish the work, or record known debt as \`shortcut: <limit>, <when to revisit>\` and tell the user (Sonar S1135; CWE-546)`);
          const chatter = added.filter(l => l.kind === 'code' && CHATTER.test(l.t));
          if (chatter.length >= 3) ctx.put('narration', c.file, chatter[0].n, `${chatter.length} log lines narrate progress ("Starting...", "Successfully..."): log what an operator needs, such as errors and decisions, not every step (Raymond, Rule of Silence)`);
        }
        const com = added.filter(l => l.kind === 'comment' && !l.directive && !l.doc).length, loc = added.filter(l => l.kind === 'code').length;
        if (com + loc >= 8 && com / (com + loc) > ctx.cfg.maxCommentRatio) ctx.put('comment-density', c.file, 0, `${Math.round((100 * com) / (com + loc))}% of the added lines are comments (max ${Math.round(100 * ctx.cfg.maxCommentRatio)}%, docs not counted): cut them to the whys`);
        const blocks = commentBlocks(ctx.typed(c), c.mine);
        if (blocks.length) ctx.put('comment-block', c.file, blocks[0], `${blocks.length} comment block(s) of 6+ lines: decisions go to the decision log and invariants into tests or types; keep at most a line of why next to the code`);
      }
    },
  },
  {
    // The shape of production code a change wrote: size, nesting, branching, signatures and names.
    id: 'structure', when: 'turn',
    run(ctx) {
      for (const c of ctx.code()) {
        const typed = ctx.typed(c), added = ctx.added(c), defs = ctx.defs(c), born = ctx.born(c), ls = c.text.split('\n');
        if (c.isNew && typed.filter(l => l.kind === 'code').length < 10 && !ENTRY_FILE.test(path.basename(c.file)) && !FILE_PER_TYPE.test(c.file)) ctx.put('tiny-file', c.file, 0, 'tiny new file: put its code in the file that uses it, unless it is a responsibility of its own');
        const dense = added.filter(l => l.kind === 'code' && l.t.length > 160 && !LONG_STRING.test(l.t)).map(l => l.n), size = typed.filter(l => l.kind === 'code').length;
        if (dense.length) ctx.put('dense-lines', c.file, dense[0], `${dense.length} line(s) over 160 characters: one readable statement per line beats compressed code`);
        if (c.added.size - c.removed >= 150 && size > 800) ctx.put('swollen-file', c.file, 0, `grew by ${c.added.size - c.removed} lines to ${size} code lines: split by responsibility if it now holds several`);
        for (const [v, ns] of literalChains(typed, c.mine)) ctx.put('if-chain', c.file, ns[0], `${ns.length} if-branches on literal values of \`${v}\`: a lookup table keeps one place to add cases`);
        const before = new Map(c.gone.map(flagsOf).filter(Boolean));
        for (const l of added) {
          const sig = flagsOf(l.t), extra = sig && before.has(sig[0]) && sig[1].filter(f => !before.get(sig[0]).includes(f));
          if (extra?.length) ctx.put('mode-flag', c.file, l.n, `\`${sig[0]}\` gained flag parameter \`${extra[0]}\`: if callers now need different behavior, two clear functions beat one with a mode switch`);
        }
        for (const d of born) if (d.top && !ENTRY_NAME.test(d.n) && [...nameKey(d.n)].every(w => VAGUE.has(w))) ctx.put('vague-name', c.file, d.l, `vague name \`${d.n}\`: name it after what it does, so the next agent can find it`);
        for (const d of born.filter(d => !CONVENTIONAL.test(d.n) && !/\b(class|interface|struct|enum|trait|type|record|object)\b/.test(d.s))) {
          const n = paramCount(ls, d.l - 1);
          if (n > 7) ctx.put('long-params', c.file, d.l, `\`${d.n}\` takes ${n} parameters: pass one object, or split it by what callers need (CWE-1064; Sonar S107; Clean Code F1)`);
        }
        for (const n of derivedEffects(c.file, c.text).filter(n => c.mine.has(n))) ctx.put('simpler', c.file, n, 'an Effect that only sets state from other values: compute it during render (React docs: You Might Not Need an Effect)');
        for (const x of defensiveChecks(c.file, c.text).filter(x => c.mine.has(x.n))) ctx.put('defensive', c.file, x.n, x.msg);
        if (c.isNew && JUNK_DRAWER.test(path.basename(c.file))) ctx.put('junk-drawer', c.file, 0, 'junk-drawer module name: name the module after its one responsibility');
        const deep = deepNesting(typed).filter(x => c.mine.has(x.n));
        if (deep.length) ctx.put('deep-nesting', c.file, deep[0].n, `${deep.length} statement(s) nested ${Math.max(...deep.map(x => x.depth))} control levels deep: flatten with guard clauses, early return or continue (Sonar S134; Fowler: Replace Nested Conditional with Guard Clauses)`);
        for (const d of defs.filter(d => !/\b(class|interface|struct|enum|trait|type|impl|object|record|module|protocol)\b/.test(d.s))) {
          const body = typed.filter(l => l.n >= d.l && l.n <= d.end && l.kind === 'code');
          if (body.length > 100 && body.filter(l => c.mine.has(l.n)).length >= 20) ctx.put('long-function', c.file, d.l, `\`${d.n}\` is ${body.length} code lines: split it where it does several things, not into one-line helpers (Fowler: Long Function; Sonar S138)`);
        }
      }
    },
  },
  {
    // What a production file imports and exposes: unused imports, demo blocks in imported modules, files that only re-export.
    id: 'imports-and-exports', when: 'turn',
    run(ctx) {
      for (const c of ctx.code()) {
        const typed = ctx.typed(c), added = ctx.added(c);
        const names = [...new Set(added.flatMap(l => importedNames(c.file, l.t)))].filter(n => !(c.file.endsWith('.py') && (ctx.ruff().ran || /(^|\/)__init__\.py$/.test(c.file))));
        // A use is the name on its own, or spread (`...name`); after a single dot it is another object's property.
        const idle = names.filter(n => (c.text.match(new RegExp(`(?<![\\w$])(?<!(?<!\\.\\.)\\.)${esc(n)}(?![\\w$])`, 'g')) || []).length < 2);
        if (idle.length) ctx.put('unused', c.file, added.find(l => importedNames(c.file, l.t).includes(idle[0]))?.n ?? 0, `imports ${idle.slice(0, 4).map(n => `\`${n}\``).join(', ')} that nothing uses: delete ${idle.length > 1 ? 'them' : 'it'} (Sonar S1128)`);
        const guard = added.find(l => MAIN_GUARD.test(l.t)), mod = path.basename(c.file).replace(/\.\w+$/, '');
        if (guard && ctx.to && !ENTRY_FILE.test(path.basename(c.file)) && git(ctx.top, ['grep', '-l', '-E', c.file.endsWith('.py') ? `(from|import)[[:space:]]+([[:alnum:]_.]*\\.)?${mod}([[:space:]]|$|,)` : `(require\\(|from[[:space:]]+)['"][^'"]*/${mod}(\\.[a-z]+)?['"]`, ctx.to, '--', `:!${c.file}`])) ctx.put('demo-code', c.file, guard.n, 'example or demo block in a module other code imports: move the example into a test, or delete it');
        if (c.isNew && /\.(js|jsx|mjs|cjs|ts|tsx)$/.test(c.file) && !/^(src\/)?index\.\w+$/.test(c.file)) {
          const lines = typed.filter(l => l.kind === 'code');
          if (lines.length && lines.every(l => REEXPORT.test(l.t))) ctx.put('wrapper', c.file, 0, 'file only re-exports other modules: import from them directly (Vite performance guide: avoid barrel files)');
        }
      }
    },
  },
  {
    // Formatting-only edits: a line whose tokens are unchanged but whose quotes or spacing are. Re-indented lines (code wrapped in a
    // new block) are structure, not churn; a diff counts only when such lines are most of it.
    id: 'churn', when: 'turn',
    run(ctx) {
      for (const c of ctx.live.filter(c => ctx.role(c).code)) {
        const norm = t => t.replace(/\s+/g, '').replace(/['"`]/g, '"'), gone = new Map(), inner = new Set(c.gone.map(t => t.trim())), ls = c.text.split('\n');
        for (const t of c.gone) gone.set(norm(t), (gone.get(norm(t)) || 0) + 1);
        let churn = 0;
        for (const n of c.added) {
          const t = ls[n - 1] ?? '';
          if (t.trim() && !inner.has(t.trim()) && gone.get(norm(t)) > 0) { churn++; gone.set(norm(t), gone.get(norm(t)) - 1); }
        }
        if (churn >= 10 && churn * 2 >= c.added.size) ctx.put('churn', c.file, 0, `${churn} lines only reformatted (quotes, spacing, punctuation): leave the formatting of lines the task does not change alone, and reformat a whole project in its own change (Google eng-practices: small CLs)`);
      }
    },
  },
  {
    id: 'empty-tests', when: 'turn',
    run(ctx) {
      for (const c of ctx.live.filter(c => ctx.role(c).test && ctx.role(c).code)) {
        for (const x of emptyTests(c.file, c.text).filter(x => c.mine.has(x.n))) ctx.put('empty-test', c.file, x.n, `test \`${clip(x.name, 50)}\` ${x.msg}: assert the behavior it is named for (TDD anti-patterns: The Liar)`);
        for (const x of mockedSubjects(c.file, c.text).filter(x => c.mine.has(x.n))) ctx.put('empty-test', c.file, x.n, x.msg);
      }
    },
  },
  {
    // A version bump removes and re-adds the same dependency: not a new one.
    id: 'dependencies', when: 'turn',
    run(ctx) {
      for (const c of ctx.live) {
        const dep = DEPS.find(([re]) => re.test(c.file))?.[1];
        if (!dep) continue;
        const ls = c.text.split('\n'), declared = declares(c.file, ls, dep), present = ls.filter((t, i) => declared[i]).map(depName);
        const had = new Set(c.gone.filter(t => dep.test(t)).map(depName));
        const lock = LOCKS.find(([m]) => path.basename(c.file) === m)?.[1].find(l => ctx.has(path.posix.join(path.posix.dirname(c.file), l)));
        ls.forEach((t, i) => {
          if (!c.added.has(i + 1) || !declared[i] || had.has(depName(t))) return;
          const twin = SAME_JOB.find(g => g.includes(depName(t)))?.find(o => o !== depName(t) && present.includes(o));
          const why = `${twin ? `; \`${twin}\` already does this job` : ''}${lock && !ctx.list.some(x => x.file === path.posix.join(path.posix.dirname(c.file), lock)) ? `; ${lock} does not pin it, so it was never installed: install it, or check that the package and version exist` : ''}`;
          if (!ctx.cfg.approvedDependencies) ctx.put('new-dependency', c.file, i + 1, `new dependency \`${clip(t.trim())}\`${why}: use the standard library or an installed one, or say why it is worth it`);
          else if (!ctx.cfg.approvedDependencies.includes(depName(t))) ctx.put('dependency', c.file, i + 1, `dependency \`${depName(t)}\` is not in approvedDependencies${why}: use an approved one or ask the user`);
        });
      }
    },
  },
];
