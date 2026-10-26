// Pages made from the repository itself, so the site never drifts from the code: a page for each catalogued pattern with
// examples or a standard to show (its bad and good forms from test/cases.mjs), the pattern catalog with a section for each of
// the others, the benchmark results (bench/README.md), why less code (PATTERNS.md), and the install page as plain Markdown
// (install.md).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { GROUPS, PATTERNS } from '../../lib/catalog.mjs';
import { CASES } from '../../test/cases.mjs';
import { linkTo, nameOf, ownPage, said, slug, topic } from '../.vitepress/said.mjs';

const DOCS = path.join(import.meta.dirname, '..'), ROOT = path.join(DOCS, '..'), BLOB = 'https://github.com/rextail-ai/lessloc/blob/main';
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// A generated page has no file of its own in the repository, so it gets no "Edit this page" link. Its last update, which the
// page footer and the sitemap show, is the last commit to the files it is made from (their newest change outside git).
const updated = sources => new Date(spawnSync('git', ['log', '-1', '--format=%cI', '--', ...sources], { cwd: ROOT, encoding: 'utf8' }).stdout?.trim()
  || Math.max(...sources.map(f => fs.statSync(path.join(ROOT, f)).mtimeMs))).toISOString();
// `meta` adds frontmatter, such as the page's title in search results when its h1 alone says too little, or its description
// when its lead paragraph is longer than a search result shows.
const write = (f, date, text, meta = {}) => (fs.mkdirSync(path.dirname(path.join(DOCS, f)), { recursive: true }), fs.writeFileSync(path.join(DOCS, f),
  `---\neditLink: false\nlastUpdated: ${date}\n${Object.entries(meta).map(([k, v]) => `${k}: ${JSON.stringify(v)}\n`).join('')}---\n\n${text}`));
// Links between repository files point to GitHub, unless the site has its own page for the topic. A link that shows its file's
// path as its text shows the page's name instead.
const SITE = { 'docs/guide/reference.md#files-lessloc-writes': ['/guide/reference#files-lessloc-writes'], 'PATTERNS.md': ['/patterns/', 'the pattern catalog'], 'bench/README.md': ['/benchmarks', 'Benchmarks'] };
const links = (text, from) => text.replace(/\[([^\]]*)\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, (_, label, to) => {
  const file = path.posix.normalize(path.posix.join(path.posix.dirname(from), to)), [page, name] = SITE[file] || [];
  return `[${name && label === to ? name : label}](${page || `${BLOB}/${file}`})`;
});
// A chart in the repository's Markdown is a <picture> of its light and dark copies on lessloc.org, so GitHub shows the one for
// its own appearance. On the site it is both copies, sized from their files and each shown only in its own appearance
// (theme/custom.css); they load lazily, so the hidden one is never fetched.
const chart = html => ['light', 'dark'].map(theme => {
  const file = new URL(html.match(theme === 'dark' ? / srcset="([^"]+)"/ : / src="([^"]+)"/)[1]).pathname;
  const [, width, height] = fs.readFileSync(path.join(DOCS, 'public', file), 'utf8').match(/<svg[^>]* width="(\d+)" height="(\d+)"/);
  return `<img class="${theme}-only" src="${file}" alt="${html.match(/ alt="([^"]*)"/)[1]}" width="${width}" height="${height}" loading="lazy">`;
}).join('');
// Outside code spans and charts, `<` and `{{` would be read as markup by the site's templates.
const safe = text => text.split(/(`[^`]*`|<picture>.*?<\/picture>)/).map((s, i) => (i % 2 ? (s[0] === '<' ? chart(s) : s) : s.replace(/</g, '&lt;').replace(/\{\{/g, '&#123;&#123;'))).join('');
const LANG = { py: 'python', js: 'js', mjs: 'js', ts: 'ts', tsx: 'tsx', jsx: 'jsx', rs: 'rust', go: 'go', java: 'java', cs: 'csharp', rb: 'ruby', kt: 'kotlin', php: 'php', swift: 'swift', sh: 'bash', sql: 'sql', json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', md: 'md', html: 'html', css: 'css', c: 'c', cpp: 'cpp' };
const fence = (file, code) => `\`\`\`${LANG[file.split('.').pop()] || ''} [${file}]\n${code.replace(/\n$/, '')}\n\`\`\``;
// The standards a text cites, linked to their sources: CWE entries (also a list of their numbers after "CWE weaknesses"), PEPs
// and arXiv papers. Code and links stay as they are.
const CWE = n => `https://cwe.mitre.org/data/definitions/${n}.html`;
const SOURCES = [[/\bCWE-(\d+)\b/g, (_, n) => `[CWE-${n}](${CWE(n)})`], [/\bPEP (\d+)\b/g, (_, n) => `[PEP ${n}](https://peps.python.org/pep-${n.padStart(4, '0')}/)`],
  [/\barXiv:(\d{4}\.\d{4,5})\b/g, (_, n) => `[arXiv:${n}](https://arxiv.org/abs/${n})`]];
const cite = text => text.replace(/^(.*\*\*CWE weaknesses\.\*\*.* are )(.*)$/m, (_, open, ids) => open + ids.replace(/\d+/g, n => `[${n}](${CWE(n)})`))
  .split(/(`[^`]*`|\[[^\]]*\]\([^)]*\))/).map((s, i) => (i % 2 ? s : SOURCES.reduce((t, [re, to]) => t.replace(re, to), s))).join('');
// Each finding kind's tier and what it reports, from the tier tables of the reference page. A kind on a pattern page links
// to its table there.
const KINDS = new Map([...fs.readFileSync(path.join(DOCS, 'guide', 'reference.md'), 'utf8').matchAll(/^### Tier (\d+)\n([\s\S]*?)(?=^#)/gm)]
  .flatMap(([, tier, table]) => [...table.matchAll(/^\| `([a-z-]+)` \|[^|]*\| (.*?) \|[^|]*\|$/gm)].map(([, kind, reports]) => [kind, { tier, reports }])));
const linkKind = k => (KINDS.has(k) ? `[\`${k}\`](/guide/reference#tier-${KINDS.get(k).tier})` : (console.warn(`kind ${k} is in no tier table of guide/reference.md`), `\`${k}\``));

// What lessloc does about a pattern, in sentences: with each kind linked to its tier table, or (`kind`) written another way.
const does = (p, kind = linkKind) => safe(said(links(p.does, 'PATTERNS.md'), kind)).replace(/[^.!?]$/, '$&.');
const firstSentence = text => text.split(/(?<=[.!?]) +(?=[A-Z[`"]|lessloc\b)/)[0];
// Each kind a pattern is reported as, with its tier and what it reports.
const kinds = p => [...new Set([...p.does.matchAll(/\{([a-z-]+)\}/g)].map(m => m[1]))].filter(k => KINDS.has(k))
  .map(k => `- \`${k}\` (tier ${KINDS.get(k).tier}): ${KINDS.get(k).reports}`).join('\n');
// A name in Markdown: its underscores and asterisks are not emphasis, and a backslash in it escapes nothing.
const md = s => s.replace(/[\\_*]/g, '\\$&');
const groupOf = p => GROUPS.find(([g]) => g === p.group);

// A pattern page opens with the answer: what the pattern is one of and the first thing lessloc does about it. It then asks and
// answers why it is a bad practice and what lessloc does, shows the examples, and lists the other patterns of its group.
const catalogUpdated = updated(['lib/catalog.mjs', 'test/cases.mjs']);
// docs/patterns holds only these generated pages, so it starts empty and a pattern that loses its page leaves none behind.
fs.rmSync(path.join(DOCS, 'patterns'), { recursive: true, force: true });
for (const p of PATTERNS.filter(ownPage)) {
  const [, group, intro] = groupOf(p), cases = CASES.filter(c => c[0] === p.id), what = does(p), standard = p.standard && p.standard !== '—' && p.standard;
  // A standard lists its sources between semicolons; a part that opens with an article explains instead of naming a source.
  const many = standard && standard.split('; ').filter(s => !/^(a|an|the) /.test(s)).length > 1;
  write(`patterns/${p.id}.md`, catalogUpdated, [
    `# ${safe(p.title)}`,
    `*${group}*: one of the ways AI coding agents bloat software, from lessloc's [pattern catalog](/patterns/). ${firstSentence(what)}`,
    standard ? `## What makes ${md(topic(p))} a bad practice?\n\nThe ${many ? 'standards that call' : 'standard that calls'} it a bad practice: ${safe(links(cite(standard), 'PATTERNS.md')).replace(/[^.!?]$/, '$&.')}` : '',
    `## What does lessloc do about ${md(topic(p))}?\n\n${what.replace(/^What lessloc does: /, '')}`,
    kinds(p),
    cases.length ? `## Examples\n\n${cases.map(([, kind, file, bad, good]) => `Caught as \`${kind}\`:\n\n${fence(file, bad)}\n\nWritten well:\n\n${fence(file, good)}`).join('\n\n')}` : '',
    `## Related patterns\n\n${intro ? `${safe(intro)} ` : ''}The other patterns in [${group}](/patterns/#${slug(group)}):\n\n${PATTERNS.filter(q => q.group === p.group && q !== p)
      .map(q => `- [${md(nameOf(q))}](${linkTo(q)}): ${firstSentence(does(q, k => `\`${k}\``)).replace(/^What lessloc does: /, '')}`).join('\n')}`,
  ].filter(Boolean).join('\n\n') + '\n');
}
// A pattern with no page of its own is a section of the catalog page: its name, its title when that says more, what lessloc
// does about it and the kinds it is reported as.
const section = p => [`### ${md(nameOf(p))} {#${p.id}}`, `${p.title.replace(/`/g, '') === nameOf(p) ? '' : `${safe(p.title)}. `}${does(p)}`, kinds(p)].filter(Boolean).join('\n\n');
// PATTERNS.md opens with one sentence on why the catalog exists, then a key to its tables and the standards it cites, then two
// sections on why less code. The key goes with the catalog, on /patterns/; the sentence and the two sections make /why-less-code.
const catalog = read('PATTERNS.md'), after = catalog.split('<!-- catalog:end -->')[1] || '';
const intro = catalog.split('<!-- catalog:start -->')[0].replace(/^# .*\n/, '').trim(), [opening, ...why] = intro.split(/^(?=## )/m);
const lead = opening.match(/^.*?\.(?= )/)[0], [lists, key] = opening.slice(lead.length).trim().split(/(?<=:)\n\n/);
write('patterns/index.md', updated(['lib/catalog.mjs', 'PATTERNS.md']), [
  '# Patterns',
  'Every way lessloc knows that coding agents bloat code, comments, files, folders, dependencies and tests, with the standard that calls each one a bad practice and what lessloc does about it.',
  `Each pattern's page, or its section on this page, says what lessloc does about it:\n\n${safe(links(cite(key.replace(/\brow\b/g, 'pattern')), 'PATTERNS.md'))}`,
  ...GROUPS.map(([g, name, intro]) => [`## ${name}`, intro && safe(intro), PATTERNS.filter(p => p.group === g).map(p => `- [${safe(p.title)}](${linkTo(p)})`).join('\n'),
    ...PATTERNS.filter(p => p.group === g && !ownPage(p)).map(section)].filter(Boolean).join('\n\n')),
  safe(links(cite(after.trim()), 'PATTERNS.md')),
].join('\n\n') + '\n', { title: 'How AI coding agents bloat code: the pattern catalog',
  description: 'Every way lessloc knows that coding agents bloat code, comments, files, folders, dependencies and tests, why each is a bad practice and what lessloc does.' });
const [first, ...more] = why.map(s => s.match(/^## (.*)/)[1]), lower = s => s[0].toLowerCase() + s.slice(1);
write('why-less-code.md', updated(['PATTERNS.md']), [
  '# Why less code',
  `${lead} ${lists.replace(/^This catalog/, '[The pattern catalog](/patterns/)').replace(/:$/, '.')} This page explains ${[first, ...more].map(lower).join(', and ')}.`,
  safe(links(cite(why.join('').trim()), 'PATTERNS.md')).replace('the counterweights at the end of this file', '[the counterweights](/patterns/#what-lessloc-never-pushes-an-agent-toward)'),
].join('\n\n') + '\n', { title: 'Why less code: unneeded size does more harm than good', description: `${lead} ${[first, ...more.map(lower)].join(', and ')}.` });
write('benchmarks.md', updated(['bench/README.md']), safe(links(read('bench/README.md'), 'bench/README.md')).replace(/^# .*/, '# Benchmarks'), { title: 'lessloc benchmarks on real projects',
  description: 'lessloc against no tool on 117 real changes to three open-source projects, each judged by tests the agent never sees: up to 36% less code and 26% lower cost per task, with the same results.' });
// The install steps an agent follows, also served as plain text at /install.md, the address the docs give the agent.
fs.writeFileSync(path.join(DOCS, 'public', 'install.md'), fs.readFileSync(path.join(DOCS, 'install.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n+/, ''));
console.log(`generated ${PATTERNS.filter(ownPage).length} pattern pages, the pattern catalog with ${PATTERNS.filter(p => !ownPage(p)).length} more, why less code, benchmarks and the plain install page`);
