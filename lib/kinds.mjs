// Every finding kind lessloc reports, with its tier and whether it stops an agent's turn by default. Tier 0 fails `check`, 1 is a
// risk, 2 duplication or structure, 3 knowledge, 4 size. A kind stops a turn only when it is precise enough that a fix is almost
// always right, as replaying commits humans already merged in public repositories shows (bench/replay.mjs).
const KINDS = [
  ['tests-failed', 0, true], ['ratchet', 0], ['config', 0], ['policy', 0, true], ['protected', 0, true], ['boundary', 0, true], ['dependency', 0, true],
  ['secret', 0, true], ['placeholder', 0, true], ['commented-out', 0, true], ['junk-file', 0, true], ['weakened-tests', 0, true],
  ['swallowed-error', 1, true], ['suppression', 1, true], ['unsafe', 1, true], ['made-up-api', 1, true], ['test-logic', 1, true], ['stub', 1, true],
  ['debug-leftover', 1, true], ['empty-test', 1, true], ['untested', 1, true], ['unaddressed', 1, true], ['unfinished', 1, true], ['removed-safeguard', 1], ['copy', 1, true], ['versioned-copy', 1, true], ['unverified', 1, true],
  ['simpler', 2], ['reinvented', 2], ['defensive', 2], ['unused', 2], ['single-use', 2], ['near-copy', 2], ['repeated-literal', 2], ['style-copy', 2], ['similar-name', 2], ['wrapper', 2], ['single-impl', 2],
  ['if-chain', 2], ['mode-flag', 2], ['long-params', 2], ['deep-nesting', 2], ['long-function', 2], ['clever', 2], ['copied-tests', 2], ['demo-code', 2],
  ['unrequested-file', 2], ['tiny-file', 2], ['new-folder', 2], ['swollen-file', 2], ['vague-name', 2], ['junk-drawer', 2], ['moved-files', 2],
  ['new-dependency', 2], ['refactor-tests', 2], ['churn', 2],
  ['narration', 3], ['history', 3], ['todo', 3], ['comment-density', 3], ['comment-block', 3], ['dense-lines', 3], ['stale-doc', 3], ['doc-removed', 3],
  ['unrequested-doc', 3], ['long-instructions', 3],
  ['net-growth', 4], ['new-files', 4],
];
export const CHECKS = Object.fromEntries(KINDS.map(([k, tier]) => [k, tier]));
export const INTERRUPT = KINDS.filter(k => k[2]).map(([k]) => k);
