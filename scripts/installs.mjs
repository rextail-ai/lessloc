#!/usr/bin/env node
// Counts lessloc's installs on every channel that publishes a number, and draws the README's slime from the count
// (.github/workflows/installs.yml runs it every 5 minutes). The channels: npm downloads (npm, Pi, OpenCode and Kilo install from
// npm), downloads of the release asset (Gemini CLI and Qwen Code install it), and the repository's unique cloners per day (the
// install sentence and the Claude Code, Codex, Copilot and Cursor marketplaces clone it), less one on each day lessloc's own
// workflows cloned it. npm and GitHub keep daily counts for a while only (GitHub: 14 days), so the days go into a ledger,
// installs.json, that each run extends. It and the slime, in a light and a dark copy for GitHub's theme, are the only files on
// the branch `installs`, rewritten as a single commit. --dry prints the count instead of writing it.
import { slime } from './slime.mjs';

const REPO = process.env.GITHUB_REPOSITORY || 'rextail-ai/lessloc', BRANCH = 'installs', API = 'https://api.github.com';
const DARK = /@media \(prefers-color-scheme: ?dark\)/, DAY = 864e5, sum = o => Object.values(o).reduce((a, b) => a + b, 0);
const merge = (days = {}, fresh) => {
  const out = { ...days };
  for (const [d, n] of fresh) out[d] = Math.max(out[d] || 0, n);
  return out;
};

// The ledger after this run's counts. recent is the installs of the last 24 hours, from the totals the ledger saw change.
export function count(old, { clones = [], npm = [], assets = 0, ours = [], now = new Date() }) {
  const ledger = { clones: merge(old.clones, clones), ours: [...new Set([...(old.ours || []), ...ours])].sort(), npm: merge(old.npm, npm), assets: Math.max(old.assets || 0, assets) };
  const mine = new Set(ledger.ours);
  const total = Object.entries(ledger.clones).reduce((a, [d, n]) => a + Math.max(0, n - (mine.has(d) ? 1 : 0)), 0) + sum(ledger.npm) + ledger.assets;
  let history = old.history || [];
  if (history.at(-1)?.total !== total) history = [...history, { at: now.toISOString(), total }];
  const older = history.filter(h => now - Date.parse(h.at) >= DAY), base = older.at(-1) || { total: 0 };
  return { ...ledger, total, recent: total - base.total, history: [...older.slice(-1), ...history.filter(h => now - Date.parse(h.at) < DAY)] };
}

async function api(url, { token, method = 'GET', body } = {}) {
  const r = await fetch(url, { method, body: body && JSON.stringify(body), headers: { accept: 'application/vnd.github+json', 'user-agent': 'lessloc-installs', ...(token && { authorization: `Bearer ${token}` }) } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function main() {
  const token = process.env.GITHUB_TOKEN, traffic = process.env.TRAFFIC_TOKEN, dry = process.argv.includes('--dry');
  const file = async f => {
    const c = await api(`${API}/repos/${REPO}/contents/${f}?ref=${BRANCH}`, { token });
    return c && Buffer.from(c.content, 'base64').toString('utf8');
  };
  const since = new Date(Date.now() - 15 * DAY).toISOString().slice(0, 10);
  const [ledger, svg, clones, npm, releases, runs] = await Promise.all([
    file('installs.json').then(t => (t ? JSON.parse(t) : {})),
    file('slime-light.svg'),
    // Without the token (Administration: read on this repository) the clone days in the ledger stay as they are.
    traffic ? api(`${API}/repos/${REPO}/traffic/clones`, { token: traffic }).catch(e => (console.error(`clones skipped: ${e.message}`), null)) : null,
    api('https://api.npmjs.org/downloads/range/last-month/lessloc'),
    api(`${API}/repos/${REPO}/releases?per_page=100`, { token }),
    api(`${API}/repos/${REPO}/actions/runs?per_page=100&created=>=${since}`, { token }),
  ]);
  const next = count(ledger, {
    clones: (clones?.clones || []).map(c => [c.timestamp.slice(0, 10), c.uniques]),
    npm: (npm?.downloads || []).map(d => [d.day, d.downloads]),
    assets: (releases || []).flatMap(r => r.assets).reduce((a, x) => a + x.download_count, 0),
    ours: (runs?.workflow_runs || []).filter(r => r.name !== 'installs').map(r => r.created_at.slice(0, 10)),
  });
  const drawn = slime({ total: next.total, recent: next.recent }), light = drawn.replace(DARK, '@media not all');
  console.log(`${next.total} installs, ${next.recent} in the last 24 hours`);
  if (dry || light === svg) return;
  const tree = await api(`${API}/repos/${REPO}/git/trees`, { token, method: 'POST', body: { tree: [['installs.json', `${JSON.stringify(next, null, 2)}\n`], ['slime-light.svg', light], ['slime-dark.svg', drawn.replace(DARK, '@media all')]].map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })) } });
  const commit = await api(`${API}/repos/${REPO}/git/commits`, { token, method: 'POST', body: { message: `${next.total} installs`, tree: tree.sha, parents: [] } });
  const ref = `${API}/repos/${REPO}/git/refs`;
  if (await api(`${ref}/heads/${BRANCH}`, { token })) await api(`${ref}/heads/${BRANCH}`, { token, method: 'PATCH', body: { sha: commit.sha, force: true } });
  else await api(ref, { token, method: 'POST', body: { ref: `refs/heads/${BRANCH}`, sha: commit.sha } });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
