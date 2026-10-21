#!/usr/bin/env node
// The tasks of the long-horizon benchmark, from a project's real history: every change to its source after a start point, in
// the order it reached the main branch, each with the text a developer was given (the linked issue, else the pull request).
// A change is a squash-merged commit or a pull-request merge on the main line. A merge that syncs another branch is skipped
// and named: replaying it faithfully needs a project with a linear history. Changes that touch no source (docs, CI, tests
// alone) are not tasks: they change no behavior an agent must build.
// usage: node bench/real/mine.mjs <project.json> <clone dir> > candidates.json
// project.json: { "repo": "owner/name", "start": "<tag>", "branch": "main", "source": ["src/pkg"], "tests": ["tests"],
//                 "max": 80, "setup": "<command that builds the environment>", "python": ".venv/bin/python" }
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { under } from './hidden.mjs';

const [projectFile, clone] = process.argv.slice(2);
const P = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
const git = (...a) => execFileSync('git', ['-C', clone, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const gh = path => {
  try { return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; }
};
const isTest = f => under(f, P.tests) || /(^|\/)(test_[^/]*|[^/]*_test)\.py$|(^|\/)conftest\.py$/.test(f);
// A pull request template's comments and empty checklists are not part of what the developer asked for.
const clean = text => String(text || '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*- \[[ x]\] .*$/gim, '').replace(/\n{3,}/g, '\n\n').trim();
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)/gi;

// Main-line changes from the start: a squash commit, or a pull-request merge measured against its first parent.
const changes = [];
for (const line of git('log', '--first-parent', '--reverse', '--format=%H %P%x09%s', `${P.start}..${P.branch || 'main'}`).split('\n').filter(Boolean)) {
  const [ids, subject] = line.split('\t'), [sha, first, second] = ids.split(' ');
  if (second && !/^Merge pull request #\d+/.test(subject)) process.stderr.write(`skipped a branch sync, ${sha.slice(0, 10)}: ${subject}\n`);
  else changes.push({ sha, parent: first, landed: sha, subject });
}
const out = [], seen = new Set();
for (const c of changes) {
  if (out.length >= (P.max || 80)) break;
  const files = git('diff', '--numstat', c.parent, c.sha).split('\n').filter(Boolean).map(l => {
    const [a, d, f] = l.split('\t');
    return { f, lines: (Number(a) || 0) + (Number(d) || 0) };
  });
  const source = files.filter(x => under(x.f, P.source) && !isTest(x.f) && x.f.endsWith('.py')), tests = files.filter(x => isTest(x.f) && x.f.endsWith('.py'));
  const size = source.reduce((s, x) => s + x.lines, 0), subject = c.subject, pr = /\(#(\d+)\)\s*$/.exec(subject)?.[1] || /^Merge pull request #(\d+)/.exec(subject)?.[1];
  if (!size || size > 1000 || seen.has(pr || c.sha)) continue;
  seen.add(pr || c.sha);
  // The issue a change closes, named in its pull request or, for a direct commit, in its message.
  const p = pr && gh(`repos/${P.repo}/pulls/${pr}`), message = git('log', '-1', '--format=%B', c.sha);
  const issueNo = [...`${p?.body || ''}\n${message}`.matchAll(CLOSES)].map(m => m[1]).find(n => n !== pr), issue = issueNo && gh(`repos/${P.repo}/issues/${issueNo}`);
  const from = issue && !issue.pull_request ? issue : p, text = from ? `${from.title}\n\n${clean(from.body)}`.trim() : message;
  out.push({ id: pr ? `pr${pr}` : c.sha.slice(0, 10), sha: c.sha, parent: c.parent, landed: c.landed, pr: pr ? Number(pr) : null, issue: from === issue ? Number(issueNo) : null, title: from?.title || subject, text, source: source.map(x => x.f), tests: tests.map(x => x.f), size, merged: p?.merged_at || git('log', '-1', '--format=%cI', c.sha) });
  process.stderr.write(`${out.length} ${out.at(-1).id} (${size} lines, ${tests.length} test files)${from === issue && issue ? ` issue #${issueNo}` : ''}\n`);
}
console.log(JSON.stringify({ project: P, candidates: out }, null, 1));
