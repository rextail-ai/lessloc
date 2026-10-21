// Every word an agent reads from lessloc, in one voice: a colleague's plain instruction at the moment it is cheapest to act on.
// Never lessloc's name, a path or command of its own, a finding kind, a count of notes or a citation; the agent should only
// ever see its own work and what is left to do. Text for the user (approval prompts) is the one place lessloc names itself.
import fs from 'node:fs';
import { clip, fmtDefs } from './text.mjs';

export const STANDARD = fs.readFileSync(new URL('../RULES.md', import.meta.url), 'utf8').trim();
// Subagents start cold and do one task; their parent already carries the whole standard.
export const SUBAGENT = 'Working standard: reuse code that already does the job (search first), change code in place, add no stub, mock data, debug print or silenced check, and never weaken tests, validation, error handling or security. Prove new behavior with a test that asserts it. End with one line: what you changed and what you verified.';

export const existing = defs => (defs.length ? `Existing code that may already do part of this (matched by name; search for other names too):\n${fmtDefs(defs)}` : '');

export function constraints(cfg) {
  const rules = [...cfg.protect.map(g => `only the user changes \`${g}\``), ...cfg.boundaries.map(b => `\`${b.files}\` must not import \`${b.mustNotImport}\`${b.why ? ` (${b.why})` : ''}`)];
  return rules.length ? `In this project: ${rules.join('; ')}.` : '';
}

const VERIFIED = { 'no code changed': 'it changed no code',  'tests passed': 'its tests passed at its final state', 'tests failed': 'its tests failed at its final state', 'tests not run': 'its tests did not run at its final state', 'tests changed': 'it changed how the tests run', 'no test command': 'this project has no test command' };
// Nothing that names lessloc is passed on.
export function handoff(e, hours) {
  const files = `${e.files.slice(0, 6).join(', ')}${e.files.length > 6 ? ` and ${e.files.length - 6} more` : ''}`, quiet = t => !/lessloc/i.test(t);
  const open = (e.open || []).filter(quiet), said = e.said && quiet(e.said) ? e.said : '';
  return `The last session here (${hours ? `${hours}h` : 'under an hour'} ago) was asked "${clip(e.prompt, 160)}" and left uncommitted changes in ${files}${VERIFIED[e.verified] ? `; ${VERIFIED[e.verified]}` : ''}${open.length ? `; left open: ${open.join('; ')}` : ''}.${said ? ` It ended with: "${clip(said.replace(/\s+/g, ' '), 300)}"` : ''}`;
}

// A finding as one plain line (the review splits a message's source off). lessloc's own files are never named to the agent:
// the policy file's message says what it is.
const OWN = /(^|\/)\.lessloc(-baseline)?\.json$/;
export const line = f => `${f.file && !OWN.test(f.file) ? `${f.file}${f.line ? `:${f.line}` : ''}: ` : ''}${f.msg}`;
const bullets = F => F.map(f => `- ${line(f)}`).join('\n');

// A write that never lands, in the tool's own error.
const REFUSE = {
  junk: [i => `\`${i.file}\` is a backup, copy, scratch or report file`, 'Edit the real file instead; git keeps history.'],
  placeholder: [i => `it adds a placeholder (\`${clip(i.text, 60)}\`)`, 'Write the real code, or tell the user plainly what is not done.'],
  'commented-out': [i => `it adds commented-out code (\`${clip(i.text, 60)}\`)`, 'Delete what is no longer used; git keeps history.'],
};
export function refusal(items) {
  const kinds = [...new Set(items.map(i => i.kind))];
  return `Not applied: ${kinds.map(k => REFUSE[k][0](items.find(i => i.kind === k))).join(', and ')}. ${kinds.map(k => REFUSE[k][1]).join(' ')}`;
}
// Decisions only the user may make: the approval prompt names lessloc for the user; a host that cannot ask gets the agent to.
export const asking = (reason, why) => ({ user: `lessloc: ${reason}. ${why}`, agent: `Not applied: ${reason}, and only the user may approve that. Ask them in your reply; if they agree, they can do it themselves.` });
export const bypass = flag => asking(`this command skips the project's own checks (\`${clip(flag, 40)}\`)`, 'Approve only if you asked for that; otherwise the agent should fix what the checks report.');
export const guarded = files => {
  const name = own => files.map(f => (own && OWN.test(f.file) ? "the project's policy file" : `\`${f.file}\``)).join(', '), be = files.length > 1 ? 'are' : 'is';
  return { user: asking(`${name(false)} ${be} protected in this project`, 'Only you change it, so approve only what you asked for.').user, agent: asking(`${name(true)} ${be} protected in this project`, '').agent };
};

// Right after a write: one line per problem that is cheapest to fix while the code is still open.
export const writeNote = F => (F.length === 1 ? line(F[0]) : bullets(F));

// What the turn's tests show, as the one thing to do about them.
export const tests = {
  failed: cmd => `The tests fail on the final state (\`${clip(cmd, 80)}\`): fix the cause, or say why the failure is expected.`,
  redefined: files => `You changed how the tests run this turn (${files.map(f => `\`${f}\``).join(', ')}), so a pass no longer shows the code works: revert that, or say in one line why it is needed.`,
};

// Part of the request the agent's own reply says it left failing, quoted back with the one thing to do about it.
const youSay = q => `You say: "${clip(q, 220)}"`;
export const unfinished = {
  admitted: q => `${youSay(q)} That is part of the request and it still fails: fix it in this change. Leave it only if the request itself rules it out, and quote that line.`,
  suspected: q => `${youSay(q)} Check it now, and fix it in this change if it fails the same way.`,
};

// A turn far past what tasks take, once: a request with no natural end otherwise runs until something stops it.
export const pace = 'This turn has taken many steps. If what is left of the request has no natural end (all coverage, every warning, every case), finish with what works now and say exactly what is left. Otherwise carry on.';

// A name the request asked for that the final code never has.
export const missing = names => `The request asks for ${names.map(n => `\`${n}\``).join(' or ')}; ${names.length > 1 ? 'none of these appears' : 'it appears nowhere'} in this repository.`;

// The end of a turn with work left: at most once per turn, everything that is unfinished, and nothing else.
export const hold = (size, F) => `Before you finish (this turn: ${size}):\n${bullets(F.slice(0, 8))}\nFix only these and add nothing else for this note. If one is intended, say why in one line. Then finish.`;
