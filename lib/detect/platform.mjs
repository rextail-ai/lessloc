// What the platform, the project's manifests and its installed libraries already provide: imports of packages nothing declares
// (made up, or never installed), and hand-written versions of what the standard library or an installed package does.
import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { TESTFILE, load, read, repoFiles, save, stateDir } from '../repo.mjs';

const JS = /\.(js|jsx|mjs|cjs|ts|tsx)$/i, PY = /\.py$/i;
const JS_IMPORT = /^\s*(?:import\s[^'"]*?from\s*|import\s*|export\s[^'"]*?from\s*)['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/;
const PY_IMPORT = /^\s*(?:from\s+([\w.]+)\s+import\b|import\s+([\w.]+))/;
// Import names that differ from the name the package is installed under.
const PY_DIST = { yaml: 'pyyaml', cv2: 'opencv-python', PIL: 'pillow', sklearn: 'scikit-learn', bs4: 'beautifulsoup4', dateutil: 'python-dateutil', jwt: 'pyjwt', dotenv: 'python-dotenv', attr: 'attrs', serial: 'pyserial', Crypto: 'pycryptodome', OpenSSL: 'pyopenssl', magic: 'python-magic', multipart: 'python-multipart', jose: 'python-jose', docx: 'python-docx', pptx: 'python-pptx', telegram: 'python-telegram-bot', slugify: 'python-slugify', psycopg2: 'psycopg2-binary', MySQLdb: 'mysqlclient', fitz: 'pymupdf', skimage: 'scikit-image', zmq: 'pyzmq', git: 'gitpython', google: 'google', pkg_resources: 'setuptools', _pytest: 'pytest' };
const norm = n => n.toLowerCase().replace(/[-_.]+/g, '-');
// Packages nearly every Python environment carries as a dependency of another: importing one is not a made-up name.
const PY_EVERYWHERE = new Set(['typing_extensions', 'setuptools', 'pkg_resources', 'pip', 'wheel', 'distutils', '_typeshed']);

// Everything the repository's manifests declare, per ecosystem, read once per review.
function declared(ctx) {
  return ctx.once('declared', () => {
    const files = repoFiles(ctx.top), js = new Set(), py = new Set(), local = new Set();
    for (const f of files.filter(f => /(^|\/)package\.json$/.test(f))) {
      const pkg = load(path.join(ctx.top, f));
      if (pkg.name) js.add(pkg.name);
      for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) for (const d of Object.keys(pkg[k] || {})) js.add(d);
    }
    for (const f of files.filter(f => /(^|\/)(requirements[^/]*\.(txt|in)|requirements\/[^/]+\.(txt|in)|pyproject\.toml|setup\.py|setup\.cfg|Pipfile)$/.test(f))) for (const m of (read(ctx.top, f) || '').matchAll(/^\s*["']?([A-Za-z][\w.-]*)/gm)) py.add(norm(m[1]));
    // Aliases a bundler or compiler resolves (tsconfig paths, `@/`, bundler configs), and top-level folders and modules that are
    // the project's own.
    for (const f of files.filter(f => /(^|\/)[jt]sconfig[\w.]*\.json$/.test(f))) for (const k of Object.keys(load(path.join(ctx.top, f)).compilerOptions?.paths || {})) local.add(k.replace(/\*.*$/, ''));
    const bundlers = files.filter(f => /(^|\/)(vite|webpack|next|nuxt|svelte|astro|rollup)\.config\.\w+$/.test(f)).map(f => read(ctx.top, f) || '').join('\n');
    for (const m of bundlers.matchAll(/["'`]([@~#$][\w/-]*)["'`]\s*:/g)) local.add(m[1]);
    for (const f of files) local.add(f.includes('/') ? `${f.split('/')[0]}/` : f.replace(/\.(py|js|ts|mjs|cjs|jsx|tsx)$/, ''));
    for (const f of files.filter(f => /\.py$/.test(f))) local.add(path.posix.basename(f, '.py')), local.add(path.posix.basename(path.posix.dirname(f)));
    return { js, py, local, jsManifest: files.some(f => /(^|\/)package\.json$/.test(f)), pyManifest: py.size > 0 };
  });
}

// Python's standard library module names, asked of the installed interpreter once and kept in lessloc's state. The list is
// saved whole, so a session reading it while another writes it never gets part of it.
function stdlib(ctx) {
  return ctx.once('stdlib', () => {
    const dir = stateDir(ctx.top);
    let names = read(dir, 'python-stdlib.txt');
    if (names == null) {
      const r = spawnSync('python3', ['-c', 'import sys; print(" ".join(sorted(sys.stdlib_module_names)))'], { encoding: 'utf8', timeout: 10000 });
      if (r.status !== 0) return null;
      save(path.join(dir, 'python-stdlib.txt'), (names = r.stdout));
    }
    return new Set(names.trim().split(/\s+/));
  });
}

const known = (ctx, file, spec) => {
  const d = declared(ctx);
  if (JS.test(file)) {
    if (/^[./]|^[#~]|:/.test(spec) || spec.startsWith('@/') || builtinModules.includes(spec.split('/')[0])) return true;
    const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    return !d.jsManifest || d.js.has(pkg) || [...d.local].some(a => a && (spec === a || spec.startsWith(a.endsWith('/') ? a : `${a}/`)));
  }
  if (!d.pyManifest) return true;
  const top = spec.split('.')[0], std = stdlib(ctx);
  return !std || PY_EVERYWHERE.has(top) || std.has(top) || d.local.has(top) || d.local.has(`${top}/`) || d.py.has(norm(top)) || d.py.has(norm(PY_DIST[top] || top)) || (PY_DIST[top] === 'google' && [...d.py].some(n => n.startsWith('google')));
};

// Hand-written versions of what the platform or an installed library does, by the name agents give them.
const REBUILT = [
  [/^(deep_?clone|clone_?deep|deep_?copy)$/i, JS, 'structuredClone()'],
  [/^(deep_?copy|deep_?clone)$/i, PY, 'copy.deepcopy()'],
  [/^(uuid|uuidv?4|generate_?uuid|gen_?uuid|random_?uuid)$/i, JS, 'crypto.randomUUID()'],
  [/^(uuid4?|generate_?uuid|gen_?uuid)$/i, PY, 'uuid.uuid4()'],
  [/^(debounce|throttle|chunk|flatten_?deep|uniq_?by|group_?by|deep_?equal|is_?equal|deep_?merge|camel_?case|kebab_?case|snake_?case|pick|omit)$/i, JS, 'lodash', ['lodash', 'lodash-es', 'es-toolkit', 'remeda', 'ramda', 'underscore']],
  [/^slugify$/i, JS, 'slugify', ['slugify', '@sindresorhus/slugify']],
  [/^slugify$/i, PY, 'python-slugify', ['python-slugify']],
];
const RETRY_DEPS = ['tenacity', 'backoff', 'retrying', 'stamina', 'p-retry', 'async-retry', 'retry', 'axios-retry', 'exponential-backoff'];
const LIBRARIES = 'know and use the libraries (Bloch, Effective Java, Item 59)';

export default [
  {
    // An import of a package no manifest declares: a made-up name, or one never installed. Either way it breaks on another machine.
    id: 'undeclared-imports', when: 'turn',
    run(ctx) {
      // Tests import dev tools that test runners bring along, so only production code is held to the manifests.
      for (const c of ctx.live.filter(c => (JS.test(c.file) || PY.test(c.file)) && !TESTFILE.test(c.file))) {
        c.text.split('\n').forEach((t, i) => {
          if (!c.mine.has(i + 1)) return;
          const m = (JS.test(c.file) ? JS_IMPORT : PY_IMPORT).exec(t), spec = m && (m[1] || m[2] || m[3]);
          if (spec && !(PY.test(c.file) && spec.startsWith('.')) && !known(ctx, c.file, spec)) ctx.put('made-up-api', c.file, i + 1, `imports \`${spec}\`, which no manifest declares and the platform does not provide: install it, or check that the package exists (package hallucination: Spracklen et al., USENIX Security 2025)`);
        });
      }
    },
  },
  {
    id: 'reinvented', when: 'turn',
    run(ctx) {
      const d = declared(ctx), has = names => names.find(n => d.js.has(n) || d.py.has(norm(n)));
      for (const c of ctx.code()) {
        for (const def of ctx.born(c)) {
          const hit = REBUILT.find(([re, lang, , deps]) => re.test(def.n) && lang.test(c.file) && (!deps || has(deps)));
          if (hit) ctx.put('reinvented', c.file, def.l, `\`${def.n}\` rebuilds ${hit[3] ? `what the installed \`${has(hit[3])}\` has` : `\`${hit[2]}\``}: use it; ${LIBRARIES}`);
        }
        // A retry loop: a loop whose body sleeps and catches. Only worth a note when the project already has a way to retry.
        const ls = c.text.split('\n'), helper = ctx.index().find(e => /retry|backoff/i.test(e.n) && e.f !== c.file), dep = has(RETRY_DEPS);
        if (helper || dep) for (const n of [...c.mine].sort((a, b) => a - b)) {
          if (!/^\s*(for\b.*\b(range|of|in)\b|while\b)/.test(ls[n - 1] ?? '')) continue;
          const body = ls.slice(n, n + 12).join('\n');
          if (/\b(sleep|setTimeout)\s*\(/.test(body) && /\b(except|catch)\b/.test(body)) {
            ctx.put('reinvented', c.file, n, `hand-written retry loop while ${helper ? `\`${helper.n}\` (${helper.f}:${helper.l})` : `\`${dep}\``} already retries: use it; ${LIBRARIES}`);
            break;
          }
        }
        // CSV split by hand, and command-line flags read by hand.
        if (PY.test(c.file) && /\.csv\b/.test(c.text)) {
          const at = [...c.mine].find(n => /\.split\(\s*["'],["']\s*\)/.test(ls[n - 1] ?? ''));
          if (at) ctx.put('reinvented', c.file, at, `splits CSV lines by hand: the \`csv\` module handles quoting and commas inside fields; ${LIBRARIES}`);
        }
        const argv = [...c.mine].filter(n => (PY.test(c.file) ? /\bsys\.argv\[\s*\d/ : /\bprocess\.argv\b.*["'`]--/).test(ls[n - 1] ?? ''));
        if (argv.length >= 2 && !/\b(argparse|click|typer|fire|docopt|parseArgs|commander|yargs|minimist|meow|cac)\b/.test(c.text)) ctx.put('reinvented', c.file, argv[0], `reads command-line flags by hand: ${PY.test(c.file) ? '`argparse`' : '`util.parseArgs`'} adds help, defaults and errors; ${LIBRARIES}`);
      }
    },
  },
];
