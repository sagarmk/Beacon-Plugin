---
description: Manage Beacon indexing whitelist — allow indexing in specific directories that would otherwise be blacklisted
allowed-tools: [Bash]
---

# /whitelist

Parse the user's arguments and run the appropriate subcommand:

- `/whitelist` (no args) → `node ${CLAUDE_PLUGIN_ROOT}/scripts/whitelist-manager.js show`
- `/whitelist add [path]` → `node ${CLAUDE_PLUGIN_ROOT}/scripts/whitelist-manager.js add [path]` (defaults to current directory if no path given)
- `/whitelist remove <path>` → `node ${CLAUDE_PLUGIN_ROOT}/scripts/whitelist-manager.js remove <path>`
- `/whitelist clear` → `node ${CLAUDE_PLUGIN_ROOT}/scripts/whitelist-manager.js clear`

Format the JSON output as a readable summary:
- For `show`: list all whitelisted paths
- For `add`/`remove`/`clear`: confirm the action and show the updated list

Whitelisted paths override the blacklist. Subdirectories of whitelisted paths are also allowed. This is useful for allowing indexing in project directories that happen to be under a blacklisted parent.
