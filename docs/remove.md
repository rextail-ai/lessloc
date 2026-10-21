---
title: "Remove lessloc: steps for an AI coding agent"
---

# Remove lessloc

These steps are for an AI coding agent whose user asked it to remove lessloc. Follow them in order and run each command yourself. The user only approves your commands.

## 1. Find lessloc

```sh
ls ~/.lessloc/lessloc.mjs
```

If the file is missing, lessloc came as a plugin that an agent tool installed itself. For Claude Code, `claude plugin list` shows `lessloc@lessloc`: run `claude plugin uninstall lessloc@lessloc` and `claude plugin marketplace remove lessloc`, then go to step 3. For any other tool, tell the user to remove the lessloc plugin or extension in that tool, and stop.

## 2. Take it out

Ask the user which repositories lessloc was set up in, and run this in each one, starting with the current one:

```sh
node ~/.lessloc/lessloc.mjs remove --agents
```

It takes lessloc out of that repository's git hooks and out of every agent tool's hooks for all projects, gives settings files back as they were, and deletes lessloc's stored files for that checkout. Act on what it prints:

| The output says | Do this |
|---|---|
| `removed: ...` | Nothing. |
| `kept, because they are shared with the team: ...` | Delete them only if the user asks. |
| `installed by the tool itself, so remove it there: ...` | Run the commands it gives. For Claude Code they are `claude plugin uninstall lessloc@lessloc` and `claude plugin marketplace remove lessloc`. Where it names a step in a tool's settings, tell the user. |
| `not removed: ...` (exit code 1) | The file has comments or is not a JSON object. Tell the user which entries to take out by hand. |
| `nothing of lessloc's to remove` | Nothing. |

Outside a repository, `remove --agents` takes out only the agent tools' hooks. If the user set up GitHub Copilot's cloud agent, also run `node ~/.lessloc/lessloc.mjs remove --copilot --repo`, which takes lessloc out of `.github/hooks/review.json`.

## 3. Leave the last step to the user

Do not delete `~/.cache/lessloc` or `~/.lessloc` from this session. An agent tool registers its hooks when a session starts, and the session keeps running them until it ends, so this session, and any other agent session that is open, keeps running lessloc's hooks after `remove`, and they would write `~/.cache/lessloc` again.

## 4. Tell the user

- What was removed and what was kept, exactly as the output listed it.
- To finish, close every agent session, then run `rm -rf ~/.cache/lessloc ~/.lessloc`, or ask for it in a new session. That deletes lessloc's files in the user cache, the shortened prompt copies among them, and the clone. It leaves the snapshots in `.git/objects`, as the next point says.
- The snapshots lessloc's hooks took stay in each repository's `.git/objects` as unreachable git objects: copies of the working tree, untracked files that git does not ignore included. Git never pushes them, and `git gc` prunes them once they are older than `gc.pruneExpire`, two weeks by default. To delete them now, the user runs `git gc --prune=now` in each repository after every agent session has ended, or asks for it in a new session; it also deletes the repository's other unreachable objects, such as a dropped stash. Tell the user this instead of saying that nothing of lessloc remains.
- If you offer to pause lessloc instead of removing it, say what stays on: `"mode": "off"` in `.lessloc.json`, or `LESSLOC=off` in the environment the agent tool starts with, silences only the agent hooks; the commit gate still checks and refuses commits, and `node ~/.lessloc/lessloc.mjs check` and CI still run. Only `node ~/.lessloc/lessloc.mjs remove` takes out the commit gate.

More: https://lessloc.org/agents#remove-lessloc
