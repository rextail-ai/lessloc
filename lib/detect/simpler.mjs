// Shorter idioms: lessloc's own (the languages in SIMPLIFIERS), plus what the language's simplification linter knows. ruff only parses, so it
// runs in hooks too; clippy builds the crate, which runs its build scripts, so only `ci` asks for it. Not SIM105:
// contextlib.suppress is the same swallowed error in fewer lines.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { idioms } from '../text.mjs';

const RUFF = ['check', '--select', 'SIM,C4,PERF401,PERF402,RET504,FURB,PIE,E711,E712,E731,UP,TRY203,PLR1714,PLR5501,PLR1711,PLR1730,PLW0120,F401,F841,F811', '--ignore', 'SIM105,SIM108,SIM115', '--per-file-ignores', '__init__.py:F401', '--output-format', 'json', '--exit-zero', '--force-exclude', '--no-cache'];
// Dead code ruff finds: reported as `unused`, and only once the work is done, since mid-work an import may be for the next edit.
const RUFF_UNUSED = /^F(401|841|811)$/;
const CLIPPY = ['clippy', '--quiet', '--message-format=json', '--', '-A', 'clippy::all', '-W', 'clippy::complexity', '-A', 'clippy::too_many_arguments', '-A', 'clippy::type_complexity',
  ...['needless_return', 'question_mark', 'redundant_closure', 'collapsible_if', 'collapsible_else_if', 'single_match', 'len_zero', 'manual_map', 'manual_find', 'needless_range_loop'].flatMap(l => ['-W', `clippy::${l}`])];
// Languages lessloc's own idioms cover; ruff and clippy go deeper where installed.
export const SIMPLIFIERS = new Set(['.py', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.go', '.rs', '.java', '.cs', '.kt', '.kts', '.swift', '.dart', '.php', '.c', '.h', '.cc', '.cpp', '.hpp']);

// ruff's findings for the change's Python files, run once per review: { ran, items }.
export function ruff(ctx) {
  const py = ctx.code().map(c => c.file).filter(f => f.endsWith('.py'));
  const r = py.length ? spawnSync('ruff', [...RUFF, ...py], { cwd: ctx.top, encoding: 'utf8', timeout: 60000 }) : null, ran = Boolean(r && !r.error && r.status === 0);
  return { ran, items: ran ? JSON.parse(r.stdout || '[]') : [] };
}

export default [
  {
    id: 'simpler', when: 'write',
    run(ctx) {
      const code = ctx.code(), at = new Map(code.map(c => [c.file, c])), hit = (file, line, msg, kind = 'simpler') => at.get(file)?.mine.has(line) && ctx.put(kind, file, line, msg);
      const { ran, items } = ctx.ruff();
      for (const x of items) if (!(ctx.quick && RUFF_UNUSED.test(x.code))) hit(path.relative(ctx.top, x.filename).split(path.sep).join('/'), x.location.row, `${x.message} (ruff ${x.code})`, RUFF_UNUSED.test(x.code) ? 'unused' : 'simpler');
      for (const c of code) for (const x of idioms(c.file, c.text, ran && c.file.endsWith('.py'))) hit(c.file, x.n, x.msg);
      if (ctx.build && code.some(c => c.file.endsWith('.rs')) && fs.existsSync(path.join(ctx.top, 'Cargo.toml'))) {
        for (const line of (spawnSync('cargo', CLIPPY, { cwd: ctx.top, encoding: 'utf8', timeout: 1800000, maxBuffer: 1 << 28 }).stdout || '').split('\n')) {
          let m;
          try { m = JSON.parse(line).message; } catch { continue; }
          const span = m?.code?.code?.startsWith('clippy::') && m.spans.find(x => x.is_primary);
          if (span) hit(span.file_name, span.line_start, `${m.message} (clippy ${m.code.code.slice(8)})`);
        }
      }
    },
  },
];
