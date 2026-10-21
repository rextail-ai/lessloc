// How each agent tool runs in the end-to-end tests: its pinned version, its install route for lessloc, its tool names, its
// environment and its headless command. Everything else (what lessloc promises the tool) comes from lib/hosts.mjs and the
// fixtures, never from here.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CACHE = process.env.E2E_CACHE || path.join(os.homedir(), '.cache', 'lessloc-e2e');
const PINS = JSON.parse(fs.readFileSync(new URL('./tools.json', import.meta.url), 'utf8'));
const PLUGIN = JSON.parse(fs.readFileSync(new URL('../../.claude-plugin/plugin.json', import.meta.url), 'utf8'));

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
  route: plugindir ? () => [] : t => [['plugin', 'marketplace', 'add', t.lessloc], ['plugin', 'install', 'lessloc@lessloc']],
  env: t => ({
    CLAUDE_CONFIG_DIR: t.config, CLAUDE_CODE_TMPDIR: t.tmp, ANTHROPIC_BASE_URL: t.url, ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'fake-haiku',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1', DISABLE_ERROR_REPORTING: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
  }),
  run: (t, prompt) => ['-p', prompt, '--model', 'claude-sonnet-4-5', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', ...(plugindir ? ['--plugin-dir', t.lessloc] : [])],
  // doctor knows a plugin Claude Code installed; one loaded with --plugin-dir lives only as long as the session.
  doctor: !plugindir && /^✓ Claude Code: set up .*; its hooks last ran here/m,
  timeout: 90,
});

export const ADAPTERS = [claude(false), claude(true)];
