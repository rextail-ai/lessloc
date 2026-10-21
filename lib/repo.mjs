// Repository state: git access, project policy, lessloc's own state files, worktree snapshots, changes, evidence, the definitions index.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHECKS, INTERRUPT } from './kinds.mjs';
import { DEFS, defsIn, isCode } from './text.mjs';

export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const SKIP = /(^|\/)(node_modules|vendor|dist|build|out|target|\.venv|venv|__pycache__|coverage|\.next)\/|\.min\.\w+$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|uv\.lock|go\.sum|composer\.lock|Gemfile\.lock)$/;
export const GENERATED = /@generated|do not edit|auto-?generated/i;
// Tests, fixtures and migrations repeat by design: exempt from duplication, size, folder and net-growth checks.
export const TESTFILE = /(^|\/)(tests?|__tests__|spec)\/|[._-](tests?|spec)\.\w+$|(^|\/)(test_[^/]*|tests?\.\w+|conftest\.py)$/i;
export const EXEMPT = new RegExp(`${TESTFILE.source}|(^|\\/)(fixtures?|testdata|corpora|corpus|examples?|samples?|migrations?|__mocks__|mocks?|stories)\\/|\\.(stories|mocks?)\\.\\w+$`, 'i');
// Files a folder exists for by convention, framework routes included (Next.js, SvelteKit, Expo Router): a folder holding only
// these is not a needless folder, and they are never too small.
export const ENTRY_FILE = /^(SKILL\.md|README\.md|index\.\w+|mod\.rs|lib\.rs|main\.\w+|__init__\.py|__main__\.py|conftest\.py|doc\.go|package-info\.java|module-info\.java|Dockerfile|package\.json|Cargo\.toml|go\.mod|pyproject\.toml|(page|layout|route|loading|error|not-found|template|default|head|middleware|_layout)\.(js|jsx|ts|tsx|mdx)|\+(page|layout|server|error)(\.server)?\.(svelte|js|ts))$/;
// One type per file and one package per folder are these languages' conventions, so file and folder counts do not apply.
export const FILE_PER_TYPE = /\.(java|kt|kts|scala|cs|go)$/i;
export const POLICY = /(^|\/)\.lessloc(-baseline)?\.json$/;
export const JUNK_DRAWER = /^(utils?|helpers?|common|misc|shared|stuff|tools)(\.\w+)?$/i;
export const DEMO_DIR = /^(examples?|demos?|samples?|playground|sandbox|scratch)$/i;
// Caches, build output and logs: never source, so committing them is noise at best.
export const CACHE = /(^|\/)(__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|node_modules|\.next|coverage|\.nyc_output|\.tox)\/|\.py[co]$|(^|\/)(\.DS_Store|Thumbs\.db|\.coverage|npm-debug\.log[^/]*|yarn-error\.log)$|\.log$/;
export const ENV_FILE = /(^|\/)\.env(\.(?!example$|sample$|template$|dist$|defaults$|schema$)[\w.-]+)?$/;
// A manifest that declares dependencies, with the lockfiles that pin them.
export const LOCKS = [
  ['package.json', ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'], t => /"(dev)?[dD]ependencies"\s*:\s*\{\s*"/.test(t)],
  ['pyproject.toml', ['poetry.lock', 'uv.lock', 'pdm.lock'], t => /dependencies\s*=\s*\[\s*["']/.test(t)],
  ['Cargo.toml', ['Cargo.lock'], t => /\[(dev-)?dependencies\]\s*\n\s*[\w-]+\s*=/.test(t)],
  ['Gemfile', ['Gemfile.lock'], t => /^\s*gem\s/m.test(t)],
  ['composer.json', ['composer.lock'], t => /"require"\s*:\s*\{\s*"/.test(t)],
];
export const INSTRUCTIONS = /^(CLAUDE(\.local)?\.md|AGENTS\.md|GEMINI\.md|\.claude\/CLAUDE\.md|\.github\/copilot-instructions\.md|\.cursorrules|\.windsurfrules|\.clinerules(\/.+)?|\.cursor\/rules\/.+\.mdc|\.windsurf\/rules\/.+)$/;
// Junk: backups, copies next to their original, scratch scripts at the root, unrequested report docs.
const BACKUP = /\.(bak|orig|rej|swp|old|tmp)$|~$|(^|\/)tmpclaude-[^/]*$/i;
const VERSIONED = /^(.+?)[._ -](old|new|v\d+|fixed|final|updated|improved|refactored|simplified|clean|copy|backup|bak)(\.\w+)?$/i;
const SCRATCH = /^(scratch|tmp|temp|debug|demo|try|quick|playground|sandbox|example|repro|reproduce|verify|check)([._-][^/]*)?\.(py|js|mjs|cjs|ts|sh|rb|go|rs|php|java)$/i;
// A test script at the root is scratch only where the project keeps its tests in a folder; otherwise it is how tests are added.
const ROOT_TEST = /^tests?([._-][^/]*)?\.(py|js|mjs|cjs|ts|sh|rb)$/i;
const REPORT = /(^|\/)[A-Z0-9_-]*(SUMMARY|REPORT|IMPLEMENTATION|ANALYSIS|NOTES|PLAN|FIXES|WALKTHROUGH|STATUS|PROGRESS|COMPLETION|VERIFICATION|RESULTS|FINDINGS|CHANGES_MADE)[A-Z0-9_-]*\.md$/;
export const junk = (file, has) => {
  const m = VERSIONED.exec(path.basename(file)), root = !file.includes('/');
  return BACKUP.test(file) || REPORT.test(file) || (root && SCRATCH.test(file)) || (root && ROOT_TEST.test(file) && ['tests', 'test', '__tests__', 'spec'].some(has)) || Boolean(m && (isCode(file) || /\.md$/i.test(file)) && has(path.posix.join(path.posix.dirname(file), m[1] + (m[3] || ''))));
};
// Files the user asked for pass: every word of a multi-word name, or a one-word name in full, appears in the prompt.
export const mentioned = (file, prompt = '') => {
  const p = prompt.toLowerCase(), ws = path.basename(file).replace(/\.\w+$/, '').split(/[^a-zA-Z0-9]+|(?<=[a-z])(?=[A-Z])/).filter(w => w.length > 1);
  return ws.length > 1 ? ws.every(w => p.includes(w.toLowerCase())) : p.includes(path.basename(file).toLowerCase());
};
export const glob = g => new RegExp('^' + g.replace(/[.+^$()|[\]\\{}]/g, '\\$&').replace(/\*\*\/|\*\*|\*|\?/g, m => ({ '**/': '(.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' })[m]) + '$');
export const posix = p => p.split(path.sep).join('/');

// Windows looks for a bare program name (git, ruff, python3) in the current folder before PATH, and lessloc runs its programs
// in the repository, so a git.exe committed there would run. Set here, before anything is started, this turns that off for
// lessloc and its children. The project's own commands (sh) still look in their folder: `gradlew test` relies on it.
const NO_CWD_LOOKUP = process.platform === 'win32' && !('NoDefaultCurrentDirectoryInExePath' in process.env) && (process.env.NoDefaultCurrentDirectoryInExePath = '1');
const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
// Temporary files go in one folder per process, which mkdtemp makes readable by the user alone.
let scratch;
const tmpFile = name => {
  if (!scratch) {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-tmp-'));
    process.once('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
  }
  return path.join(scratch, name);
};
// A child's input comes from a file, never a pipe: inside some sandboxes (Codex's on Linux) the end of a piped input never
// arrives, and a child reading to the end waits forever. `use` gets the file's descriptor for stdin, or 'ignore' without input.
let inputs = 0;
function withInput(input, use) {
  if (input == null) return use('ignore');
  const f = tmpFile(`input-${inputs++}`);
  fs.writeFileSync(f, input);
  const fd = fs.openSync(f, 'r');
  try { return use(fd); } finally { fs.closeSync(fd); fs.rmSync(f, { force: true }); }
}
export function git(cwd, args, input) {
  try {
    return withInput(input, stdin => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, env: ENV, encoding: 'utf8', stdio: [stdin, 'pipe', 'ignore'], maxBuffer: 1 << 28, timeout: 300e3 })).trimEnd();
  } catch { return ''; }
}
// The same, but null when git fails, for callers that must not read a failure as "nothing".
export function gitOrNull(cwd, args) {
  try { return execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28, timeout: 300e3 }); } catch { return null; }
}
export const topOf = cwd => git(cwd, ['rev-parse', '--show-toplevel']);
export const emptyTree = top => git(top, ['hash-object', '-t', 'tree', '--stdin'], '');
export const headTree = top => git(top, ['rev-parse', '--verify', '-q', 'HEAD^{tree}']) || emptyTree(top);
export const instructionTokens = top => repoFiles(top).filter(f => INSTRUCTIONS.test(f)).reduce((s, f) => s + Math.round((read(top, f) || '').length / 4), 0);
export const repoFiles = top => {
  const listed = git(top, ['ls-files', '-co', '--exclude-standard', '-z']);
  return (listed ? listed.split('\0') : topOf(top) ? [] : walk(top)).filter(f => f && !SKIP.test(f)).slice(0, 20000);
};
// Outside git: every file not under a dot folder.
function walk(root, dir = root, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), f = posix(path.relative(root, p));
    if (acc.length >= 20000 || e.name.startsWith('.') || SKIP.test(f + (e.isDirectory() ? '/' : ''))) continue;
    if (e.isDirectory()) walk(root, p, acc);
    else acc.push(f);
  }
  return acc;
}
// The command shell of this platform (sh or cmd), so configured commands run the way the project documents them.
export const sh = (cmd, cwd, { timeout = 600000, input, env = process.env } = {}) => withInput(input, stdin => spawnSync(cmd, { cwd, shell: true, stdio: [stdin, 'pipe', 'pipe'], env: NO_CWD_LOOKUP ? { ...env, NoDefaultCurrentDirectoryInExePath: undefined } : env, encoding: 'utf8', timeout, maxBuffer: 1 << 26 }));

export function read(top, f) {
  try {
    const p = path.join(top, f), s = fs.statSync(p);
    if (!s.isFile() || s.size > 1 << 20) return null;
    const t = fs.readFileSync(p, 'utf8');
    return t.includes('\0') ? null : t;
  } catch { return null; }
}
export const load = f => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; }
};
// Write-then-rename, so a concurrent reader never sees half a file. `mode` sets the file's permissions; without it a file keeps
// its own, so a private settings file stays private. A symlink stays one: the file it points to is written.
export const save = (f, o, mode) => {
  try { f = fs.realpathSync(f); } catch { /* a new file */ }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  let kept;
  try { kept = fs.statSync(f).mode & 0o777; } catch { /* a new file */ }
  const m = mode ?? kept, tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, typeof o === 'string' ? o : JSON.stringify(o), m === undefined ? undefined : { mode: m });
  if (m !== undefined) fs.chmodSync(tmp, m);
  fs.renameSync(tmp, f);
};

// lessloc's own files live in the user's cache, never in the repository or its .git: nothing to commit, ignore or merge, a
// search of the repository never hits them, and people sharing one checkout under their own accounts never see each other's
// prompts. Each checkout (each git worktree, too) gets its own folder. Only the user can open them.
export const stateRoot = () => process.env.LESSLOC_STATE || path.join(process.env.XDG_CACHE_HOME || (process.platform === 'win32' && process.env.LOCALAPPDATA) || path.join(os.homedir(), '.cache'), 'lessloc');
const stateDirs = new Map();
const realTop = top => {
  try { return fs.realpathSync(top); } catch { return top; }
};
export function stateDir(top) {
  if (!stateDirs.has(top)) {
    const gitDir = git(top, ['rev-parse', '--absolute-git-dir']), real = realTop(gitDir || top);
    const d = path.join(stateRoot(), `${path.basename(top).replace(/[^\w.-]/g, '_')}-${createHash('sha1').update(real).digest('hex').slice(0, 12)}`);
    fs.mkdirSync(stateRoot(), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(stateRoot(), 0o700); } catch { /* a folder of someone else's: its owner decides */ }
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(path.join(d, 'repo'))) fs.writeFileSync(path.join(d, 'repo'), real);
    stateDirs.set(top, d);
  }
  return stateDirs.get(top);
}
// The state of checkouts that no longer exist, or that lessloc first wrote over a month ago, is removed.
export function pruneStates() {
  for (const d of fs.existsSync(stateRoot()) ? fs.readdirSync(stateRoot()) : []) {
    const dir = path.join(stateRoot(), d);
    try {
      const repo = fs.readFileSync(path.join(dir, 'repo'), 'utf8');
      if (!fs.existsSync(repo) || Date.now() - fs.statSync(path.join(dir, 'repo')).mtimeMs > 30 * 864e5) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* not a lessloc folder, or already gone */ }
  }
}
// Append-only logs, so hooks of concurrent sessions never lose each other's lines; `trim` keeps the last `keep`.
const append = (top, name, line) => fs.appendFileSync(path.join(stateDir(top), name), `${line}\n`);
export const lines = (top, name) => {
  try { return fs.readFileSync(path.join(stateDir(top), name), 'utf8').split('\n').filter(Boolean); } catch { return []; }
};
export const trim = (top, name, keep) => {
  const ls = lines(top, name);
  if (ls.length > keep) save(path.join(stateDir(top), name), ls.slice(-keep).join('\n') + '\n');
};

export const DEFAULTS = { test: '', setup: '', probe: '', mode: 'block', interrupt: INTERRUPT, trailers: 'off', maxCommentRatio: 0.25, maxNetLines: 150, maxNewFiles: 3, dupLines: 6, instructionBudget: 2000, testTimeout: 300, allow: [], protect: [], boundaries: [], approvedDependencies: null, exceptions: [] };
const TYPES = { test: 's', setup: 's', probe: 's', mode: ['block', 'warn', 'off'], interrupt: 'kinds', trailers: ['verified', 'all', 'off'], maxCommentRatio: 'n', maxNetLines: 'n', maxNewFiles: 'n', dupLines: 'n', instructionBudget: 'n', testTimeout: 'n', allow: 'ss', protect: 'ss', boundaries: 'o', approvedDependencies: 'ss?', exceptions: 'o' };
const distance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const near = (k, keys) => {
  const [best, n] = keys.map(x => [x, distance(k.toLowerCase(), x.toLowerCase())]).sort((a, b) => a[1] - b[1])[0] ?? [];
  return best && n <= Math.max(3, k.length / 2) ? ` (did you mean "${best}"?)` : '';
};
// Why a boundary's pattern does not compile, or '' when it does: one that does not must not stop the other detectors.
const notPattern = s => {
  try {
    RegExp(s);
    return '';
  } catch (e) { return `"mustNotImport" ${JSON.stringify(s)} is not a valid regular expression (${e.message})`; }
};
function problem(k, v) {
  const t = TYPES[k], strings = Array.isArray(v) && v.every(x => typeof x === 'string');
  if (!t) return `unknown setting "${k}"${near(k, Object.keys(TYPES))}`;
  if (Array.isArray(t)) return t.includes(v) ? '' : `"${k}" must be one of ${t.join(', ')}`;
  if (t === 's' || t === 'n') return typeof v === { s: 'string', n: 'number' }[t] ? '' : `"${k}" must be a ${{ s: 'string', n: 'number' }[t]}`;
  if (t === 'ss' || t === 'ss?') return strings || (v === null && t === 'ss?') ? '' : `"${k}" must be a list of strings`;
  if (t === 'kinds') return strings ? v.filter(x => !(x in CHECKS)).map(x => `"interrupt" names an unknown finding kind "${x}"${near(x, Object.keys(CHECKS))}`).join('; ') : '"interrupt" must be a list of finding kinds';
  if (k === 'boundaries') return !(Array.isArray(v) && v.every(b => typeof b?.files === 'string' && typeof b?.mustNotImport === 'string')) ? 'each "boundaries" entry needs "files" and "mustNotImport"' : v.map(b => notPattern(b.mustNotImport)).filter(Boolean).join('; ');
  return Array.isArray(v) && v.every(e => typeof e?.why === 'string' && e.why.trim()) ? '' : 'each "exceptions" entry needs a "why"';
}
// Project policy from .lessloc.json, with every problem in it spelled out instead of silently ignored.
export function config(top) {
  const file = path.join(top, '.lessloc.json'), problems = [], valid = {};
  let raw = {};
  if (fs.existsSync(file)) {
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { problems.push('.lessloc.json is not valid JSON, so the defaults apply'); }
  }
  for (const [k, v] of Object.entries(raw)) {
    // One exception without a reason must not disable the others.
    const p = problem(k, k === 'exceptions' && Array.isArray(v) ? v.filter(e => typeof e?.why === 'string' && e.why.trim()) : v);
    if (p) problems.push(p);
    else valid[k] = v;
    if (!p && k === 'exceptions' && valid[k].some(e => !(typeof e?.why === 'string' && e.why.trim()))) {
      problems.push('each "exceptions" entry needs a "why"; the ones without are ignored');
      valid[k] = v.filter(e => typeof e?.why === 'string' && e.why.trim());
    }
  }
  return { ...DEFAULTS, ...valid, problems };
}

// How a fresh agent can verify a change, when the project does not say so in .lessloc.json.
export function discoverTest(top) {
  const pkg = load(path.join(top, 'package.json')), has = f => fs.existsSync(path.join(top, f)), py = process.platform === 'win32' ? 'python' : 'python3';
  if (pkg.scripts?.test && !/no test specified/.test(pkg.scripts.test)) return 'npm test';
  if (/^test:/m.test(read(top, 'Makefile') || '')) return 'make test';
  if (has('Cargo.toml')) return 'cargo test';
  if (has('go.mod')) return 'go test ./...';
  if (['pytest.ini', 'tox.ini', 'conftest.py'].some(has) || /\[tool\.pytest/.test(read(top, 'pyproject.toml') || '')) return `${py} -m pytest -q`;
  const dir = ['tests', 'test'].find(d => has(d) && fs.statSync(path.join(top, d)).isDirectory()), first = dir && fs.readdirSync(path.join(top, dir)).find(f => /^test_.*\.py$/.test(f));
  if (first) return /\bunittest\b|TestCase/.test(read(top, `${dir}/${first}`) || '') ? `${py} -m unittest discover -s ${dir} -q` : `${py} -m pytest -q`;
  return '';
}
export const testCommand = (top, cfg) => cfg.test || discoverTest(top);

// Untracked files that hold keys or credentials by their name.
const SECRET_FILE = new RegExp(`${ENV_FILE.source}|\\.(pem|key)$|(^|/)id_(rsa|ed25519)$`), PEM_LABEL = /^-----(BEGIN|END) [A-Z0-9 ]+-----$/;
// The whole working tree, untracked files included, as one tree hash. Each key keeps a private index, so a snapshot
// costs only the files changed since the last one and never takes the repository's own index lock.
export function snapshot(top, key = 'cli') {
  const untracked = git(top, ['ls-files', '-o', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  // Untracked files over 1 MB stay out: reviews never read them, and hashing them would fill git's object store.
  const big = untracked.filter(f => {
    try { return fs.statSync(path.join(top, f)).size > 1 << 20; } catch { return false; }
  });
  // An untracked key or environment file goes into the tree with every line blank but its PEM labels (`-----BEGIN ...-----`,
  // the same words in every key), so its content never reaches git's object store while a review still sees the file appear
  // and a private key in it. A blank file is one blank line: git's diff leaves out a new file that is empty.
  const withheld = untracked.filter(f => SECRET_FILE.test(f) && !big.includes(f));
  const standIn = f => {
    try { return fs.readFileSync(path.join(top, f), 'utf8').split('\n').map(l => (PEM_LABEL.test(l.trim()) ? l.trim() : '')).join('\n') || '\n'; } catch { return '\n'; }
  };
  const tree = env => execFileSync('git', ['write-tree'], { cwd: top, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 300e3 }).trim();
  const run = idx => {
    const env = { ...ENV, GIT_INDEX_FILE: idx };
    withInput(['.', ...[...big, ...withheld].map(f => `:(exclude,literal)${f}`)].join('\0'), stdin => execFileSync('git', ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], { cwd: top, env, stdio: [stdin, 'ignore', 'ignore'], timeout: 300e3 }));
    if (!withheld.length) return tree(env);
    // The stand-ins go into a copy of the index: an index that tracked such a file would take in its content once it is ignored.
    const copy = tmpFile(`blanks-${inputs++}`), blankEnv = { ...ENV, GIT_INDEX_FILE: copy };
    try {
      fs.copyFileSync(idx, copy);
      const blob = f => withInput(standIn(f), stdin => execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: top, env: ENV, encoding: 'utf8', stdio: [stdin, 'pipe', 'ignore'], timeout: 300e3 })).trim();
      withInput(withheld.map(f => `100644 ${blob(f)}\t${f}\0`).join(''), stdin =>execFileSync('git', ['update-index', '-z', '--index-info'], { cwd: top, env: blankEnv, stdio: [stdin, 'ignore', 'ignore'], timeout: 300e3 }));
      return tree(blankEnv);
    } finally { fs.rmSync(copy, { force: true }); }
  };
  // Named .idx, not .index: an index an earlier lessloc kept may track such files.
  const own = path.join(stateDir(top), 'sessions', `${key.replace(/[^\w-]/g, '_')}.idx`);
  try {
    if (!fs.existsSync(own)) seedIndex(top, own);
    return run(own);
  } catch {
    // Another hook of the same session holds that index: use a throwaway copy.
    const tmp = tmpFile(`index-${Date.now()}`);
    try {
      seedIndex(top, tmp);
      return run(tmp);
    } catch { return ''; } finally { fs.rmSync(tmp, { force: true }); }
  }
}
function seedIndex(top, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    // Keep the index's own timestamps: git trusts cached file stats only for entries older than the index, and a fresh
    // copy would make a same-size rewrite in the same second look unchanged.
    const index = path.resolve(top, git(top, ['rev-parse', '--git-path', 'index'])), st = fs.statSync(index);
    fs.copyFileSync(index, to);
    fs.utimesSync(to, st.atime, st.mtime);
  } catch { /* a repository without an index starts from an empty one */ }
}

// File contents at a tree-ish, read in one git process: what a review sees is exactly the snapshot, not a later state.
export function blobs(top, specs) {
  if (!specs.length) return [];
  let out;
  try { out = withInput(specs.join('\n') + '\n', stdin => execFileSync('git', ['cat-file', '--batch'], { cwd: top, env: ENV, maxBuffer: 1 << 30, stdio: [stdin, 'pipe', 'ignore'], timeout: 300e3 })); } catch { return specs.map(() => null); }
  const res = [];
  for (let i = 0, k = 0; k < specs.length; k++) {
    const nl = out.indexOf(10, i), head = out.toString('utf8', i, nl).split(' ');
    if (head[1] !== 'blob') { res.push(null); i = nl + 1; continue; }
    const size = Number(head[2]), text = out.toString('utf8', nl + 1, nl + 1 + size);
    res.push(size > 1 << 20 || text.includes('\0') ? null : text);
    i = nl + 1 + size + 1;
  }
  return res;
}

// Files that differ between two tree-ishes, as { file, added: Set(line numbers), removed, gone: [removed lines], isNew, deleted, text }.
export function changes(top, from, to, only = null) {
  const diff = git(top, ['diff', from, to, '-M', '-U0', '--no-prefix', '--no-color', '--no-ext-diff']);
  const files = new Map(), renames = [];
  let cur = null, n = 0, hunk = false, isNew = false, old = '', moved = '';
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) { cur = null; hunk = false; isNew = false; }
    else if (!hunk && l.startsWith('new file mode')) isNew = true;
    else if (!hunk && l.startsWith('rename from ')) moved = l.slice(12);
    else if (!hunk && l.startsWith('rename to ')) renames.push([moved, l.slice(10)]);
    else if (!hunk && l.startsWith('--- ')) old = l.slice(4).replace(/\t$/, '');
    else if (!hunk && l.startsWith('+++ ')) {
      const p = l.slice(4).replace(/\t$/, ''), deleted = p === '/dev/null';
      files.set(deleted ? old : p, (cur = { file: deleted ? old : p, added: new Set(), removed: 0, gone: [], isNew, deleted }));
    }
    else if (l.startsWith('@@')) { hunk = true; n = Number(/\+(\d+)/.exec(l)[1]); }
    else if (hunk && cur && l[0] === '+') cur.added.add(n++);
    else if (hunk && cur && l[0] === '-') { cur.removed++; cur.gone.push(l.slice(1)); }
  }
  // A pure rename has no hunks: still a change of that path.
  for (const [, b] of renames) if (!files.has(b)) files.set(b, { file: b, added: new Set(), removed: 0, gone: [], isNew: false, deleted: false });
  const keep = c => !only || only.has(c.file) || renames.some(([a, b]) => b === c.file && only.has(a));
  const list = [...files.values()].filter(keep), texts = blobs(top, list.filter(c => !c.deleted).map(c => `${to}:${c.file}`));
  let t = 0;
  for (const c of list) c.text = c.deleted ? null : texts[t++];
  return Object.assign(list.filter(c => c.deleted || c.text != null), { renames: renames.filter(([a, b]) => !only || only.has(a) || only.has(b)) });
}

// Test results keyed by the exact tree they ran on, one file per tree so concurrent sessions never overwrite each other; a
// result never transfers to another tree.
export function evidence(top, tree) {
  const r = tree ? load(path.join(stateDir(top), 'evidence', `${tree}.json`)) : {};
  return r.test ? r : null;
}
export function record(top, tree, result) {
  if (!tree) return;
  try { save(path.join(stateDir(top), 'evidence', `${tree}.json`), result); } catch { /* the state folder is not writable from here */ }
}
// Runs a test command and records the result for `tree`. Test output is the largest thing agents read over and over, so only
// what a reader needs is kept: one summary line on success; on failure the failing parts and the end, at most 80 lines.
const FAILURE = /\b(FAIL(ED|URE|S)?|ERROR|Error|Exception|Traceback|assert\w*|expected|received|panicked|not ok)\b|✗|✕|×/;
export function runTests(top, cfg, cmd, tree) {
  const t0 = Date.now(), r = sh(cmd, top, { timeout: cfg.testTimeout * 1000 }), ok = r.status === 0, ls = `${r.stdout || ''}${r.stderr || ''}`.trimEnd().split('\n');
  const result = { test: cmd, ok, at: new Date().toISOString(), where: 'working tree', ms: Date.now() - t0 };
  record(top, tree, result);
  if (ok) return { ...result, status: 0, output: (ls.filter(l => /\b(passed|failed|ok|tests?|ran)\b/i.test(l)).at(-1) || '').trim().slice(0, 120) };
  const keep = new Set(), shown = [];
  ls.forEach((l, i) => {
    if (FAILURE.test(l)) for (let k = Math.max(0, i - 2); k <= Math.min(ls.length - 1, i + 5); k++) keep.add(k);
  });
  for (let k = Math.max(0, ls.length - 15); k < ls.length; k++) keep.add(k);
  let prev = -1;
  for (const k of [...keep].sort((a, b) => a - b)) {
    if (k > prev + 1) shown.push('...');
    shown.push(ls[k]);
    prev = k;
  }
  return { ...result, status: r.status, output: shown.slice(0, 80).join('\n') + (r.status == null ? '\n(timed out)' : '') };
}

// The definitions index, cached per file by mtime and size; the cache key includes the analyzer's own version.
const ENGINE = (() => {
  const s = fs.statSync(new URL('./text.mjs', import.meta.url));
  return createHash('sha1').update(`${VERSION}:${s.mtimeMs}:${s.size}`).digest('hex').slice(0, 10);
})();
const indexed = new Map();
export function index(top, only) {
  if (!only && indexed.has(top)) return indexed.get(top);
  const files = only ?? repoFiles(top).filter(f => DEFS.some(([re]) => re.test(f)) && !EXEMPT.test(f));
  const cache = path.join(stateDir(top), `defs-${ENGINE}.json`), old = load(cache), next = {};
  let dirty = Object.keys(old).length !== files.length;
  for (const f of files) {
    let st;
    try { st = fs.statSync(path.join(top, f)); } catch { continue; }
    const key = `${st.mtimeMs}:${st.size}`;
    if (old[f]?.key === key) next[f] = old[f];
    else {
      const text = read(top, f) ?? '';
      next[f] = { key, defs: GENERATED.test(text.slice(0, 400)) ? [] : defsIn(f, text) };
      dirty = true;
    }
  }
  if (dirty) {
    try {
      for (const stale of fs.readdirSync(stateDir(top)).filter(n => /^defs-\w+\.json$/.test(n) && !n.includes(ENGINE))) fs.rmSync(path.join(stateDir(top), stale), { force: true });
      save(cache, next);
    } catch { /* the cache only saves time; a read-only git dir still works */ }
  }
  const defs = Object.values(next).flatMap(e => e.defs);
  if (!only) indexed.set(top, defs);
  return defs;
}

// Bounded logs of lessloc's own failures and costs, so a broken or expensive hook is visible instead of silent.
export function logError(top, event, e) {
  try { append(top, 'errors.log', `${new Date().toISOString()} ${event} ${String(e?.stack || e).split('\n').slice(0, 2).join(' | ')}`); } catch { /* nowhere left to report it */ }
}
// The host is named when it is not Claude Code.
export const recordCost = (top, event, ms, tokens, host = '') => append(top, 'cost.log', `${event} ${ms} ${tokens} ${Date.now()}${host && ` ${host}`}`);
// Each hook's recent costs: { event: [[ms, tokens, at], ...] }.
export const costs = top => {
  const all = {};
  for (const l of lines(top, 'cost.log').slice(-2000)) {
    const [e, ...xs] = l.split(' ');
    (all[e] ||= []).push(xs.map(Number));
  }
  return all;
};
