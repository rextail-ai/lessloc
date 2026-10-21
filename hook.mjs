#!/usr/bin/env node
// What agent tools run on each hook event. Some show its command line to their model, so its name says no more than this.
import { hook, lint } from './lib/agent.mjs';

const at = process.argv.indexOf('--host'), host = at > 0 ? process.argv[at + 1] : undefined;
try {
  // Aider runs it as its lint command, with the files its model edited.
  await (host === 'aider' ? lint(process.argv.slice(at + 2)) : hook(host, at > 0 ? process.argv[at + 2] : undefined));
} catch (e) {
  // Hooks fail open: a lessloc bug must never block the agent.
  if (process.env.LESSLOC_DEBUG) console.error(e);
}
