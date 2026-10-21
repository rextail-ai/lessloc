#!/usr/bin/env node
// Run by `npm version <patch|minor|major|x.y.z>`, so one command releases lessloc. Before the bump (--check), it stops unless
// CHANGELOG.md has a `## [Unreleased]` section to release. After npm sets package.json, it carries the new version into every
// agent tool's manifest and the CI guide, names the Unreleased section and its link after the version, and stages those
// files, so npm's release commit and tag include them. postversion then pushes both, and the tag starts the release workflow.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url), read = f => fs.readFileSync(new URL(f, ROOT), 'utf8');
const UNRELEASED = /^## \[Unreleased\]\n/m;
if (process.argv[2] === '--check') {
  if (UNRELEASED.test(read('CHANGELOG.md'))) process.exit(0);
  console.error('CHANGELOG.md has no "## [Unreleased]" section: write down what changed there first');
  process.exit(1);
}
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const old = JSON.parse(git('show', 'HEAD:package.json')).version, { version } = JSON.parse(read('package.json'));
const MANIFESTS = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.github/plugin/plugin.json', '.cursor-plugin/plugin.json', 'gemini/gemini-extension.json', 'qwen-extension.json'];
const edits = {
  ...Object.fromEntries(MANIFESTS.map(f => [f, t => t.replace(`"version": "${old}"`, `"version": "${version}"`)])),
  'docs/guide/ci.md': t => t.replace(new RegExp(`(?<![\\d.])${old.replaceAll('.', '\\.')}(?![\\d.])`, 'g'), version),
  'CHANGELOG.md': t => t.replace(UNRELEASED, `## [${version}]\n`).replace(/^\[[\d.]+\]: /m, m => `[${version}]: https://github.com/rextail-ai/lessloc/releases/tag/v${version}\n${m}`),
};
for (const [f, edit] of Object.entries(edits)) {
  const before = read(f), after = edit(before);
  if (after === before) throw new Error(`${f}: found no ${old} to change to ${version}`);
  fs.writeFileSync(new URL(f, ROOT), after);
}
git('add', ...Object.keys(edits));
