---
description: View and modify Beacon configuration — providers, thresholds, indexing rules
argument-hint: "[show | set <key> <value> | provider <name> | reset [section]]"
allowed-tools: [Bash, Read]
---

# /config

Manage Beacon plugin configuration. All changes are saved to the repo-local `.claude/beacon.json` override file.

## Routing

Parse `$ARGUMENTS` to determine the subcommand:
- Empty or `show` → **Show**
- `set <key> <value>` → **Set**
- `provider` or `provider <name>` → **Provider**
- `reset` or `reset <section>` → **Reset**

---

## Show (default)

1. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/config-manager.js show`
2. Format the JSON output as a readable config overview:
   - Show the active provider prominently at the top: `Provider: ollama (local)` or `Provider: custom`
   - Group settings by section: **Embedding**, **Chunking**, **Indexing**, **Search**, **Storage**
   - For each setting, show the key, value, and mark `[override]` if source is `"user"` — leave unmarked if default
   - For array values (include/exclude patterns), show as a compact comma-separated list
   - At the bottom, list available providers: `Available: ollama, openai, voyage, litellm`
   - Keep total output under 30 lines

## Set

1. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/config-manager.js set <key> <value>`
2. If the script exits with an error (JSON on stderr), show the error message. If it's an unknown key, show the list of valid keys.
3. If `dimensions_changed` is `true` in the output:
   - ⚠️ Warn: "Changing dimensions from `<old>` to `<new>` makes existing embeddings incompatible."
   - Ask: "Run `/reindex` now to rebuild the index?"
   - If the user confirms, delete the DB file (`rm -f .claude/.beacon/embeddings.db`) and run `node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.js`
4. Otherwise, confirm: `Set search.similarity_threshold → 0.5`

## Provider

1. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/config-manager.js provider <name>`
2. If no name given, the script lists available providers — format them as a table with name, description, model, and dimensions.
3. If the provider is not found, show the error with available provider names.
4. If successful, show what was applied: model, endpoint, dimensions.
5. If `api_key_env` is not empty/none, remind: "Make sure `OPENAI_API_KEY` is set in your environment."
6. If `dimensions_changed` is `true`:
   - ⚠️ Warn: "Switching from `<old>` to `<new>` dimensions. Existing embeddings are incompatible."
   - Ask: "Run `/reindex` now to rebuild the index with the new provider?"
   - If the user confirms, delete the DB and run sync.

## Reset

1. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/config-manager.js reset [section]`
2. Confirm what was reset: "Reset all overrides to defaults" or "Reset `embedding` section to defaults"
3. If `dimensions_changed` is `true`, same warning and `/reindex` offer as above.

---

## Formatting Rules

- Use code formatting for key names and values
- Show overrides in **bold** to distinguish them from defaults
- Keep output compact — prefer tables over verbose prose
- For provider switching, be explicit about what changed and what the user needs to do next
