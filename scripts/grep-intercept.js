#!/usr/bin/env node
// PreToolUse hook for Grep — enforces Beacon hybrid search as the primary
// search tool by denying grep and redirecting to Beacon when appropriate.
// Falls back to allowing grep when Beacon can't work (DB missing, Ollama down, etc.)

import { readFileSync, existsSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..');

let input;
try {
  input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
} catch {
  process.exit(0);
}

const toolInput = input.tool_input || {};
const pattern = toolInput.pattern || '';
const searchPath = toolInput.path || '';
const outputMode = toolInput.output_mode || 'files_with_matches';

// --- Load config (for intercept settings + DB path) ---
let config;
try {
  const { loadConfig } = await import('./lib/config.js');
  config = loadConfig();
} catch {
  // Can't load config — allow grep through
  process.exit(0);
}

// Check if intercept is disabled via config
if (config.intercept?.enabled === false) process.exit(0);

const minLen = config.intercept?.min_pattern_length ?? 4;

// --- Allow grep through (no intercept) for legitimate grep use cases ---

// 1. Very short pattern
if (pattern.length < minLen) process.exit(0);

// 2. Regex metacharacters (not just dots or escaped chars)
if (/[*+?\[\]{}()|\\^$]/.test(pattern.replace(/\\\./g, ''))) process.exit(0);

// 3. Targeting a specific file (not a directory)
if (searchPath && !searchPath.endsWith('/') && path.extname(searchPath)) {
  process.exit(0);
}

// 4. Count mode — grep is the right tool
if (outputMode === 'count') process.exit(0);

// 5. Dotted identifier (e.g. fs.readFileSync, path.join)
if (/\w\.\w/.test(pattern)) process.exit(0);

// 6. Path-like pattern (contains / or \)
if (/[/\\]/.test(pattern)) process.exit(0);

// 7. Content output mode — user wants matching lines, not file rankings
if (outputMode === 'content') process.exit(0);

// 8. Quoted string literals (looking for exact strings in source)
if (/^["']|["']$/.test(pattern)) process.exit(0);

// 9. Annotations/markers (TODO, FIXME, @param, etc.)
if (/^[@#]|TODO|FIXME|HACK|XXX|DEPRECATED/.test(pattern)) process.exit(0);

// 10. URL-like patterns
if (/:\/{2}|localhost/.test(pattern)) process.exit(0);

// --- Health gate: only intercept if Beacon index is healthy ---
try {
  const { BeaconDatabase } = await import('./lib/db.js');
  const dbPath = path.join(config.storage.path, 'embeddings.db');

  if (!existsSync(dbPath)) process.exit(0);
  const dbStat = statSync(dbPath);
  if (dbStat.size < 4096) process.exit(0);

  const health = BeaconDatabase.healthCheck(dbPath, config.embedding.dimensions);
  if (!health.ok) process.exit(0);
} catch {
  // Any error in health check — allow grep through
  process.exit(0);
}

// --- Deny grep + redirect to Beacon ---
const output = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    additionalContext: `This repo uses Beacon hybrid search (semantic + keyword + BM25) which handles this query better than grep. Run:\n\nnode ${pluginRoot}/scripts/search.js "${pattern}"\n\nBeacon returns ranked results with file paths and line ranges. After reviewing Beacon results, you can grep within specific files if needed.`
  }
};
console.log(JSON.stringify(output));
