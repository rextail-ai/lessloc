// Evidence from what the host saw: the agent's own test runs, recognized in its shell commands, with their result read from
// the host (its failure event or exit code, or the runner's summary where the host reports no exit code). lessloc never runs
// the tests itself. A wrong "ran everything" or "passed" lets unverified work through, so every rule here errs toward "not shown".
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// A shell command as its lists and pipelines, the way bash runs them: quotes, escapes, comments, line continuations and
// heredoc bodies never split it. Each part is one pipeline (its stages) and the operator after it: && || ; \n &, or ''.
function parts(cmd) {
  const s = String(cmd || '').replace(/\\\r?\n/g, ' '), out = [], bodies = [];
  let cur = '', stages = [], i = 0;
  const stage = () => (stages.push(cur.trim()), (cur = ''));
  const part = sep => {
    stage();
    if (stages.some(Boolean)) out.push({ stages: stages.filter(Boolean), sep });
    stages = [];
  };
  while (i < s.length) {
    const ch = s[i], next = s[i + 1];
    if (ch === "'") {
      const j = s.indexOf("'", i + 1), end = j < 0 ? s.length : j + 1;
      cur += s.slice(i, end);
      i = end;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      cur += s.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '\\') {
      cur += s.slice(i, i + 2);
      i += 2;
    } else if (ch === '#' && (i === 0 || /[\s;&|(]/.test(s[i - 1]))) {
      while (i < s.length && s[i] !== '\n') i++;
    } else if (ch === '<' && next === '<' && s[i + 2] !== '<' && /^<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/.test(s.slice(i))) {
      const m = /^<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/.exec(s.slice(i));
      bodies.push({ word: m[3], tabs: m[1] === '-' });
      cur += m[0];
      i += m[0].length;
    } else if (ch === '\n') {
      part('\n');
      i++;
      // A heredoc's body is the command's input, never commands of its own.
      for (const b of bodies.splice(0)) {
        while (i < s.length) {
          const eol = s.indexOf('\n', i), line = s.slice(i, eol < 0 ? s.length : eol);
          i = eol < 0 ? s.length : eol + 1;
          if ((b.tabs ? line.replace(/^\t+/, '') : line).replace(/\r$/, '') === b.word) break;
        }
      }
    } else if (ch === '&' && next === '&') {
      part('&&');
      i += 2;
    } else if (ch === '|' && next === '|') {
      part('||');
      i += 2;
    } else if (ch === ';') {
      part(';');
      i++;
    } else if (ch === '|') {
      stage();
      i += next === '&' ? 2 : 1;
    } else if (ch === '&' && s[i - 1] !== '>' && next !== '>') {
      part('&');
      i++;
    } else if ((ch === '(' && s[i - 1] !== '$') || ch === ')' || ((ch === '{' || ch === '}') && /^[\s;]?$/.test(s[i - 1] || '') && /^\s?$/.test(next || ''))) {
      cur += ' ';
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  part('');
  return out;
}
// A stage's words, unquoted, without its redirections (`2>&1`, `> log`, `<in`): those are not arguments.
function words(stage) {
  const out = [], ws = stage.match(/'[^']*'|"(?:\\.|[^"\\])*"|\S+/g) || [];
  for (let i = 0; i < ws.length; i++) {
    if (/^\d*(?:>>?|<|&>>?|>&|<&)$/.test(ws[i])) i++;
    else if (!/^\d*(?:>>?|<|&>>?|>&|<&)\S/.test(ws[i])) out.push(ws[i].replace(/^(['"])([\s\S]*)\1$/, '$2'));
  }
  return out;
}

// Commands that only read, change folder or set up the shell: what may run around a test run without changing the tree.
const READ_ONLY = /^\s*(ls|cat|head|tail|less|grep|egrep|rg|ag|find|fd|tree|wc|file|stat|pwd|echo|printf|which|type|date|du|df|diff|cmp|sort|uniq|cut|jq|true|false|:|cd|export|set|source|\.|deactivate|git\s+(status|log|diff|show|branch|blame|grep|rev-parse|ls-files|ls-tree|remote))(\s|$)/;
// Linters and type checkers that only report (no fix or write option): run after the tests, they leave the code as tested.
const LINTERS = /^\s*(?:(?:npx|bunx|pnpm\s+exec|yarn|uv\s+run|poetry\s+run|pipenv\s+run|python[\d.]*\s+-m)\s+)?(?:ruff\s+check(?!.*\s--(?:fix|unsafe-fixes|fix-only)\b)|(?:mypy|pyright|flake8|pylint|pyflakes|pycodestyle)(?=\s|$)|(?:black|isort)(?=.*\s--(?:check|check-only|diff)\b)|eslint(?!.*\s--fix\b)(?=\s|$)|prettier(?=.*\s(?:--check|-c|--list-different|-l)(?:\s|$))|tsc(?=.*\s--noEmit\b)|go\s+vet(?=\s|$)|cargo\s+(?:check|clippy)(?!.*\s--fix\b)(?=\s|$))/;
export const readOnly = cmd => !/(^|[^<>&\d])>>?\s*(?!&|\/dev\/null)\S|\s-(delete|exec|i)\b|\btee\b|<</.test(cmd) && parts(cmd).every(p => p.stages.every(st => READ_ONLY.test(st) || LINTERS.test(st)));

// Wrappers that run the command after them: variable assignments, env, time, timeout, nice, and project runners.
const WRAPPER = /^(?:[A-Za-z_]\w*=\S*\s+|env(?:\s+-\S+)*\s+|time\s+|timeout(?:\s+-\S+)*\s+\S+\s+|nice(?:\s+-n\s*\S+)?\s+|exec\s+|command\s+|xvfb-run(?:\s+-\S+)*\s+|(?:uv|poetry|pipenv|pdm|rye)\s+run(?:\s+--\S+(?:=\S+)?)*\s+|hatch\s+run\s+(?:\S+:)?|npx(?:\s+--?\S+)*\s+|bunx\s+|(?:pnpm|yarn)\s+(?:exec|dlx)\s+|(?:pnpm|yarn)\s+(?=(?:jest|vitest|mocha|tsx|ts-node)\b))/;
const COV = String.raw`(?:coverage\s+run\s+(?:--\S+\s+)*-m\s+)?`;
// The interpreter with its own options before `-m`: `python -I -m pytest`, `python3 -X dev -m unittest`.
const PY = String.raw`(?:python[\d.]*|py)(?:\s+-(?:[bBdEiIOPqRsSuvx]+|[WX]\s*\S+))*`;
// Each runner, by family: runs in one family can stand for one another, and pytest also runs unittest's tests. A tool that
// takes its task among other words (make, gradle, maven, go, node) is matched by the command, and its task word is dropped
// from the arguments, so options written before the task are judged too.
const RUNNERS = [
  ['pytest', new RegExp(String.raw`^(?:\S*\/)?(?:${PY}\s+-m\s+${COV}pytest|coverage\s+run\s+(?:--\S+\s+)*-m\s+pytest|py\.test|pytest)(?=\s|$)`)],
  ['unittest', new RegExp(String.raw`^(?:\S*\/)?(?:${PY}\s+-m\s+${COV}unittest|coverage\s+run\s+(?:--\S+\s+)*-m\s+unittest)(?=\s|$)`)],
  ['tox', /^tox(?=\s|$)/], ['nox', /^nox(?=\s|$)/],
  ['npm-test', /^(?:npm|yarn|pnpm)\s+(?:run\s+)?test(?=\s|$)|^bun\s+run\s+test(?=\s|$)/],
  ['bun', /^bun\s+test(?=\s|$)/],
  ['jest', /^(?:\S*\/)?jest(?=\s|$)/], ['vitest', /^(?:\S*\/)?vitest(?:\s+run)?(?=\s|$)/], ['mocha', /^(?:\S*\/)?mocha(?=\s|$)/],
  ['cargo', /^cargo(?:\s+\+\S+)?\s+(?:test|nextest\s+run)(?=\s|$)/], ['dotnet', /^dotnet\s+test(?=\s|$)/],
  ['rspec', /^(?:bundle\s+exec\s+)?rspec(?=\s|$)/], ['ctest', /^ctest(?=\s|$)/], ['deno', /^deno\s+test(?=\s|$)/],
  ['phpunit', /^(?:\S*\/)?phpunit(?=\s|$)/], ['mix', /^mix\s+test(?=\s|$)/],
  ['node-test', /^node(?=\s)/, w => w === '--test'], ['go', /^go(?=\s)/, w => w === 'test'],
  ['make', /^make(?=\s)/, w => /^(test|check)$/.test(w)], ['gradle', /^(?:\.\/)?gradlew?(?=\s)/, w => /^(?::\S+:)?(test|check)$/.test(w)],
  ['mvn', /^(?:\.\/)?mvnw?(?=\s)/, w => /^(test|verify)$/.test(w)],
];
const COVERS = { unittest: ['pytest', 'unittest'] };
function family(cmd) {
  let head = String(cmd || '').trim();
  while (WRAPPER.test(head)) head = head.replace(WRAPPER, '');
  for (const [name, re, task] of RUNNERS) {
    const m = re.exec(head);
    if (!m) continue;
    const args = words(head.slice(m[0].length));
    if (!task) return { name, runner: m[0], args };
    const at = args.findIndex(task);
    if (at >= 0) return { name, runner: `${m[0]} ${args[at]}`, task: args[at], args: args.filter((_, i) => i !== at) };
  }
  return null;
}

// Per runner: arguments that make a run cover nothing (listing, compiling, skipping, rewriting expectations, help), arguments
// that select a part, options whose next word is their value, and whether a bare path or name selects a part.
const R = (...xs) => w => xs.some(x => (typeof x === 'string' ? x === w : x.test(w)));
const HELP = ['-h', '--help', '--version'];
const SPEC = {
  pytest: { none: R(...HELP, '-V', '--collect-only', '--co', '--fixtures', '--markers', '--setup-plan', '--setup-only'), part: R(/^-k/, '-m', /^--deselect/, /^--ignore/, '--lf', '--last-failed', '--sw', '--stepwise', '--testmon', '--picked'), valued: R('-n', '-p', '-c', '-o', '-W', '-r', '--rootdir', '--maxfail', '--durations', '--timeout', '--import-mode', '--basetemp', '--junitxml', '--cov', '--cov-report', '--cov-config', '--tb', '--confcutdir', '--log-level'), paths: true },
  jest: { none: R(...HELP, '-v', '--listTests', '--showConfig', '--clearCache', '-u', '--updateSnapshot', '--ci=false'), part: R('-t', /^--testNamePattern/, '-o', '--onlyChanged', /^--changedSince/, /^--testPathPattern/, '--findRelatedTests', '--lastCommit', /^--shard/), valued: R('-c', '--config', '--reporters', '--maxWorkers', '-w'), paths: true },
  vitest: { none: R(...HELP, '-v', 'list', '-u', '--update'), part: R('-t', /^--testNamePattern/, /^--changed/, /^--project/, 'related', /^--shard/), valued: R('-c', '--config', '--reporter', '--pool', '--root', '--dir'), paths: true },
  mocha: { none: R(...HELP, '--dry-run'), part: R('-g', /^--grep/, '-f', '--fgrep', /^--spec/), valued: R('-r', '--require', '--reporter', '-R', '--timeout', '-t', '--config'), paths: true },
  'node-test': { none: R(...HELP), part: R(/^--test-name-pattern/, '--test-only', /^--test-skip-pattern/, /^--test-shard/), valued: R(), paths: true },
  bun: { none: R(...HELP, '-u', '--update-snapshots'), part: R('-t', /^--test-name-pattern/, '--only'), valued: R('--timeout', '--preload'), paths: true },
  go: { none: R('-c', '-list', /^-list=/, '-h', '-help', '-n'), part: R(/^-run/, /^-skip/, /^-short$/), valued: R('-p', '-parallel', '-timeout', '-count', '-coverprofile', '-o', '-tags', '-bench', '-benchtime', '-cpu', '-exec', '-C'), paths: true, dir: '-C' },
  cargo: { none: R(...HELP, '--no-run'), part: R('-p', /^--package/, '--test', '--lib', '--bin', '--bins', '--doc', '--example', '--examples', '--bench', '--benches', '-E', /^--exclude/, '--ignored'), valued: R('--features', '-F', '--target', '-j', '--jobs', '--manifest-path', '--profile', '--config'), paths: true, listAfterDashes: true, dir: '--manifest-path' },
  'npm-test': { none: R(), part: R('-w', /^--workspace(=|$)/, /^--filter/, /^--testPathPattern/, /^--testNamePattern/, '-t', /^--grep/, '-u', '--updateSnapshot', /^--changed/, '--onlyChanged', '-o'), valued: R('--prefix', '-C', '--dir', '--cwd'), paths: true, dir: ['--prefix', '-C', '--dir', '--cwd'] },
  make: { none: R('-n', '--dry-run', '--just-print', '-q', '--question'), part: R(/^\w+=/), valued: R('-C', '-f', '-j', '--directory', '--file'), paths: false, dir: ['-C', '--directory'] },
  gradle: { none: R(...HELP, '--dry-run', '-m', '-x', '--exclude-task'), part: R('--tests'), valued: R('-p', '--project-dir'), paths: false, dir: ['-p', '--project-dir'] },
  mvn: { none: R('-DskipTests', /^-DskipTests=true$/, /^-Dmaven\.test\.skip(=true)?$/), part: R(/^-Dtest=/, /^-Dit\.test=/, '-pl', '--projects'), valued: R('-f', '-s', '--file'), paths: false, dir: ['-f', '--file'] },
  dotnet: { none: R(...HELP, '--list-tests', '-t'), part: R(/^--filter/), valued: R('-c', '--configuration', '-f', '--framework', '--logger', '-l'), paths: true },
  rspec: { none: R(...HELP, '--dry-run'), part: R('--tag', '-t', '-e', '--example', '--only-failures', '--next-failure'), valued: R('-r', '--require', '-f', '--format', '-o', '--out'), paths: true },
  ctest: { none: R('-N', '--show-only'), part: R('-R', '-L', '-E', '-I', '--tests-regex', '--label-regex', '--rerun-failed'), valued: R('-j', '-C', '--test-dir', '--output-on-failure'), paths: false, dir: '--test-dir' },
  deno: { none: R(...HELP, '--no-run', '--doc-only'), part: R(/^--filter/), valued: R('--config', '-c'), paths: true },
  phpunit: { none: R(...HELP, '--list-tests', '--list-suites', '--list-groups'), part: R(/^--filter/, /^--group/, /^--testsuite/), valued: R('-c', '--configuration', '--bootstrap'), paths: true },
  mix: { none: R('--help'), part: R('--only', '--failed', '--stale', '--include'), valued: R('--seed', '--max-failures'), paths: true },
  tox: { none: R(...HELP, '-l', '--listenvs', '-a', '--listenvs-all', '--notest'), part: R(), valued: R('-e', '-c'), paths: false, dir: '-c' },
  nox: { none: R(...HELP, '-l', '--list'), part: R(), valued: R('-s', '--session', '-k', '-f'), paths: false },
  configured: { none: R(...HELP), part: R(), valued: R(), paths: true },
};
// A bare argument that still means the whole suite: the project root or its test folder, or Go's ./...
const SUITE = /^(\.|\.\/|\.\.\.|\.\/\.\.\.|tests?\/?|specs?\/?|testing\/?|\.\/tests?\/?|\.\/specs?\/?)$/;
function coverage(f) {
  const spec = SPEC[f.name] || SPEC.configured, at = f.args.indexOf('--'), own = at < 0 ? f.args : f.args.slice(0, at), passed = at < 0 ? [] : f.args.slice(at + 1);
  if (own.some(spec.none) || (spec.listAfterDashes && passed.includes('--list')) || (f.name !== 'npm-test' && passed.some(spec.none))) return 'none';
  if (f.name === 'gradle' && /^:\S+:/.test(f.task || '')) return 'targeted';
  // `tox -e lint` and `nox -s docs` run no tests: an environment counts only when its name says it tests.
  const envs = (f.name === 'tox' || f.name === 'nox') && own.flatMap((w, i) => (/^(-e|-s|--session)$/.test(w) ? (own[i + 1] || '').split(',') : []));
  if (envs?.length && !envs.some(e => /^(py\d*|pypy\d*|tests?|unit|integration)(\b|-|$)/.test(e))) return 'none';
  if (own.some(spec.part)) return 'targeted';
  const bare = [];
  for (let i = 0; i < own.length; i++) {
    if (spec.valued(own[i])) i++;
    else if (!own[i].startsWith('-')) bare.push(own[i]);
  }
  if (f.name === 'unittest') {
    const value = flag => own[own.indexOf(flag) + 1];
    if (bare[0] !== 'discover') return bare.length || own.includes('-k') ? 'targeted' : 'full';
    return (bare[1] && !SUITE.test(bare[1])) || (own.includes('-p') && value('-p') !== 'test*.py') || (own.includes('-s') && !SUITE.test(value('-s') || '')) || own.includes('-k') ? 'targeted' : 'full';
  }
  if (spec.paths && bare.some(w => !SUITE.test(w))) return 'targeted';
  // After `--`, words go to the runner itself or the runner a script calls: a name, a path or a selecting flag there selects.
  if (passed.some(w => /^(--listTests|--collect-only|--co|--showConfig|--clearCache|--list|--setup-only)$/.test(w))) return 'none';
  if (passed.some(w => (!w.startsWith('-') && !SUITE.test(w)) || /^(-t|-k\S*|-g|--grep|--testNamePattern|--testPathPattern|--filter|-m|--exact|--ignored|--skip|-u|--updateSnapshot)(=|$)/.test(w))) return 'targeted';
  return 'full';
}
// Whether a Python run that names its tests (`unittest tests.test_shop`, `pytest tests/test_a.py tests/test_b.py`, `discover
// -p "test_*.py"`) names every test file the project has (`files`, from the top): then it ran the whole suite. A filter by
// name or mark, or a single test, still selects a part.
export function coversEvery(run, files) {
  const tests = files.filter(f => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(f)), args = run.args || [], valued = SPEC[run.family]?.valued ?? (w => /^-[kpst]$/.test(w));
  if (!tests.length || !['unittest', 'pytest'].includes(run.family) || args.some(w => /^-[km]$|^-k\S|::|^--(deselect|ignore|lf|last-failed|sw|stepwise)/.test(w))) return false;
  const bare = args.filter((w, i) => !w.startsWith('-') && !(i && valued(args[i - 1])));
  if (run.family === 'unittest' && bare[0] === 'discover') {
    const flag = (f, n) => (args.includes(f) ? args[args.indexOf(f) + 1] : bare[n]), dir = String(flag('-s', 1) || '.').replace(/^\.\/?|\/$/g, '');
    const name = new RegExp(`^${String(flag('-p', 2) || 'test*.py').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    return tests.every(t => (!dir || t.startsWith(`${dir}/`)) && name.test(t.split('/').pop()));
  }
  const paths = bare.map(w => (run.family === 'unittest' && !/[/\\]|\.py$/.test(w) ? w.replace(/\./g, '/') : w.replace(/\/$/, '')));
  return paths.length > 0 && tests.every(t => paths.some(p => t === p || t === `${p}.py` || t.startsWith(`${p}/`)));
}
// The folders an option points a runner at (`make -C x`, `npm --prefix x`, `cargo --manifest-path x/Cargo.toml`).
function dirs(f) {
  const spec = SPEC[f.name], names = [spec?.dir || []].flat(), out = [];
  f.args.forEach((w, i) => {
    for (const n of names) {
      if (w === n && f.args[i + 1]) out.push(f.args[i + 1]);
      else if (w.startsWith(`${n}=`)) out.push(w.slice(n.length + 1));
    }
  });
  return out.map(d => (/\.(toml|xml|ini|cfg)$/.test(d) ? d.replace(/[^/]*$/, '') || '.' : d));
}

// Pipeline stages that may rewrite lines: a summary seen after them can be one they made (`cut -d, -f2` turns "1 failed, 21
// passed in 0.1s" into a pass), so a run piped through them can only show a failure. Stages that keep or drop whole lines
// (grep, head, tail, sort, uniq) cannot print a summary the runner did not.
const FILTERS = /^(sed|g?awk|mawk|cut|jq|wc|tr|perl|ruby|python[\d.]*|node|xargs)(\s|$)|^(grep|egrep|fgrep|rg)\b.*\s(-[a-zA-Z]*o[a-zA-Z]*|--only-matching)(\s|$)|^(head|tail)\b.*\s(-c\S*|--bytes\S*)(\s|$)/;
// A shell command's test run, or null when it runs none: its runner and family; whether the command's exit status is the
// runner's (`masked`: piped into another command without pipefail, or a ; || newline or & follows it); whether its output may
// have lost the summary (`filtered`); whether it went to the background; whether it may not have run at all (`maybeSkipped`,
// after `x ||`); whether it shares its exit status with other commands (`chained` by &&); what it covered; and the commands
// before and after it, so the caller can tell which tree it ran on.
export function testRun(cmd, configured) {
  const runs = testRuns(cmd, configured);
  // `pytest tests/a.py && pytest`: the whole-suite run speaks for the command.
  return runs.find(r => r.scope === 'full') ?? runs[0] ?? null;
}
// Every test run of a shell command, in order.
export function testRuns(cmd, configured) {
  const ps = parts(cmd), conf = String(configured || '').trim();
  // A command some hosts wrap in a shell of its own: `bash -lc '…'`.
  const wrapped = ps.length === 1 && ps[0].stages.length === 1 && /^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/.exec(ps[0].stages[0]);
  if (wrapped) return testRuns(wrapped[2], configured);
  const runs = [];
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i], head = p.stages[0];
    // The project's own test command runs the whole suite as written; only arguments added to it can narrow it.
    const f = conf && (head === conf || head.startsWith(`${conf} `)) ? { name: family(conf)?.name || 'configured', runner: conf, args: words(head.slice(conf.length)) } : family(head);
    if (!f) continue;
    const scope = coverage(f);
    if (scope === 'none') continue;
    const earlier = ps.slice(0, i), later = ps.slice(i).map(x => x.sep).filter(Boolean);
    const pipefail = earlier.some(x => x.stages.some(st => /\bset\s+(-\w*o\s+pipefail|-o\s+pipefail)\b/.test(st)));
    runs.push({
      runner: f.runner, family: f.name, args: f.args, scope, dirs: dirs(f),
      masked: (p.stages.length > 1 && !pipefail) || later.some(sep => sep !== '&&'),
      filtered: p.stages.slice(1).some(st => FILTERS.test(st)),
      background: p.sep === '&',
      maybeSkipped: earlier.some(x => x.sep === '||'),
      chained: earlier.some(x => x.sep === '&&' && !/^\s*(cd|export|source|\.|set)(\s|$)/.test(x.stages[0])) || later.includes('&&'),
      before: earlier.flatMap(x => x.stages), after: ps.slice(i + 1).flatMap(x => x.stages),
    });
  }
  return runs;
}

// A command's exit code, from the fields hosts report it in. In plain-text output only a header counts (Codex's "Exit code:"
// before "Output:", OpenCode's closing "Command exited with code"), never a line the command itself printed.
export function exitCodeOf(r) {
  if (typeof r === 'string') {
    try {
      const o = JSON.parse(r);
      if (o && typeof o === 'object') return exitCodeOf(o);
    } catch { /* plain text */ }
    const head = /^([\s\S]*?)^Output:/m.exec(r)?.[1] ?? r.split('\n')[0];
    const m = /^(?:Exit code:\s*(\d+)|Process exited with code (\d+))/m.exec(head);
    return m ? Number(m[1] ?? m[2]) : null;
  }
  const code = r?.exit_code ?? r?.exitCode ?? r?.exit ?? r?.metadata?.exit_code ?? r?.metadata?.exit;
  if (typeof code === 'number') return code;
  const tail = Array.isArray(r?.content) ? /^Command exited with code (\d+)\.?\s*$/m.exec(r.content.map(x => x?.text || '').join('\n')) : null;
  return tail ? Number(tail[1]) : null;
}
// The text a host returned for a command, whatever its shape: a string (maybe JSON), stdout and stderr, or content parts.
function textOf(r) {
  if (r == null) return '';
  if (typeof r === 'string') {
    try {
      const o = JSON.parse(r);
      if (o && typeof o === 'object') return textOf(o);
    } catch { /* plain text */ }
    return r;
  }
  if (Array.isArray(r)) return r.map(textOf).join('\n');
  const own = [r.stdout, r.stderr, r.output, r.metadata?.output, r.error, r.result].filter(x => typeof x === 'string');
  if (Array.isArray(r.content)) own.push(r.content.map(x => (typeof x === 'string' ? x : x?.text || '')).join('\n'));
  return own.join('\n');
}
// Each runner's verdict lines: a failure, and a pass that speaks for the whole run. One package's or one test's `ok` does not,
// nor does a pass printed by some other command, so a runner is judged only by lines in its own format. A line the runner
// starts is matched only where a line starts, not inside a test name or a log line that quotes it.
const SUMMARY = {
  pytest: [/\b[1-9]\d* (?:subtests? )?(?:failed|errors?)\b.* in [\d.]+s\b|^(?:FAILED|ERROR) [\w./-]+(?:::|\s-\s)|Coverage failure|FAIL Required test coverage/m, /\b\d+ passed(?:, \d+ (?:subtests? (?:passed|skipped)|skipped|deselected|xfailed|xpassed|warnings?))* in [\d.]+s\b/],
  unittest: [/^FAILED \((?:failures|errors)=\d+/m, /^Ran \d+ tests? in [\d.]+s\s*\n\s*\nOK\b/m],
  jest: [/^Tests:.*\b[1-9]\d* failed/m, /^Tests:\s+(?:\d+ (?:skipped|todo), )*\d+ passed, \d+ total/m],
  vitest: [/^\s*Tests\s+.*\b[1-9]\d* failed/m, /^\s*Tests\s+\d+ passed \(\d+\)/m],
  mocha: [/^\s*[1-9]\d* failing/m, null],
  'node-test': [/^(?:#|ℹ) fail [1-9]|^not ok \d/m, /^(?:#|ℹ) fail 0\s*$/m],
  go: [/^(?:--- )?FAIL\b/m, null],
  cargo: [/test result: FAILED|^error: (?:test failed|\d+ targets? failed)/m, /test result: ok\./],
  rspec: [/\b\d+ examples?, [1-9]\d* failures?/, /\b\d+ examples?, 0 failures\b/],
  phpunit: [/^(?:FAILURES|ERRORS)!|^Tests: \d+, Assertions: \d+, (?:Errors|Failures): [1-9]/m, /^OK \(\d+ tests?, \d+ assertions?\)/m],
  dotnet: [/^Failed!\s+-\s+Failed:\s+[1-9]|^Test Run Failed/m, /^Passed!\s+-\s+Failed:\s+0\b/m],
  mvn: [/BUILD FAILURE|Tests run: \d+, Failures: [1-9]|Tests run: \d+, Failures: \d+, Errors: [1-9]/, /BUILD SUCCESS/],
  gradle: [/BUILD FAILED|\d+ tests? completed, [1-9]\d* failed/, /BUILD SUCCESSFUL/],
  bun: [/^\s*[1-9]\d* fail\b/m, /^\s*0 fail\b/m],
  deno: [/(?:^FAILED \|)|\| [1-9]\d* failed/m, /^ok \| \d+ passed \| 0 failed/m],
  ctest: [/\b[1-9]\d* tests? failed out of/, /\b100% tests passed/],
  tox: [/commands? failed|: FAIL code/m, /congratulations :\)/],
  nox: [/^nox > Session \S+ failed/m, /^nox > Session \S+ was successful/m],
};
// The line that closes one run, passed or failed, for runners that print exactly one per run: in a command that runs the
// tests more than once, the i-th of them is the i-th run's.
const RUN_END = {
  pytest: /\b\d+ (?:subtests? )?(?:passed|failed|errors?|skipped|deselected)\b[^\n]* in [\d.]+s\b/g,
  unittest: /^FAILED \((?:failures|errors)=\d+[^\n]*|^Ran \d+ tests? in [\d.]+s\s*\n\s*\nOK\b/gm,
  'node-test': /^(?:#|ℹ) fail \d+\s*$/gm,
};
// The closing lines of `count` runs, in order: by the runner's own pattern, or for a project script whose runner is not known
// (`npm test`, `make test`) by the one pattern that closes exactly that many.
function runEnds(text, family, count) {
  const found = (RUN_END[family] ? [RUN_END[family]] : Object.values(RUN_END)).map(re => [...text.matchAll(re)]).filter(m => m.length === count);
  return found.length === 1 ? found[0] : [];
}
// The runner's verdict from its own summary: true, false, or null when none shows. A runner whose format is unknown (a
// project script, `make test`) is judged by any runner's lines.
function summarized(text, family) {
  const t = String(text || ''), rules = SUMMARY[family] ? [SUMMARY[family]] : Object.values(SUMMARY);
  if (rules.some(([fail]) => fail?.test(t))) return false;
  return rules.some(([, pass]) => pass?.test(t)) ? true : null;
}
// Whether a test run passed: true, false, or null when the host's report does not say. A masked run's exit status is not the
// runner's, so only its summary speaks for it; a filtered one may have lost the summary, so it can only show a failure. A
// failing exit the runner shares with other commands is its own only when its summary shows the failure. When the command
// runs the tests `count` times, this run (the `index`-th) owns only its own closing line, told apart when every run printed
// exactly one: a stashed run's failure is never the final state's.
export function outcome({ failed, passed, response, error, masked, filtered, chained, maybeSkipped, interrupted, family, index = 0, count = 1 }) {
  if (interrupted || response?.interrupted || response?.backgroundTaskId) return null;
  const text = `${textOf(response)}\n${typeof error === 'string' ? error : ''}`, ends = count > 1 ? runEnds(text, family, count) : [];
  const said = count === 1 ? summarized(text, family) : ends.length ? summarized(ends[index][0], family) : null;
  if (!masked) {
    // The exit status is the runner's here, so it outranks any line of output, which a test name or a log may echo.
    const code = exitCodeOf(response), bad = failed || (code != null && code !== 0), good = !failed && (code === 0 || (code == null && passed));
    if (bad) return chained || maybeSkipped ? (said === false ? false : filtered ? null : said) : false;
    if (good) return maybeSkipped ? (said === true ? true : null) : true;
  }
  return said === false ? false : filtered ? null : said;
}

// What "the tests" means in a repository: the files and settings that choose what a test run runs. A run after any of them
// changed during the turn cannot verify the turn's code. Whole files where any line may matter; sections of shared ones.
// Files that exist only to configure tests are pinned whole; shared ones (a Makefile, pom.xml, pyproject.toml) only in the
// parts that choose or skip tests, so an unrelated edit there is no redefinition.
const WHOLE = ['pytest.ini', 'tox.ini', 'noxfile.py', 'phpunit.xml', 'phpunit.xml.dist', '.mocharc.json', '.mocharc.jsonc', '.mocharc.js', '.mocharc.cjs', '.mocharc.yml', '.mocharc.yaml', 'karma.conf.js', 'bunfig.toml',
  ...['jest', 'vitest', 'playwright'].flatMap(n => ['js', 'ts', 'mjs', 'cjs', 'mts', 'cts', 'json'].map(e => `${n}.config.${e}`))];
const SECTION = name => new RegExp(String.raw`^\[${name}[^\]]*\][\s\S]*?(?=^\[|$(?![\s\S]))`, 'gm');
const SECTIONS = {
  'pyproject.toml': SECTION(String.raw`tool\.(?:pytest|tox|coverage|hatch\.envs)`), 'setup.cfg': SECTION(String.raw`(?:tool:pytest|coverage:)`), 'Cargo.toml': SECTION(String.raw`\[test\]`),
  Makefile: /^(?:test|check)[\w-]*\s*:.*(?:\n\t.*)*/gm, GNUmakefile: /^(?:test|check)[\w-]*\s*:.*(?:\n\t.*)*/gm,
  'pom.xml': /<plugin>(?:(?!<\/plugin>)[\s\S])*?maven-(?:surefire|failsafe)-plugin[\s\S]*?<\/plugin>|<(skipTests|maven\.test\.skip|testFailureIgnore)>[\s\S]*?<\/\1>/g,
  'build.gradle': /^\s*(?:test|tasks\.(?:named\(["']test["']\)|withType\(Test\)|test))\s*\{[\s\S]*?^\}/gm, 'build.gradle.kts': /^\s*(?:test|tasks\.(?:named\(["']test["']\)|withType<Test>|test))\s*\{[\s\S]*?^\}/gm,
};
// package.json's test scripts, and every script they run, followed through `npm run x`, `pnpm x` and `yarn x`.
function testScripts(text) {
  let pkg;
  try { pkg = JSON.parse(text); } catch { return text; }
  const scripts = pkg.scripts ?? {}, seen = new Set(), queue = Object.keys(scripts).filter(k => /^(pre|post)?test/.test(k));
  while (queue.length) {
    const k = queue.shift();
    if (seen.has(k) || !(k in scripts)) continue;
    seen.add(k);
    for (const m of String(scripts[k]).matchAll(/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:.-]+)/g)) queue.push(m[1], `pre${m[1]}`, `post${m[1]}`);
  }
  return JSON.stringify([[...seen].sort().map(k => [k, scripts[k]]), pkg.jest, pkg.mocha, pkg.ava, pkg.vitest]);
}
function definition(file, text) {
  if (file === 'package.json') return testScripts(text);
  if (/^deno\.jsonc?$/.test(file)) {
    try {
      const o = JSON.parse(text);
      return JSON.stringify([o.test, o.tasks?.test]);
    } catch { return text; }
  }
  return SECTIONS[file] ? (text.match(SECTIONS[file]) || []).join('\n') : text;
}
// One short hash per definition file, so a change can be named.
export function testDefinition(top, configured = '') {
  const out = {}, script = /(?:^|\s)((?:\.\/|[\w-]+\/)[\w./-]+\.(?:sh|bash|py|js|mjs|ts|rb|pl))\b/.exec(configured)?.[1];
  for (const f of [...WHOLE, 'package.json', 'deno.json', 'deno.jsonc', ...Object.keys(SECTIONS), ...(script ? [script.replace(/^\.\//, '')] : [])]) {
    let text;
    try { text = fs.readFileSync(path.join(top, f), 'utf8'); } catch { continue; }
    const part = definition(f, text);
    if (part && part !== '[[],null,null,null,null]' && part !== '[null,null]') out[f] = createHash('sha1').update(part).digest('hex').slice(0, 12);
  }
  return out;
}
export const changedDefinitions = (before = {}, now = {}) => [...new Set([...Object.keys(before), ...Object.keys(now)])].filter(f => before[f] !== now[f]);

// The families whose passing runs verify this project: the configured or discovered test command's, and for an npm test
// script, those of the runners it calls. Empty when nothing is known: then any runner's run of everything counts.
// `several`: the script runs more than one runner, so a run of one of them is only a part of the suite.
export function familiesFor(top, configured) {
  const f = family(configured);
  if (!f) return Object.assign([], { several: false });
  const out = new Set(COVERS[f.name] || [f.name]), called = new Set();
  if (f.name === 'npm-test') {
    try {
      const script = JSON.parse(fs.readFileSync(path.join(top, 'package.json'), 'utf8')).scripts?.test;
      for (const p of parts(script)) for (const st of p.stages) {
        const g = family(st)?.name;
        if (g) called.add(g), (COVERS[g] || [g]).forEach(n => out.add(n));
      }
    } catch { /* no package.json */ }
  }
  return Object.assign([...out], { several: called.size > 1, own: f.name });
}
