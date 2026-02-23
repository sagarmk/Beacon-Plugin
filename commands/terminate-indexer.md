---
description: Kill a running Beacon sync process and clean up state
allowed-tools: [Bash]
---

# /terminate-indexer

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/terminate-indexer.js` and format the JSON output:

- `status: "terminated"` → Confirm the process was killed and state was cleaned up
- `status: "cleaned"` → Explain the process was already gone but stale state was cleaned up
- `status: "no_process"` → Let the user know no sync is currently running
- `status: "error"` → Report the error
