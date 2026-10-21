#!/usr/bin/env node
// lessloc: keeps each agent's change to the least code that stays correct, reused and verified, so the next agent or developer
// has less to read, search and check. Hooks for agents, checks for commits and CI, an audit for the whole codebase.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDARD, line as plainLine } from './lib/voice.mjs';
import { VERSION, blobs, changes, config, costs, emptyTree, evidence, git, headTree, index, lines, load, read, record, runTests, save, sh, snapshot, stateDir, testCommand, topOf } from './lib/repo.mjs';
import { auditData, auditText, metrics, worse } from './lib/audit.mjs';
import { annotations, fmt, format, review, summary, unchecked, verifiedAt } from './lib/review.mjs';
import { clip, fmtDefs, isCode, relevant } from './lib/text.mjs';
import { renderCatalog } from './lib/catalog.mjs';
import { CLOUD_ENTRY } from './lib/hosts.mjs';
import { CLI, REPO_HOOKS, ROOT, TOOLS, ago, cloudStep, health, hostRows, hostTable, repoHooks, setup, teardown } from './lib/install.mjs';

const SELF = fileURLToPath(import.meta.url);
const [cmd, ...args] = process.argv.slice(2);
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const fail = (msg, code = 2) => (console.error(msg), code);
const repo = () => topOf(process.cwd());
const commitOf = (top, rev) => git(top, ['rev-parse', '--verify', '-q', `${rev}^{commit}`]);

// The catalog tables in PATTERNS.md, generated from lib/catalog.mjs: printed, or written between the file's markers.
const CATALOG = /(<!-- catalog:start -->\n)[\s\S]*?(\n<!-- catalog:end -->)/;
function catalog() {
  const file = new URL('./PATTERNS.md', import.meta.url), doc = fs.readFileSync(file, 'utf8');
  if (!args.includes('--write')) return console.log(renderCatalog()), 0;
  fs.writeFileSync(file, doc.replace(CATALOG, (_, a, b) => a + renderCatalog() + b));
  return 0;
}

// Each agent tool: how it installs and what was verified live, from the rows in lib/install.mjs. Printed, as a Markdown table, or
// written as one between the markers of the getting-started guide, with links within the site.
const HOSTS_BLOCK = /(<!-- hosts:start -->\n)[\s\S]*?(\n<!-- hosts:end -->)/;
function hosts() {
  if (!args.includes('--write')) return console.log(args.includes('--markdown') ? hostTable() : hostRows().map(r => `- ${r.name} (${r.how.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')}): ${r.status}`).join('\n')), 0;
  const file = new URL('./docs/guide/getting-started.md', import.meta.url);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(HOSTS_BLOCK, (_, a, b) => a + hostTable('') + b));
  return 0;
}

function find() {
  const top = repo() || process.cwd();
  console.log(fmtDefs(relevant(index(top), args.join(' '), 15)) || 'no definitions match by name; search the code for other names too');
  return 0;
}

function audit() {
  const dir = path.resolve(args.find(a => !a.startsWith('--')) || '.');
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return fail(`lessloc audit cannot find the folder ${dir}`);
  const top = topOf(dir) || dir, cfg = config(top), within = path.relative(top, dir).split(path.sep).join('/');
  const r = auditData(top, cfg, args.includes('--tools'), within), m = metrics(r);
  console.log(args.includes('--json') ? JSON.stringify({ ...r, metrics: m }, null, 1) : auditText(r, m, cfg));
  return 0;
}

// The change under review: staged (pre-commit), since a base branch (CI), or the working tree; `head` reviews the commit only,
// all of it when there is no base.
function changeSet(top, { staged, base, head }) {
  const from = base ? commitOf(top, git(top, ['merge-base', base, 'HEAD']) || base) : !head && commitOf(top, 'HEAD');
  const to = staged ? git(top, ['write-tree']) : head ? headTree(top) : snapshot(top, 'cli');
  return { from: from || emptyTree(top), to };
}

function check(argv = args, { head = false, build = false } = {}) {
  const top = repo();
  if (!top) return fail('lessloc check needs a git repository');
  const has = f => argv.includes(f), base = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : undefined, cfg = config(top);
  if (has('--base') && !commitOf(top, base)) return fail(`lessloc check cannot find the base "${base ?? ''}": name a branch, tag or commit this clone has (in CI, check out with fetch-depth: 0)`);
  const { from, to } = changeSet(top, { staged: has('--staged'), base, head }), list = changes(top, from, to);
  const F = review(top, list, cfg, { from, to, build });
  for (const p of cfg.problems) F.unshift({ kind: 'config', tier: 0, file: '.lessloc.json', line: 0, msg: p });
  // The ratchet. A committed baseline is a line the team chose, so a worse measure fails (unless another lessloc version, which
  // may measure differently, recorded it). Without one, the measures of the base commit are the line: nothing to commit or
  // merge, and a worse measure warns on the pull request.
  const file = path.join(top, '.lessloc-baseline.json'), held = has('--ratchet') && (fs.existsSync(file) ? load(file) : base && commitOf(top, from) ? { base: true, metrics: inCheckout(top, from, null, dir => metrics(auditData(dir, cfg))) } : null), prev = held?.metrics;
  if (prev) {
    const now = metrics(auditData(top, cfg)), same = held.version === VERSION;
    for (const k of Object.keys(now)) if (worse(k, now[k], prev[k], k === 'commentPercent' ? 0.5 : 0)) F.unshift({ kind: 'ratchet', tier: held.base ? 1 : same ? 0 : 2, file: held.base ? '' : '.lessloc-baseline.json', line: 0, msg: `${k} got worse: ${prev[k]} -> ${now[k]}${held.base ? ` since ${base}` : ''} (\`lessloc audit\` shows where)${held.base || same ? '' : `; the baseline is from lessloc ${held.version || '(version not recorded)'}, so record it again with \`lessloc baseline\` once this is reviewed`}` });
  }
  // Evidence counts only for the exact state that was tested: a passing run on another tree proves nothing about this one.
  const verified = verifiedAt(top, to, cfg), ev = evidence(top, to);
  if (has('--require-evidence') && !ev?.ok) F.unshift({ kind: 'unverified', tier: 0, file: '', line: 0, msg: ev ? `the tests failed at exactly this state (${ev.where}): fix them, then run \`lessloc test\`` : `no passing test run recorded for exactly this state (${verified}): run \`lessloc test\`` });
  const failed = F.some(f => f.tier === 0 || has('--strict')), notChecked = [...unchecked(cfg, top, list), ...(cfg.probe ? [] : ['handoff probe (no "probe" command)'])];
  const head1 = `lessloc check (${summary(list)}; ${verified}${F.accepted ? `; ${F.accepted} accepted by exception` : ''}${F.suppressed.length ? `; ${F.suppressed.length} suppressed` : ''}): ${F.length ? `${F.length} finding(s)` : 'clean'}`;
  if (has('--staged')) try { save(path.join(stateDir(top), 'staged.json'), { tree: to, verified, open: F.map(f => clip(fmt(f), 140)), unchecked: unchecked(cfg, top, list) }); } catch { /* a sandbox may not let the commit write lessloc's state */ }
  // The commit gate speaks to whoever commits, often an agent: nothing when the commit may go ahead, otherwise only what
  // blocks it, in plain words.
  // Problems in lessloc's own settings are the owner's to fix (`lessloc doctor`), never a reason to refuse an agent's commit.
  if (has('--gate')) {
    const blocking = F.filter(f => f.kind !== 'config' && (f.tier === 0 || has('--strict')));
    if (blocking.length) console.log(['Not committed. Fix these first:', ...blocking.slice(0, 10).map(f => `- ${plainLine(f)}`)].join('\n'));
    return blocking.length ? 1 : 0;
  }
  if (has('--json')) console.log(JSON.stringify({ summary: summary(list), verified, unchecked: notChecked, findings: F, suppressed: F.suppressed }, null, 1));
  else console.log(format(F, head1, [failed ? 'Tier-0 findings (or any finding with --strict) fail the check.' : '', notChecked.length ? `Not checked: ${notChecked.join('; ')}` : '', ...F.suppressed.map(f => `suppressed: ${fmt(f)} (${f.why})`)].filter(Boolean).join('\n'), has('--all') ? Infinity : 15));
  // With --json, stdout holds only the JSON, so the annotations go to stderr.
  if (process.env.GITHUB_ACTIONS === 'true' || has('--github')) (has('--json') ? console.error : console.log)(annotations(F));
  return failed ? 1 : 0;
}

// The project's tests with compact output, recorded as evidence for the exact working-tree state they ran on.
function test() {
  const top = repo() || process.cwd(), cfg = config(top), sep = args.indexOf('--'), configured = testCommand(top, cfg), command = sep >= 0 ? args.slice(sep + 1).join(' ') : configured;
  if (!command) return fail('no test command: set "test" in .lessloc.json');
  // Inside a sandbox (Codex's makes .git read-only) the state cannot be snapshotted here.
  let tree = '';
  try { tree = command === configured && repo() ? snapshot(top, 'cli') : ''; } catch { /* not writable here */ }
  const r = runTests(top, cfg, command, tree), where = tree ? '; recorded for this exact state' : command === configured ? '; not recorded (lessloc cannot write its state from this process)' : '';
  console.log(`${r.ok ? 'passed' : 'FAILED'}: ${command} (${(r.ms / 1000).toFixed(1)}s)${r.ok ? `${r.output ? `: ${r.output}` : ''}${where}` : (r.output ? `\n${r.output}` : '')}`);
  return r.status ?? 1;
}

// A clean checkout of one commit, removed afterwards. Installed dependency folders are linked in when no setup command is
// configured, unless a lockfile differs, because then they may not match the commit. Without `cfg`, only the files.
const DEPENDENCY_DIRS = ['node_modules', '.venv', 'venv'];
const LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'uv.lock', 'requirements.txt', 'Pipfile.lock'];
function inCheckout(top, commit, cfg, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-checkout-'));
  try {
    execFileSync('git', ['worktree', 'add', '-q', '--detach', dir, commit], { cwd: top, stdio: 'ignore' });
    if (!cfg) return fn(dir);
    if (!cfg.setup) {
      const drift = LOCKFILES.filter(f => fs.existsSync(path.join(top, f)) && blobs(top, [`${commit}:${f}`])[0] !== read(top, f));
      if (drift.length) return { status: null, stdout: `${drift.join(', ')} differ from the installed dependencies; set "setup" (for example "npm ci") so the checkout installs its own` };
      for (const d of DEPENDENCY_DIRS) if (fs.existsSync(path.join(top, d))) fs.symlinkSync(path.join(top, d), path.join(dir, d), 'junction');
    } else {
      const s = sh(cfg.setup, dir, { timeout: 1800000 });
      if (s.status !== 0) return { status: null, stdout: `setup \`${cfg.setup}\` failed:\n${`${s.stdout}${s.stderr}`.trim().split('\n').slice(-10).join('\n')}` };
    }
    return fn(dir);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: top });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
// A temporary commit of a tree, never published: what checks run on when nothing is committed yet.
const commitTree = (top, tree) => git(top, ['-c', 'user.name=lessloc', '-c', 'user.email=lessloc@localhost', 'commit-tree', tree, ...(commitOf(top, 'HEAD') ? ['-p', commitOf(top, 'HEAD')] : []), '-m', 'lessloc: candidate state']);

// Independent verification: the tests run on a clean checkout of the exact commit (default: the staged state). Anything other
// than a pass, including a crash, a timeout or a failed setup, is "not verified".
function verify() {
  const top = repo(), cfg = top ? config(top) : {}, command = top && testCommand(top, cfg);
  if (!command) return fail('lessloc verify needs a git repository with a test command');
  const rev = args.find(a => !a.startsWith('--')), commit = rev ? commitOf(top, rev) : commitTree(top, git(top, ['write-tree']));
  if (!commit) return fail(rev ? `lessloc verify cannot find the commit ${rev}` : 'lessloc verify cannot make a commit of the staged state');
  try {
    const r = inCheckout(top, commit, cfg, dir => sh(command, dir, { timeout: cfg.testTimeout * 1000 }));
    record(top, git(top, ['rev-parse', `${commit}^{tree}`]), { test: command, ok: r.status === 0, at: new Date().toISOString(), where: 'clean checkout' });
    console.log(`${r.status === 0 ? 'verified' : 'NOT verified'}: \`${command}\` ${r.status === 0 ? 'passed' : r.status == null ? 'did not finish' : 'failed'} on a clean checkout of ${commit.slice(0, 12)}`);
    const tail = `${r.stdout || ''}${r.stderr || ''}`.trim();
    if (r.status !== 0 && tail) console.log(tail.split('\n').slice(-20).join('\n'));
    return r.status === 0 ? 0 : 1;
  } catch (e) {
    return fail(`NOT verified: the check could not run (${e.message})`, 1);
  }
}

// CI in one command: setup, the tests (recorded for the commit's tree), then the check with the ratchet and required evidence.
function ci() {
  const top = repo();
  if (!top) return fail('lessloc ci needs a git repository');
  const cfg = config(top), command = testCommand(top, cfg);
  if (cfg.setup) {
    const s = sh(cfg.setup, top, { timeout: 1800000 });
    if (s.status !== 0) return fail(`setup \`${cfg.setup}\` failed:\n${`${s.stdout}${s.stderr}`.trim().split('\n').slice(-20).join('\n')}`, 1);
  }
  const t = command ? runTests(top, cfg, command, headTree(top)) : null;
  if (t) console.log(`${t.ok ? 'passed' : 'FAILED'}: ${command}${t.ok || !t.output ? '' : `\n${t.output}`}`);
  // Without a base (a first commit), the whole commit is the change.
  const base = opt('--base') || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : commitOf(top, 'HEAD~1') && 'HEAD~1');
  const flags = ['--ratchet', ...args.filter(a => a === '--strict')];
  if (base) flags.push('--base', base);
  if (command) flags.push('--require-evidence');
  return Math.max(check(flags, { head: true, build: true }), t && !t.ok ? 1 : 0);
}

// The handoff probe: a fresh agent, without this conversation and with lessloc off, is asked in a clean checkout where the
// task's behavior lives. If it cannot name the files the change touched, or needs many turns, the next agent pays the same.
function probe() {
  const top = repo(), cfg = top ? config(top) : {}, task = opt('--task');
  if (!cfg.probe || !task) return fail('lessloc probe needs a "probe" agent command in .lessloc.json (it reads the question on stdin) and --task "<behavior>"');
  const rev = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--task'), commit = rev ? commitOf(top, rev) : commitTree(top, git(top, ['write-tree']));
  const parent = commitOf(top, `${commit}^`) || emptyTree(top), files = git(top, ['diff', '--name-only', parent, commit]).split('\n').filter(f => f && isCode(f));
  const question = `Without changing any files, answer from this repository alone: where is the following behavior implemented, and what existing code would you reuse to change it? Reply with file paths, one per line.\n\nBehavior: ${task}`;
  const r = inCheckout(top, commit, { ...cfg, setup: '' }, dir => sh(cfg.probe, dir, { input: question, env: { ...process.env, LESSLOC: 'off' }, timeout: 600000 }));
  let answer = r.stdout || '', turns = 0, used = 0;
  try {
    const o = JSON.parse(answer), u = o.usage || {};
    [answer, turns, used] = [o.result || '', o.num_turns || 0, (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)];
  } catch { /* a plain-text answer */ }
  const found = files.filter(f => answer.includes(f));
  // Turns are the navigation steps; tokens mostly repeat the agent's own system prompt, so they inform but do not decide.
  const problem = r.status !== 0 ? 'the probe agent did not run, so whether the next agent can find this change is unchecked' : !found.length ? `a fresh agent answered "${clip(answer.replace(/\s+/g, ' ').trim())}", none of the changed files (${files.slice(0, 3).join(', ')}): give the responsibility a findable home and name` : turns > 8 ? `a fresh agent found it but needed ${turns} turns (~${Math.round(used / 1000)}k tokens): the path from behavior to code is too long` : '';
  console.log(problem ? `lessloc probe: ${problem}` : `a fresh agent found it in ${turns || 'a few'} turn(s)${used ? ` (~${Math.round(used / 1000)}k tokens)` : ''}: ${found.join(', ')}`);
  return problem ? 1 : 0;
}

function baseline(quiet = false) {
  const top = repo() || process.cwd(), file = path.join(top, '.lessloc-baseline.json'), now = metrics(auditData(top, config(top))), prev = load(file).metrics, why = opt('--allow-worse');
  const up = prev ? Object.keys(now).filter(k => worse(k, now[k], prev[k])) : [];
  if (up.length && !why) return fail(`refusing to record a worse ${up.map(k => `${k} (${prev[k]} -> ${now[k]})`).join(', ')}: fix it, or pass --allow-worse "<why>"`, 1);
  fs.writeFileSync(file, `${JSON.stringify({ version: VERSION, metrics: now, ...(up.length ? { raised: { metrics: up, why, date: new Date().toISOString().slice(0, 10) } } : {}) }, null, 1)}\n`);
  if (!quiet) console.log(`baseline written to ${file}`);
  return 0;
}

// Is lessloc working here: what runs, what failed, what it costs.
function doctor() {
  const out = [], line = (state, msg, fix) => out.push(`${{ ok: '✓', warn: '!', bad: '✗' }[state]} ${msg}${state !== 'ok' && fix ? ` (${fix})` : ''}`), top = repo();
  line(Number(process.versions.node.split('.')[0]) >= 20 ? 'ok' : 'bad', `node ${process.versions.node}`, 'lessloc needs node 20 or newer');
  // Every hook starts Node, and a build without its startup snapshot (common in Linux distribution packages) spends about
  // 0.2 s of CPU on each start before lessloc runs.
  if (process.config.variables.node_use_node_snapshot === false) line('warn', `this Node (${process.execPath}) was built without its startup snapshot, so every hook starts several times slower`, 'install Node from nodejs.org or a version manager such as nvm or fnm');
  line(top ? 'ok' : 'bad', top ? `git repository ${top}` : 'not in a git repository', 'reviews, checks and evidence need git');
  if (top) {
    const cfg = config(top), command = testCommand(top, cfg), dir = stateDir(top), cost = costs(top);
    line('ok', `lessloc's own files: ${dir} (outside the repository)`);
    line(cfg.problems.length ? 'bad' : 'ok', cfg.problems.length ? `.lessloc.json: ${cfg.problems.join('; ')}` : fs.existsSync(path.join(top, '.lessloc.json')) ? '.lessloc.json is valid' : 'no .lessloc.json, so the defaults apply', 'fix the settings named');
    line(command ? 'ok' : 'warn', command ? `test command: ${command}${cfg.test ? '' : ' (discovered)'}` : 'no test command', 'set "test" in .lessloc.json so agents and CI can verify');
    const last = Object.entries(cost).map(([e, xs]) => [e, xs.at(-1)?.[2] || 0]).sort((a, b) => b[1] - a[1])[0];
    line(last?.[1] ? 'ok' : 'warn', last?.[1] ? `hooks last ran ${ago(Date.now() - last[1])} (${last[0]})` : 'no lessloc hook has run in this repository yet', `${CLI} init lists your agent tools and the command that sets up each; then start a new session`);
    const errors = lines(top, 'errors.log');
    line(errors.length ? 'bad' : 'ok', errors.length ? `${errors.length} hook error(s), latest: ${clip(errors.at(-1), 160)}` : 'no hook errors', `details in ${path.join(dir, 'errors.log')}; LESSLOC_DEBUG=1 prints them live`);
    const block = RULES_BLOCK.exec(read(top, 'AGENTS.md') || '')?.[0].replace(/<!-- \/?lessloc -->/g, '').trim();
    if (block && block !== STANDARD) line('warn', 'AGENTS.md holds the rules of an earlier lessloc, so agents get both', `${CLI} init --rules`);
    const hooks = path.resolve(top, git(top, ['rev-parse', '--git-path', 'hooks'])), installed = Object.keys(GATES).filter(h => (read(hooks, h) || '').includes(SELF));
    line(installed.length === 2 ? 'ok' : 'warn', installed.length === 2 ? 'git hooks (this clone only): commit gate and trailers' : installed.length ? `git hooks: only the ${installed[0] === 'pre-commit' ? 'commit gate' : 'trailers hook'} is installed; init prints the line to add to your own hook` : 'git hooks not installed', `${CLI} init`);
    const held = load(path.join(top, '.lessloc-baseline.json'));
    line(!held.metrics || held.version === VERSION ? 'ok' : 'warn', !held.metrics ? 'ratchet: CI compares each change with its base commit' : held.version === VERSION ? 'ratchet: committed baseline' : `ratchet baseline is from lessloc ${held.version || '(version not recorded)'}, so it only informs`, `${CLI} baseline, then commit it`);
    for (const [e, xs] of Object.entries(cost)) out.push(`  ${e}: median ${xs.map(x => x[0]).sort((a, b) => a - b)[xs.length >> 1]} ms, ~${xs.map(x => x[1]).sort((a, b) => a - b)[xs.length >> 1]} tokens added (${xs.length} run${xs.length === 1 ? '' : 's'})`);
  }
  // Each agent tool: set up or not, whether its installed hooks answer, and when they last ran here (cost.log names the host).
  const last = {};
  for (const l of top ? lines(top, 'cost.log') : []) {
    const [, , , at, host = 'claude'] = l.split(' ');
    last[host] = Number(at);
  }
  for (const [state, msg, fix] of health(last)) state === 'info' ? out.push(`  ${msg}`) : line(state, msg, fix);
  console.log(out.join('\n'));
  return out.some(l => l.startsWith('✗')) ? 1 : 0;
}

// prepare-commit-msg: what was verified at exactly this commit's state and what was left open, as git trailers any later agent
// reads without lessloc. Reuses the pre-commit check of the same tree instead of reviewing twice.
function trailers() {
  const [file, source] = args, top = repo();
  if (!top || !file || /^(merge|squash)$/.test(source || '')) return 0;
  const cfg = config(top), msg = fs.readFileSync(file, 'utf8'), mode = cfg.trailers;
  // A commit's message keeps what a later reader needs: what changed and why. The diff already lists the files: a message
  // that recaps them one by one says nothing the history does not.
  const recap = msg.split('\n').filter(l => /^\s*[-*]\s+[\w./-]+\.\w+\b/.test(l)).length;
  if (recap >= 5) console.error(`This commit message lists ${recap} files, which the diff already shows; say what changed and why instead.`);
  if (mode === 'off' || /^Lessloc-Verified:/m.test(msg)) return 0;
  const tree = git(top, ['write-tree']), cached = load(path.join(stateDir(top), 'staged.json'));
  let { verified, open, unchecked: gaps } = cached.tree === tree ? cached : {};
  if (!verified) {
    const from = commitOf(top, 'HEAD') || emptyTree(top), list = changes(top, from, tree), F = review(top, list, cfg, { from, to: tree });
    [verified, open, gaps] = [verifiedAt(top, tree, cfg), F.map(f => clip(fmt(f), 140)), unchecked(cfg, top, list)];
  }
  // One line by default, so a shared history stays readable; "all" adds what was left open and what was not checked.
  const add = [`Lessloc-Verified: ${verified}`, ...(mode !== 'all' ? [] : [...(open.length ? [`Lessloc-Open: ${open.length} (${open.slice(0, 2).join('; ')}${open.length > 2 ? '; ...' : ''})`] : []), ...gaps.filter(g => !/^tests/.test(g)).slice(0, 2).map(g => `Lessloc-Unchecked: ${g}`)])];
  const cut = msg.search(/^#/m), body = cut < 0 ? msg : msg.slice(0, cut), comments = cut < 0 ? '' : msg.slice(cut);
  fs.writeFileSync(file, `${body.trimEnd()}\n\n${add.join('\n')}\n${comments && `\n${comments}`}`);
  return 0;
}

// Where CI gets lessloc from: LESSLOC_SOURCE, or the repository lessloc's package.json names. Never a guessed package name,
// because anyone could publish one.
function workflow() {
  const repoUrl = load(new URL('./package.json', import.meta.url)).repository, source = process.env.LESSLOC_SOURCE || (repoUrl ? `github:${String(repoUrl.url || repoUrl).replace(/^.*github\.com[/:]|\.git$/g, '')}#v${VERSION}` : '');
  const yaml = `name: lessloc\non: [pull_request]\njobs:\n  lessloc:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          fetch-depth: 0\n      - uses: actions/setup-node@v7\n        with:\n          node-version: 24\n      - run: npx --yes ${source || '<lessloc source>'} ci --base origin/\${{ github.base_ref }}\n`;
  return { source, yaml };
}

// The git hooks lessloc installs. Each line runs only where lessloc is installed at that path, so a hook copied to another
// machine or account is a no-op instead of a blocked commit.
const guard = cmd => `if command -v node >/dev/null 2>&1 && [ -f "${SELF}" ]; then ${cmd}; fi`;
const GATES = { 'pre-commit': guard(`node "${SELF}" check --staged --gate || exit 1`), 'prepare-commit-msg': guard(`node "${SELF}" trailers "$1" "$2"`) };
const GATE_NAME = { 'pre-commit': 'commit gate', 'prepare-commit-msg': 'trailers' };
const RULES_BLOCK = /\n*<!-- lessloc -->[\s\S]*?<!-- \/lessloc -->\n?/;
// A hook file lessloc wrote holds nothing but its own lines.
const ownHook = t => t.split('\n').every(l => !l.trim() || l.startsWith('#!') || l.includes('lessloc'));

// Setup writes nothing into the repository unless asked. Git hooks go to this clone's .git/hooks, and only into hook files lessloc
// created; a shared or hand-written hook gets the line to add instead. Files the whole team shares (rules for every agent, team
// policy, a baseline, a CI workflow) each need their flag. Hooks for other agent tools go to the user's home, never the project,
// except Copilot's with --repo: the cloud agent reads hooks only from the repository.
function init() {
  const top = repo();
  if (!top) return fail('lessloc init needs a git repository');
  // Hook commands put lessloc's path in double quotes for sh, cmd and PowerShell, inside which these characters still act.
  const unquotable = process.platform === 'win32' ? ['"', '$', '`'] : ['"', '$', '`', '\\'], bad = unquotable.find(c => ROOT.includes(c));
  if (bad) return fail(`lessloc init cannot set up hooks from ${ROOT}: hook commands cannot quote the ${bad} in it. Move lessloc to a folder whose path has none of ${unquotable.join(' ')}, then run init again`);
  const cfg = config(top), done = [], manual = [], set = [], flag = f => args.includes(f);
  const hooksDir = path.resolve(top, git(top, ['rev-parse', '--git-path', 'hooks'])), common = path.resolve(top, git(top, ['rev-parse', '--git-common-dir']));
  const local = !path.relative(common, hooksDir).startsWith('..');
  for (const [name, line] of Object.entries(GATES)) {
    const p = path.join(hooksDir, name);
    const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (local && (cur == null || ownHook(cur))) {
      fs.mkdirSync(hooksDir, { recursive: true });
      fs.writeFileSync(p, `#!/bin/sh\n${line}\n`);
      fs.chmodSync(p, 0o755);
      set.push(name);
    } else if (cur?.includes(line)) set.push(name);
    else manual.push(`add to ${path.relative(top, p)}: ${line}`);
  }
  done.push(set.length ? `git hooks in this clone only (.git/hooks): ${set.map(n => GATE_NAME[n]).join(' and ')}` : '');
  if (flag('--rules')) {
    const prev = read(top, 'AGENTS.md') || '', block = `<!-- lessloc -->\n${STANDARD}\n<!-- /lessloc -->\n`;
    fs.writeFileSync(path.join(top, 'AGENTS.md'), RULES_BLOCK.test(prev) ? prev.replace(RULES_BLOCK, m => (m.startsWith('\n') ? '\n\n' : '') + block) : `${prev ? prev.trimEnd() + '\n\n' : ''}${block}`);
    const claude = path.join(top, 'CLAUDE.md');
    if (fs.existsSync(claude) && !fs.readFileSync(claude, 'utf8').includes('@AGENTS.md')) fs.appendFileSync(claude, '\n@AGENTS.md\n');
    done.push('rules in AGENTS.md, for every agent that reads it (commit it if the team agrees)');
  }
  if (flag('--config')) {
    if (fs.existsSync(path.join(top, '.lessloc.json'))) done.push('.lessloc.json already exists, so it was left as it is');
    else {
      const command = testCommand(top, cfg);
      fs.writeFileSync(path.join(top, '.lessloc.json'), `${JSON.stringify(command ? { test: command } : {}, null, 2)}\n`);
      done.push(`.lessloc.json${command ? ` with test command \`${command}\`` : ' (add a "test" command)'}`);
    }
  }
  if (flag('--baseline')) done.push(fs.existsSync(path.join(top, '.lessloc-baseline.json')) ? '.lessloc-baseline.json already exists, so it was left as it is (lessloc baseline records it again)' : (baseline(true), '.lessloc-baseline.json: a fixed ratchet line (commit it)'));
  if (flag('--ci')) {
    const { source, yaml } = workflow(), f = path.join(top, '.github', 'workflows', 'lessloc.yml');
    if (source && !fs.existsSync(f)) fs.mkdirSync(path.dirname(f), { recursive: true }), fs.writeFileSync(f, yaml), done.push(`CI workflow ${path.relative(top, f)} (commit it)`);
    else if (source) done.push(`${path.relative(top, f)} already exists, so it was left as it is`);
    else done.push(`CI workflow not written: lessloc's package.json names no repository to install it from. Set LESSLOC_SOURCE (for example github:<owner>/lessloc#v${VERSION}) and run init --ci again, or add this yourself:\n${yaml}`);
  }
  if (flag('--repo') && !flag('--copilot')) done.push('--repo goes with --copilot, the one tool whose hooks lessloc writes into the repository; nothing written for it');
  else if (flag('--repo')) {
    repoHooks(top, true);
    done.push(`GitHub Copilot hooks in ${path.relative(top, REPO_HOOKS(top))}, for the cloud agent and everyone who works here; commit it to the default branch. They run lessloc from ${path.posix.dirname(CLOUD_ENTRY).replace('$HOME', '~')} and do nothing where it is missing. For the cloud agent, add this step to the copilot-setup-steps job in .github/workflows/copilot-setup-steps.yml:\n    ${cloudStep()}`);
  }
  const command = testCommand(top, cfg);
  console.log([
    ...done.filter(Boolean).map(d => `- ${d}`),
    ...manual.map(m => `- this repository's git hooks are shared or hand-written, so lessloc left them alone; ${m}`),
    command ? `- test command: \`${command}\`` : '- no test command found: add "test" to .lessloc.json so agents and CI can verify',
    `- lessloc's own files stay outside the repository, in ${stateDir(top)}`,
    ['--rules', '--config', '--baseline', '--ci', '--repo'].some(flag) ? '' : '- nothing was written to the repository; shared files are opt-in: --rules (AGENTS.md, for agents without lessloc hooks), --config (.lessloc.json), --baseline, --ci, --copilot --repo',
    ...setup(t => homeFlag(t, flag), flag('--agents')),
  ].filter(Boolean).join('\n'));
  return 0;
}

// Undoes setup for this clone: lessloc's git hook lines (and hook files that held nothing else), the rules block in AGENTS.md,
// and lessloc's own files. Committed settings, a baseline and CI stay: deleting shared files is the team's call. With a tool's
// flag or --agents it takes out that tool's hooks too; outside a repository, only those.
function remove() {
  const top = repo(), flag = f => args.includes(f), wanted = t => homeFlag(t, flag) || flag('--agents');
  if (!top && !TOOLS.some(wanted)) return fail('lessloc remove needs a git repository, or a tool flag such as --agents');
  const tools = teardown(wanted), done = [...(top ? repoTeardown(top, flag) : []), ...tools.done];
  const kept = top ? ['.lessloc.json', '.lessloc-baseline.json', '.github/workflows/lessloc.yml', path.relative(top, REPO_HOOKS(top))].filter(f => fs.existsSync(path.join(top, f))) : [];
  console.log([done.length ? `removed: ${done.join('; ')}` : 'nothing of lessloc\'s to remove', kept.length ? `kept, because they are shared with the team: ${kept.join(', ')}` : '', ...tools.left.map(l => `installed by the tool itself, so remove it there: ${l}`)].filter(Boolean).join('\n'));
  for (const f of tools.failed) console.error(`not removed: ${f}`);
  return tools.failed.length ? 1 : 0;
}
// The repository's part of `remove`.
function repoTeardown(top, flag) {
  const done = [], hooksDir = path.resolve(top, git(top, ['rev-parse', '--git-path', 'hooks']));
  for (const name of Object.keys(GATES)) {
    const p = path.join(hooksDir, name), cur = read(hooksDir, name);
    if (!cur?.includes('lessloc')) continue;
    const rest = cur.split('\n').filter(l => !l.includes('lessloc'));
    if (rest.every(l => !l.trim() || l.startsWith('#!'))) fs.rmSync(p);
    else fs.writeFileSync(p, rest.join('\n'));
    done.push(`git hook ${name}`);
  }
  const agents = read(top, 'AGENTS.md');
  if (agents && RULES_BLOCK.test(agents)) {
    const rest = agents.replace(RULES_BLOCK, '\n').trim();
    if (rest) fs.writeFileSync(path.join(top, 'AGENTS.md'), `${rest}\n`);
    else fs.rmSync(path.join(top, 'AGENTS.md'));
    done.push(rest ? 'rules block in AGENTS.md' : 'AGENTS.md (it held only the rules)');
  }
  if (flag('--repo') && (flag('--copilot') || flag('--agents')) && repoHooks(top, false)) done.push(`GitHub Copilot hooks in ${path.relative(top, REPO_HOOKS(top))}`);
  fs.rmSync(stateDir(top), { recursive: true, force: true });
  done.push('lessloc\'s own files');
  return done;
}

// A tool's flag sets up its hooks in the user's home folder; with --repo, Copilot's go into the repository instead.
const homeFlag = (t, flag) => flag(`--${t.id}`) && !(t.id === 'copilot' && flag('--repo'));
const AGENT_FLAGS = TOOLS.filter(t => t.install).map(t => `[--${t.id}]`).join(' ');
const COMMANDS = { find, catalog, hosts, audit, check, test, verify, ci, probe, baseline: () => baseline(), doctor, init, remove, trailers, version: () => (console.log(VERSION), 0) };
const USAGE = `lessloc ${VERSION}: keeps AI coding agents to the least code that does the job and still works
Usage: lessloc <command> [flags]

  find <words>             existing definitions for a task, by name
  audit [dir] [--json] [--tools]
                           the whole codebase: copies, dead code, junk, comment weight, structure
  check [--staged | --base <ref>] [--ratchet] [--require-evidence] [--strict] [--json] [--github] [--all]
                           review a change (default: the working tree against HEAD); tier-0 findings fail it
  test [-- <command>]      run the tests with compact output; records evidence for this exact state
  verify [<rev>]           run the tests on a clean checkout of a commit (default: the staged state)
  ci [--base <ref>] [--strict]
                           setup, tests, then check --ratchet --require-evidence; GitHub annotations in Actions
  probe --task <behavior> [<rev>]
                           ask a fresh agent where a behavior lives (each run starts an agent session)
  baseline [--allow-worse <why>]
                           record a fixed line for the ratchet in .lessloc-baseline.json
  doctor                   is lessloc working here, and what does it cost
  init [--rules] [--config] [--baseline] [--ci] [--agents] ${AGENT_FLAGS} [--repo]
                           git hooks for this clone; shared files only with their flag; lists the agent tools found, and
                           installs hooks in your home for each one named, or with --agents for all of them; --copilot
                           --repo writes Copilot's hooks into the repository, for its cloud agent
  remove [--agents] ${AGENT_FLAGS} [--repo]
                           undo init for this clone, delete lessloc's own files, and take out the agent tools' hooks named;
                           outside a repository, only those hooks
  catalog [--write]        the pattern catalog's tables (PATTERNS.md); --write is for contributors
  hosts [--markdown] [--write]
                           each agent tool: how it installs and what was verified live; --write is for contributors
  version, --version, -v   print the version

Docs: https://lessloc.org/guide/reference`;
// No command, or a request for help, prints the usage, also after a command (`remove --help` removes nothing); a command
// lessloc does not have cannot start.
const HELP = ['help', '--help', '-h'], name = { '--version': 'version', '-v': 'version' }[cmd] ?? cmd, run = Object.hasOwn(COMMANDS, name) && COMMANDS[name];
if (!cmd || HELP.includes(cmd) || (run && args.some(a => HELP.slice(1).includes(a)))) console.log(USAGE);
else if (run) process.exitCode = await run();
else process.exitCode = fail(`lessloc: unknown command "${cmd}"\n\n${USAGE}`);
