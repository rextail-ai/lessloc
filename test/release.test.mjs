import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { VERSION } from '../lib/repo.mjs';
import { ENV, tmp } from './helpers.mjs';

const MANIFESTS = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.github/plugin/plugin.json', '.cursor-plugin/plugin.json', 'gemini/gemini-extension.json', 'qwen-extension.json'];
const FILES = ['package.json', 'scripts/version.mjs', 'CHANGELOG.md', 'docs/guide/ci.md', ...MANIFESTS];
const env = { ...ENV, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', npm_config_update_notifier: 'false' };
const run = (cwd, cmd, ...args) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env });

// A maintainer's clone of main with the files a release touches, whose origin is a bare repository of its own.
function clone(changelog = t => t) {
  const origin = tmp('origin-'), dir = tmp('release-');
  run(origin, 'git', 'init', '-q', '--bare');
  for (const f of FILES) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(new URL(`../${f}`, import.meta.url), path.join(dir, f));
  }
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8')));
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-qm', 'c'], ['remote', 'add', 'origin', origin], ['push', '-q', '-u', 'origin', 'main']]) run(dir, 'git', ...args);
  return { origin, dir, read: f => fs.readFileSync(path.join(dir, f), 'utf8') };
}

test('npm version carries the new version into every manifest, the CI guide and the changelog, then commits, tags and pushes', () => {
  const unreleased = '## [Unreleased]\n\n- A change.\n\n';
  const { origin, dir, read } = clone(t => t.replace(`## [${VERSION}]`, `${unreleased}## [${VERSION}]`));
  const [major, minor] = VERSION.split('.').map(Number), next = `${major}.${minor + 1}.0`;
  const r = run(dir, 'npm', 'version', 'minor');
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['package.json', ...MANIFESTS]) assert.equal(JSON.parse(read(f)).version, next, f);
  const ci = read('docs/guide/ci.md');
  assert.ok(ci.includes(`github:rextail-ai/lessloc#v${next} ci`) && !ci.includes(VERSION), 'the CI guide shows the new tag only');
  assert.ok(read('CHANGELOG.md').includes(`## [${next}]\n\n- A change.\n\n## [${VERSION}]`), 'the Unreleased section is named after the version');
  assert.ok(read('CHANGELOG.md').includes(`[${next}]: https://github.com/rextail-ai/lessloc/releases/tag/v${next}\n[${VERSION}]: `));
  assert.equal(run(dir, 'git', 'status', '--porcelain').stdout, '', 'every change is in the release commit');
  assert.equal(run(origin, 'git', 'rev-parse', `v${next}^{commit}`).stdout, run(origin, 'git', 'rev-parse', 'main').stdout, 'the tag and its commit reached origin');
});

test('npm version stops before the bump when the changelog has nothing to release', () => {
  const { origin, dir, read } = clone();
  const before = read('package.json'), r = run(dir, 'npm', 'version', 'patch');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /CHANGELOG\.md has no "## \[Unreleased\]" section/);
  assert.equal(read('package.json'), before);
  assert.equal(run(origin, 'git', 'tag').stdout, '');
});
