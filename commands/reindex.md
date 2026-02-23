---
description: Force a full re-index of the codebase (escape hatch if index gets corrupted)
allowed-tools: [Bash]
---

# /reindex

1. Delete the existing database: `rm -f .claude/.beacon/embeddings.db`
2. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.js`
3. Report completion stats from `node ${CLAUDE_PLUGIN_ROOT}/scripts/status.js`
