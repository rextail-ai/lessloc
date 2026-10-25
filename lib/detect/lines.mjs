// Write-time detectors: what the lines a change wrote show on their own. They run right after each write and again at the end of
// a turn, so each must be cheap and precise. Kinds a line can only be judged for once the work is done carry `late`.
import { POLICY, ENV_FILE, glob, junk, mentioned } from '../repo.mjs';
import { classify, clip, isHistory, lineFindings, restates, restatesParam, secretIn, swallowed, typeLines } from '../text.mjs';

const IMPORT_LINE = /^(import|from|use|using|#include|require)\b|\b(require|import)\(/;

export default [
  {
    id: 'policy', when: 'write',
    run(ctx) {
      for (const c of ctx.agent ? ctx.list : []) {
        if (ctx.asked.includes(c.file)) continue;
        if (POLICY.test(c.file)) ctx.put('policy', c.file, 0, 'the project\'s policy file changed without the user approving it: revert it, or ask the user');
        else if (ctx.cfg.protect.some(g => glob(g).test(c.file))) ctx.put('protected', c.file, 0, 'protected path changed without the user approving it: revert it, or ask the user');
      }
      for (const rule of ctx.cfg.boundaries) {
        for (const c of ctx.live.filter(c => glob(rule.files).test(c.file))) {
          c.text.split('\n').forEach((t, i) => {
            if (c.added.has(i + 1) && IMPORT_LINE.test(t.trim()) && new RegExp(rule.mustNotImport).test(t)) ctx.put('boundary', c.file, i + 1, `${rule.files} must not import ${rule.mustNotImport}${rule.why ? ` (${rule.why})` : ''}`);
          });
        }
      }
    },
  },
  {
    // Files that should not exist, and credentials that should not be written down.
    id: 'files-and-secrets', when: 'write',
    run(ctx) {
      for (const c of ctx.live) {
        if (c.isNew && junk(c.file, ctx.has) && !mentioned(c.file, ctx.prompt)) ctx.put('junk-file', c.file, 0, 'backup, copy, scratch or report file: delete it; git keeps history, and needed content belongs in existing files');
        if (c.isNew && ENV_FILE.test(c.file)) ctx.put('secret', c.file, 0, 'environment file would be committed: add it to .gitignore and commit a `.env.example` with the names only (CWE-798)');
        c.text.split('\n').forEach((t, i) => {
          const key = c.mine.has(i + 1) && secretIn(t);
          if (key) ctx.put('secret', c.file, i + 1, `credential \`${key.slice(0, 8)}...\` in the source: read it from the environment, keep it out of git, and rotate it if it was ever pushed (CWE-798)`);
        });
      }
    },
  },
  {
    // Comments and single lines: placeholders, dead code, stubs, narration, history, and the line rules in text.mjs.
    id: 'lines', when: 'write',
    run(ctx) {
      for (const c of ctx.live) {
        const { exempt, test } = ctx.role(c), added = ctx.added(c), typed = ctx.typed(c), narrated = [], had = new Map();
        // A marker a rewritten line already carried (an edited line keeping its `# type: ignore`) is not one the change added;
        // a removed line still in the code somewhere only moved, and carries nothing over.
        if (added.length) {
          const back = ctx.once('back', () => new Set([...ctx.texts.values()].flatMap(t => t.split('\n').map(x => x.trim()))));
          for (const l of typeLines(c.file, c.gone.filter(t => !back.has(t.trim())).join('\n'))) for (const x of lineFindings(c.file, l, test)) had.set(x.kind, (had.get(x.kind) || 0) + 1);
        }
        // History is a sentence's: a comment line that starts in lower case goes on the sentence of the comment line above when that
        // one does not end it. A capitalized line starts its own, as under a heading without a full stop.
        const sentence = l => {
          const above = typed[l.n - 2];
          return /^\p{Ll}/u.test(l.body) && above?.kind === 'comment' && above.body && !/[.!?:;]$/.test(above.body) ? `${above.body} ${l.body}` : l.body;
        };
        const hist = added.filter(l => l.kind === 'comment' && isHistory(sentence(l))).map(l => l.n);
        for (const l of added) {
          const k = classify(l);
          if (k === 'placeholder' || k === 'commented-out') ctx.put(k, c.file, l.n, `${k === 'placeholder' ? 'placeholder' : 'commented-out code'}: delete \`${clip(l.t)}\``);
          else if (k === 'stub') { if (!ctx.quick && !exempt) ctx.put('stub', c.file, l.n, `\`${clip(l.t, 60)}\`: finish it, or tell the user plainly what is not real yet and mark it \`shortcut: <what, and when to replace it>\``); }
          else if ((k || restatesParam(l)) && !hist.includes(l.n)) narrated.push(l.n);
          for (const x of exempt && !test ? [] : lineFindings(c.file, l, test)) {
            if (had.get(x.kind) > 0) had.set(x.kind, had.get(x.kind) - 1);
            else if (x.kind === 'narration') narrated.push(l.n);
            else if (!(ctx.quick && x.late)) ctx.put(x.kind, c.file, l.n, `\`${clip(l.t, 50)}\`: ${x.msg}`);
          }
        }
        narrated.push(...ctx.born(c).filter(d => d.d && restates(d)).map(d => d.l));
        if (narrated.length) ctx.put('narration', c.file, narrated[0], `${narrated.length} comment(s) narrate the code, decorate it or restate a name (line ${[...new Set(narrated)].slice(0, 5).join(', ')}): delete them, keep only whys`);
        if (hist.length) ctx.put('history', c.file, hist[0], 'dates, change history or notes to the requester in comments: they belong in the commit message, the reply or the decision log');
        if (ctx.role(c).code && !exempt) for (const l of added) if (swallowed(ctx.typed(c), l)) ctx.put('swallowed-error', c.file, l.n, 'swallowed error: let it reach a boundary that handles it, or catch only the error you expect');
      }
    },
  },
];
