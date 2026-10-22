// How each agent tool runs in the end-to-end tests: its pinned version, its install route for lessloc, its tool names, its
// environment and its headless command. Everything else (what lessloc promises the tool) comes from lib/hosts.mjs and the
// fixtures, never from here.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { HOSTS } from '../../lib/hosts.mjs';
import { parse } from './record.mjs';

export const CACHE = process.env.E2E_CACHE || path.join(os.homedir(), '.cache', 'lessloc-e2e');
const PINS = JSON.parse(fs.readFileSync(new URL('./tools.json', import.meta.url), 'utf8'));
const PLUGIN = JSON.parse(fs.readFileSync(new URL('../../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
// Where a tool reads each part of lessloc's answer: its host fixture's answer paths, as in the contract tests.
const answer = host => JSON.parse(fs.readFileSync(new URL(`../fixtures/hosts/${host}.json`, import.meta.url), 'utf8')).answer;

// The tool's binary: an absolute path in E2E_BIN_<PIN>, or the pinned version in the cache, installed with E2E_INSTALL=1. Never
// one found on PATH, where a wrapper may stand in for the tool. Null when it is not there.
export function bin(pin) {
  const given = process.env[`E2E_BIN_${pin.toUpperCase()}`];
  if (given) return given;
  const p = PINS[pin], name = p.npm.replace('{platform}', process.platform).replace('{arch}', process.arch), dir = path.join(CACHE, `${pin}@${p.version}`);
  const exe = path.join(dir, 'node_modules', name, p.bin), env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir };
  if (!fs.existsSync(path.join(dir, '.ok'))) {
    if (!process.env.E2E_INSTALL) return null;
    fs.mkdirSync(dir, { recursive: true });
    spawnSync('npm', ['install', '--prefix', dir, '--ignore-scripts', '--no-save', '--no-audit', '--no-fund', `${name}@${p.version}`], { env, stdio: 'ignore' });
    if (!spawnSync(exe, ['--version'], { env, encoding: 'utf8' }).stdout?.includes(p.version)) throw new Error(`${name}@${p.version} did not install`);
    fs.writeFileSync(path.join(dir, '.ok'), '');
  }
  return exe;
}

// Claude Code, from the plugin marketplace or with --plugin-dir. Its subagents run in the background.
const claude = plugindir => ({
  id: plugindir ? 'claude-plugindir' : 'claude', host: 'claude', pin: 'claude', protocol: 'anthropic',
  tools: { write: 'Write', edit: 'Edit', shell: 'Bash', agent: 'Agent' },
  args: { agent: { subagent_type: 'general-purpose' } },
  events: Object.keys(PLUGIN.hooks), homes: ['.claude', '.claude.json'],
  // Where Claude Code reads each part of lessloc's answer (it has no host fixture: its payloads are the recorded golden session's).
  answer: { context: 'hookSpecificOutput.additionalContext', deny: 'hookSpecificOutput.permissionDecisionReason', block: 'reason|decision=block' },
  route: async t => plugindir || (t.tool(['plugin', 'marketplace', 'add', t.lessloc]).status === 0 && t.tool(['plugin', 'install', 'lessloc@lessloc']).status === 0),
  env: t => ({
    CLAUDE_CONFIG_DIR: t.config, CLAUDE_CODE_TMPDIR: t.tmp, ANTHROPIC_BASE_URL: t.url, ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'fake-haiku',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1', DISABLE_ERROR_REPORTING: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
  }),
  run: (t, prompt) => ['-p', prompt, '--model', 'claude-sonnet-4-5', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', ...(plugindir ? ['--plugin-dir', t.lessloc] : [])],
  // doctor knows a plugin Claude Code installed; one loaded with --plugin-dir lives only as long as the session.
  doctor: !plugindir && 'Claude Code',
  timeout: 90,
});

// Persists trust in the hooks Codex lists for the work repository, the way the user's one-time /hooks in Codex does: each
// hook's current hash, from `codex app-server`, under its key in config.toml.
async function trust(t) {
  const p = spawn(t.exe, ['app-server'], { cwd: t.work, env: t.env, stdio: ['pipe', 'pipe', 'ignore'] });
  for (const o of [{ id: 1, method: 'initialize', params: { clientInfo: { name: 'e2e', title: 'e2e', version: '0' } } }, { method: 'initialized' }, { id: 2, method: 'hooks/list', params: { cwds: [t.work] } }]) p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...o })}\n`);
  const reply = await new Promise(resolve => {
    setTimeout(resolve, 30000, {});
    readline.createInterface({ input: p.stdout }).on('line', l => parse(l).id === 2 && resolve(parse(l)));
  });
  p.kill();
  const hooks = reply.result?.data.flatMap(d => d.hooks) ?? [];
  fs.appendFileSync(path.join(t.config, 'config.toml'), hooks.map(h => `\n[hooks.state.${JSON.stringify(h.key)}]\ntrusted_hash = ${JSON.stringify(h.currentHash)}\n`).join(''));
  return hooks.length > 0;
}
// Codex's free-text apply_patch for a write (a new file) or an edit (the old lines out, the new lines in).
const lines = (text, mark) => text.replace(/\n$/, '').split('\n').map(l => `${mark}${l}\n`).join('');
const patch = s => `*** Begin Patch\n${s.content != null ? `*** Add File: ${s.path}\n${lines(s.content, '+')}` : `*** Update File: ${s.path}\n@@\n${lines(s.old, '-')}${lines(s.new, '+')}`}*** End Patch\n`;

// Codex with `init --codex`. Its model sees exec_command and apply_patch; its hooks see Bash and apply_patch.
const codex = {
  id: 'codex', host: 'codex', pin: 'codex', protocol: 'responses',
  tools: { write: 'apply_patch', edit: 'apply_patch', shell: 'exec_command' }, text: patch,
  events: Object.keys(HOSTS.codex.hooks.events), homes: ['.codex'], answer: answer('codex'),
  // gpt-5.5, a model Codex knows, so it offers apply_patch; plugins off, so it syncs no plugin list.
  files: t => ({ [path.join(t.config, 'config.toml')]: `model = "gpt-5.5"\nmodel_provider = "fake"\ncheck_for_update_on_startup = false\n\n[model_providers.fake]\nname = "fake"\nbase_url = "${t.url}/v1"\nenv_key = "FAKE_API_KEY"\nwire_api = "responses"\n\n[features]\nplugins = false\n\n[analytics]\nenabled = false\n\n[feedback]\nenabled = false\n` }),
  route: async t => t.init('--codex').status === 0 && trust(t),
  env: t => ({ CODEX_HOME: t.config, FAKE_API_KEY: 'sk-test' }),
  run: (t, prompt) => ['exec', '--json', '--sandbox', 'workspace-write', prompt],
  doctor: 'Codex',
  timeout: 90,
};

// OpenCode 2.x with `init --opencode`, from a provider of the user's own. Its turn end runs only in a server, so the session
// is a `serve` and a `run --server` against it.
const opencode2 = {
  id: 'opencode2', host: 'opencode', pin: 'opencode2', protocol: 'chat',
  tools: { write: 'write', edit: 'edit', shell: 'shell' },
  events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'], homes: ['.config/opencode', '.local/share/opencode'], answer: answer('generic'),
  files: t => ({ [path.join(t.home, '.config/opencode/opencode.jsonc')]: JSON.stringify({ update: 'disable', providers: { fake: { name: 'Fake', package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `${t.url}/v1`, apiKey: 'sk-test' }, models: { 'fake-model': { name: 'Fake' } } } } }) }),
  route: async t => t.init('--opencode').status === 0,
  env: () => ({ OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_SERVER_PASSWORD: 'e2e', OPENCODE_PASSWORD: 'e2e' }),
  serve: t => ['serve', '--hostname', '127.0.0.1', '--port', String(t.port)],
  run: (t, prompt) => ['run', '--server', `http://127.0.0.1:${t.port}`, '--auto', '--format', 'json', '-m', 'fake/fake-model', prompt],
  doctor: 'OpenCode',
  timeout: 120,
};

export const ADAPTERS = [claude(false), claude(true), codex, opencode2];
