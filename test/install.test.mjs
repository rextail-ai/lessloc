import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { HOSTS, ourEntries, userHooks } from '../lib/hosts.mjs';
import { ROOT, TOOLS, hostRows, hostTable, insideTool } from '../lib/install.mjs';
import { VERSION } from '../lib/repo.mjs';
import { STANDARD } from '../lib/voice.mjs';
import { CLI, ENTRY, ENV, repo, tmp, write } from './helpers.mjs';

// A machine of its own: a home folder, and a PATH that holds node, git and stub programs named like agent tools.
function machine(programs = [], files = {}) {
  const root = tmp('machine-'), home = path.join(root, 'home'), bin = path.join(root, 'bin');
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  const which = name => process.env.PATH.split(path.delimiter).map(d => path.join(d, name)).find(f => fs.existsSync(f));
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  fs.symlinkSync(which('git'), path.join(bin, 'git'));
  for (const p of programs) fs.writeFileSync(path.join(bin, p), '#!/bin/sh\n', { mode: 0o755 });
  write(home, files);
  const dir = repo({ 'a.py': 'x = 1\n' }), env = { ...ENV, HOME: home, PATH: bin };
  const cli = (args, extra = {}, cwd = dir) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...env, ...extra } });
  return { home, dir, cli };
}
// Every file under a folder with its bytes, to compare a home folder before and after.
function tree(d, pre = '', files = {}) {
  for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) tree(path.join(d, e.name), `${pre}${e.name}/`, files);
    else files[`${pre}${e.name}`] = fs.readFileSync(path.join(d, e.name), 'utf8');
  }
  return files;
}
const FOREIGN = { hooks: { stop: [{ command: './mine.sh' }] }, version: 1 };

test('init lists the agent tools found with the command that sets each up, and writes nothing in the home folder', () => {
  const m = machine(['codex', 'gemini'], { '.cursor/hooks.json': `${JSON.stringify(FOREIGN, null, 2)}\n`, '.config/opencode/opencode.json': '{}' });
  const before = tree(m.home), out = m.cli(['init']).stdout;
  assert.deepEqual(tree(m.home), before);
  const tools = out.split('Agent tools for this user:\n')[1].split('\n').filter(Boolean);
  assert.match(tools[0], /^- Codex: not set up; run: node ".*lessloc\.mjs" init --codex$/);
  assert.match(tools[1], /^- Cursor: not set up; run: node ".*lessloc\.mjs" init --cursor$/);
  assert.match(tools[2], /^- OpenCode: not set up; run: node ".*lessloc\.mjs" init --opencode$/);
  assert.match(tools[3], /^- Gemini CLI: not set up; run: node ".*lessloc\.mjs" init --gemini$/);
  assert.match(tools[4], /^- to set up every tool above: node ".*lessloc\.mjs" init --agents$/);
  assert.equal(tools.length, 5, 'tools that are not installed are not listed');
  assert.doesNotMatch(out, /Claude Code/);
});

test('init --agents installs hooks for exactly the tools found, prints Claude Code\'s own commands, and remove --agents restores every file', () => {
  const codex = `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: './mine.sh' }] }] } }, null, 2)}\n`;
  const m = machine(['codex', 'claude'], { '.cursor/hooks.json': `${JSON.stringify(FOREIGN, null, 2)}\n`, '.codex/hooks.json': codex, '.claude/settings.json': '{}\n' });
  const before = tree(m.home), out = m.cli(['init', '--agents'], { CLAUDECODE: '1' }).stdout;
  assert.match(out, /^Agent tools for this user \(this command runs in Claude Code\):$/m);
  assert.match(out, /^- Claude Code: not set up\. lessloc never edits Claude Code's settings itself; run: claude plugin marketplace add ".*" && claude plugin install lessloc@lessloc$/m);
  assert.match(out, /^- Codex hooks installed in .*\.codex\/hooks\.json, for all your projects\. Codex runs new hooks only after you trust them once: \/hooks in Codex$/m);
  assert.match(out, /^- Cursor hooks installed in .*\.cursor\/hooks\.json, for all your projects$/m);
  assert.match(out, /^- then start a new session in Claude Code, Codex and Cursor, so each loads lessloc$/m);
  assert.doesNotMatch(out, /OpenCode/, 'OpenCode is not installed here');
  assert.deepEqual(fs.readFileSync(path.join(m.home, '.claude/settings.json'), 'utf8'), '{}\n', "Claude Code's settings are never touched");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(m.home, '.cursor/hooks.json'), 'utf8')).hooks.stop[0], FOREIGN.hooks.stop[0], 'the user\'s own hooks stay first');
  assert.match(m.cli(['init']).stdout, /^- Cursor: set up \(.*\.cursor\/hooks\.json\)$/m);

  const removed = m.cli(['remove', '--agents']).stdout;
  assert.match(removed, /Codex hooks in .*hooks\.json; Cursor hooks in .*hooks\.json/);
  assert.deepEqual(tree(m.home), before, 'byte for byte');
});

test('a disabled Claude Code plugin is named with the command that enables it, and doctor run inside Claude Code tells a session that started before the install from hooks that do not run', () => {
  const plugin = (enabled, installedAt = '2020-01-01T00:00:00.000Z') => ({ '.claude/plugins/installed_plugins.json': JSON.stringify({ version: 2, plugins: { 'lessloc@lessloc': [{ scope: 'user', installPath: ROOT, version: VERSION, installedAt }] } }), '.claude/settings.json': JSON.stringify({ enabledPlugins: { 'lessloc@lessloc': enabled } }) });
  const off = machine(['claude'], plugin(false));
  assert.match(off.cli(['init', '--agents']).stdout, /^- Claude Code: set up, but the plugin is disabled; run: claude plugin enable lessloc@lessloc$/m);
  assert.match(off.cli(['doctor']).stdout, /Claude Code: set up, but the plugin is disabled.*claude plugin enable lessloc@lessloc/);
  // This test's own process stands in for the Claude Code process: it started before now and long after 2020.
  const withPs = m => (fs.symlinkSync(execFileSync('sh', ['-c', 'command -v ps'], { encoding: 'utf8' }).trim(), path.join(path.dirname(m.home), 'bin', 'ps')), m);
  const before = withPs(machine(['claude'], plugin(true)));
  assert.match(before.cli(['doctor']).stdout, /✓ Claude Code: set up \(Claude Code plugin\); its hooks have not run in this repository yet/, 'from a terminal, a session may simply not have started yet');
  assert.match(before.cli(['doctor'], { CLAUDECODE: '1', CLAUDE_PID: String(process.pid) }).stdout, /✗ Claude Code: set up \(Claude Code plugin\), but its hooks did not run in this session either/);
  const after = withPs(machine(['claude'], plugin(true, new Date(Date.now() + 60e3).toISOString())));
  assert.match(after.cli(['doctor'], { CLAUDECODE: '1', CLAUDE_PID: String(process.pid) }).stdout, /! Claude Code: set up \(Claude Code plugin\) after this session started, so this session runs without it \(start a new Claude Code session\)/);
  assert.match(after.cli(['doctor'], { CLAUDECODE: '1' }).stdout, /! Claude Code: set up \(Claude Code plugin\), but no hook has run in this session: expected if the plugin was installed after it started/, 'when the session start is unknown, the line names both causes');
});

test('init --agents leaves a hook file that is not JSON alone, and skips a tool set up through its own plugin', () => {
  const m = machine(['codex'], { '.cursor/hooks.json': '{ "hooks": ', '.codex/config.toml': '[plugins."lessloc@lessloc"]\nenabled = true\n' });
  const out = m.cli(['init', '--agents']).stdout;
  assert.match(out, /^- Cursor: not set up: .*\.cursor\/hooks\.json has comments or is not a JSON object, so lessloc left it alone\. To set it up by hand, merge this into it: \{"version":1,"hooks":\{"sessionStart":\[\{"command":"node \\".*hook\.mjs\\" --host cursor".*\}\}$/m);
  assert.match(out, /^- Codex: set up \(Codex plugin\)$/m);
  assert.equal(fs.readFileSync(path.join(m.home, '.cursor/hooks.json'), 'utf8'), '{ "hooks": ');
  assert.ok(!fs.existsSync(path.join(m.home, '.codex/hooks.json')), 'no second set of hooks beside the plugin');
});

test('doctor runs each installed hook command and says which answer', () => {
  const m = machine(['codex', 'opencode'], { '.cursor/hooks.json': `${JSON.stringify(FOREIGN, null, 2)}\n` });
  m.cli(['init', '--agents']);
  const ok = m.cli(['doctor']).stdout;
  for (const t of ['Codex', 'Cursor', 'OpenCode']) assert.match(ok, new RegExp(`^✓ ${t}: set up \\(.*\\); its hooks have not run in this repository yet`, 'm'));
  const file = path.join(m.home, '.cursor/hooks.json');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('hook.mjs', 'moved/hook.mjs'));
  const broken = m.cli(['doctor']);
  assert.match(broken.stdout, /^✗ Cursor: the hooks in .*\.cursor\/hooks\.json do not answer \(node ".*lessloc\.mjs" init --cursor\)$/m);
  assert.equal(broken.status, 1);
});

test('each tool lessloc has hooks for is recognized from the marker it sets for its agent\'s commands', () => {
  const markers = { claude: { CLAUDECODE: '1' }, codex: { CODEX_THREAD_ID: 'thr_1' }, cursor: { CURSOR_AGENT: '1' }, opencode: { OPENCODE_TERMINAL: '1' }, gemini: { GEMINI_CLI: '1' }, copilot: { COPILOT_CLI: '1' }, kilo: { KILO_PID: '4242', OPENCODE: '1' }, cline: { CLINE_ACTIVE: 'true' }, pi: { PI_CODING_AGENT: 'true', AI_AGENT: 'pi' }, qwen: { QWEN_CODE: '1' }, augment: { AUGMENT_AGENT: '1' }, goose: { GOOSE_TERMINAL: '1', AGENT: 'goose' }, crush: { CRUSH: '1', AGENT: 'crush', AI_AGENT: 'crush' } };
  for (const [id, env] of Object.entries(markers)) assert.equal(insideTool(env)?.id, id);
  assert.equal(insideTool({}), undefined);
  // These document no variable for the commands their agents run.
  const none = ['amp', 'droid', 'kiro', 'junie', 'openhands', 'devin', 'antigravity', 'aider'];
  for (const t of TOOLS.filter(x => (x.install || x.commands) && !none.includes(x.id))) assert.ok(markers[t.id], `${t.label} has a marker`);
});

test("the Codex plugin's hook file is exactly what init --codex writes, run from the plugin's folder", () => {
  const f = path.join(tmp('codex-'), 'hooks.json');
  userHooks('codex', true, f, '$CLAUDE_PLUGIN_ROOT/hook.mjs');
  assert.equal(fs.readFileSync(new URL('../codex-hooks.json', import.meta.url), 'utf8'), fs.readFileSync(f, 'utf8'));
});

test("init --gemini keeps every other setting of Gemini's settings file, init --copilot writes a hook file of its own, and remove restores the home folder byte for byte", () => {
  const settings = `${JSON.stringify({ general: { vimMode: true }, hooksConfig: { enabled: true }, hooks: { BeforeTool: [{ matcher: 'run_shell_command', hooks: [{ type: 'command', command: './audit.sh' }] }] }, ui: { theme: 'GitHub' } }, null, 2)}\n`;
  const m = machine(['gemini', 'copilot'], { '.gemini/settings.json': settings }), read = f => JSON.parse(fs.readFileSync(path.join(m.home, f), 'utf8'));
  const before = tree(m.home), out = m.cli(['init', '--gemini', '--copilot']).stdout;
  assert.match(out, /^- Gemini CLI hooks installed in .*\.gemini\/settings\.json, for all your projects$/m);
  assert.match(out, /^- GitHub Copilot hooks installed in .*\.copilot\/hooks\/lessloc\.json, for all your projects$/m);
  const gemini = read('.gemini/settings.json');
  assert.deepEqual(Object.keys(gemini), ['general', 'hooksConfig', 'hooks', 'ui'], 'every other key kept, in its place');
  assert.deepEqual(gemini.hooks.BeforeTool[0], JSON.parse(settings).hooks.BeforeTool[0], "the user's own hook stays first");
  assert.deepEqual(gemini.hooks.AfterAgent[0].hooks[0].command.replace(/node ".*"/, 'node lessloc'), 'node lessloc --host gemini');
  assert.equal(gemini.hooks.AfterAgent[0].hooks[0].timeout, 600000, 'Gemini counts milliseconds');
  const copilot = read('.copilot/hooks/lessloc.json');
  assert.equal(copilot.version, 1);
  assert.match(copilot.hooks.preToolUse[0].bash, /^if command -v node >\/dev\/null 2>&1 && \[ -f ".*\/hook\.mjs" \]; then node ".*\/hook\.mjs" --host copilot preToolUse; fi$/, 'each command names its event');
  const doctor = m.cli(['doctor']).stdout;
  for (const t of ['Gemini CLI', 'GitHub Copilot']) assert.match(doctor, new RegExp(`^✓ ${t}: set up \\(.*\\); its hooks have not run in this repository yet`, 'm'));
  // VS Code runs the same hook file, with payloads of its own.
  spawnSync(process.execPath, [ENTRY, '--host', 'copilot', 'sessionStart'], { cwd: m.dir, input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'v1', cwd: m.dir, source: 'new' }), env: { ...ENV, HOME: m.home } });
  assert.match(m.cli(['doctor']).stdout, /^✓ GitHub Copilot: set up \(.*\); its hooks last ran here 0 min ago$/m);
  m.cli(['remove', '--gemini', '--copilot']);
  assert.deepEqual(tree(m.home), before, 'byte for byte, and no Copilot hook file left');

  const fresh = machine(['gemini']), home = fresh.home, own = path.join(home, 'copilot-home');
  fresh.cli(['init', '--gemini', '--copilot'], { COPILOT_HOME: own });
  assert.ok(fs.existsSync(path.join(own, 'hooks', 'lessloc.json')), 'COPILOT_HOME moves the hook file');
  fresh.cli(['remove', '--gemini', '--copilot'], { COPILOT_HOME: own });
  assert.deepEqual(tree(home), {}, 'a settings file lessloc created goes again');
});

test('init --copilot --repo writes the hook file the cloud agent reads, and the setup step that gets lessloc, both named so the agent reads nothing of lessloc in the hooks; remove --copilot --repo takes it out', () => {
  const m = machine(['copilot']), file = path.join(m.dir, '.github/hooks/review.json');
  const out = m.cli(['init', '--copilot', '--repo']).stdout;
  assert.match(out, /^- GitHub Copilot hooks in \.github\/hooks\/review\.json, for the cloud agent and everyone who works here; commit it to the default branch\. They run lessloc from ~\/\.agent-standard and do nothing where it is missing\./m);
  assert.ok(out.includes(`- run: mkdir -p "$HOME/.agent-standard" && cd "$HOME/.agent-standard" && npm pack lessloc@${VERSION} --silent && tar -xzf lessloc-${VERSION}.tgz --strip-components=1`), 'this version\'s npm package, which npm checks against the registry');
  assert.ok(!fs.existsSync(path.join(m.home, '.copilot/hooks/lessloc.json')), 'with --repo, nothing in the home folder');
  const text = fs.readFileSync(file, 'utf8'), hooks = JSON.parse(text).hooks;
  assert.equal(hooks.agentStop[0].bash, 'if command -v node >/dev/null 2>&1 && [ -f "$HOME/.agent-standard/hook.mjs" ]; then node "$HOME/.agent-standard/hook.mjs" --host copilot agentStop; fi');
  assert.doesNotMatch(text, /lessloc/i);
  assert.match(m.cli(['remove']).stdout, /kept, because they are shared with the team: .*\.github\/hooks\/review\.json/);
  assert.match(m.cli(['remove', '--copilot', '--repo']).stdout, /GitHub Copilot hooks in \.github\/hooks\/review\.json/);
  assert.ok(!fs.existsSync(file));
});

test("init recognizes lessloc installed by Copilot's and Cursor's plugin managers and as a Gemini extension, and --agents adds no second set of hooks", () => {
  const m = machine(['gemini', 'copilot', 'cursor-agent'], {
    '.copilot/installed-plugins/_direct/rextail-ai-lessloc/.github/plugin/plugin.json': JSON.stringify({ name: 'lessloc' }),
    '.gemini/extensions/lessloc/gemini-extension.json': JSON.stringify({ name: 'lessloc' }),
    '.cursor/plugins/local/lessloc/.cursor-plugin/plugin.json': JSON.stringify({ name: 'lessloc' }),
  });
  const out = m.cli(['init', '--agents']).stdout;
  assert.match(out, /^- Gemini CLI: set up \(Gemini CLI extension\)$/m);
  assert.match(out, /^- GitHub Copilot: set up \(Copilot plugin\)$/m);
  assert.match(out, /^- Cursor: set up \(Cursor plugin\)$/m);
  for (const f of ['.gemini/settings.json', '.copilot/hooks/lessloc.json', '.cursor/hooks.json']) assert.ok(!fs.existsSync(path.join(m.home, f)), f);
  const removed = m.cli(['remove', '--agents']).stdout;
  assert.match(removed, /remove it there: GitHub Copilot: copilot plugin uninstall lessloc$/m);
  assert.match(removed, /remove it there: Gemini CLI: gemini extensions uninstall lessloc$/m);
  assert.match(removed, /remove it there: Cursor: uninstall the lessloc plugin in Cursor's plugin settings$/m);
});

const repoFile = f => new URL(`../${f}`, import.meta.url);
const generated = (host, entry) => {
  const f = path.join(tmp('generated-'), 'hooks.json');
  userHooks(host, true, f, entry);
  return fs.readFileSync(f, 'utf8');
};

test("Copilot's plugin install reads lessloc's own Copilot manifest, never Claude Code's, and each plugin's hook file is what init writes", () => {
  // Copilot looks for a plugin's manifest in this order, and the first that exists wins (its CLI plugin reference).
  assert.equal(['.plugin/plugin.json', 'plugin.json', '.github/plugin/plugin.json', '.claude-plugin/plugin.json'].find(f => fs.existsSync(repoFile(f))), '.github/plugin/plugin.json');
  const copilot = JSON.parse(fs.readFileSync(repoFile('.github/plugin/plugin.json'), 'utf8'));
  assert.equal(copilot.$schema, undefined, 'a legacy manifest, the kind that names its hook file');
  assert.match(copilot.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.deepEqual(copilot.skills, [], "the /lessloc skill is Claude Code's; Copilot gets the hooks");
  assert.equal(fs.readFileSync(repoFile(copilot.hooks), 'utf8'), generated('copilot', '$PLUGIN_ROOT/hook.mjs'));
  // Claude Code also loads a plugin's hooks/hooks.json, and Copilot a root hooks.json, so neither may exist here.
  for (const f of ['hooks/hooks.json', 'hooks.json']) assert.ok(!fs.existsSync(repoFile(f)), f);
  assert.equal(fs.readFileSync(repoFile('gemini/hooks/hooks.json'), 'utf8'), generated('gemini', '${extensionPath}${/}hook.mjs'));
  for (const f of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.github/plugin/plugin.json', '.cursor-plugin/plugin.json', 'gemini/gemini-extension.json', 'qwen-extension.json']) assert.equal(JSON.parse(fs.readFileSync(repoFile(f), 'utf8')).version, VERSION, f);
  // Claude Code's hooks and plugin source stay as measured; descriptions and discovery metadata may change.
  const json = f => JSON.parse(fs.readFileSync(repoFile(f), 'utf8')), market = json('.claude-plugin/marketplace.json');
  assert.equal(createHash('sha256').update(JSON.stringify(json('.claude-plugin/plugin.json').hooks)).digest('hex'), 'a3bf55299b6ca95e531172d4bbd7fc2ba730c9dd9f0999f00fb9d23ba45aa108');
  assert.deepEqual([market.name, market.plugins.map(p => [p.name, p.source])], ['lessloc', [['lessloc', './']]]);
});

test('the Gemini extension folder runs its hooks from its own copy of lessloc, and lists no skill to the model', () => {
  const ext = path.join(tmp('gemini-'), 'lessloc'), dir = repo({ 'a.py': 'x = 1\n' });
  execFileSync(process.execPath, [new URL('../scripts/gemini-extension.mjs', import.meta.url).pathname, ext]);
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'gemini-extension.json'), 'utf8'));
  assert.equal(manifest.name, path.basename(ext), "Gemini expects the folder to carry the extension's name");
  assert.ok(!fs.existsSync(path.join(ext, 'skills')));
  // Gemini fills in ${extensionPath} and ${/} before it runs a hook's command.
  const command = JSON.parse(fs.readFileSync(path.join(ext, 'hooks/hooks.json'), 'utf8')).hooks.SessionStart[0].hooks[0].command.replaceAll('${extensionPath}', ext).replaceAll('${/}', path.sep);
  const r = spawnSync(command, { shell: true, cwd: dir, input: JSON.stringify({ session_id: 'x1', cwd: dir, hook_event_name: 'SessionStart', timestamp: new Date().toISOString(), source: 'startup' }), encoding: 'utf8', env: ENV });
  assert.ok(JSON.parse(r.stdout).hookSpecificOutput.additionalContext.startsWith(STANDARD.slice(0, 60)));
});

test('init --kilo --amp --cline --pi writes the file each tool loads lessloc from, and Cline\'s hook files; doctor loads and runs them; remove restores the home folder byte for byte', () => {
  const m = machine(['kilo', 'amp', 'cline', 'pi']), read = f => fs.readFileSync(path.join(m.home, f), 'utf8');
  const before = tree(m.home), out = m.cli(['init', '--kilo', '--amp', '--cline', '--pi']).stdout;
  assert.match(out, /^- Kilo Code plugin installed in .*\.config\/kilo\/plugin\/lessloc\.js, for all your projects$/m);
  assert.match(out, /^- Amp plugin installed in .*\.config\/amp\/plugins\/lessloc\.js, for all your projects\. Amp loads it after "plugins: reload"/m);
  assert.match(out, /^- Cline plugin and hook files installed in .*\.cline\/plugins\/lessloc\.js and .*Documents\/Cline\/Hooks, for all your projects\. Cline's IDE extension runs hook files only when "Enable Hooks" is on/m);
  assert.match(out, /^- Pi extension installed in .*\.pi\/agent\/extensions\/lessloc\.js, for all your projects\. Pi loads it after \/reload, or a restart$/m);
  assert.match(read('.config/kilo/plugin/lessloc.js'), /^\/\/ Written by `lessloc init --kilo`[\s\S]*export \{ kilo as default \} from "file:\/\/.*\/opencode\/server\.js";/);
  assert.match(read('.pi/agent/extensions/lessloc.js'), /export \{ default \} from "\/.*\/pi\/extension\.js";/, 'Pi loads extensions with jiti, which takes a path');
  for (const h of ['TaskStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'TaskComplete']) {
    const f = path.join(m.home, 'Documents/Cline/Hooks', h);
    assert.equal(fs.statSync(f).mode & 0o111, 0o111, `${h} is executable`);
    assert.match(read(`Documents/Cline/Hooks/${h}`), /^#!\/bin\/sh\n[\s\S]*exec node ".*\/hook\.mjs" --host cline\n$/);
  }
  const doctor = m.cli(['doctor']).stdout;
  for (const t of ['Kilo Code', 'Amp', 'Cline', 'Pi']) assert.match(doctor, new RegExp(`^✓ ${t}: set up \\(.*\\); its hooks have not run in this repository yet`, 'm'));
  assert.doesNotMatch(doctor, /set up twice/, "Cline's plugin and hook files serve its CLI and its IDE extension");
  m.cli(['remove', '--kilo', '--amp', '--cline', '--pi']);
  assert.deepEqual(tree(m.home), before);
});

test("init leaves a Cline hook file of the user's own alone, and --agents adds no second Pi extension beside the Pi package", () => {
  const m = machine(['cline', 'pi'], { 'Documents/Cline/Hooks/PreToolUse': '#!/bin/sh\necho mine\n', '.pi/agent/settings.json': JSON.stringify({ packages: ['git:github.com/rextail-ai/lessloc'] }) });
  const out = m.cli(['init', '--agents']).stdout;
  assert.match(out, /^- Cline: not set up: .*Documents\/Cline\/Hooks\/PreToolUse is a hook of your own, so lessloc left Cline's hook files alone$/m);
  assert.match(out, /^- Pi: set up \(Pi package\)$/m);
  assert.ok(!fs.existsSync(path.join(m.home, '.cline/plugins/lessloc.js')) && !fs.existsSync(path.join(m.home, '.pi/agent/extensions/lessloc.js')));
  assert.equal(fs.readFileSync(path.join(m.home, 'Documents/Cline/Hooks/PreToolUse'), 'utf8'), '#!/bin/sh\necho mine\n');
  assert.match(m.cli(['remove', '--agents']).stdout, /remove it there: Pi: pi remove git:github\.com\/rextail-ai\/lessloc$/m);
});

test("Pi's package install loads lessloc's extension and no skill, and the npm package carries every bridge", async () => {
  const pkg = JSON.parse(fs.readFileSync(repoFile('package.json'), 'utf8'));
  assert.deepEqual(pkg.pi, { extensions: ['./pi/extension.js'], skills: [] }, 'the /lessloc skill would be listed to the model');
  assert.equal(typeof (await import('../pi/extension.js')).default, 'function');
  for (const d of ['bridge/', 'opencode/', 'amp/', 'cline/', 'pi/', 'augment/', 'cursor/', '.cursor-plugin/', 'cursor-hooks.json', 'qwen-extension.json', 'qwen-hooks.json']) assert.ok(pkg.files.includes(d), d);
});

test('init writes the user-level hook file of Qwen Code, Factory Droid, Augment, Kiro, Junie, OpenHands, goose and Devin CLI, keeps everyone else\'s settings and hooks, doctor runs each, and remove restores the home folder byte for byte', () => {
  const json = o => `${JSON.stringify(o, null, 2)}\n`, theirs = { type: 'command', command: './audit.sh' };
  const m = machine(['qwen', 'droid', 'auggie', 'kiro-cli', 'junie', 'openhands', 'goose', 'devin'], {
    '.qwen/settings.json': json({ model: { name: 'qwen3-coder-plus' }, hooks: { PreToolUse: [{ matcher: 'run_shell_command', hooks: [theirs] }] } }),
    '.factory/hooks.json': json({ PreToolUse: [{ matcher: 'Execute', hooks: [theirs] }] }),
    '.junie/AGENTS.md': '# My rules\n\nUse tabs.\n',
    '.config/goose/.goosehints': 'Prefer small functions.',
  });
  const read = f => JSON.parse(fs.readFileSync(path.join(m.home, f), 'utf8')), text = f => fs.readFileSync(path.join(m.home, f), 'utf8');
  const flags = ['--qwen', '--droid', '--augment', '--kiro', '--junie', '--openhands', '--goose', '--devin'];
  const before = tree(m.home), out = m.cli(['init', ...flags]).stdout;
  for (const [label, file] of [['Qwen Code', '.qwen/settings.json'], ['Factory Droid', '.factory/hooks.json'], ['Augment', '.augment/settings.json'], ['Kiro', '.kiro/hooks/lessloc.json'], ['OpenHands', '.openhands/hooks.json'], ['Devin CLI', '.config/devin/config.json']]) {
    assert.match(out, new RegExp(`^- ${label} hooks installed in .*${file.replaceAll('.', '\\.')}, for all your projects`, 'm'));
  }
  assert.match(out, /^- Junie hooks installed in .*\.junie\/config\.json and .*\.junie\/AGENTS\.md, for all your projects\. Junie runs hooks only in its CLI's Early Access build$/m);
  assert.match(out, /^- goose plugin installed in .*\.agents\/plugins\/review and .*\.config\/goose\/\.goosehints, for all your projects$/m);

  const qwen = read('.qwen/settings.json');
  assert.deepEqual(Object.keys(qwen), ['model', 'hooks'], 'every other setting kept, in its place');
  assert.deepEqual(qwen.hooks.PreToolUse[0].hooks[0], theirs, "the user's own hook stays first");
  assert.equal(qwen.hooks.Stop[0].hooks[0].timeout, 600, 'Qwen Code counts seconds');
  const droid = read('.factory/hooks.json');
  assert.deepEqual(droid.PreToolUse[0].hooks[0], theirs);
  assert.equal(droid.hooks, undefined, "Droid's own hook file holds the events at its top");
  const augment = read('.augment/settings.json').hooks;
  assert.match(augment.Stop[0].hooks[0].command, /\/augment\/hook\.sh$/, 'Augment runs only script files, without arguments');
  assert.equal(augment.Stop[0].hooks[0].timeout, 600000, 'Augment counts milliseconds');
  assert.deepEqual(augment.Stop[0].metadata, { includeConversationData: true }, "the Stop hook asks for the turn's request and the agent's reply");
  const bare = spawnSync('/bin/sh', ['-c', augment.Stop[0].hooks[0].command], { cwd: m.dir, input: '{}', encoding: 'utf8', env: { ...ENV, PATH: tmp('empty-bin-') } });
  assert.deepEqual([bare.status, bare.stdout, bare.stderr], [0, '', ''], 'no node: nothing, and every tool call goes ahead');
  const kiro = read('.kiro/hooks/lessloc.json');
  assert.equal(kiro.version, 'v1');
  assert.deepEqual(kiro.hooks.filter(h => h.trigger === 'PreToolUse').map(h => h.matcher), ['write', 'shell']);
  assert.ok(kiro.hooks.every(h => h.name.startsWith('review ') && /--host kiro$/.test(h.action.command)), 'a neutral name on every hook');
  assert.deepEqual(Object.keys(read('.openhands/hooks.json')), ['session_start', 'user_prompt_submit', 'pre_tool_use', 'post_tool_use', 'stop']);
  assert.deepEqual(read('.agents/plugins/review/plugin.json'), { name: 'review', version: VERSION });
  assert.ok(read('.agents/plugins/review/hooks/hooks.json').hooks.PreToolUse[0].hooks[0].command.endsWith('--host goose'));
  assert.ok(text('.junie/AGENTS.md').startsWith('# My rules\n\nUse tabs.\n\n<!-- working-standard -->\n'), 'the rules block goes after the user\'s own rules');
  assert.equal(text('.config/goose/.goosehints'), `Prefer small functions.\n<!-- working-standard -->\n${STANDARD}\n<!-- /working-standard -->\n`);
  assert.ok(read('.config/devin/config.json').hooks.SessionStart);

  const doctor = m.cli(['doctor']).stdout;
  for (const t of ['Qwen Code', 'Factory Droid', 'Augment', 'Kiro', 'Junie', 'OpenHands', 'goose', 'Devin CLI']) assert.match(doctor, new RegExp(`^✓ ${t}: set up \\(.*\\); its hooks have not run in this repository yet`, 'm'));
  assert.equal(m.cli(['init', ...flags]).status, 0);
  assert.equal(text('.junie/AGENTS.md').split('<!-- working-standard -->').length, 2, 'a second init replaces the block');
  m.cli(['remove', ...flags]);
  assert.deepEqual(tree(m.home), before, 'byte for byte');
});

test("init --droid writes into Droid's settings when it keeps its hooks there, and init --goose leaves a review plugin of the user's own alone", () => {
  const settings = `${JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: './done.sh' }] }] } }, null, 2)}\n`;
  const m = machine(['droid', 'goose'], { '.factory/settings.json': settings, '.agents/plugins/review/plugin.json': '{"name": "review"}\n', '.agents/plugins/review/skills/x/SKILL.md': 'mine\n' });
  const out = m.cli(['init', '--agents']).stdout;
  assert.match(out, /^- Factory Droid hooks installed in .*\.factory\/settings\.json, for all your projects$/m);
  assert.ok(!fs.existsSync(path.join(m.home, '.factory/hooks.json')), 'a hooks.json would make Droid ignore the hooks in its settings');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(m.home, '.factory/settings.json'), 'utf8')).hooks.Stop[0].hooks[0].command, './done.sh');
  assert.match(out, /^- goose: not set up: .*\.agents\/plugins\/review is a plugin of your own, so lessloc left it alone$/m);
  assert.equal(fs.readFileSync(path.join(m.home, '.agents/plugins/review/plugin.json'), 'utf8'), '{"name": "review"}\n');
  m.cli(['remove', '--droid']);
  assert.equal(fs.readFileSync(path.join(m.home, '.factory/settings.json'), 'utf8'), settings);
});

test('with the standard in their user-level rules file, goose and Junie get no second copy of it, and Junie still gets the session start text with its first prompt', () => {
  const m = machine(['goose', 'junie']), dir = repo({ 'shop/money.py': 'def format_money(amount):\n    return f"${amount:.2f}"\n', '.lessloc.json': '{"protect": ["infra/**"]}' });
  m.cli(['init', '--goose', '--junie']);
  const send = (host, input) => spawnSync(process.execPath, [ENTRY, '--host', host], { cwd: dir, input: JSON.stringify(input), encoding: 'utf8', env: { ...ENV, HOME: m.home } }).stdout;
  assert.equal(send('junie', { hook_event_name: 'SessionStart', session_id: 'j1', cwd: dir, source: 'startup' }), '');
  const first = JSON.parse(send('junie', { hook_event_name: 'UserPromptSubmit', session_id: 'j1', cwd: dir, prompt: 'show the money totals' })).additionalContext;
  assert.ok(!first.includes(STANDARD.slice(0, 60)), 'the rules file holds the standard');
  assert.match(first, /infra\/\*\*[\s\S]*format_money/, "the project's own rules, then the hints");
  assert.equal(send('goose', { event: 'SessionStart', session_id: 'g1' }), '', 'goose hears nothing at session start');
});

test("Qwen Code's extension install reads lessloc's Qwen manifest first, which runs the hooks init writes with the skill off, and the release asset carries it too", () => {
  // Qwen Code takes the first manifest it finds in this order (its extension converter), after a root Agent Plugins plugin.json.
  assert.ok(!fs.existsSync(repoFile('plugin.json')));
  assert.equal(['qwen-extension.json', 'gemini-extension.json', '.claude-plugin/marketplace.json', '.claude-plugin/plugin.json'].find(f => fs.existsSync(repoFile(f))), 'qwen-extension.json');
  const manifest = JSON.parse(fs.readFileSync(repoFile('qwen-extension.json'), 'utf8'));
  assert.equal(manifest.name, 'lessloc');
  assert.equal(manifest.version, VERSION);
  assert.deepEqual(manifest.skillStates, { lessloc: false }, 'Qwen Code loads skills/ from every extension; the /lessloc skill stays off');
  assert.equal(fs.readFileSync(repoFile(manifest.hooks), 'utf8'), generated('qwen', '${CLAUDE_PLUGIN_ROOT}/hook.mjs'));
  // Qwen Code installs a repository's release asset when there is exactly one: the Gemini CLI extension, which carries both.
  const ext = path.join(tmp('asset-'), 'lessloc'), dir = repo({ 'a.py': 'x = 1\n' });
  execFileSync(process.execPath, [new URL('../scripts/gemini-extension.mjs', import.meta.url).pathname, ext]);
  const hooks = JSON.parse(fs.readFileSync(path.join(ext, JSON.parse(fs.readFileSync(path.join(ext, 'qwen-extension.json'), 'utf8')).hooks), 'utf8')).hooks;
  const command = hooks.SessionStart[0].hooks[0].command.replaceAll('${CLAUDE_PLUGIN_ROOT}', ext);
  const r = spawnSync(command, { shell: true, cwd: dir, input: JSON.stringify({ session_id: 'q1', cwd: dir, hook_event_name: 'SessionStart', source: 'startup' }), encoding: 'utf8', env: ENV });
  assert.ok(JSON.parse(r.stdout).hookSpecificOutput.additionalContext.startsWith(STANDARD.slice(0, 60)));
});

test('init recognizes lessloc installed as a Qwen Code extension, and --agents adds no second set of hooks', () => {
  const m = machine(['qwen'], { '.qwen/extensions/lessloc/qwen-extension.json': JSON.stringify({ name: 'lessloc' }) });
  assert.match(m.cli(['init', '--agents']).stdout, /^- Qwen Code: set up \(Qwen Code extension\)$/m);
  assert.ok(!fs.existsSync(path.join(m.home, '.qwen/settings.json')));
  assert.match(m.cli(['remove', '--agents']).stdout, /remove it there: Qwen Code: qwen extensions uninstall lessloc$/m);
});

test("init writes Crush's hook entry and its CRUSH.md block, and Antigravity's named hook, keeping everyone else's; it leaves a hook of the user's own named like lessloc's alone; doctor runs each; remove restores the home folder byte for byte", () => {
  const json = o => `${JSON.stringify(o, null, 2)}\n`, theirs = { type: 'command', command: './audit.sh' };
  const m = machine(['crush', 'agy'], {
    '.config/crush/crush.json': json({ $schema: 'https://charm.land/crush.json', options: { tui: { compact_mode: true } }, hooks: { PreToolUse: [{ matcher: '^bash$', command: './no-rm.sh' }] } }),
    '.config/crush/CRUSH.md': 'Answer briefly.\n',
    '.gemini/config/hooks.json': json({ 'my-linter-hook': { PostToolUse: [{ matcher: 'run_command', hooks: [theirs] }] } }),
  });
  const read = f => JSON.parse(fs.readFileSync(path.join(m.home, f), 'utf8')), before = tree(m.home), out = m.cli(['init', '--crush', '--antigravity']).stdout;
  assert.match(out, /^- Crush hooks installed in .*\.config\/crush\/crush\.json and .*\.config\/crush\/CRUSH\.md, for all your projects$/m);
  assert.match(out, /^- Antigravity hooks installed in .*\.gemini\/config\/hooks\.json, for all your projects$/m);
  const crush = read('.config/crush/crush.json');
  assert.deepEqual(Object.keys(crush), ['$schema', 'options', 'hooks'], 'every other setting kept, in its place');
  assert.deepEqual(crush.hooks.PreToolUse.map(h => h.command.replace(/^node ".*" --host crush$/, 'lessloc')), ['./no-rm.sh', 'lessloc'], "the user's own hook stays first");
  assert.deepEqual({ ...crush.hooks.PreToolUse[1], command: '' }, { name: 'review', matcher: '^(bash|edit|multiedit|write)$', command: '', timeout: 30 });
  assert.ok(fs.readFileSync(path.join(m.home, '.config/crush/CRUSH.md'), 'utf8').startsWith('Answer briefly.\n\n<!-- working-standard -->\n'));
  const agy = read('.gemini/config/hooks.json');
  assert.deepEqual(Object.keys(agy), ['my-linter-hook', 'review']);
  assert.deepEqual(Object.keys(agy.review), ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']);
  assert.match(agy.review.SessionStart[0].command, /^node ".*\/hook\.mjs" --host antigravity SessionStart$/, 'each command names its event, which the payload does not');
  assert.equal(agy.review.Stop[0].timeout, 600);
  assert.equal(agy.review.PreToolUse[0].hooks[0].command.split(' ').pop(), 'PreToolUse');
  const doctor = m.cli(['doctor']).stdout;
  for (const t of ['Crush', 'Antigravity']) assert.match(doctor, new RegExp(`^✓ ${t}: set up \\(.*\\); its hooks have not run in this repository yet`, 'm'));
  assert.equal(m.cli(['init', '--crush', '--antigravity']).status, 0);
  assert.equal(read('.gemini/config/hooks.json').review.Stop.length, 1, 'a second init replaces lessloc\'s entries');
  m.cli(['remove', '--crush', '--antigravity']);
  assert.deepEqual(tree(m.home), before, 'byte for byte');

  const own = machine(['agy'], { '.gemini/config/hooks.json': json({ review: { PreToolUse: [{ matcher: 'run_command', hooks: [theirs] }] } }) });
  assert.match(own.cli(['init', '--agents']).stdout, /^- Antigravity: not set up: .*hooks\.json has a hook of your own named "review", so lessloc left it alone$/m);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(own.home, '.gemini/config/hooks.json'), 'utf8')).review.PreToolUse[0].hooks, [theirs]);
});

test('init --aider writes its settings only where the user set none, a lint command and a standard under a neutral name, and remove restores the home folder byte for byte', () => {
  const settings = '# my settings\nmodel: sonnet\nread: [CONVENTIONS.md]\n';
  const m = machine(['aider'], { '.aider.conf.yml': settings }), conf = () => fs.readFileSync(path.join(m.home, '.aider.conf.yml'), 'utf8');
  const before = tree(m.home), out = m.cli(['init', '--aider']).stdout, dir = path.join(m.home, '.config/agent-standard');
  assert.match(out, /^- Aider settings installed in .*\.aider\.conf\.yml and .*\.config\/agent-standard \(your own read in .*\.aider\.conf\.yml stayed; lessloc's would be read: ".*\/CONVENTIONS\.md"\), for all your projects\. Aider sends lint errors to its model only while auto-lint is on, its default$/m);
  assert.equal(conf(), `${settings}\n# >>> lessloc: \`lessloc remove --aider\` takes this block out\nlint-cmd: ${JSON.stringify(path.join(dir, 'check'))}\ngit-commit-verify: true\n# <<< lessloc\n`, 'after the user\'s own settings, without a second read');
  assert.equal(fs.readFileSync(path.join(dir, 'CONVENTIONS.md'), 'utf8'), `${STANDARD}\n`);
  assert.equal(fs.statSync(path.join(dir, 'check')).mode & 0o111, 0o111);
  assert.match(m.cli(['doctor']).stdout, /^✓ Aider: set up \(.*\.aider\.conf\.yml\); its hooks have not run in this repository yet/m);
  const check = path.join(dir, 'check'), script = fs.readFileSync(check, 'utf8');
  fs.writeFileSync(check, script.replaceAll('hook.mjs', 'moved/hook.mjs'));
  assert.deepEqual(spawnSync(check, ['a.py'], { cwd: m.dir, encoding: 'utf8' }).output.slice(1), ['', ''], 'a moved checkout: every file passes, and the model sees no error');
  assert.match(m.cli(['doctor']).stdout, /^✗ Aider: the hooks in .*\.aider\.conf\.yml do not answer \(node ".*lessloc\.mjs" init --aider\)$/m);
  fs.writeFileSync(check, script);
  m.cli(['init', '--aider']);
  assert.equal(conf().split('# >>> lessloc').length, 2, 'a second init replaces the block');
  assert.match(m.cli(['remove', '--aider']).stdout, /Aider settings in .*\.aider\.conf\.yml and .*agent-standard/);
  assert.deepEqual(tree(m.home), before, 'byte for byte');

  const fresh = machine(['aider']);
  fresh.cli(['init', '--agents']);
  assert.match(fs.readFileSync(path.join(fresh.home, '.aider.conf.yml'), 'utf8'), /^# >>> lessloc[^\n]*\nlint-cmd: .*\nread: .*CONVENTIONS\.md"\ngit-commit-verify: true\n# <<< lessloc\n$/);
  fresh.cli(['remove', '--agents']);
  assert.deepEqual(tree(fresh.home), {}, 'a settings file lessloc created goes again');
});

test('init names the tools it finds that have no hooks, with the rules tier, and doctor gives them one line', () => {
  const m = machine(['zeditor', 'cn'], { '.warp/themes/x.yaml': 'name: x\n' });
  const out = m.cli(['init']).stdout;
  for (const t of ['Zed', 'Warp', 'Continue']) assert.match(out, new RegExp(`^- ${t}: lessloc has no hooks for it; to put the working standard in AGENTS\\.md for tools without hooks, run: node ".*lessloc\\.mjs" init --rules$`, 'm'));
  assert.doesNotMatch(out, /init --agents/, 'nothing for --agents to install');
  assert.match(m.cli(['doctor']).stdout, /^ {2}no lessloc hooks for Zed, Warp, Continue: to put the working standard in AGENTS\.md for tools without hooks, run: node ".*lessloc\.mjs" init --rules$/m);
});

test("every Copilot hook command does nothing where node or its hook.mjs is missing, since Copilot refuses a tool call when a pre-tool hook fails; where both are there, it answers", () => {
  const dir = repo({ 'a.py': 'x = 1\n' }), moved = path.join(tmp('copilot-'), 'hooks.json'), here = path.join(tmp('copilot-'), 'hooks.json');
  userHooks('copilot', true, moved, path.join(tmp('moved-'), 'hook.mjs'));
  userHooks('copilot', true, here);
  const file = f => JSON.parse(fs.readFileSync(f, 'utf8')).hooks, plugin = file(repoFile('copilot-hooks.json'));
  // Each run is a session of its own: Copilot may run lessloc twice for one event, and a repeated payload is answered once.
  let n = 0;
  const input = () => JSON.stringify({ sessionId: `m${++n}`, timestamp: 1, cwd: dir, toolName: 'create', toolArgs: { path: path.join(dir, 'b.py'), file_text: 'x = 1\n# ... existing code ...\n' } });
  const run = (command, env = {}) => spawnSync('/bin/sh', ['-c', command], { cwd: dir, input: input(), encoding: 'utf8', env: { ...ENV, ...env } });
  const nothing = r => assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
  for (const [what, hooks, env] of [['a moved checkout', file(moved)], ['no node', file(here), { PATH: tmp('empty-bin-') }], ["the plugin's folder without lessloc", plugin, { PLUGIN_ROOT: tmp('empty-') }]]) {
    for (const [event, [e]] of Object.entries(hooks)) {
      assert.match(e.powershell, /^if \(\(Get-Command node -ErrorAction SilentlyContinue\) -and \(Test-Path ".*hook\.mjs"\)\) \{ node ".*hook\.mjs" --host copilot \w+; exit \$LASTEXITCODE \}$/, `${what}: ${event}`);
      nothing(run(e.bash, env));
    }
  }
  for (const [hooks, env] of [[file(here)], [plugin, { PLUGIN_ROOT: ROOT }]]) assert.equal(JSON.parse(run(hooks.preToolUse[0].bash, env).stdout).permissionDecision, 'deny', 'a placeholder is refused');
});

test("init and remove give a settings file back byte for byte in any layout, and init writes lessloc's entries in the file's own indentation", () => {
  const gemini = '{\n    "general": { "vimMode": true },\n    "ui": {\n        "theme": "GitHub"\n    }\n}\n', codex = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"./mine.sh"}]}]}}';
  const m = machine(['gemini', 'codex'], { '.gemini/settings.json': gemini, '.codex/hooks.json': codex }), f = path.join(m.home, '.gemini/settings.json');
  const before = tree(m.home);
  m.cli(['init', '--agents']);
  assert.match(fs.readFileSync(f, 'utf8'), /^\{\n {4}"general": \{\n {8}"vimMode": true\n {4}\},\n/, 'four spaces, as the file had');
  assert.ok(!fs.readFileSync(path.join(m.home, '.codex/hooks.json'), 'utf8').endsWith('\n'), 'no last newline, as the file had none');
  assert.equal(fs.statSync(path.join(ENV.LESSLOC_STATE, 'originals.json')).mode & 0o077, 0, 'what the files held is readable by the user alone');
  m.cli(['remove', '--agents']);
  assert.deepEqual(tree(m.home), before);
  // A setting the user changed while lessloc was set up stays changed.
  m.cli(['init', '--gemini']);
  fs.writeFileSync(f, `${JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), ui: { theme: 'Dark' } }, null, 4)}\n`);
  m.cli(['remove', '--gemini']);
  assert.equal(fs.readFileSync(f, 'utf8'), `${JSON.stringify({ general: { vimMode: true }, ui: { theme: 'Dark' } }, null, 4)}\n`);
});

test('a settings file with comments is left alone: init prints what to add by hand, and remove reports what it could not take out', () => {
  const settings = '{\n  // the model I use\n  "model": { "name": "qwen3-coder-plus" }\n}\n', m = machine(['qwen'], { '.qwen/settings.json': settings }), f = path.join(m.home, '.qwen/settings.json');
  assert.match(m.cli(['init', '--qwen']).stdout, /^- Qwen Code: not set up: .*\.qwen\/settings\.json has comments or is not a JSON object, so lessloc left it alone\. To set it up by hand, merge this into it: \{"hooks":\{"SessionStart":\[\{"hooks":\[\{"type":"command","command":"node \\".*hook\.mjs\\" --host qwen","timeout":30\}\]\}\],.*\}\}$/m);
  assert.equal(m.cli(['remove', '--agents']).status, 0, "nothing of lessloc's in it, so nothing to report");
  assert.equal(fs.readFileSync(f, 'utf8'), settings);
  // A comment written after lessloc's entries went in.
  fs.writeFileSync(f, '{"model": {"name": "qwen3-coder-plus"}}\n');
  m.cli(['init', '--qwen']);
  const commented = fs.readFileSync(f, 'utf8').replace('{\n', '{\n  // hooks below\n');
  fs.writeFileSync(f, commented);
  const removed = m.cli(['remove', '--qwen']);
  assert.match(removed.stderr, /^not removed: Qwen Code: .*\.qwen\/settings\.json has comments or is not a JSON object, so lessloc left it alone\. Take out by hand the entries that run node ".*hook\.mjs" --host qwen$/m);
  assert.doesNotMatch(removed.stdout, /installed by the tool itself/);
  assert.equal(removed.status, 1);
  assert.equal(fs.readFileSync(f, 'utf8'), commented);
});

test("init finds Gemini CLI by its program, settings or extensions, not by Antigravity's files in ~/.gemini, and Copilot not by VS Code alone", () => {
  const m = machine(['agy', 'code'], { '.gemini/antigravity/brain/x.json': '{}\n' });
  const out = m.cli(['init', '--agents']).stdout;
  assert.match(out, /^- Antigravity hooks installed in .*\.gemini\/config\/hooks\.json/m);
  assert.doesNotMatch(out, /Gemini CLI|GitHub Copilot/);
  assert.ok(!fs.existsSync(path.join(m.home, '.gemini/settings.json')) && !fs.existsSync(path.join(m.home, '.copilot')));
});

test("remove --agents runs outside any repository and takes out only the agent tools' hooks, deleting the hook files lessloc created", () => {
  const m = machine(['cursor-agent', 'codex']), outside = { GIT_CEILING_DIRECTORIES: path.dirname(m.home) };
  m.cli(['init', '--agents']);
  assert.ok(['.cursor/hooks.json', '.codex/hooks.json'].every(f => fs.existsSync(path.join(m.home, f))));
  const r = m.cli(['remove', '--agents'], outside, m.home);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^removed: Codex hooks in .*\.codex\/hooks\.json; Cursor hooks in .*\.cursor\/hooks\.json$/m);
  assert.deepEqual(tree(m.home), {}, 'no file left that lessloc created');
  assert.ok(fs.existsSync(path.join(m.dir, '.git/hooks/pre-commit')), "the repository's commit gate stays");
  assert.match(m.cli(['remove'], outside, m.home).stderr, /^lessloc remove needs a git repository, or a tool flag such as --agents$/m);
});

test("Cursor's plugin install reads lessloc's Cursor manifest, which lists no skill, and runs the hooks init writes through a script in the plugin's folder", () => {
  const manifest = JSON.parse(fs.readFileSync(repoFile('.cursor-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'lessloc');
  assert.deepEqual(manifest.skills, [], "a component the manifest names replaces Cursor's own discovery, so the /lessloc skill is not listed to the model");
  const text = fs.readFileSync(repoFile(manifest.hooks), 'utf8'), command = './cursor/hook.sh';
  assert.equal(text, `${JSON.stringify(HOSTS.cursor.hooks.wrap({}, ourEntries('cursor', command)), null, 2)}\n`);
  for (const f of ['hooks/hooks.json', 'hooks.json']) assert.ok(!fs.existsSync(repoFile(f)), `Claude Code would load ${f}`);
  // Cursor runs a plugin's hook command from the plugin's folder.
  const dir = repo({ 'a.py': 'x = 1\n' }), input = JSON.stringify({ hook_event_name: 'sessionStart', session_id: 'u1', conversation_id: 'u1', workspace_roots: [dir], cursor_version: '2.5.0' });
  const run = PATH => spawnSync('/bin/sh', ['-c', command], { cwd: ROOT, input, encoding: 'utf8', env: { ...ENV, PATH } });
  assert.ok(JSON.parse(run(ENV.PATH).stdout).additional_context.startsWith(STANDARD.slice(0, 60)));
  assert.deepEqual(run(tmp('empty-bin-')).output.slice(1), ['', ''], 'no node: nothing, and every tool call goes ahead');
});

// The status table is generated from the rows in lib/install.mjs, so the getting-started guide and the rows cannot disagree, and
// a status says "verified live" only beside the tool version it was verified on. The README links to it.
test('the getting-started guide shows exactly the status table, and the README links to it', () => {
  const text = fs.readFileSync(repoFile('docs/guide/getting-started.md'), 'utf8'), readme = fs.readFileSync(repoFile('README.md'), 'utf8');
  assert.equal(text.split('<!-- hosts:start -->\n')[1]?.split('\n<!-- hosts:end -->')[0], hostTable(''), 'run `node lessloc.mjs hosts --write`');
  assert.ok(!readme.includes('<!-- hosts:start -->') && readme.includes('https://lessloc.org/guide/getting-started#supported-agent-tools'));
  assert.match(spawnSync(process.execPath, [CLI, 'hosts', '--markdown'], { encoding: 'utf8' }).stdout, /^\| Agent tool \| Install \| Status \|\n\|---\|---\|---\|\n\| Claude Code \| \[plugin\]\(https:\/\/lessloc\.org\/guide\/getting-started#claude-code\) \|/);
});

test('the status table has a row for every tool lessloc sets up, naming how, and every status is worded exactly', () => {
  for (const t of TOOLS.filter(x => x.setUp)) assert.ok(t.docs?.some(r => r.how.includes(t.commands ? 'plugin' : `\`init --${t.id}`)), `${t.label} has a row with its install`);
  for (const r of hostRows()) assert.match(r.status, /^(tested against documented payloads|rules tier: .*|(\`init --\w+\` )?verified live on \d+\.\d+[.\d]*\b.*)$/, r.name);
});
