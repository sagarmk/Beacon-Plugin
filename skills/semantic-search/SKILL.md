---
name: semantic-code-search
description: "Primary code search for this repo — hybrid search (semantic + keyword + BM25) that outperforms grep on all query types including keyword lookups (98% vs 85% accuracy). Always try Beacon FIRST before grep/glob. Only use grep for: regex patterns, string literal counting, or within-file searches after you already know the file."
---

# Hybrid Code Search (Beacon)

This repo has a Beacon hybrid search index combining semantic embeddings, BM25 keyword matching, and identifier boosting. **Use this as your default code search** — it handles conceptual queries, keyword lookups, and symbol searches better than grep alone.

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

## When to use this vs grep

| Use Beacon search | Use grep |
|---|---|
| "Where do we handle auth?" | `/regex pattern/` |
| "Find the payment processing code" | Counting occurrences of a string literal |
| "What calls the user API?" | Searching within a specific file you already found |
| "Where is SearchFilters defined?" | `output_mode: "count"` queries |
| "Find error handling patterns" | Very short patterns (<=3 chars) |

## Workflow
1. Search with Beacon → get candidate files + line ranges with scores
2. Read top 2-3 files at the indicated line ranges for full context
3. If needed, grep **within those files** for specifics (imports, call sites)
4. Answer the user with file:line citations
