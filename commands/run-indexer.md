---
description: Manually trigger Beacon indexing (useful when auto-index is off)
allowed-tools: [Bash]
---

# /run-indexer

1. First check if the current directory is blacklisted: `node ${CLAUDE_PLUGIN_ROOT}/scripts/blacklist-manager.js show`
   - If the current working directory appears in the effective blacklist and is NOT whitelisted, refuse with a helpful message explaining how to use `/whitelist add` or `/blacklist remove`
2. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.js --force`
3. Report completion stats from `node ${CLAUDE_PLUGIN_ROOT}/scripts/status.js`
