// What every plugin bridge shares. An agent tool with a plugin API instead of hook commands loads a bridge (opencode/server.js,
// amp/plugin.js, cline/plugin.js, pi/extension.js), which sends each event to its own `hook.mjs --host <row>` process in the
// generic protocol (docs/guide/any-agent.md) and applies the answer through the tool's API.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../hook.mjs', import.meta.url));

// One event and its answer. `wait`: answer nothing after that many milliseconds, for a tool that turns off a plugin whose
// hooks run long; the hook still finishes its work. `detach`: no answer is wanted, and the hook outlives the tool's call.
// The hook starts in lessloc's own folder, so Windows never finds a `node` the repository holds; the event names the repository.
export function call(host, cwd, input, { wait, detach } = {}) {
  return new Promise(resolve => {
    const p = spawn('node', [HOOK, '--host', host], { cwd: path.dirname(HOOK), stdio: ['pipe', detach ? 'ignore' : 'pipe', 'ignore'], ...(detach && { detached: true }) });
    let out = '';
    const timer = wait && setTimeout(() => resolve({}), wait);
    // Hooks fail open: no node, a crash or no answer leaves the agent alone.
    p.on('error', () => resolve({}));
    if (detach) p.unref();
    else {
      p.stdout.on('data', d => (out += d));
      p.on('close', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(out || '{}')); } catch { resolve({}); }
      });
    }
    p.stdin.end(JSON.stringify({ cwd: cwd ?? process.cwd(), ...input }));
    if (detach) resolve({});
  });
}

// Feedback goes after a tool's result, never in place of it: a text, or a list of content parts.
export const append = (content, text) => (typeof content === 'string' ? `${content}\n\n${text}` : [...(content || []), { type: 'text', text }]);
export const joined = (...parts) => parts.filter(Boolean).join('\n\n');
