---
description: "Hybrid code search — semantic + keyword + BM25"
argument-hint: <query> [query2] [--top-k N] [--threshold F]
allowed-tools: [Bash, Read, Glob]
---

# /search-code

Search the codebase using Beacon hybrid search (semantic embeddings + BM25 keyword matching + identifier boosting).

## Single query
1. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/search.js "$ARGUMENTS"`
2. Parse the JSON results — each match has `file`, `lines`, `similarity`, `score`, and `preview`
3. For the top 3 results, read the actual source files at the indicated line ranges
4. Summarize findings and cite file:line references

## Multi-query batch
Pass multiple quoted queries for a single HTTP round-trip:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/search.js "auth flow" "session handling"
```
Returns `[{query, matches}, ...]` grouped by query.

## Options
- `--top-k N` — number of results (default: 10)
- `--threshold F` — minimum score cutoff (default: 0.35)
- `--no-hybrid` — disable hybrid scoring, use pure vector search

## Result fields
- `file` — file path
- `lines` — matched line range (e.g. "45-78")
- `similarity` — vector cosine similarity
- `score` — final hybrid score (semantic + BM25 + identifier boost)
- `preview` — first 300 chars of matched code chunk
