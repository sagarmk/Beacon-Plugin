---
description: Visual overview of Beacon index — files, chunks, coverage, provider
allowed-tools: [Bash]
---

# /index

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/index-info.js` and format the JSON output as a rich visual overview, styled like Claude Code's `/context` command. This output is ALWAYS viewed in a CLI terminal — never use markdown tables. Use padded/aligned plain text columns instead.

## Output Format

Use `⊡` for bullet items, `⊠` for warnings/errors. All sections indented with 2 spaces. Section headers indented with 4 spaces.

CRITICAL: Never use markdown table syntax (`| col | col |` or `|---|---|`). Always use space-padded aligned columns for tabular data, like this:

```
  filename.js              12 chunks    ~2m
  other_file.ts             4 chunks    ~1h
```

---

### If `status` is `"no_index"`:

```
📊 Beacon Index — Not Initialized
  ⊡ {config.model} · {config.provider_description} · {config.dimensions} dims
  ⊡ No index found. It will be created on next session start.
  ⊡ Storage: {config.storage_path}
```

---

### Normal output (index exists):

#### 1. Header

```
📊 Beacon Index
  ⊡ {config.model} · {config.provider_description} · {config.dimensions} dims
```

#### 2. Sync Status (only if NOT idle)

If `sync.status` is `"in_progress"`:
```
    Syncing
  ⊡ {progress_bar} {sync.percent}% ({sync.completed}/{sync.total} files)
  ⊡ Currently: {sync.current_file}
```

Build the progress bar: 20 chars wide, use `█` for filled and `░` for empty. Example: `████████████░░░░░░░░`

If `sync.status` is `"error"`:
```
    ⊠ Sync Error
  ⊠ {sync.error}
  ⊡ Last successful sync: {last_sync as relative time}
  ⊡ Try /reindex to force a fresh sync
```

If `sync.status` is `"stale"`:
```
    ⊠ Sync Stalled
  ⊠ Sync appears to have stalled (started over 5 minutes ago)
  ⊡ Try /reindex to force a fresh sync
```

#### 3. Coverage Bar (always show)

```
    Coverage
  ⊡ {coverage_bar} {coverage_percent}% ({files_indexed} / {eligible_files} files)
```

Build the coverage bar: 20 chars wide using `█` and `░`. If `coverage_percent` is null (no eligible count), show just the file count without a bar.

If coverage < 50%, add: `  ⊠ Low coverage — consider running /reindex`

#### 4. Index Statistics

```
    Index statistics
  ⊡ Indexed files:     {files_indexed}
  ⊡ Total chunks:      {total_chunks}
  ⊡ Avg chunks/file:   {avg_chunks_per_file}
  ⊡ DB size:           {db_size formatted as KB/MB}
  ⊡ Last sync:         {last_sync as relative time}
```

Format `db_size_bytes`: <1024 → `N bytes`, <1MB → `N.N KB`, else `N.N MB`.
Format timestamps as relative: "2 minutes ago", "3 hours ago", "about 1 day ago". If null, show "never".

#### 5. Indexed Files

```
    Indexed files
  ⊡ scripts/lib/db.js              12 chunks    ~2m
  ⊡ scripts/lib/embedder.js         4 chunks    ~2m
  ⊡ scripts/lib/chunker.js          6 chunks    ~2m
  ⊡ src/index.ts                    3 chunks    ~1h
```

Rules:
- Use `⊡` prefix for each file, then pad columns so chunk counts and timestamps align vertically
- Right-align the chunk count column, left-align the file path
- If ≤ 20 files: show all files sorted by most recently updated
- If > 20 files: show only the top 30 most recently updated, then add `  ⊡ ... and {N} more files`
- Format `last_updated` as short relative: `~2m`, `~1h`, `~3d`, `~19h`

#### 6. By Extension

```
    By extension
  ⊡ .tsx       48 files
  ⊡ .ts        11 files
  ⊡ .sql        3 files
  ⊡ .md         2 files
  ⊡ .py         1 file
```

Use `⊡` prefix, pad the extension and count columns to align. Use "file" (singular) for count of 1.

## Key Rules

- Keep it scannable — no paragraph text, no verbose explanations
- NEVER use markdown pipe tables — always use space-padded aligned columns with `⊡` bullets
- Use consistent indentation: 2 spaces before `⊡` bullets
- Section headers with 4 spaces indent
- Never exceed ~50 lines total
- If sync is idle and healthy, do NOT show the sync section — go straight from header to coverage
