#!/usr/bin/env node
// Builds the Gemini CLI extension in a folder: lessloc's hook runtime, with gemini/gemini-extension.json and gemini/hooks/ at
// its root. The release workflow packs that folder as the release's one asset, which
// `/extensions install https://github.com/rextail-ai/lessloc` downloads. Gemini loads an extension's hooks only from
// hooks/hooks.json, and Claude Code would load a hooks/hooks.json at the repository's root too, so the file lives in gemini/.
// skills/ stays out: Gemini would list its skill to the model. Qwen Code installs the same asset, and reads its own manifest
// (qwen-extension.json) before Gemini's, so that goes in too.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)), out = path.resolve(process.argv[2] || 'dist/gemini');
fs.rmSync(out, { recursive: true, force: true });
for (const f of ['hook.mjs', 'lessloc.mjs', 'lib', 'RULES.md', 'PATTERNS.md', 'package.json', 'LICENSE', 'qwen-extension.json', 'qwen-hooks.json']) fs.cpSync(path.join(ROOT, f), path.join(out, f), { recursive: true });
fs.cpSync(path.join(ROOT, 'gemini'), out, { recursive: true });
console.log(out);
