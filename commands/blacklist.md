---
description: Manage Beacon indexing blacklist — prevent indexing of dangerous directories
allowed-tools: [Bash]
---

# /blacklist

Parse the user's arguments and run the appropriate subcommand:

- `/blacklist` (no args) → `node ${CLAUDE_PLUGIN_ROOT}/scripts/blacklist-manager.js show`
- `/blacklist add <path>` → `node ${CLAUDE_PLUGIN_ROOT}/scripts/blacklist-manager.js add <path>`
- `/blacklist remove <path>` → `node ${CLAUDE_PLUGIN_ROOT}/scripts/blacklist-manager.js remove <path>`
- `/blacklist reset` → `node ${CLAUDE_PLUGIN_ROOT}/scripts/blacklist-manager.js reset`

Format the JSON output as a readable summary:
- For `show`: list the effective blacklist paths with a note about defaults vs user additions
- For `add`/`remove`/`reset`: confirm the action and show the updated list

The default blacklist automatically includes all ancestor directories from `/` to the user's home directory (e.g., `/`, `/Users`, `/Users/<username>`). This prevents accidentally indexing root or home directories. User additions are merged on top of these defaults. The whitelist overrides the blacklist for specific paths.
