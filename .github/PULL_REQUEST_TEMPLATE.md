## What this changes

<!-- One or two sentences in a user's words. Link the issue it closes. -->

## Checklist

- [ ] `npm test` passes
- [ ] `test/golden/claude.jsonl` is unchanged
- [ ] Generated files were regenerated, not edited by hand (`node lessloc.mjs catalog --write`, `node lessloc.mjs hosts --write`)
- [ ] docs/guide says what the code now does
- [ ] Any text an agent reads is in `lib/voice.mjs` or a finding's message, and names nothing of lessloc
- [ ] A kind that newly stops turns comes with `node bench/replay.mjs` results on public repositories
