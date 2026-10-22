// The agent tools lessloc knows on a user's machine: whether each one is installed or is running this process, whether lessloc
// is set up for it, and how to set it up, check it and take it out. A tool with lessloc hooks names its row in lib/hosts.mjs.
// Finding a tool spawns nothing and makes no network call: it looks for the tool's program on PATH and its folder.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BRIDGE, CLINE_HOOKS, CLOUD_ENTRY, ENTRY, HOSTS, NEUTRAL, OURS, RULES_MARK, hookLists, userHooks } from './hosts.mjs';
import { VERSION, load, save } from './repo.mjs';
import { STANDARD } from './voice.mjs';

export const ROOT = path.dirname(ENTRY);
export const CLI = `node "${path.join(ROOT, 'lessloc.mjs')}"`;
// How long ago, in the unit a person reads at a glance.
export const ago = ms => {
  const m = Math.round(ms / 60000);
  if (m < 120) return `${m} min ago`;
  return m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
};
const home = (...p) => path.join(os.homedir(), ...p);
const conf = (...p) => path.join(process.env.XDG_CONFIG_HOME || home('.config'), ...p);
const codexHome = (...p) => path.join(process.env.CODEX_HOME || home('.codex'), ...p);
const claudeHome = (...p) => path.join(process.env.CLAUDE_CONFIG_DIR || home('.claude'), ...p);
const copilotHome = (...p) => path.join(process.env.COPILOT_HOME || home('.copilot'), ...p);
const clineHome = (...p) => path.join(process.env.CLINE_DIR || home('.cline'), ...p);
const piHome = (...p) => path.join(process.env.PI_CODING_AGENT_DIR || home('.pi', 'agent'), ...p);
const dirsIn = d => {
  try { return fs.readdirSync(d); } catch { return []; }
};
const fileText = f => {
  try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
};

// Runs a hook command the way the tool runs it, with a session start outside any repository, and says whether lessloc answers:
// with the standard, or, for a tool whose session start reaches no model (`quiet`), by running without an error.
function answers(command, event, quiet) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-doctor-'));
  try {
    const input = JSON.stringify({ hook_event_name: event, hookName: event, event, event_type: event, source: 'startup', session_id: 'doctor', taskId: 'doctor', cwd: dir, working_dir: dir, workspace_roots: [dir], workspaceRoots: [dir] });
    const r = spawnSync(command, { shell: true, cwd: dir, input, encoding: 'utf8', timeout: 30000, env: { ...process.env, LESSLOC: '', LESSLOC_OFF: '', LESSLOC_STATE: path.join(dir, 'state') } });
    return quiet ? r.status === 0 && !r.stderr : String(r.stdout).includes(STANDARD.slice(0, 40));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
// The command of lessloc's first entry in a hook list, whatever the file's shape. A Copilot entry gives one command per shell,
// and `doctor` runs the bash one, except on Windows.
function commandIn(x) {
  if (!x || typeof x !== 'object') return undefined;
  const command = x.command ?? (process.platform === 'win32' ? undefined : x.bash);
  if (typeof command === 'string' && OURS(x)) return command;
  return Object.values(x).map(commandIn).find(Boolean);
}

// A tool whose row in lib/hosts.mjs has a user-level hook file.
const lists = host => {
  const f = HOSTS[host].hooks.file();
  try { return hookLists(host, load(f), f); } catch { return {}; }
};
const hookFile = (host, plugin) => ({
  host,
  setUp: () => [Object.values(lists(host)).flat().some(OURS) && HOSTS[host].hooks.file(), plugin?.()].filter(Boolean),
  install: () => userHooks(host, true),
  remove: () => userHooks(host, false),
  works() {
    const start = Object.keys(HOSTS[host].hooks.events)[0], command = commandIn(lists(host)[start]);
    return command ? answers(command, start, HOSTS[host].start === false) : true;
  },
});
// A tool whose session start reaches no model reads the standard from a user-level rules file. lessloc's block there has
// neutral markers; `remove` takes out the block, and the file when it held nothing else.
const BLOCK = `<!-- working-standard -->\n${STANDARD}\n<!-- /working-standard -->\n`;
function userRules(f, install) {
  const text = fileText(f);
  if (install) return save(f, RULES_MARK.test(text) ? text.replace(RULES_MARK, BLOCK) : text ? `${text}\n${BLOCK}` : BLOCK), f;
  const rest = text.replace(/(^|\n)<!-- working-standard -->\n[\s\S]*?\n<!-- \/working-standard -->\n?/, '');
  if (rest === text) return '';
  if (rest.trim()) fs.writeFileSync(f, rest);
  else fs.rmSync(f);
  return f;
}
const withRules = (t, file) => ({
  ...t,
  install: () => `${t.install()} and ${userRules(file(), true)}`,
  remove: () => [t.remove(), userRules(file(), false)].filter(Boolean).join(' and '),
});

// A tool that loads plugins from a folder of its own gets a short file there that loads lessloc's bridge from this checkout,
// exported by `line` from the module `from` (quoted). `check` is what the tool needs of the module's default export, which
// `doctor` checks by loading the file; a file in another form than the one `init` writes now (an older lessloc's) does not work
// either, wherever it loads lessloc from.
function pluginFile(id, file, from, check, line = m => `export { default } from ${m};`) {
  const text = (m = JSON.stringify(from)) => `// Written by \`lessloc init --${id}\`; \`lessloc remove --${id}\` deletes it.\n${line(m)}\n`;
  const t = {
    setUp: () => (fileText(file()).includes('lessloc') ? [file()] : []),
    install() {
      save(file(), text());
      return file();
    },
    remove: () => (t.setUp().length ? (fs.rmSync(file()), file()) : ''),
    works: () => fileText(file()).replace(/"(?:[^"\\]|\\.)*"/, '""') === text('""') && spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(process.argv[1]); process.exit(${check} ? 0 : 1)`, pathToFileURL(file()).href], { timeout: 30000 }).status === 0,
  };
  return t;
}
const own = dir => pathToFileURL(path.join(ROOT, dir)).href;
// OpenCode imports the plugin file; the bridge it loads then runs the hooks. OpenCode 2.x runs its `setup`, 1.x its `server`.
const opencode = { host: 'opencode', what: 'plugin', ...pluginFile('opencode', () => conf('opencode', 'plugins', 'lessloc.js'), pathToFileURL(path.join(BRIDGE, 'server.js')).href, 'typeof m.default?.setup === "function" && typeof m.default?.server === "function"') };
const kilo = { host: 'kilo', what: 'plugin', ...pluginFile('kilo', () => conf('kilo', 'plugin', 'lessloc.js'), pathToFileURL(path.join(BRIDGE, 'server.js')).href, 'typeof m.default?.server === "function"', m => `export { kilo as default } from ${m};`) };
const amp = { host: 'amp', what: 'plugin', ...pluginFile('amp', () => conf('amp', 'plugins', 'lessloc.js'), own('amp/plugin.js'), 'typeof m.default === "function"') };
// Pi loads extensions with jiti, which takes a plain path. A package Pi installed itself is listed in its settings.
const piPackage = () => [].concat(load(piHome('settings.json')).packages || []).some(p => /lessloc/.test(typeof p === 'string' ? p : p?.source || '')) && 'Pi package';
const piFile = pluginFile('pi', () => piHome('extensions', 'lessloc.js'), path.join(ROOT, 'pi', 'extension.js'), 'typeof m.default === "function"');
const pi = { host: 'pi', what: 'extension', ...piFile, setUp: () => [...piFile.setUp(), piPackage()].filter(Boolean) };

// Cline: its CLI and SDK load lessloc's plugin, and its IDE extension runs hook files named after their events, from a folder
// in Documents. Each hook file runs lessloc; one of the user's own with the same name is never replaced.
const CLINE_DIR = () => home('Documents', 'Cline', 'Hooks');
// Cline's plugin loader gives a default import from a module package the whole namespace, so its file imports by name.
const clinePlugin = pluginFile('cline', () => clineHome('plugins', 'lessloc.js'), own('cline/plugin.js'), 'typeof m.default?.hooks?.beforeTool === "function"', m => `import { lessloc } from ${m};\nexport default lessloc();`);
const clineHook = h => path.join(CLINE_DIR(), h), clineOurs = h => OURS(fileText(clineHook(h)));
const cline = {
  host: 'cline', via: ['cline-sdk'], what: 'plugin and hook files',
  setUp() {
    const set = [...clinePlugin.setUp(), CLINE_HOOKS.some(clineOurs) && CLINE_DIR()].filter(Boolean);
    return set.length ? [set.join(' and ')] : [];
  },
  install() {
    const theirs = CLINE_HOOKS.map(clineHook).find(f => fs.existsSync(f) && !OURS(fileText(f)));
    if (theirs) throw new Error(`${theirs} is a hook of your own, so lessloc left Cline's hook files alone`);
    for (const h of CLINE_HOOKS) {
      save(clineHook(h), `#!/bin/sh\n# Written by \`lessloc init --cline\`; \`lessloc remove --cline\` deletes it.\nexec node "${ENTRY}" --host cline\n`);
      fs.chmodSync(clineHook(h), 0o755);
    }
    return `${clinePlugin.install()} and ${CLINE_DIR()}`;
  },
  remove() {
    const gone = [clinePlugin.remove(), CLINE_HOOKS.filter(clineOurs).map(h => fs.rmSync(clineHook(h))).length && CLINE_DIR()].filter(Boolean);
    return gone.join(' and ');
  },
  works: () => (!clinePlugin.setUp().length || clinePlugin.works()) && (!clineOurs('TaskStart') || answers(JSON.stringify(clineHook('TaskStart')), 'TaskStart')),
};

// goose loads hooks from a plugin folder: lessloc writes its manifest and hook file under a neutral name, and a folder of that
// name holding anything else is the user's own.
const gooseDir = () => path.dirname(path.dirname(HOSTS.goose.hooks.file()));
const gooseHooks = hookFile('goose');
const goose = withRules({
  ...gooseHooks,
  install() {
    const dir = gooseDir();
    if (dirsIn(dir).length && !gooseHooks.setUp().length) throw new Error(`${dir} is a plugin of your own, so lessloc left it alone`);
    save(path.join(dir, 'plugin.json'), `${JSON.stringify({ name: NEUTRAL, version: VERSION }, null, 2)}\n`);
    gooseHooks.install();
    return dir;
  },
  remove() {
    if (!gooseHooks.remove()) return '';
    if (!fs.existsSync(HOSTS.goose.hooks.file())) {
      fs.rmSync(path.join(gooseDir(), 'plugin.json'), { force: true });
      for (const d of [path.join(gooseDir(), 'hooks'), gooseDir()]) if (!dirsIn(d).length) fs.rmSync(d, { recursive: true, force: true });
    }
    return gooseDir();
  },
}, HOSTS.goose.rules);
// Antigravity's hook file names each hook: lessloc's has a neutral name, and a hook of that name holding anything else is the
// user's own.
const agyHooks = hookFile('antigravity');
const antigravity = {
  ...agyHooks,
  install() {
    const f = HOSTS.antigravity.hooks.file(), mine = load(f)[NEUTRAL];
    if (mine && typeof mine === 'object' && Object.keys(mine).length && !Object.values(mine).flat().some(OURS)) throw new Error(`${f} has a hook of your own named "${NEUTRAL}", so lessloc left it alone`);
    return agyHooks.install();
  },
};

// Aider has no hooks. It runs a lint command on each file its model edits, and sends the model what the command prints when
// it exits non-zero; it shows the model that command, and the names of its read-only files. So lessloc's lint command is a
// script in a folder with a neutral name, and the working standard is a read-only file beside it. ~/.aider.conf.yml gets them
// in a marked block, with git-commit-verify so the commit gate runs on Aider's commits, each only where the user set no value.
const aiderDir = (...p) => conf('agent-standard', ...p), aiderConf = () => home('.aider.conf.yml');
const AIDER_BLOCK = /(^|\n)# >>> lessloc\b[^\n]*\n[\s\S]*?# <<< lessloc\n?/;
const aiderScript = () => /--host aider\b/.test(fileText(aiderDir('check')));
// The hook.mjs lessloc's lint command runs. Where it or node is missing, the command passes every file, so a moved checkout
// never shows Aider's model an error; `doctor` finds it instead.
const aiderEntry = () => /^exec node "(.*)" --host aider/m.exec(fileText(aiderDir('check')))?.[1];
const aiderSetting = (key, text) => new RegExp(`^${key}\\s*:`, 'm').test(text);
const aider = {
  host: 'aider', what: 'settings',
  setUp: () => (AIDER_BLOCK.test(fileText(aiderConf())) ? [aiderConf()] : []),
  install() {
    const f = aiderConf(), text = fileText(f), theirs = text.replace(AIDER_BLOCK, '$1'), check = aiderDir('check');
    if (dirsIn(aiderDir()).length && !aiderScript()) throw new Error(`${aiderDir()} is a folder of your own, so lessloc left it alone`);
    save(aiderDir('CONVENTIONS.md'), `${STANDARD}\n`);
    save(check, `#!/bin/sh\n# Written by \`lessloc init --aider\`; \`lessloc remove --aider\` deletes it.\ncommand -v node >/dev/null 2>&1 && [ -f "${ENTRY}" ] || exit 0\nexec node "${ENTRY}" --host aider "$@"\n`);
    fs.chmodSync(check, 0o755);
    const want = [['lint-cmd', /\s/.test(check) ? JSON.stringify(check) : check], ['read', aiderDir('CONVENTIONS.md')], ['git-commit-verify', true]];
    const lines = want.filter(([k]) => !aiderSetting(k, theirs)).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), kept = want.filter(([k]) => aiderSetting(k, theirs));
    const block = `# >>> lessloc: \`lessloc remove --aider\` takes this block out\n${lines.join('\n')}\n# <<< lessloc\n`;
    if (lines.length) save(f, AIDER_BLOCK.test(text) ? text.replace(AIDER_BLOCK, (m, pre) => pre + block) : text ? `${text}\n${block}` : block);
    else if (text !== theirs) save(f, text.replace(AIDER_BLOCK, ''));
    return `${lines.length ? `${f} and ` : ''}${aiderDir()}${kept.length ? ` (your own ${kept.map(([k]) => k).join(', ')} in ${f} stayed; lessloc's would be ${kept.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})` : ''}`;
  },
  remove() {
    const f = aiderConf(), text = fileText(f), gone = [];
    if (AIDER_BLOCK.test(text)) {
      const rest = text.replace(AIDER_BLOCK, '');
      if (rest.trim()) fs.writeFileSync(f, rest);
      else fs.rmSync(f);
      gone.push(f);
    }
    if (aiderScript()) {
      for (const x of ['check', 'CONVENTIONS.md']) fs.rmSync(aiderDir(x), { force: true });
      if (!dirsIn(aiderDir()).length) fs.rmSync(aiderDir(), { recursive: true, force: true });
      gone.push(aiderDir());
    }
    return gone.join(' and ');
  },
  // When the block sets lessloc's lint command: its hook.mjs exists, and the command, run as Aider runs it on a file outside
  // any repository, answers nothing, without an error.
  works() {
    if (!/^lint-cmd:/m.test(AIDER_BLOCK.exec(fileText(aiderConf()))?.[0] || '')) return true;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessloc-doctor-'));
    try {
      const r = spawnSync(`${JSON.stringify(aiderDir('check'))} a.py`, { shell: true, cwd: dir, encoding: 'utf8', timeout: 30000, env: { ...process.env, LESSLOC: '', LESSLOC_OFF: '', LESSLOC_STATE: path.join(dir, 'state') } });
      return !!aiderEntry() && fs.existsSync(aiderEntry()) && r.status === 0 && !r.stdout && !r.stderr;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
};

// Qwen Code keeps each extension in a folder named after it.
const qwenExtension = () => fs.existsSync(home('.qwen', 'extensions', 'lessloc', 'qwen-extension.json')) && 'Qwen Code extension';

// When the Claude Code process this command runs under started (0 when unknown): a session loads its plugins when it starts.
const sessionStart = () => {
  const pid = Number(process.env.CLAUDE_PID), r = pid ? spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }) : null;
  return Date.parse(r?.stdout?.trim() || '') || 0;
};
// Claude Code installs its plugins itself, and lessloc never edits Claude Code's settings: it prints the commands instead.
const claudePlugin = () => Object.entries(load(claudeHome('plugins', 'installed_plugins.json')).plugins || {}).find(([k]) => k.startsWith('lessloc@'))?.[1]?.[0];
const claude = {
  host: 'claude',
  setUp: () => (claudePlugin() ? ['Claude Code plugin'] : []),
  commands: [`claude plugin marketplace add "${ROOT}"`, 'claude plugin install lessloc@lessloc'],
  // `claude plugin disable` keeps the plugin installed and turns it off in the user's settings.
  disabled: () => load(claudeHome('settings.json')).enabledPlugins?.['lessloc@lessloc'] === false,
  enable: 'claude plugin enable lessloc@lessloc',
  works: () => !claudePlugin()?.installPath || answers(`node "${path.join(claudePlugin().installPath, 'hook.mjs')}"`, 'SessionStart'),
};
// Codex records a plugin it installed in config.toml as [plugins."<plugin>@<marketplace>"].
const codexPlugin = () => /^\[plugins\."lessloc@/m.test(fileText(codexHome('config.toml'))) && 'Codex plugin';
// A plugin a tool installed itself: a folder under `root`, at most `depth` levels down, whose manifest `at` names lessloc.
const pluginIn = (root, at, depth) => dirsIn(root).some(d => load(path.join(root, d, at)).name === 'lessloc' || (depth > 1 && pluginIn(path.join(root, d), at, depth - 1)));
// Copilot keeps a plugin it installed in installed-plugins/<marketplace>/<plugin>, or in _direct/<source> when it came straight
// from a repository.
const copilotPlugin = () => ['.github/plugin/plugin.json', '.claude-plugin/plugin.json'].some(at => pluginIn(copilotHome('installed-plugins'), at, 2)) && 'Copilot plugin';
// Cursor keeps the plugins it installed under ~/.cursor/plugins. Its documentation does not say how deep, so three levels.
const cursorPlugin = () => pluginIn(home('.cursor', 'plugins'), path.join('.cursor-plugin', 'plugin.json'), 3) && 'Cursor plugin';
// Gemini CLI keeps each extension in a folder named after it.
const geminiExtension = () => fs.existsSync(home('.gemini', 'extensions', 'lessloc', 'gemini-extension.json')) && 'Gemini CLI extension';

// The Copilot cloud agent reads hooks only from the repository's default branch, and gets lessloc from a setup step that
// unpacks this version's npm package, which no one can republish and which npm checks against the registry's hash. The agent
// can read the repository's files, so the hook file and lessloc's folder have neutral names; the setup step is the one file
// that names lessloc.
export const REPO_HOOKS = top => path.join(top, '.github', 'hooks', `${NEUTRAL}.json`);
export const repoHooks = (top, install) => userHooks('copilot', install, REPO_HOOKS(top), CLOUD_ENTRY);
export const cloudStep = () => {
  const dir = path.posix.dirname(CLOUD_ENTRY);
  return `- run: mkdir -p "${dir}" && cd "${dir}" && npm pack lessloc@${VERSION} --silent && tar -xzf lessloc-${VERSION}.tgz --strip-components=1`;
};

// A row of the status table (`lessloc hosts`): the tool's name in the docs, how it installs, linked to its section of the
// getting-started guide, and its status. A row without a status was tested against the tool's documented payloads only.
const row = (name, how, anchor, status) => ({ name, how: `[${how}](/guide/getting-started#${anchor})`, ...(status && { status }) });

// env: the tool is running this process (each sets its marker for the commands its agent runs). bin and dirs: it is installed.
// then: what the user still does after the install. via: other rows its hook file's runs are logged under. docs: its rows in the
// status table, one per way it runs. Tools without hooks or a plugin get the rules tier.
export const TOOLS = [
  { id: 'claude', label: 'Claude Code', env: e => e.CLAUDECODE === '1', bin: ['claude'], dirs: () => [claudeHome()], ...claude,
    docs: [row('Claude Code', 'plugin', 'claude-code', 'tested end to end on 2.1.306')] },
  { id: 'codex', label: 'Codex', env: e => !!e.CODEX_THREAD_ID, bin: ['codex'], dirs: () => [codexHome()], then: 'Codex runs new hooks only after you trust them once: /hooks in Codex', ...hookFile('codex', codexPlugin),
    docs: [row('Codex', '`init --codex` or the Codex plugin', 'codex', '`init --codex` tested end to end on 0.163.0; the Codex plugin: tested against documented payloads')] },
  { id: 'cursor', label: 'Cursor', env: e => e.CURSOR_AGENT === '1', bin: ['cursor-agent', 'cursor'], dirs: () => [home('.cursor')], ...hookFile('cursor', cursorPlugin),
    docs: [row('Cursor', '`init --cursor` or the Cursor plugin', 'cursor')] },
  { id: 'opencode', label: 'OpenCode', env: e => e.OPENCODE_TERMINAL === '1', bin: ['opencode'], dirs: () => [conf('opencode')], ...opencode,
    docs: [row('OpenCode 2.x', '`init --opencode`', 'opencode-2-x', 'tested end to end on 2.1.2'), row('OpenCode 1.x', '`init --opencode`', 'opencode-1-x-and-kilo-code', 'tested end to end on 1.19.3')] },
  { id: 'kilo', label: 'Kilo Code', env: e => !!e.KILO_PID, bin: ['kilo'], dirs: () => [conf('kilo')], ...kilo,
    docs: [row('Kilo Code', '`init --kilo`', 'opencode-1-x-and-kilo-code', 'tested end to end on 7.8.15')] },
  // Amp documents no variable for the commands its agent runs.
  { id: 'amp', label: 'Amp', bin: ['amp'], dirs: () => [conf('amp')], then: 'Amp loads it after "plugins: reload" in its command palette (Ctrl+O), or a restart', ...amp,
    docs: [row('Amp', '`init --amp`', 'amp')] },
  { id: 'cline', label: 'Cline', env: e => e.CLINE_ACTIVE === 'true', bin: ['cline'], dirs: () => [clineHome(), home('Documents', 'Cline')], then: 'Cline\'s IDE extension runs hook files only when "Enable Hooks" is on: Cline settings, Feature Settings', ...cline,
    docs: [row('Cline', '`init --cline`', 'cline', 'tested end to end on 3.0.73 (Cline CLI); the IDE\'s hook files: tested against documented payloads')] },
  { id: 'pi', label: 'Pi', env: e => e.PI_CODING_AGENT === 'true', bin: ['pi'], dirs: () => [piHome()], then: 'Pi loads it after /reload, or a restart', ...pi,
    docs: [row('Pi', '`init --pi` or the Pi package', 'pi', 'tested end to end on 1.4.0')] },
  // One hook file serves Copilot CLI and VS Code's agent mode. VS Code alone is not taken for Copilot: most of its users never
  // run its agent.
  { id: 'copilot', label: 'GitHub Copilot', env: e => e.COPILOT_CLI === '1', bin: ['copilot'], dirs: () => [copilotHome()], via: ['vscode'], ...hookFile('copilot', copilotPlugin),
    docs: [row('GitHub Copilot CLI, VS Code agent mode', '`init --copilot` or the Copilot CLI plugin', 'github-copilot-cli-and-vs-code', 'tested end to end on 1.0.102 (Copilot CLI); VS Code agent mode: tested against documented payloads'), row('Copilot cloud agent', '`init --copilot --repo` and a setup step', 'copilot-cloud-agent')] },
  // Antigravity keeps its own files in ~/.gemini too, so Gemini CLI is found by its program, its settings or its extensions.
  { id: 'gemini', label: 'Gemini CLI', env: e => e.GEMINI_CLI === '1', bin: ['gemini'], dirs: () => [home('.gemini', 'settings.json'), home('.gemini', 'extensions')], ...hookFile('gemini', geminiExtension),
    docs: [row('Gemini CLI', '`init --gemini` or the Gemini CLI extension', 'gemini-cli', 'tested end to end on 0.65.0')] },
  { id: 'qwen', label: 'Qwen Code', env: e => e.QWEN_CODE === '1', bin: ['qwen'], dirs: () => [home('.qwen')], ...hookFile('qwen', qwenExtension),
    docs: [row('Qwen Code', '`init --qwen` or the Qwen Code extension', 'qwen-code', 'tested end to end on 0.26.0')] },
  // Factory Droid, Kiro, Junie, OpenHands and Devin CLI document no variable for the commands their agents run.
  { id: 'droid', label: 'Factory Droid', bin: ['droid'], dirs: () => [home('.factory')], ...hookFile('droid'),
    docs: [row('Factory Droid', '`init --droid`', 'factory-droid', 'tested end to end on 0.247.0')] },
  { id: 'augment', label: 'Augment', env: e => e.AUGMENT_AGENT === '1', bin: ['auggie'], dirs: () => [home('.augment')], ...withRules(hookFile('augment'), HOSTS.augment.rules),
    docs: [row('Augment (CLI, VS Code, IntelliJ)', '`init --augment`', 'augment')] },
  { id: 'kiro', label: 'Kiro', bin: ['kiro-cli'], dirs: () => [home('.kiro')], then: "Kiro's CLI runs these hooks in every workspace; its IDE reads hooks only from each workspace's .kiro/hooks", ...hookFile('kiro'),
    docs: [row('Kiro CLI', '`init --kiro`', 'kiro')] },
  { id: 'junie', label: 'Junie', bin: ['junie'], dirs: () => [home('.junie')], then: "Junie runs hooks only in its CLI's Early Access build", ...withRules(hookFile('junie'), HOSTS.junie.rules),
    docs: [row('Junie CLI (Early Access)', '`init --junie`', 'junie', 'tested end to end on 26.10.20')] },
  { id: 'openhands', label: 'OpenHands', bin: ['openhands'], dirs: () => [path.dirname(HOSTS.openhands.hooks.file())], then: 'OpenHands reads it only in a repository without its own .openhands/hooks.json', ...hookFile('openhands'),
    docs: [row('OpenHands', '`init --openhands`', 'openhands', 'tested end to end on 1.16.0')] },
  { id: 'goose', label: 'goose', env: e => e.GOOSE_TERMINAL === '1', bin: ['goose'], dirs: () => [conf('goose')], what: 'plugin', ...goose,
    docs: [row('goose', '`init --goose`', 'goose', 'tested end to end on 1.55.0')] },
  { id: 'devin', label: 'Devin CLI', bin: ['devin'], dirs: () => [path.dirname(HOSTS.devin.hooks.file())], ...hookFile('devin'),
    docs: [row('Devin CLI', '`init --devin`', 'devin-cli')] },
  // Crush sets its marker for its hooks and its agent's commands alike.
  { id: 'crush', label: 'Crush', env: e => e.CRUSH === '1', bin: ['crush'], dirs: () => [path.dirname(HOSTS.crush.hooks.file())], ...withRules(hookFile('crush'), HOSTS.crush.rules),
    docs: [row('Crush', '`init --crush`', 'crush', 'tested end to end on 0.98.1')] },
  // Antigravity and Aider document no variable for the commands their agents run.
  { id: 'antigravity', label: 'Antigravity', bin: ['agy', 'antigravity'], dirs: () => ['antigravity', 'antigravity-cli', 'antigravity-ide'].map(d => home('.gemini', d)), ...antigravity,
    docs: [row('Antigravity (app, CLI, IDE)', '`init --antigravity`', 'antigravity', 'tested end to end on 1.4.5 (CLI); the app and IDE: tested against documented payloads')] },
  { id: 'aider', label: 'Aider', bin: ['aider'], dirs: () => [aiderConf(), home('.aider')], then: 'Aider sends lint errors to its model only while auto-lint is on, its default', ...aider,
    docs: [row('Aider', '`init --aider`', 'aider', 'tested end to end on 0.86.2')] },
  // Tools with no hooks lessloc can install, named with the rules tier.
  { id: 'zed', label: 'Zed', bin: ['zed', 'zeditor'], dirs: () => [conf('zed')] },
  { id: 'warp', label: 'Warp', bin: ['warp-terminal'], dirs: () => [home('.warp')] },
  { id: 'continue', label: 'Continue', bin: ['cn'], dirs: () => [home('.continue')] },
];

// The status table: a row for each way a tool above runs, then an agent of your own, the SDKs, and the tools without hooks,
// whose names add two that `init` cannot detect. Its links are under `site`.
const TESTED = 'tested against documented payloads';
export const hostRows = () => [
  ...TOOLS.flatMap(t => t.docs || []),
  { name: 'Your own agent', how: '[the hook protocol](/guide/any-agent)' },
  { name: 'Claude Agent SDK, Codex SDK', how: '[the plugin, or `init --codex`](/guide/any-agent)' },
  { name: 'OpenAI Agents SDK', how: '[the hook protocol](/guide/any-agent#openai-agents-sdk), the git hooks and CI' },
  { name: `${[...TOOLS.filter(t => !t.setUp).map(t => t.label), 'JetBrains AI Assistant', 'Roo Code'].join(', ')}, and other tools without hooks`, how: '[`init --rules`](/guide/getting-started#tools-without-hooks), the git hooks and CI', status: 'rules tier: rules written where each tool\'s documentation says it reads them' },
].map(r => ({ status: TESTED, ...r }));
export const hostTable = (site = 'https://lessloc.org') => ['| Agent tool | Install | Status |', '|---|---|---|', ...hostRows().map(r => `| ${r.name} | ${r.how} | ${r.status} |`)].join('\n').replaceAll('](/', `](${site}/`);

// Whether a program is on PATH, the way a shell finds it.
function onPath(bin) {
  const exts = process.platform === 'win32' ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')] : [''];
  return (process.env.PATH || '').split(path.delimiter).filter(Boolean).some(d => exts.some(x => {
    try {
      const f = path.join(d, bin + x);
      fs.accessSync(f, fs.constants.X_OK);
      return fs.statSync(f).isFile();
    } catch { return false; }
  }));
}
export const insideTool = (env = process.env) => TOOLS.find(t => t.env?.(env));
const found = () => {
  const now = insideTool();
  return TOOLS.filter(t => t === now || t.bin.some(onPath) || t.dirs().some(d => fs.existsSync(d)));
};
const RULES_TIER = `lessloc has no hooks for it; to put the working standard in AGENTS.md for tools without hooks, run: ${CLI} init --rules`;

// What `init` says about the agent tools, in lines an agent can act on: each tool found (and each one asked for), whether
// lessloc is set up for it, and the command that sets it up. It installs the hooks of each tool `asked` names, and with `all`
// of every tool found, except one already set up through its own plugin manager.
export function setup(asked, all) {
  const out = [], started = [], missing = [], here = found();
  for (const t of TOOLS.filter(x => asked(x) || here.includes(x))) {
    const set = t.setUp?.() || [];
    if (t.install && (asked(t) || (all && !set.some(s => / (plugin|extension|package)$/.test(s))))) {
      try {
        out.push(`- ${t.label} ${t.what || 'hooks'} installed in ${t.install()}, for all your projects${t.then ? `. ${t.then}` : ''}`);
        started.push(t.label);
      } catch (e) {
        out.push(`- ${t.label}: not set up: ${e.message}`);
      }
    } else if (set.length && t.disabled?.()) {
      out.push(`- ${t.label}: set up, but the plugin is disabled; run: ${t.enable}`);
      started.push(t.label);
    } else if (set.length) out.push(`- ${t.label}: set up (${set.join(', ')})`);
    else if (t.commands) {
      out.push(`- ${t.label}: not set up. lessloc never edits Claude Code's settings itself; run: ${t.commands.join(' && ')}`);
      started.push(t.label);
    } else if (t.install) out.push(`- ${t.label}: not set up; run: ${CLI} init --${t.id}`), missing.push(t);
    else out.push(`- ${t.label}: ${RULES_TIER}`);
  }
  if (!out.length) out.push('- no agent tool found for this user');
  if (missing.length) out.push(`- to set up every tool above: ${CLI} init --agents`);
  if (started.length) out.push(`- then start a new session in ${started.length > 1 ? `${started.slice(0, -1).join(', ')} and ${started.at(-1)}` : started[0]}, so ${started.length > 1 ? 'each' : 'it'} loads lessloc`);
  if (started.length && /[\\/]_npx[\\/]/.test(ROOT)) out.push(`- warning: lessloc runs from npx's cache (${ROOT}), which npx may clean, and the hooks would then stop. Install it from a clone instead: git clone --depth 1 https://github.com/rextail-ai/lessloc ~/.lessloc, then run this init again with node ~/.lessloc/lessloc.mjs`);
  return [`Agent tools for this user${insideTool() ? ` (this command runs in ${insideTool().label})` : ''}:`, ...out];
}

// Takes lessloc out of each tool `wanted` says (`failed`: what it could not take out, and why), and says how to take out what
// the tools installed themselves (`left`).
export function teardown(wanted) {
  const done = [], left = [], failed = [];
  for (const t of TOOLS.filter(x => wanted(x))) {
    try {
      const f = t.remove?.();
      if (f) done.push(`${t.label} ${t.what || 'hooks'} in ${f}`);
    } catch (e) {
      failed.push(`${t.label}: ${e.message}`);
    }
    if (t.commands && t.setUp().length) left.push('Claude Code: claude plugin uninstall lessloc@lessloc && claude plugin marketplace remove lessloc');
    if (t.id === 'codex' && codexPlugin()) left.push('Codex: remove the lessloc plugin in /plugins');
    if (t.id === 'cursor' && cursorPlugin()) left.push("Cursor: uninstall the lessloc plugin in Cursor's plugin settings");
    if (t.id === 'copilot' && copilotPlugin()) left.push('GitHub Copilot: copilot plugin uninstall lessloc');
    if (t.id === 'gemini' && geminiExtension()) left.push('Gemini CLI: gemini extensions uninstall lessloc');
    if (t.id === 'pi' && piPackage()) left.push('Pi: pi remove git:github.com/rextail-ai/lessloc');
    if (t.id === 'qwen' && qwenExtension()) left.push('Qwen Code: qwen extensions uninstall lessloc');
  }
  return { done, left, failed };
}

// One `doctor` line per tool found or set up: whether lessloc is set up there, whether the installed command answers, and when
// that tool's hooks last ran in this repository (`last`, by host).
export function health(last) {
  const out = [], rules = [], here = found();
  for (const t of TOOLS) {
    const set = t.setUp?.() || [], fix = t.commands ? t.commands.join(' && ') : `${CLI} init --${t.id}`;
    if (!set.length && !here.includes(t)) continue;
    if (!t.setUp) { rules.push(t.label); continue; }
    if (!set.length) out.push(['warn', `${t.label}: installed, lessloc not set up`, fix]);
    else if (set.length > 1) out.push(['warn', `${t.label}: set up twice (${set.join(' and ')}), so its hooks run twice`, `${CLI} remove --${t.id}, or remove the ${set[1].split(' ').pop()}`]);
    else if (t.disabled?.()) out.push(['warn', `${t.label}: set up, but the plugin is disabled`, t.enable]);
    else if (!t.works()) out.push(['bad', `${t.label}: the hooks in ${set[0]} do not answer`, fix]);
    else {
      const ran = Math.max(0, ...[t.host, ...(t.via || [])].map(h => last[h] || 0));
      // Run by an agent in Claude Code, doctor's own command has already fired this session's hooks, which record a run,
      // unless the plugin was installed after this session started.
      const started = !ran && t.id === 'claude' && insideTool() === t && sessionStart(), installed = Date.parse(claudePlugin()?.installedAt || '') || 0;
      if (started === 0) out.push(['warn', `${t.label}: set up (${set[0]}), but no hook has run in this session: expected if the plugin was installed after it started; otherwise its hooks do not run`, 'a new session loads the plugin; if it still does not run, https://lessloc.org/agents#hooks-do-not-run']);
      else if (started && installed > started) out.push(['warn', `${t.label}: set up (${set[0]}) after this session started, so this session runs without it`, 'start a new Claude Code session']);
      else if (started) out.push(['bad', `${t.label}: set up (${set[0]}), but its hooks did not run in this session either`, 'claude plugin list must show lessloc@lessloc enabled; then https://lessloc.org/agents#hooks-do-not-run']);
      else out.push(['ok', `${t.label}: set up (${set[0]}); ${ran ? `its hooks last ran here ${ago(Date.now() - ran)}` : `its hooks have not run in this repository yet${t.then ? ` (${t.then})` : ''}`}`]);
    }
  }
  if (rules.length) out.push(['info', `no lessloc hooks for ${rules.join(', ')}: to put the working standard in AGENTS.md for tools without hooks, run: ${CLI} init --rules`]);
  return out;
}
