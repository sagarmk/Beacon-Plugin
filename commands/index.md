---
description: Visual overview of Beacon index — chunks, coverage, provider. Pass --files to list indexed files.
allowed-tools: [Bash]
---

# /index

Run the command below. It outputs a colored dashboard with ANSI escape codes — the user sees it rendered in the command output section.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/index-info.js --pretty
```

After the command runs, add a **one-line text summary** extracted from the output, like:

> Beacon index: 37 files, 99 chunks, 97% coverage, synced 4 minutes ago.

Do NOT re-display the full dashboard as text (ANSI codes render as garbage in markdown). If the command fails, suggest running `/reindex`.
