// The lessloc.org site: documentation and guides, built from this repository. The pattern pages and their sidebar come from
// lib/catalog.mjs, so the site lists exactly what lessloc checks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';
import { GROUPS, PATTERNS } from '../../lib/catalog.mjs';
import { bare, linkTo, nameOf, said, slug } from './said.mjs';

// LESSLOC_SITE builds a copy whose absolute links (llms.txt, the Markdown copies) point to where it is served, such as a
// local preview.
const SITE = process.env.LESSLOC_SITE || 'https://lessloc.org', REPO = 'https://github.com/rextail-ai/lessloc', CARD = `${SITE}/og-card.png`;
const PKG = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const DESCRIPTION = 'lessloc keeps AI coding agents such as Claude Code, Codex, GitHub Copilot, Gemini CLI and Cursor to the least code that does the job and still works.';

const nav = [
  { text: 'Docs', link: '/guide/getting-started' },
  { text: 'Guides', link: '/guides/functions' },
  { text: 'Patterns', link: '/patterns/' },
  { text: 'Benchmarks', link: '/benchmarks' },
];
const sidebar = {
  '/guide/': [{ text: 'Docs', items: [
    { text: 'Start here', link: '/start' },
    { text: 'Getting started', link: '/guide/getting-started' },
    { text: 'Install with your agent', link: '/install' },
    { text: 'Remove with your agent', link: '/remove' },
    { text: 'Custom agents and SDKs', link: '/guide/any-agent' },
    { text: 'How it works', link: '/guide/how-it-works' },
    { text: 'Configuration', link: '/guide/configuration' },
    { text: 'Commits and CI', link: '/guide/ci' },
    { text: 'FAQ', link: '/guide/faq' },
    { text: 'Reference', link: '/guide/reference' },
  ] }],
  '/guides/': [{ text: 'Guides', items: [
    { text: 'Writing good functions with AI agents', link: '/guides/functions' },
    { text: 'Why your agent bill grows', link: '/guides/costs' },
    { text: 'Making agents verify their work', link: '/guides/verification' },
    { text: 'Why less code', link: '/why-less-code' },
  ] }],
  '/patterns/': GROUPS.map(([g, name]) => ({ text: name, collapsed: true, items: PATTERNS.filter(p => p.group === g).map(p => ({ text: nameOf(p), link: linkTo(p) })) })),
};

// Agents read the docs as plain Markdown: every page at its own address plus .md, an llms.txt index of those files, and
// llms-full.txt with all of them in one file. Written into the built site only.
const body = text => text.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
const front = (text, key) => {
  const set = text.match(/^---\n[\s\S]*?\n---\n/)?.[0].match(new RegExp(`^${key}: (.+)$`, 'm'))?.[1];
  return set && (set.startsWith('"') ? JSON.parse(set) : set);
};
// The home page is all frontmatter: its headline, line and cards become plain text.
const cards = text => [...text.matchAll(/- title: (.*)\n\s+details: (.*)/g)].map(m => [m[1], m[2]]);
const home = text => {
  const get = key => (text.match(new RegExp(`^\\s+${key}: (.*)$`, 'm')) || [])[1] || '';
  return ['# lessloc', get('text'), get('tagline'), cards(text).map(([t, d]) => `- **${t}.** ${d}`).join('\n'), body(text)].filter(Boolean).join('\n\n');
};
const pageOf = link => (link.endsWith('/') ? `${link}index.md` : `${link}.md`).replace(/^\//, '');
const linkOf = page => `/${page.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')}`;

// What search results, link cards, structured data and llms.txt say about a page, all taken from the page itself: its
// frontmatter description, or the first paragraph under its title, or its h2 headings; for a pattern, its catalog row.
// With a page's url, the text is HTML, as schema.org Answer text may be: links stay links, to absolute addresses.
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plain = (md, url) => {
  const links = [], text = md.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (_, t, to) => (url ? `\u0000${links.push([t, to]) - 1}\u0000` : t))
    .split(/(`[^`]*`)/).map((s, i) => (i % 2 ? s.slice(1, -1) : s.replace(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi, '').replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1$2').replace(/\{([a-z-]+)\}/g, '$1').replace(/&lt;/g, '<').replace(/&#123;/g, '{'))).join('').replace(/\s+/g, ' ').trim();
  return url ? esc(text).replace(/\u0000(\d+)\u0000/g, (_, i) => `<a href="${esc(new URL(links[i][1].replace(/\.md(?=#|$)/, ''), url).href)}">${esc(plain(links[i][0]))}</a>`) : text;
};
// Blocks read as sentences: a code block becomes one line of commands, and every paragraph, list item and code block ends
// with a stop, so none runs into the next.
const prose = (md, url) => plain(md.replace(/^```.*\n([\s\S]*?)^```/gm, (_, code) => `\`${code.trim().split(/\s*\n\s*/).join('; ')}\``).replace(/^\|.*$/gm, '')
  .replace(/^\s*(>|[-*]|\d+\.|#{1,6})\s+/gm, '').replace(/^(?!<).*\S(?=[ \t]*$)/gm, l => (/[.!?:;,]["')`*]*$/.test(l) ? l : `${l}.`)), url);
// A text longer than a search result shows ends at its last sentence end that fits; only when that leaves fewer than 50
// characters is it cut at a word, with an ellipsis.
const clip = (text, max = 155) => {
  if (text.length <= max) return text;
  const end = [...text.matchAll(/[.!?](?=\s+([A-Z`"]|lessloc\b))/g)].map(m => m.index + 1).filter(i => i <= max).at(-1);
  return end >= 50 ? text.slice(0, end) : `${text.slice(0, text.lastIndexOf(' ', max - 1)).replace(/[\s,;:]+$/, '')}…`;
};
const sections = text => body(text).split(/^## /m).slice(1).map(s => [plain(s.slice(0, s.indexOf('\n'))), s.slice(s.indexOf('\n') + 1)]);
const patternOf = page => PATTERNS.find(p => page === `patterns/${p.id}.md`);
// A sentence made to fit in `room` and still read whole: as it is, else up to a ";" or a ":" of its own (outside code, quotes
// and parentheses, and past a lead-in such as "What lessloc does:"), else without its asides of three or more words in
// parentheses, else up to a comma; at each step the longest that fits. Nothing, if none fits.
const stop = s => s.replace(/[\s.,;:]*$/, '.');
const fit = (s, room) => {
  const lead = s.match(/^(What lessloc does|lessloc gives every session the rule): /)?.[0].length || 0, at = (t, marks) => bare(t).filter(i => i > lead && marks.includes(t[i])).reverse().map(i => t.slice(0, i));
  const parens = bare(s).filter(i => '()'.includes(s[i])), asides = parens.reduceRight((t, i, k) => (s[i] === '(' && s[parens[k + 1]] === ')' && s.slice(i, parens[k + 1]).split(' ').length >= 3
    ? t.slice(0, i).trimEnd() + t.slice(parens[k + 1] + 1) : t), s);
  return [s, ...at(s, ';'), ...at(s, ':'), asides, ...at(asides, ',')].map(stop).find(t => plain(t).length <= room);
};
// A pattern's description: its title, then what lessloc does about it, then the standard that calls it a bad practice, each
// whole and only while they fit in `max`. What lessloc does comes before the standard, as it answers "does lessloc catch
// this": its first sentence goes after the title, or after the pattern's short name when only that leaves room for it whole,
// or cut to fit. A description still shorter than 100 characters ends with the pattern's group: its intro, or the line its
// page opens with, or only that it is one of the ways agents bloat software, whichever fits first.
const describe = (srcDir, page, max = 155) => {
  const p = patternOf(page);
  if (p) {
    const [first, ...more] = said(p.does).split(/(?<=\.) +/), standard = p.standard && p.standard !== '—' && `Why it is a bad practice: ${p.standard.split(';')[0]}`;
    const heads = [...new Set([plain(p.title).length > 100 ? nameOf(p) : p.title, nameOf(p)].map(h => plain(stop(h))))];
    const leads = [...heads.map(h => [h, first]), ...heads.map(h => [h, fit(first, max - h.length - 1)])].map(([h, s]) => s && `${h} ${plain(stop(s))}`);
    const at = leads.findIndex(l => l && l.length <= max);
    if (at < 0) return clip(plain([heads[0], first, ...more, standard].filter(Boolean).map(stop).join(' ')), max);
    let text = leads[at];
    const add = s => {
      const longer = `${text} ${plain(stop(s))}`;
      return longer.length <= max && (text = longer);
    };
    if (at < heads.length) more.every(add);
    if (standard) add(standard);
    const [, group, intro] = GROUPS.find(([g]) => g === p.group);
    if (text.length < 100) [intro, `${group}: one of the ways AI coding agents bloat software`, 'One of the ways AI coding agents bloat software'].filter(Boolean).find(add);
    return text;
  }
  const text = fs.readFileSync(path.join(srcDir, page), 'utf8'), set = front(text, 'description');
  if (set) return set;
  const h1 = body(text).match(/^# .*$/m);
  if (!h1) return DESCRIPTION;
  const rest = body(text).slice(h1.index + h1[0].length), lead = rest.split(/^#{2,6} /m)[0].split(/\n\s*\n/).map(b => b.trim()).find(b => /^(\*\*|[A-Za-z`["])/.test(b));
  return clip(lead ? plain(lead) : sections(text).map(([h]) => h.replace(/[^.?!]$/, '$&.')).join(' '), max) || DESCRIPTION;
};

// Structured data (schema.org JSON-LD). Every page names the site, its publisher and lessloc itself, since parsers do not follow
// an @id to another page; the home page adds the source code; the other pages carry where they sit (breadcrumbs) and what they
// are: an article, the FAQ, a how-to, or the pattern catalog.
const ref = id => ({ '@id': `${SITE}/#${id}` });
const ORG = { '@type': 'Organization', ...ref('org'), name: 'lessloc', url: `${SITE}/`, logo: `${SITE}/favicon-180.png`, sameAs: [REPO] };
const WEBSITE = { '@type': 'WebSite', ...ref('website'), name: 'lessloc', url: `${SITE}/`, description: DESCRIPTION, inLanguage: 'en', publisher: ref('org') };
const LICENSE = 'https://www.apache.org/licenses/LICENSE-2.0', NEEDS = [`Node.js ${PKG.engines.node.replace('>=', '')} or newer`, 'git'];
// lessloc itself: what it does is the home page's cards, and its help is the getting-started guide.
const SOFTWARE = [
  { '@type': 'SoftwareApplication', ...ref('software'), name: 'lessloc', description: DESCRIPTION, url: `${SITE}/`, applicationCategory: 'DeveloperApplication', operatingSystem: 'Linux, macOS, Windows',
    softwareRequirements: NEEDS.join(', '), softwareVersion: PKG.version, license: LICENSE, isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    downloadUrl: REPO, installUrl: `${SITE}/install`, sameAs: [REPO], publisher: ref('org'), author: ref('org'), image: CARD, keywords: PKG.keywords.join(', '),
    featureList: cards(fs.readFileSync(new URL('../index.md', import.meta.url), 'utf8')).map(([t, d]) => `${t}. ${d}`),
    softwareHelp: { '@type': 'CreativeWork', name: 'Getting started', url: `${SITE}/guide/getting-started` } },
  { '@type': 'SoftwareSourceCode', ...ref('source'), name: 'lessloc', codeRepository: REPO, programmingLanguage: 'JavaScript', runtimePlatform: 'Node.js', license: LICENSE, targetProduct: ref('software') },
];
const trail = (link, title) => {
  const [root, groups] = Object.entries(sidebar).find(([, gs]) => gs.some(g => g.items.some(i => i.link === link))) || [];
  const section = nav.find(n => (root ? n.link.startsWith(root) : n.link === link)), group = groups?.find(g => g.items.some(i => i.link === link));
  const crumbs = [['lessloc', '/'], section && [section.text, section.link], group && group.text !== section.text && [group.text, `${section.link}#${slug(group.text)}`], [title, link]].filter(Boolean);
  return crumbs.filter(([, l], i) => crumbs.findLastIndex(([, m]) => m === l) === i).map(([name, l], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + l }));
};
const graph = ({ page, url, title, name, description, modified, text }) => {
  const at = { url, name, description, inLanguage: 'en', isPartOf: ref('website'), about: ref('software'), ...(modified && { dateModified: modified }) };
  if (page === 'index.md') return [WEBSITE, ORG, ...SOFTWARE, { '@type': 'WebPage', '@id': `${url}#webpage`, ...at, name: title }];
  const parts = sections(text), steps = parts.filter(([h]) => /^\d+\. /.test(h));
  // The works a page cites: its links to anything other than lessloc's own site and repository.
  const cited = [...new Map([...body(text).replace(/^```[\s\S]*?^```/gm, '').matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)]
    .filter(([, , to]) => !to.startsWith(SITE) && !to.startsWith(REPO)).map(([, label, to]) => [to, { '@type': 'CreativeWork', name: plain(label), url: to }])).values()];
  const main = page === 'patterns/index.md'
    ? { '@type': 'CollectionPage', ...at, mainEntity: { '@type': 'ItemList', itemListElement: PATTERNS.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: nameOf(p), url: SITE + linkTo(p) })) } }
    : parts.length > 2 && parts.every(([h]) => h.endsWith('?'))
      ? { '@type': 'FAQPage', ...at, mainEntity: parts.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: prose(a, url) } })) }
      : { '@type': 'TechArticle', headline: name, ...at, image: CARD, author: ref('org'), publisher: ref('org'), ...(cited.length && { citation: cited }) };
  return [WEBSITE, ORG, SOFTWARE[0], { '@type': 'BreadcrumbList', itemListElement: trail(linkOf(page), patternOf(page) ? nameOf(patternOf(page)) : name) }, main,
    ...(steps.length > 1 ? [{ '@type': 'HowTo', name, description, url, tool: NEEDS.map(t => ({ '@type': 'HowToTool', name: t })),
      step: steps.map(([h, s]) => ({ '@type': 'HowToStep', name: h.replace(/^\d+\. /, ''), url: `${url}#${slug(h)}`, text: prose(s.split(/^### /m)[0]) })) }] : [])];
};

export default defineConfig({
  title: 'lessloc',
  description: DESCRIPTION,
  cleanUrls: true,
  // public/ holds files served as they are, such as the plain install.md, never pages of their own.
  srcExclude: ['public/**'],
  lastUpdated: true,
  sitemap: { hostname: SITE },
  // The theme's sidebar item with group titles as paragraphs, so a page's first heading is its own h1 (theme/SidebarItem.vue).
  vite: { resolve: { alias: [{ find: /^.*\/VPSidebarItem\.vue$/, replacement: fileURLToPath(new URL('./theme/SidebarItem.vue', import.meta.url)) }] } },
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico', sizes: 'any' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' }],
    ['link', { rel: 'apple-touch-icon', href: '/favicon-180.png' }],
    ['meta', { name: 'robots', content: 'max-image-preview:large' }],
    // Agents find the docs written for them from any page: llms.txt lists /agents first.
    ['link', { rel: 'alternate', type: 'text/plain', href: '/llms.txt', title: 'llms.txt' }],
    ['meta', { property: 'og:site_name', content: 'lessloc' }],
    ['meta', { property: 'og:locale', content: 'en_US' }],
    ['meta', { property: 'og:image', content: CARD }],
    ['meta', { property: 'og:image:type', content: 'image/png' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: 'lessloc: less lines of code' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: CARD }],
  ],
  themeConfig: {
    siteTitle: false,
    logo: { light: '/lessloc-mark-for-light.png', dark: '/lessloc-mark-for-dark.png', alt: 'lessloc' },
    nav,
    sidebar,
    // A pattern page's list of the other patterns in its group stays out of the search index, so a search finds each pattern on
    // its own page and the index the browser loads stays small.
    search: { provider: 'local', options: { _render: (src, env, md) => {
      const html = md.render(src.split(/^## Related patterns$/m)[0], env);
      return env.frontmatter?.search === false ? '' : html;
    } } },
    socialLinks: [{ icon: 'github', link: REPO }],
    editLink: { pattern: `${REPO}/edit/main/docs/:path` },
    footer: { message: 'Released under the Apache-2.0 license. · <a href="/llms.txt">llms.txt</a>' },
  },
  // A page's title in search results is its own (a pattern's short name, a frontmatter title, or its h1) plus "| lessloc", unless
  // the title already names lessloc or the suffix would take it past 60 characters. A pattern's short name also says where the
  // pattern comes from when that still fits with the suffix, as many of them are also names of general programming topics. A
  // title past 60 characters, a description that stops mid-phrase, and a pattern's description under 100 characters get a warning.
  transformPageData(pageData, { siteConfig }) {
    const p = patternOf(pageData.relativePath), name = p && nameOf(p);
    const title = p ? [...(/\bcode\b/.test(name) ? [] : [' in AI-written code']), ' from AI coding agents'].map(s => name + s).find(t => t.length <= 50) || name : pageData.title;
    if (title.length > 60) console.warn(`${pageData.relativePath}: its title is longer than 60 characters`);
    const own = pageData.frontmatter.titleTemplate === undefined && (title.length > 50 || /(^|\s)lessloc\b(?!\.)/.test(title));
    const description = describe(siteConfig.srcDir, pageData.relativePath);
    if (description.endsWith('…')) console.warn(`${pageData.relativePath}: its description stops mid-phrase; give it a description of its own`);
    if (p && description.length < 100) console.warn(`${pageData.relativePath}: its description is shorter than 100 characters`);
    return { description, ...(p && { title }), ...(own && { titleTemplate: false }) };
  },
  // Each page's address without .html, which GitHub Pages also serves, so engines index one URL per page.
  transformHead({ pageData, siteConfig, title, description }) {
    if (pageData.isNotFound) return [['meta', { name: 'robots', content: 'noindex' }]];
    const page = pageData.relativePath, url = SITE + linkOf(page), image = pageData.frontmatter.hero?.image;
    const modified = pageData.lastUpdated > 0 ? new Date(pageData.lastUpdated).toISOString() : undefined;
    const text = fs.readFileSync(path.join(siteConfig.srcDir, page), 'utf8');
    const ld = { '@context': 'https://schema.org', '@graph': graph({ page, url, title, name: pageData.title, description, modified, text }) };
    // VitePress escapes attributes but keeps what already reads as an entity, so a literal `&lt;` in the text needs its `&` escaped.
    const [what, heading] = [description, title].map(s => s.replace(/&(?=[\w#]+;)/g, '&amp;'));
    return [
      ['meta', { name: 'description', content: what }],
      ['link', { rel: 'canonical', href: url }],
      ['link', { rel: 'alternate', type: 'text/markdown', href: `/${page}` }],
      ['meta', { property: 'og:type', content: page === 'index.md' ? 'website' : 'article' }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:title', content: heading }],
      ['meta', { property: 'og:description', content: what }],
      ...(modified && page !== 'index.md' ? [['meta', { property: 'article:modified_time', content: modified }]] : []),
      ['meta', { name: 'twitter:title', content: heading }],
      ['meta', { name: 'twitter:description', content: what }],
      // The home banner's image for the system color scheme, which the theme shows unless the visitor picked the other appearance.
      ...(image ? [['dark', ''], ['light', 'not all and ']].map(([theme, not]) => ['link', { rel: 'preload', as: 'image', type: 'image/webp', href: image[theme], media: `${not}(prefers-color-scheme: dark)`, fetchpriority: 'high' }]) : []),
      ['script', { type: 'application/ld+json' }, JSON.stringify(ld).replace(/</g, '\\u003c')],
    ];
  },
  buildEnd(site) {
    const read = page => fs.readFileSync(path.join(site.srcDir, page), 'utf8');
    // Links in the Markdown point to the Markdown: absolute, so they still work inside llms-full.txt, and to each page's .md copy.
    const twin = (page, to) => {
      const url = new URL(to, SITE + linkOf(page));
      if (url.pathname.endsWith('/')) url.pathname += 'index.md';
      else if (!/\.\w+$/.test(url.pathname)) url.pathname += '.md';
      return url.href;
    };
    const absolute = (page, md) => md.split(/(^[ \t]*```[\s\S]*?^[ \t]*```)/m).map((s, i) => (i % 2 ? s : s.replace(/`[^`\n]*`|(?<!!)(\[(?:[^\]`]|`[^`\n]*`)*\]\()([^)\s]+)/g,
      (all, open, to) => (!open || /^([a-z][\w+.-]*:|#)/i.test(to) ? all : open + twin(page, to))))).join('');
    const markdown = page => absolute(page, (page === 'index.md' ? home : body)(read(page)));
    for (const page of site.pages) {
      const out = path.join(site.outDir, page);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, `${markdown(page)}\n`);
    }
    // A sidebar section's own index page, such as the pattern catalog, comes before its groups; a page no group lists comes last.
    const titleOf = page => front(read(page), 'title') || plain(body(read(page)).match(/^# (.*)$/m)?.[1] || linkOf(page));
    // A page with a title of its own is listed by it, not by its short sidebar label.
    const titled = items => items.map(i => ({ ...i, text: (site.pages.includes(pageOf(i.link)) && front(read(pageOf(i.link)), 'title')) || i.text }));
    const overview = root => (site.pages.includes(pageOf(root)) ? [{ text: nav.find(n => n.link === root)?.text || titleOf(pageOf(root)), items: [{ text: titleOf(pageOf(root)), link: root }] }] : []);
    const groups = [{ text: 'Start', items: [{ text: 'For AI agents: read this first', link: '/agents' }, { text: 'Install lessloc (steps for an agent)', link: '/install' }, { text: 'Remove lessloc (steps for an agent)', link: '/remove' }, { text: 'lessloc: overview', link: '/index' }, { text: 'Start here (for people)', link: '/start' }] },
      ...Object.entries(sidebar).flatMap(([root, gs]) => [...overview(root), ...gs.map(g => ({ ...g, items: titled(g.items) }))]), { text: 'Benchmarks', items: titled([{ text: 'Benchmarks', link: '/benchmarks' }]) }];
    groups.push({ text: 'More', items: site.pages.filter(page => !groups.some(g => g.items.some(i => pageOf(i.link) === page))).map(page => ({ text: titleOf(page), link: linkOf(page) })) });
    const seen = new Set(), listed = [];
    const about = [`> ${DESCRIPTION}`,
      `It runs inside your AI coding agent through the agent tool's hooks. It is free and open source (Apache-2.0), needs no account, and makes no network calls of its own ([every network contact](${SITE}/guide/faq.md#does-my-code-leave-my-machine)). Source code: [${REPO}](${REPO}). To install it, tell your coding agent: "Install lessloc for this project by following ${SITE}/install.md"`];
    // Agent fetch tools often shorten or summarise a long file, so llms.txt gives the size of the files in one and of the pages of
    // 20 KB or more, and an agent can fetch what it reads whole.
    const kb = text => Math.round(Buffer.byteLength(text) / 1000), lists = [];
    for (const g of groups) {
      const rows = g.items.filter(i => i.link && site.pages.includes(pageOf(i.link)) && !seen.has(pageOf(i.link)));
      if (!rows.length) continue;
      // Each line has the page's whole description, with no length limit, as agents read all of it.
      lists.push(`## ${g.text}\n\n${rows.map(({ text, link }) => {
        const page = pageOf(link), size = kb(markdown(page));
        return `- [${text}](${SITE}/${page})${size >= 20 ? ` (${size} KB)` : ''}: ${describe(site.srcDir, page, Infinity)}`;
      }).join('\n')}`);
      for (const i of rows) seen.add(pageOf(i.link)), listed.push(pageOf(i.link));
    }
    // The docs in one file; the pattern pages, one per kind of finding, in a file of their own. That file already holds every
    // pattern, so it leaves out each page's list of the other patterns in its group.
    const pattern = page => page.startsWith('patterns/') && page !== 'patterns/index.md';
    const all = (pages, trim = md => md) => `${[about.join('\n\n'), ...pages.map(page => `<!-- ${SITE}/${page} -->\n\n${trim(markdown(page))}`)].join('\n\n---\n\n')}\n`;
    const full = all(listed.filter(page => !pattern(page))), patterns = all(listed.filter(pattern), md => md.split(/^## Related patterns$/m)[0].trimEnd());
    fs.writeFileSync(path.join(site.outDir, 'llms-full.txt'), full);
    fs.writeFileSync(path.join(site.outDir, 'llms-patterns.txt'), patterns);
    const files = `Every page below is plain Markdown. The whole documentation, condensed for an AI coding agent (${kb(markdown('agents.md'))} KB): ${SITE}/agents.md. `
      + `The docs in one file (${kb(full)} KB): ${SITE}/llms-full.txt. The pattern pages in one file (${kb(patterns)} KB): ${SITE}/llms-patterns.txt`;
    fs.writeFileSync(path.join(site.outDir, 'llms.txt'), `${['# lessloc', ...about, files, ...lists].join('\n\n')}\n`);
  },
});
