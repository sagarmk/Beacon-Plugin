<p align="center">
  <img src="images/beacon.png" alt="Beacon" width="180">
</p>

<h1 align="center">Beacon</h1>

<p align="center">
  <strong>Semantic code search for <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a></strong><br>
  Find code by meaning, not just string matching.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> · <a href="#embedding-models">Models</a> · <a href="#commands">Commands</a> · <a href="#configuration">Config</a> · <a href="EXAMPLES.md">Examples</a>
</p>

---

<p align="center">
  <img src="images/benchmark.png" alt="Benchmark: 98.3% accuracy at 101ms" width="700">
</p>

<p align="center">
  <strong>98.3% accuracy · 5x faster than grep · 20-query benchmark on a real codebase</strong>
</p>

---

## Quick Start

```bash
# Install Ollama (local embeddings, free)
brew install ollama
ollama serve &
ollama pull nomic-embed-text

# Install Beacon plugin
claude plugin marketplace add sagarmk/Claude-Code-Beacon-Plugin
claude plugin install beacon@claude-code-beacon-plugin

# Restart Claude Code — Beacon indexes automatically
```

## Embedding Models

Beacon runs on **open-source models by default** — no API keys, no cloud costs, fully local via [Ollama](https://ollama.com).

| Model | Dims | Context | Speed | Best for |
|-------|------|---------|-------|----------|
| **nomic-embed-text** (default) | 768 | 8192 | Fast | General-purpose, great code search |
| **mxbai-embed-large** | 1024 | 512 | Fast | Higher accuracy, larger vectors |
| **snowflake-arctic-embed:l** | 1024 | 512 | Medium | Strong retrieval benchmarks |
| **all-minilm** | 384 | 512 | Very fast | Lightweight, low resource usage |

To switch models, pull with Ollama and update your config:

```bash
ollama pull mxbai-embed-large
```

```json
// .claude/beacon.json
{
  "embedding": {
    "model": "mxbai-embed-large",
    "dimensions": 1024,
    "query_prefix": ""
  }
}
```

Then run `/reindex` to rebuild with the new model.

### Cloud Providers

For cloud-hosted embeddings, create `.claude/beacon.json` in your repo:

<details>
<summary><strong>OpenAI</strong></summary>

```bash
export OPENAI_API_KEY="sk-..."
```

```json
{
  "embedding": {
    "api_base": "https://api.openai.com/v1",
    "model": "text-embedding-3-small",
    "api_key_env": "OPENAI_API_KEY",
    "dimensions": 1536,
    "batch_size": 100,
    "query_prefix": ""
  }
}
```

</details>

<details>
<summary><strong>Voyage AI</strong></summary>

```bash
export VOYAGE_API_KEY="pa-..."
```

```json
{
  "embedding": {
    "api_base": "https://api.voyageai.com/v1",
    "model": "voyage-code-3",
    "api_key_env": "VOYAGE_API_KEY",
    "dimensions": 1024,
    "batch_size": 50,
    "query_prefix": ""
  }
}
```

</details>

<details>
<summary><strong>LiteLLM proxy</strong> (Vertex AI, Bedrock, Azure, etc.)</summary>

```bash
pip install litellm
litellm --model vertex_ai/text-embedding-004 --port 4000
```

```json
{
  "embedding": {
    "api_base": "http://localhost:4000/v1",
    "model": "vertex_ai/text-embedding-004",
    "api_key_env": "LITELLM_API_KEY",
    "dimensions": 1024,
    "batch_size": 50,
    "query_prefix": ""
  }
}
```

</details>

<details>
<summary><strong>Custom endpoint</strong></summary>

Any server implementing the OpenAI `/v1/embeddings` API will work. Set `api_base`, `model`, `dimensions`, and optionally `api_key_env` in `.claude/beacon.json`.

</details>

## Commands

Beacon indexes your codebase automatically on session start and re-embeds files as you edit — no manual steps needed.

#### Search

| Command | Description |
|---------|-------------|
| `/search-code` | Hybrid code search — semantic + keyword + BM25 matching. Supports `--path <dir>` to scope results |

#### Index

| Command | Description |
|---------|-------------|
| `/index` | Visual overview — files, chunks, coverage, provider |
| `/index-status` | Quick health check — file count, chunk count, last sync |
| `/reindex` | Force full re-index from scratch |
| `/run-indexer` | Manually trigger indexing |
| `/terminate-indexer` | Kill a running sync process |

#### Config

| Command | Description |
|---------|-------------|
| `/config` | View and modify Beacon configuration |
| `/blacklist` | Prevent indexing of specific directories |
| `/whitelist` | Allow indexing in otherwise-blacklisted directories |

Beacon also provides a **code-explorer** agent and a **semantic-search** skill that Claude can invoke automatically.

<details>
<summary><strong>Why Beacon?</strong></summary>

- **Understands your questions** — ask "where is the auth flow?" and get `lib/auth.ts`, not every file containing "auth"
- **Query expansion** — searches for "auth" automatically find code mentioning "authentication", "authorize", and "login"
- **Stays in sync automatically** — hooks handle full index, incremental re-embedding on edits, and garbage collection
- **Resilient** — retries with backoff on transient failures, auto-recovers from DB corruption, debounces GC
- **Works with any embedding provider** — Ollama (local/free), OpenAI, Voyage AI, LiteLLM, or any OpenAI-compatible API
- **Gives Claude better context** — slash commands, a code-explorer agent, and a grep-nudge hook for smarter search

</details>

<details>
<summary><strong>How It Works</strong></summary>

Beacon uses Claude Code [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) to stay in sync with your codebase:

| Hook | Trigger | What it does |
|------|---------|-------------|
| **SessionStart** | Every session | Full index on first run, diff-based catch-up on subsequent runs |
| **PostToolUse** | `Write`, `Edit`, `MultiEdit` | Re-embeds the changed file |
| **PostToolUse** | `Bash` | Garbage collects embeddings for deleted files |
| **PreCompact** | Before context compaction | Injects index status so search capability survives compaction |
| **PreToolUse** | `Grep` | Intercepts grep and redirects to Beacon for semantic-style queries |

</details>

<details>
<summary><strong>Configuration</strong></summary>

Default configuration (`config/beacon.default.json`):

```json
{
  "embedding": {
    "api_base": "http://localhost:11434/v1",
    "model": "nomic-embed-text",
    "api_key_env": "",
    "dimensions": 768,
    "batch_size": 10,
    "query_prefix": "search_query: "
  },
  "chunking": {
    "strategy": "hybrid",
    "max_tokens": 512,
    "overlap_tokens": 50
  },
  "indexing": {
    "include": ["**/*.ts", "**/*.tsx", "**/*.js", "..."],
    "exclude": ["node_modules/**", "dist/**", "..."],
    "max_file_size_kb": 500,
    "auto_index": true,
    "max_files": 10000,
    "concurrency": 4
  },
  "search": {
    "top_k": 10,
    "similarity_threshold": 0.35,
    "hybrid": {
      "enabled": true,
      "weight_vector": 0.4,
      "weight_bm25": 0.3,
      "weight_rrf": 0.3,
      "doc_penalty": 0.5,
      "identifier_boost": 1.5,
      "debug": false
    }
  },
  "storage": {
    "path": ".claude/.beacon"
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `embedding.api_base` | `http://localhost:11434/v1` | Embedding API endpoint |
| `embedding.model` | `nomic-embed-text` | Embedding model name |
| `embedding.dimensions` | `768` | Vector dimensions (must match model) |
| `embedding.query_prefix` | `search_query: ` | Prefix prepended to search queries |
| `indexing.include` | Common code patterns | Glob patterns for files to index |
| `indexing.exclude` | `node_modules`, `dist`, etc. | Glob patterns to skip |
| `indexing.max_file_size_kb` | `500` | Skip files larger than this |
| `indexing.auto_index` | `true` | Auto-index on session start |
| `indexing.concurrency` | `4` | Number of files to index in parallel |
| `search.top_k` | `10` | Max results per query |
| `search.similarity_threshold` | `0.35` | Minimum similarity score |
| `search.hybrid.enabled` | `true` | Enable hybrid search (set `false` for pure vector) |

#### Per-repo overrides

Create `.claude/beacon.json` in any repo to override defaults. Values are deep-merged with the default config:

```json
{
  "embedding": {
    "api_base": "https://api.openai.com/v1",
    "model": "text-embedding-3-small",
    "api_key_env": "OPENAI_API_KEY",
    "dimensions": 1536
  },
  "indexing": {
    "include": ["**/*.py"],
    "max_files": 5000
  }
}
```

#### Storage

Beacon stores its SQLite database at `.claude/.beacon/embeddings.db` (configurable via `storage.path`). This file is auto-generated and safe to delete — run `/reindex` to rebuild. The database uses [sqlite-vec](https://github.com/asg017/sqlite-vec) for vector search and FTS5 for keyword matching.

</details>

<details>
<summary><strong>Troubleshooting</strong></summary>

### What if Ollama is down?

Beacon degrades gracefully when the embedding server is unreachable — it never blocks your session. Embedding requests automatically retry with backoff (1s, 4s) before giving up.

| Scenario | Behavior |
|----------|----------|
| **Session start** | Sync is skipped, error is logged, session continues normally |
| **Search** | Falls back to keyword-only (BM25) search — still returns results |
| **File edits** | Re-embedding fails silently, old embeddings are preserved |
| **Status commands** | Work normally (DB-only, no Ollama needed) |
| **DB corruption** | Auto-detected and rebuilt on next sync |

Start Ollama at any time and run `/run-indexer` to catch up.

### Manual indexing

| Command | What it does |
|---------|-------------|
| `/run-indexer` | Manually trigger indexing — useful when `auto_index` is off or after starting Ollama late |
| `/reindex` | Force a full re-index from scratch (deletes existing embeddings first) |
| `/terminate-indexer` | Kill a stuck sync process and clean up lock state |

### Checking index health

Run `/index` for a visual overview with a coverage bar, file list, and provider info. For a quick numeric summary, use `/index-status` — it shows file count, chunk count, and last sync time.

Things to look for:
- **Low coverage %** — files may be excluded by glob patterns or exceeding `max_file_size_kb`
- **Sync status errors** — usually means the embedding server was unreachable during the last sync
- **Stale sync warnings** — the index hasn't been updated recently; run `/run-indexer` to refresh

### Verifying search

Run `/search-code` with a test query to confirm search is working. If results include `"FTS-only"` in debug output, the embedding server is unreachable — search still works but without semantic matching (keyword/BM25 only).

</details>

## Examples

See [EXAMPLES.md](EXAMPLES.md) for real-world use cases — intent-based search, codebase navigation, identifier tracking, and auto-sync — each with concrete before/after comparisons.

## License

[MIT](LICENSE)
