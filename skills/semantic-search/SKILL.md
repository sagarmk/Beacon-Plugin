---
name: semantic-code-search
description: "Primary code search for this repo — hybrid search (semantic + keyword + BM25) that outperforms grep on all query types including keyword lookups (98% vs 85% accuracy). Grep is automatically intercepted and redirected to Beacon for most queries. Grep only passes through for: regex patterns, dotted identifiers, path-like patterns, string literal counting, short patterns (<=3 chars), within-file searches, content output mode, quoted string literals, annotations/markers (TODO/FIXME/@param), or URL-like patterns."
---

# Hybrid Code Search (Beacon)

This repo has a Beacon hybrid search index combining semantic embeddings, BM25 keyword matching, and identifier boosting. **Beacon is enforced as the default search** — grep is automatically intercepted and redirected to Beacon for queries it handles better.

## How to search

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/search.js "<query>"
```

### Options
- `--top-k N` — number of results (default: 10)
- `--threshold F` — minimum score cutoff (default: 0.35)
- `--no-hybrid` — disable hybrid, use pure vector search only

### Multi-query batch
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/search.js "auth flow" "session handling" "token refresh"
```
Single HTTP round-trip for all queries. Returns grouped results.

### Output
JSON array of matches, each with:
- `file` — file path
- `lines` — line range (e.g. "45-78")
- `similarity` — vector cosine similarity
- `score` — final hybrid score (when hybrid enabled)
- `preview` — first 300 chars of matched chunk

## Grep intercept behavior

Grep is **denied and redirected** to Beacon unless one of these conditions is met:

| Grep passes through when... | Example |
|---|---|
| Pattern has regex metacharacters | `function\s+\w+` |
| Targets a specific file | `path: "src/lib/db.js"` |
| `output_mode` is `"count"` | Counting occurrences |
| Pattern is <= 3 characters | `fs`, `db` |
| Dotted identifier | `fs.readFileSync`, `path.join` |
| Path-like pattern (contains `/` or `\`) | `src/components` |
| `output_mode` is `"content"` | Viewing matching lines |
| Quoted string literal | `"use strict"`, `'Content-Type'` |
| Annotation/marker pattern | `TODO`, `FIXME`, `@param`, `#pragma` |
| URL-like pattern | `http://`, `localhost:3000` |
| Beacon index is unhealthy | DB missing, empty, dimension mismatch |
| Intercept disabled via config | `intercept.enabled: false` |

To disable interception entirely, set `intercept.enabled: false` in `.claude/beacon.json`.

## Workflow
1. Search with Beacon → get candidate files + line ranges with scores
2. Read top 2-3 files at the indicated line ranges for full context
3. If needed, grep **within those files** for specifics (imports, call sites)
4. Answer the user with file:line citations
