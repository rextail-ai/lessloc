// How each agent tool runs in the end-to-end tests: its pinned version, its install route for lessloc, its tool names, its
// environment and its headless command. Everything else (what lessloc promises the tool) comes from lib/hosts.mjs and the
// fixtures, never from here.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { HOSTS } from '../../lib/hosts.mjs';
import { event, parse } from './record.mjs';

export const CACHE = process.env.E2E_CACHE || path.join(os.homedir(), '.cache', 'lessloc-e2e');
const PINS = JSON.parse(fs.readFileSync(new URL('./tools.json', import.meta.url), 'utf8'));
const PLUGIN = JSON.parse(fs.readFileSync(new URL('../../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
// The events a tool's hook file sets up, in lessloc's names (Gemini's BeforeTool is PreToolUse, Copilot's agentStop Stop).
const named = (host, events) => events.map(e => event(host, { hook_event_name: e }, [e]));
// Where a tool reads each part of lessloc's answer, and which test runs its hooks can see (`evidence`): its host fixture's, as
// in the contract tests.
const fixture = host => JSON.parse(fs.readFileSync(new URL(`../fixtures/hosts/${host}.json`, import.meta.url), 'utf8'));
const answer = host => fixture(host).answer;

// The tool's binary: an absolute path in E2E_BIN_<PIN>, or the pinned version in the cache, installed with E2E_INSTALL=1. Never
// one found on PATH, where a wrapper may stand in for the tool. Null when it is not there. A tool whose npm package fetches its
// binary in a postinstall is pinned to its release tarball for this platform, and that file's sha256.
export function bin(pin) {
  const given = process.env[`E2E_BIN_${pin.toUpperCase()}`];
  if (given) return given;
  const p = PINS[pin], tarball = p.tarball?.[`${process.platform}-${process.arch}`], name = p.npm?.replace('{platform}', process.platform).replace('{arch}', process.arch) ?? pin, dir = path.join(CACHE, `${pin}@${p.version}`);
  const exe = tarball ? path.join(dir, p.bin) : path.join(dir, 'node_modules', name, p.bin), env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir };
  if (!fs.existsSync(path.join(dir, '.ok'))) {
    if (!process.env.E2E_INSTALL) return null;
    fs.mkdirSync(dir, { recursive: true });
    if (tarball) {
      const file = path.join(dir, path.basename(tarball.url));
      spawnSync('curl', ['-fsSL', '-o', file, tarball.url], { env, stdio: 'ignore' });
      if (!fs.existsSync(file) || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== tarball.sha256) throw new Error(`${tarball.url} is not the pinned file`);
      spawnSync('tar', ['-xzf', file, '-C', dir, '--strip-components=1'], { stdio: 'ignore' });
    } else spawnSync('npm', ['install', '--prefix', dir, '--ignore-scripts', '--no-save', '--no-audit', '--no-fund', `${name}@${p.version}`], { env, stdio: 'ignore' });
    // The plugin SDK of the same version, which the tool installs from the registry into a config folder that holds a plugin.
    if (p.sdk) spawnSync('npm', ['install', '--prefix', path.join(dir, 'sdk'), '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund', `${p.sdk}@${p.version}`], { env, stdio: 'ignore' });
    if (!spawnSync(exe, ['--version'], { env, encoding: 'utf8' }).stdout?.includes(p.version) || (p.sdk && !fs.existsSync(path.join(dir, 'sdk/node_modules', p.sdk)))) throw new Error(`${name}@${p.version} did not install`);
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
  route: async t => plugindir || (await t.tool(['plugin', 'marketplace', 'add', t.lessloc]) === 0 && await t.tool(['plugin', 'install', 'lessloc@lessloc']) === 0),
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
  route: async t => await t.init('--codex') === 0 && trust(t),
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
  route: async t => await t.init('--opencode') === 0,
  env: () => ({ OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_SERVER_PASSWORD: 'e2e', OPENCODE_PASSWORD: 'e2e' }),
  serve: t => ['serve', '--hostname', '127.0.0.1', '--port', String(t.port)],
  run: (t, prompt) => ['run', '--server', `http://127.0.0.1:${t.port}`, '--auto', '--format', 'json', '-m', 'fake/fake-model', prompt],
  doctor: 'OpenCode',
  timeout: 120,
};

// Pi with `init --pi`, from a models.json provider of the user's own. Its `-p` waits for an open stdin; the runner's is closed.
const pi = {
  id: 'pi', host: 'pi', pin: 'pi', protocol: 'chat',
  tools: { write: 'write', edit: 'edit', shell: 'bash' },
  events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'], homes: ['.pi'], answer: answer('generic'),
  files: t => ({ [path.join(t.home, '.pi/agent/models.json')]: JSON.stringify({ providers: { fake: { baseUrl: `${t.url}/v1`, api: 'openai-completions', apiKey: 'sk-test', models: [{ id: 'fake-model' }] } } }) }),
  route: async t => await t.init('--pi') === 0,
  env: () => ({ PI_OFFLINE: '1' }),
  run: (t, prompt) => ['-p', '--no-session', '--mode', 'json', '--provider', 'fake', '--model', 'fake-model', prompt],
  doctor: 'Pi',
  timeout: 90,
};

// GitHub Copilot CLI with `init --copilot`, from a provider of the user's own, which needs no GitHub sign-in.
const copilot = {
  id: 'copilot', host: 'copilot', pin: 'copilot', protocol: 'chat',
  tools: { write: 'create', edit: 'edit', shell: 'bash', agent: 'task' },
  events: named('copilot', Object.keys(HOSTS.copilot.hooks.events)), homes: ['.copilot'], answer: answer('copilot'),
  unfired: { PostToolUseFailure: 'a failing command is a successful bash call with its exit code in the output, and no tool call here fails' },
  route: async t => await t.init('--copilot') === 0,
  // COPILOT_OFFLINE turns off the GitHub sign-in, telemetry, the web tools, the GitHub MCP server and the updater.
  env: t => ({ COPILOT_HOME: t.config, COPILOT_PROVIDER_BASE_URL: `${t.url}/v1`, COPILOT_PROVIDER_API_KEY: 'sk-test', COPILOT_MODEL: 'fake-model', COPILOT_OFFLINE: 'true' }),
  run: (t, prompt) => ['-p', prompt, '--allow-all-tools', '--no-auto-update', '--disable-client-telemetry', '-s'],
  doctor: 'GitHub Copilot',
  timeout: 120,
};

// Qwen Code, from a provider of the user's own: with `init --qwen`, or its extension built from the copy and installed by
// local path. The model catalog (models.dev) and auto-memory (one more request per turn) are off; the agent tool, deferred
// behind tool_search, is offered.
const QWEN_EXT = JSON.parse(fs.readFileSync(new URL('../../qwen-hooks.json', import.meta.url), 'utf8'));
// The extension route of Gemini CLI and Qwen Code: the extension built from the copy, with the recording wrapper in it, and
// installed by local path.
const extensionDir = t => path.join(t.dir, 'extension');
async function extension(t) {
  if (spawnSync(process.execPath, [path.join(t.lessloc, 'scripts/gemini-extension.mjs'), extensionDir(t)]).status !== 0) return false;
  t.wrap(extensionDir(t));
  return await t.tool(['extensions', 'install', extensionDir(t), '--consent']) === 0;
}
const qwen = ext => ({
  id: ext ? 'qwen-ext' : 'qwen', host: 'qwen', pin: 'qwen', protocol: 'chat',
  tools: { write: 'write_file', edit: 'edit', shell: 'run_shell_command', agent: 'agent' },
  events: Object.keys(ext ? QWEN_EXT.hooks : HOSTS.qwen.hooks.events), homes: ['.qwen'], answer: answer('qwen'),
  files: t => ({ [path.join(t.home, '.qwen/settings.json')]: JSON.stringify({ general: { enableAutoUpdate: false }, privacy: { usageStatisticsEnabled: false }, telemetry: { enabled: false }, memory: { enableManagedAutoMemory: false, enableManagedAutoDream: false }, security: { auth: { selectedType: 'openai' }, folderTrust: { enabled: false } }, tools: { visible: ['agent'] } }) }),
  route: async t => (ext ? extension(t) : await t.init('--qwen') === 0),
  env: t => ({ OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${t.url}/v1`, QWEN_CODE_MODELS_DEV: 'off', QWEN_CODE_FORCE_FILE_STORAGE: 'true', QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(t.dir, 'system-settings.json'), QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(t.dir, 'system-defaults.json') }),
  run: (t, prompt) => [prompt, '--approval-mode', 'yolo', '-o', 'json', '-m', 'fake-model'],
  doctor: 'Qwen Code',
  timeout: 90,
});

// OpenCode 1.x with `init --opencode`, and Kilo Code, its fork, with `init --kilo`, each from a provider of the user's own. As
// in 2.x, the turn end runs only in a server: a `serve` and a `run --attach` against it. A config folder that holds a plugin
// gets the tool's plugin SDK from the registry, so the copy installed next to the pin is put there first, as an earlier
// session would have left it.
const v1 = ({ id, host, doctor, env, config }) => ({
  id, host, pin: id, protocol: 'chat',
  tools: { write: 'write', edit: 'edit', shell: 'bash', agent: 'task' }, args: { agent: { subagent_type: 'general' } },
  events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'], homes: [`.config/${host}`, `.local/share/${host}`, `.local/state/${host}`, `.cache/${host}`], answer: answer('generic'),
  files: t => ({ [path.join(t.home, `.config/${host}/${host}.json`)]: JSON.stringify({ autoupdate: false, share: 'disabled', ...config, provider: { fake: { npm: '@ai-sdk/openai-compatible', name: 'Fake', options: { baseURL: `${t.url}/v1`, apiKey: 'sk-test' }, models: { 'fake-model': { name: 'Fake' } } } } }) }),
  route: async t => (fs.cpSync(path.join(CACHE, `${id}@${PINS[id].version}`, 'sdk'), path.join(t.home, '.config', host), { recursive: true }), await t.init(`--${host}`) === 0),
  env: () => env,
  serve: t => ['serve', '--hostname', '127.0.0.1', '--port', String(t.port)],
  run: (t, prompt) => ['run', '--attach', `http://127.0.0.1:${t.port}`, '--dir', t.work, '--auto', '--format', 'json', '-m', 'fake/fake-model', prompt],
  doctor,
  timeout: 120,
});
const opencode1 = v1({ id: 'opencode1', host: 'opencode', doctor: 'OpenCode', env: { OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_LSP_DOWNLOAD: '1' } });
// Kilo sends telemetry unless told not to, and fetches its own gateway's models unless only the user's provider is enabled.
const kilo = v1({ id: 'kilo', host: 'kilo', doctor: 'Kilo Code', env: { KILO_DISABLE_AUTOUPDATE: '1', KILO_DISABLE_MODELS_FETCH: '1', KILO_DISABLE_LSP_DOWNLOAD: '1', KILO_TELEMETRY_LEVEL: 'off' }, config: { enabled_providers: ['fake'], experimental: { openTelemetry: false } } });

// Gemini CLI with `init --gemini`, or its extension, into the settings it already has: with a base URL and no auth type, a
// headless run picks the gateway auth and refuses it (exit 41). The extension's local folder is trusted the way a user's "y"
// does. Its events in lessloc's names, so its AfterAgent is the turn's end.
const GEMINI_EXT = JSON.parse(fs.readFileSync(new URL('../../gemini/hooks/hooks.json', import.meta.url), 'utf8'));
const gemini = ext => ({
  id: ext ? 'gemini-ext' : 'gemini', host: 'gemini', pin: 'gemini', protocol: 'gemini',
  tools: { write: 'write_file', edit: 'replace', shell: 'run_shell_command' },
  events: named('gemini', Object.keys(ext ? GEMINI_EXT.hooks : HOSTS.gemini.hooks.events)), homes: ['.gemini'], answer: answer('gemini'),
  files: t => ({
    [path.join(t.home, '.gemini/settings.json')]: JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } }, general: { enableAutoUpdate: false, enableAutoUpdateNotification: false }, privacy: { usageStatisticsEnabled: false }, telemetry: { enabled: false } }),
    ...(ext && { [path.join(t.home, '.gemini/trustedFolders.json')]: JSON.stringify({ [extensionDir(t)]: 'TRUST_FOLDER' }) }),
  }),
  route: async t => (ext ? extension(t) : await t.init('--gemini') === 0),
  ...(ext && { namespace: 'its extension install sends usage events to play.googleapis.com, whatever the settings say' }),
  env: t => ({ GEMINI_API_KEY: 'sk-test', GOOGLE_GEMINI_BASE_URL: t.url, GEMINI_FORCE_FILE_STORAGE: 'true', GEMINI_CLI_SYSTEM_SETTINGS_PATH: path.join(t.dir, 'system-settings.json'), GEMINI_CLI_SYSTEM_DEFAULTS_PATH: path.join(t.dir, 'system-defaults.json') }),
  // A pinned model, so no router request picks one.
  run: (t, prompt) => ['-p', prompt, '--approval-mode', 'yolo', '-o', 'json', '-m', 'gemini-2.5-flash', '--skip-trust'],
  doctor: 'Gemini CLI',
  timeout: 60,
});

// The Cline CLI with `init --cline`, which loads lessloc's plugin (cline/plugin.js), from a provider of the user's own. Its
// own --data-dir keeps its state in the run folder and starts no hub daemon; without -y, a text reply ends the run.
const clineData = t => path.join(t.config, 'data');
const cline = {
  id: 'cline', host: 'cline-sdk', pin: 'cline', protocol: 'chat',
  tools: { write: 'editor', edit: 'editor', shell: 'run_commands', agent: 'spawn_agent' },
  events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'], homes: ['.cline', 'Documents/Cline'],
  // The plugin runs the turn end detached, after the run (cline/plugin.js), so no hold of lessloc's can reach the tool.
  answer: (({ block, ...read }) => read)(answer('generic')),
  // The provider as `cline auth -p openai` saves it; Cline resets the file when an entry has no updatedAt.
  files: t => ({
    [path.join(clineData(t), 'settings/providers.json')]: JSON.stringify({ version: 1, lastUsedProvider: 'openai-compatible', providers: { 'openai-compatible': { settings: { provider: 'openai-compatible', apiKey: 'sk-test', model: 'fake-model', baseUrl: `${t.url}/v1` }, updatedAt: '2026-01-01T00:00:00.000Z' } } }),
    [path.join(clineData(t), 'settings/global-settings.json')]: JSON.stringify({ telemetryOptOut: true }),
  }),
  route: async t => await t.init('--cline') === 0,
  // E2E_TEST's one use: it stops the feature flags Cline fetches from data.cline.bot, which telemetryOptOut leaves on.
  env: t => ({ CLINE_DIR: t.config, CLINE_HUB_PORT: String(t.port), CLINE_NO_AUTO_UPDATE: '1', DO_NOT_TRACK: '1', E2E_TEST: 'true' }),
  run: (t, prompt) => ['--json', '--data-dir', clineData(t), '-t', '60', prompt],
  doctor: 'Cline',
  timeout: 90,
};

// Crush with `init --crush`, from a provider of the user's own. Its one hook runs before a tool, so the standard reaches the
// model from the CRUSH.md init writes. Its data folder (sessions, logs) would otherwise go into the work repository.
const crush = {
  id: 'crush', host: 'crush', pin: 'crush', protocol: 'chat',
  tools: { write: 'write', edit: 'edit', shell: 'bash', agent: 'agent' },
  events: named('crush', Object.keys(HOSTS.crush.hooks.events)), homes: ['.config/crush', '.local/share/crush'], answer: answer('crush'), evidence: fixture('crush').evidence,
  files: t => ({ [path.join(t.home, '.config/crush/crush.json')]: JSON.stringify({
    providers: { fake: { name: 'Fake', type: 'openai-compat', base_url: `${t.url}/v1`, api_key: 'sk-test', models: [{ id: 'fake-model', name: 'Fake', context_window: 128000, default_max_tokens: 4096 }] } },
    models: { large: { model: 'fake-model', provider: 'fake' }, small: { model: 'fake-model', provider: 'fake' } },
    options: { disable_provider_auto_update: true, disable_metrics: true },
  }) }),
  route: async t => await t.init('--crush') === 0,
  env: () => ({ CRUSH_DISABLE_METRICS: '1', DO_NOT_TRACK: '1', CRUSH_DISABLE_PROVIDER_AUTO_UPDATE: '1' }),
  run: (t, prompt) => ['run', '--quiet', '--data-dir', path.join(t.dir, 'crush-data'), '-m', 'fake/fake-model', prompt],
  namespace: 'every start asks api.github.com for a newer release, and no setting turns that off (internal/app/app.go, checkForUpdates)',
  doctor: 'Crush',
  timeout: 60,
};

export const ADAPTERS = [claude(false), claude(true), codex, opencode2, pi, copilot, qwen(false), qwen(true), opencode1, kilo, gemini(false), gemini(true), cline, crush];
