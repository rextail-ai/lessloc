// What counts as a test run, what it covered and what its result is decide whether a turn is verified: a wrong "ran
// everything" or "passed" lets unverified work through, so each rule is pinned here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { changedDefinitions, coversEvery, familiesFor, outcome, readOnly, testDefinition, testRun, testRuns } from '../lib/evidence.mjs';
import { tmp } from './helpers.mjs';

const kind = (cmd, configured = '') => {
  const r = testRun(cmd, configured);
  return !r ? 'none' : [r.family, r.scope, r.masked && 'masked', r.filtered && 'filtered', r.background && 'bg', r.chained && 'chained', r.maybeSkipped && 'maybe'].filter(Boolean).join(' ');
};
const wrong = cases => cases.filter(([cmd, want]) => kind(cmd) !== want).map(([cmd, want]) => `${JSON.stringify(cmd)}: ${kind(cmd)}, expected ${want}`);

test('a run that covers nothing is not a test run: listing, compiling, skipping, help', () => {
  assert.deepEqual(wrong([
    ['python3 -m pytest --collect-only -q', 'none'], ['pytest --co', 'none'], ['pytest --version', 'none'], ['cargo test --no-run', 'none'], ['cargo test -- --list', 'none'],
    ['go test -c', 'none'], ['go test -list .', 'none'], ['jest --listTests', 'none'], ['npx vitest list', 'none'], ['mocha --dry-run', 'none'], ['tox --notest', 'none'],
    ['tox -l', 'none'], ['mvn test -DskipTests', 'none'], ['dotnet test --list-tests', 'none'], ['echo "pytest"', 'none'], ['printf "5 passed"', 'none'],
    ['cat <<EOF\npytest\nEOF', 'none'], ['make test-integration', 'none'], ['npm run test:unit', 'none'], ['pytest-watch', 'none'], ['ls tests', 'none'],
    ['./gradlew build -x test', 'none'], ['make -n test', 'none'], ['npx jest -u', 'none'], ['pytest --setup-only', 'none'], ['npx jest --clearCache', 'none'],
    ['mvn verify -DskipTests=true', 'none'], ['npx vitest run -u', 'none'], ['tox -e lint', 'none'], ['nox -s docs', 'none'], ['npm test -- --listTests', 'none'],
  ]), []);
});

test('a run of a selection is never the whole suite; the project root, its test folder and ./... are', () => {
  assert.deepEqual(wrong([
    ['go test ./internal/billing', 'go targeted'], ['go test ./...', 'go full'], ['cargo test parse_header', 'cargo targeted'], ['cargo test -p core', 'cargo targeted'],
    ['cargo test --workspace', 'cargo full'], ['python3 -m unittest tests.test_cart.CartTest.test_total', 'unittest targeted'], ['python3 -m unittest', 'unittest full'],
    ['python3 -m unittest discover -s tests -q', 'unittest full'], ['python3 -m unittest discover -p "test_cart*.py"', 'unittest targeted'], ['npm test -w packages/a', 'npm-test targeted'],
    ['npm test -- -t cart', 'npm-test targeted'], ['mvn test -Dtest=FooTest', 'mvn targeted'], ['./gradlew test --tests FooTest', 'gradle targeted'], ['./gradlew :core:test', 'gradle targeted'],
    ['pytest -kfoo', 'pytest targeted'], ['pytest -k slow', 'pytest targeted'], ['pytest --lf', 'pytest targeted'], ['pytest --ignore=tests/slow', 'pytest targeted'],
    ['npx vitest run --changed', 'vitest targeted'], ['pytest --testmon', 'pytest targeted'], ['pytest --picked', 'pytest targeted'], ['python3 -m pytest -q \\\n  -k test_total', 'pytest targeted'],
    ['pytest -q tests/test_x.py', 'pytest targeted'], ['pytest tests/test_a.py 2>/dev/null', 'pytest targeted'], ['pytest -n 4 tests/', 'pytest full'], ['pytest -c pytest.ini', 'pytest full'],
    ['pytest tests', 'pytest full'], ['tox -e py311', 'tox full'], ['make test', 'make full'], ['make test TESTS=a', 'make targeted'], ['npx jest src/cart', 'jest targeted'],
    ['mvn -Dtest=FooTest test', 'mvn targeted'], ['node --test-name-pattern=cart --test', 'node-test targeted'], ['node --test', 'node-test full'],
    ['yarn test src/cart.test.js', 'npm-test targeted'], ['npm test -- --testPathPattern=cart', 'npm-test targeted'], ['cargo test -- parse_header', 'cargo targeted'],
    ['pytest -q -- tests/x.py::t', 'pytest targeted'], ['mocha --spec test/a.spec.js', 'mocha targeted'], ['python3 -m unittest discover tests/unit', 'unittest targeted'],
    ['ctest --rerun-failed', 'ctest targeted'], ['phpunit --testsuite=unit', 'phpunit targeted'], ['pytest --cov src tests/', 'pytest full'], ['go test ./pkg/...', 'go targeted'],
    ['tox -e py311 -- tests/test_x.py', 'tox targeted'], ['tox -e py311,lint', 'tox full'], ['cargo test -- --skip slow', 'cargo targeted'],
    ['pytest tests/a.py && pytest', 'pytest full chained'], ['pnpm vitest run', 'vitest full'], ['yarn jest', 'jest full'],
  ]), []);
  assert.equal(kind('pytest tests/unit', 'pytest tests/unit'), 'pytest full', 'the configured command as written is the whole suite');
  assert.deepEqual([testRun('make -C sub test').dirs, testRun('cargo test --manifest-path ../other/Cargo.toml').dirs, testRun('npm test --prefix pkg/a').dirs], [['sub'], ['../other/'], ['pkg/a']]);
  assert.equal(kind('./run-tests.sh --fast', './run-tests.sh'), 'configured full', 'the configured command, with its own options');
  assert.equal(kind('./run-tests.sh-old', './run-tests.sh'), 'none', 'a longer name is another command');
});

test('whether the command\'s exit status is the runner\'s, and what may have happened around it', () => {
  assert.deepEqual(wrong([
    ['python3 -m pytest -q', 'pytest full'], ['env X=1 python3 -m pytest', 'pytest full'], ['coverage run -m pytest', 'pytest full'], ['uv run pytest -x', 'pytest full'],
    ['pnpm exec vitest run', 'vitest full'], ['yarn test', 'npm-test full'], ['/bin/bash -lc \'python -m pytest -q\'', 'pytest full'], ['cd app && python3 -m unittest discover -s tests -q', 'unittest full'],
    ['npm test | tail -20', 'npm-test full masked'], ['set -o pipefail; npm test | tail -20', 'npm-test full'], ['go test ./... || true', 'go full masked'], ['cargo test; exit 0', 'cargo full masked'],
    ['pytest && echo ok', 'pytest full chained'], ['pytest -q; git diff --stat', 'pytest full masked'], ['npm test 2>&1 | head -12', 'npm-test full masked'],
    ['go test ./... 2>&1 | head -3', 'go full masked'], ['python -I -m pytest -q', 'pytest full'], ['python3 -X dev -m unittest discover -s tests', 'unittest full'], ['npm test 2>&1 | grep -E "^# (pass|fail)|not ok"; git diff --stat', 'npm-test full masked'],
    ['pytest -q 2>&1 | tail -1 | cut -d, -f2', 'pytest full masked filtered'], ['pytest -q | grep -oE "[0-9]+ passed in [0-9.]+s"', 'pytest full masked filtered'], ['pytest -q | tail -c 40', 'pytest full masked filtered'], ['python3 -m pytest -q &', 'pytest full masked bg'], ['pytest > /tmp/log 2>&1 &', 'pytest full masked bg'],
    ['pytest & wait', 'pytest full masked bg'], ['test -f x || pytest', 'pytest full maybe'], ['cargo fmt && cargo test', 'cargo full chained'],
    ['git stash && python3 -m pytest -q 2>&1 | tail -3; git stash pop', 'pytest full masked chained'], ['(python -m pytest -q 2>&1 | tail -3)', 'pytest full masked'],
    ["cd /tmp/x && python3 - <<'EOF'\nimport pytest\nprint(1)\nEOF\npython3 -m unittest discover -s tests 2>&1 | tail -4", 'unittest full masked'],
    ['python3 -m unittest discover tests -v 2>&1 && python3 -c "\nfrom unittest import mock\nprint(2)\n"', 'unittest full chained'],
  ]), []);
  const r = testRun('cd sub && git stash && pytest; git stash pop');
  assert.deepEqual([r.before, r.after], [['cd sub', 'git stash'], ['git stash pop']], 'the commands around a run, to tell which tree it ran on');
  assert.deepEqual(testRuns('git stash && pytest -q | tail -3; git stash pop && pytest -q').map(x => x.after), [['git stash pop', 'pytest -q'], []], 'every run of a command, each with the commands after it');
});

test('a run\'s result comes from the host: its failure event or exit code, else the runner\'s own summary; a masked run only by its summary', () => {
  const cases = [
    [{ passed: true, response: { stdout: 'ok', stderr: '' } }, true, 'Claude Code: PostToolUse is a success'],
    [{ failed: true, response: {} }, false, 'Claude Code: PostToolUseFailure'],
    [{ passed: true, response: { stdout: 'x', interrupted: true } }, null, 'interrupted'],
    [{ passed: true, response: { stdout: '', backgroundTaskId: 'b1' } }, null, 'still running in the background'],
    [{ failed: true, interrupted: true, response: {} }, null, 'timed out or denied'],
    [{ passed: true, response: { stdout: 'test result: ok. 3 passed; 0 failed; 0 ignored' } }, true, 'cargo pass'],
    [{ passed: true, masked: true, response: { stdout: 'test result: ok. 3 passed; 0 failed; 0 ignored' } }, true, 'cargo pass, masked'],
    [{ passed: true, masked: true, response: { stdout: '== 1 failed, 4 passed in 0.12s ==' } }, false, 'a masked run that shows a failure'],
    [{ passed: true, response: { stdout: 'test_reports_2_errors PASSED\n== 5 passed in 0.1s ==' } }, true, 'an exit code outranks a line that mentions errors'],
    [{ failed: true, response: { stdout: '== 5 passed in 0.1s ==' } }, false, 'a failing exit outranks a passing line (a coverage threshold, a plugin)'],
    [{ masked: true, family: 'pytest', response: { stdout: 'Traceback: ImportError\nOK' } }, null, 'a bare OK from another command is no pytest verdict'],
    [{ masked: true, family: 'unittest', response: { stdout: 'Ran 3 tests in 0.1s\n\nOK' } }, true, 'unittest: the Ran line and OK together'],
    [{ masked: true, family: 'cargo', response: { stdout: 'test result: ok. 3 passed\n\nerror: 1 target failed:\n    `--lib`' } }, false, 'cargo: a later target failed'],
    [{ masked: true, family: 'mvn', response: { stdout: 'Tests run: 4, Failures: 1, Errors: 0\nBUILD FAILURE' } }, false, 'maven failure'],
    [{ masked: true, family: 'phpunit', response: { stdout: 'OK (12 tests, 30 assertions)' } }, true, 'phpunit pass'],
    [{ masked: true, family: 'pytest', response: { stdout: 'FAIL Required test coverage of 90% not reached. Total coverage: 80.00%\n== 5 passed in 0.2s ==' } }, false, 'pytest-cov threshold'],
    [{ failed: true, chained: true, family: 'pytest', response: { stdout: 'ERROR: ./x is not a valid editable requirement' } }, null, 'pip failed before pytest ran: no verdict on the tests'],
    [{ failed: true, chained: true, family: 'pytest', response: { stdout: '== 1 passed in 0.1s ==\nFound 1 error.' } }, true, 'a linter after pytest failed: the tests passed'],
    [{ passed: true, masked: true, response: { stdout: '== 5 passed in 0.10s ==' } }, true, 'a masked run that shows a pass'],
    [{ passed: true, masked: true, response: { stdout: '.....' } }, null, 'a masked run whose summary was cut off'],
    [{ passed: true, masked: true, response: { stdout: 'ok 1 - adds\nnot ok 2 - refunds' } }, false, 'TAP: a failing test shows'],
    [{ passed: true, masked: true, filtered: true, response: { stdout: 'ok 1 - adds\nok 2 - b' } }, null, 'TAP: per-test lines are no verdict'],
    [{ passed: true, masked: true, filtered: true, response: { stdout: 'ok  pkg/a 0.1s\nok  pkg/b 0.2s' } }, null, 'go: per-package lines are no verdict'],
    [{ passed: true, masked: true, response: { stdout: '14 passing (2s)' } }, null, 'mocha: a passing count alone is no verdict'],
    [{ passed: true, masked: true, filtered: true, response: { stdout: '== 5 passed in 0.1s ==' } }, null, 'a filtered run can only show a failure'],
    [{ response: 'Exit code: 0\nWall time: 1.2 seconds\nOutput:\nprinted exit code 1 here\n5 passed in 0.1s' }, true, 'Codex: only its header holds the exit code'],
    [{ response: 'Exit code: 1\nOutput:\n5 passed in 0.1s' }, false, 'Codex: a failing header'],
    [{ response: 'Process exited with code 1\nOutput:\nOK' }, false, 'Codex: the older header'],
    [{ response: 'Ran 3 tests in 0.1s\n\nOK' }, true, 'Codex: unittest summary'],
    [{ response: 'test result: FAILED. 3 passed; 1 failed' }, false, 'Codex: cargo failure'],
    [{ failed: true, masked: true, error: 'Exit code 1\n== 1 failed, 2 passed in 0.3s ==' }, false, 'a failure event\'s own text'],
    [{ failed: true, chained: true, response: { stdout: 'npm ERR! missing script' } }, null, 'a failure shared with other commands, no summary'],
    [{ failed: true, chained: true, response: { stdout: '5 passed in 0.2s' } }, true, 'the runner passed; a later command failed'],
    [{ failed: true, response: { stdout: 'FAIL Required test coverage of 90% not reached.' } }, false, 'a coverage threshold'],
    [{ passed: true, maybeSkipped: true, response: { stdout: '' } }, null, 'behind `x ||`, maybe never ran'],
    [{ response: '{"exitCode":1,"output":"5 passed"}' }, false, 'Cursor: exit code in JSON'],
    [{ masked: true, response: '{"exitCode":0,"output":"....F"}' }, null, 'Cursor: masked, no summary'],
    [{ response: { metadata: { exit: 0 } } }, true, 'OpenCode: exit code in metadata'],
    [{ masked: true, response: { content: [{ type: 'text', text: 'Ran 3 tests in 0.048s\n\nOK\n' }, { type: 'text', text: 'Command exited with code 0.' }] } }, true, 'OpenCode: content parts'],
    [{ response: { content: [{ type: 'text', text: 'boom' }, { type: 'text', text: 'Command exited with code 1.' }] } }, false, 'OpenCode: exit code in content'],
    [{ masked: true, response: { metadata: { exit: 0 }, output: '.....' } }, null, 'OpenCode: masked, no summary'],
    [{ masked: true, response: { stdout: 'Tests:       3 passed, 3 total' } }, true, 'jest totals'],
    [{ masked: true, response: { stdout: ' Tests  4 passed (4)' } }, true, 'vitest totals'],
    [{ masked: true, response: { stdout: '# tests 3\n# pass 3\n# fail 0' } }, true, 'node:test trailer'],
    [{ response: 'no tests ran in 0.01s' }, null, 'nothing ran'],
    [{ masked: true, family: 'pytest', response: { stdout: '29 passed, 5 subtests passed in 0.16s' } }, true, 'pytest 9 subtests'],
    [{ masked: true, family: 'pytest', response: { stdout: '28 passed, 1 subtests failed in 0.2s' } }, false, 'a failing subtest'],
    [{ masked: true, family: 'unittest', index: 1, count: 2, response: { stdout: 'Ran 22 tests in 0.03s\n\nFAILED (failures=1)\nRan 22 tests in 0.03s\n\nOK\n' } }, true, 'stash, fail, restore, pass: the second run passed'],
    [{ masked: true, family: 'unittest', index: 0, count: 2, response: { stdout: 'Ran 22 tests in 0.03s\n\nFAILED (failures=1)\nRan 22 tests in 0.03s\n\nOK\n' } }, false, 'and the first one, on the stashed code, failed'],
    [{ masked: true, family: 'pytest', index: 0, count: 2, response: { stdout: '22 passed in 0.1s\n1 failed, 21 passed in 0.1s\n' } }, true, 'pass, then stash and fail: the first run passed'],
    [{ masked: true, family: 'unittest', index: 1, count: 2, response: { stdout: 'Ran 1 test in 0.01s\n\nFAILED (failures=1)\nOK\n' } }, null, 'a run whose closing line was cut off cannot be told apart'],
    [{ masked: true, family: 'npm-test', index: 0, count: 2, response: { stdout: '# pass 3\n# fail 0\n# pass 2\n# fail 1\n' } }, true, 'a project script running node --test: each run closes with its fail count'],
  ];
  assert.deepEqual(cases.filter(([i, want]) => outcome(i) !== want).map(([i, want, what]) => `${what}: ${outcome(i)}, expected ${want}`), []);
});

test('a Python run that names every test file the project has ran the whole suite; a filter or a missing file is a part', () => {
  const one = ['tests/__init__.py', 'tests/test_shop.py', 'shop/orders.py'], two = ['tests/test_a.py', 'tests/test_b.py', 'src/a.py'];
  const covers = (cmd, files) => coversEvery(testRun(cmd), files);
  assert.deepEqual([
    covers('python3 -m unittest tests.test_shop', one), covers('python3 -m unittest discover -s tests -p "test_*.py"', one), covers('pytest -p no:cacheprovider tests/test_shop.py', one),
    covers('pytest tests/test_a.py tests/test_b.py', two), covers('pytest tests/test_a.py', two), covers('pytest tests/test_a.py tests/test_b.py -k fee', two),
    covers('pytest tests/test_a.py::test_x tests/test_b.py', two), covers('python3 -m unittest discover -s tests -p "test_a*.py"', two), covers('python3 -m unittest tests.test_other', one),
  ], [true, true, true, true, false, false, false, false, false]);
});

test('linters and type checkers that only report are read-only; their fix and write modes are not', () => {
  const reads = ['ruff check tomlkit tests', 'mypy tomlkit', 'python -m mypy src', 'black --check .', 'isort --diff .', 'eslint src', 'prettier --check .', 'tsc --noEmit -p .', 'go vet ./...', 'cargo clippy', 'uv run ruff check .'];
  const writes = ['ruff check --fix .', 'black .', 'isort .', 'npx eslint --fix src', 'prettier --write .', 'tsc', 'cargo clippy --fix', 'mypyc build'];
  assert.deepEqual([reads.filter(c => !readOnly(c)), writes.filter(c => readOnly(c))], [[], []]);
});

test('what the tests run is pinned per file: test scripts and what they call, test sections, runner configs; nothing else', () => {
  const dir = tmp('defs-'), put = (f, t) => fs.writeFileSync(path.join(dir, f), t);
  put('package.json', JSON.stringify({ scripts: { test: 'npm run unit', unit: 'node --test', build: 'tsc' }, dependencies: { a: '1' } }));
  put('pyproject.toml', '[project]\nname = "a"\n\n[tool.pytest.ini_options]\naddopts = "-q"\n\n[tool.ruff]\nline-length = 100\n');
  const before = testDefinition(dir), again = () => changedDefinitions(before, testDefinition(dir));
  put('package.json', JSON.stringify({ scripts: { test: 'npm run unit', unit: 'node --test', build: 'tsc -b' }, dependencies: { a: '2' } }));
  put('pyproject.toml', '[project]\nname = "b"\n\n[tool.pytest.ini_options]\naddopts = "-q"\n\n[tool.ruff]\nline-length = 120\n');
  assert.deepEqual(again(), [], 'dependencies, other scripts and other tools\' settings are not what the tests run');
  put('package.json', JSON.stringify({ scripts: { test: 'npm run unit', unit: 'node --test --test-name-pattern=cart', build: 'tsc -b' } }));
  put('Makefile', 'test:\n\tpytest\n');
  assert.deepEqual(again(), ['package.json', 'Makefile'], 'a script the test script runs, and a new Makefile');
  assert.deepEqual(changedDefinitions({ 'pyproject.toml': 'a', 'tox.ini': 'b' }, { 'pyproject.toml': 'c', 'tox.ini': 'b', 'pytest.ini': 'd' }), ['pyproject.toml', 'pytest.ini']);
});

test('only the project\'s own test runner can verify it; pytest also stands for unittest', () => {
  const dir = tmp('fam-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run && node --test' } }));
  const npm = familiesFor(dir, 'npm test');
  assert.deepEqual([...npm].sort(), ['node-test', 'npm-test', 'vitest']);
  assert.equal(npm.several, true, 'the script runs two runners, so either one alone is a part');
  assert.deepEqual([...familiesFor(dir, 'python3 -m unittest discover -s tests -q')].sort(), ['pytest', 'unittest']);
  assert.deepEqual([...familiesFor(dir, 'python3 -m pytest -q')], ['pytest']);
  assert.deepEqual([...familiesFor(dir, './run-tests.sh')], []);
});
