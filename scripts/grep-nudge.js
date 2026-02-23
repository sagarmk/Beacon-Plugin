#!/usr/bin/env node
// PreToolUse hook for Grep — nudges Claude toward Beacon hybrid search
// when grep is used for queries that Beacon handles better.
// Allows grep to proceed in all cases (permissionDecision: "allow").

import { readFileSync, existsSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..');

let input;
try {
  input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
} catch {
  // Can't read stdin — allow grep, no nudge
  process.exit(0);
}

const toolInput = input.tool_input || {};
const pattern = toolInput.pattern || '';
const searchPath = toolInput.path || '';
const outputMode = toolInput.output_mode || 'files_with_matches';

// --- Heuristics: skip nudge for legitimate grep use cases ---

// 1. Regex metacharacters (not just dots or escaped chars)
const regexMeta = /[*+?\[\]{}()|\\^$]/.test(pattern.replace(/\\\./g, ''));
if (regexMeta) process.exit(0);

// 2. Targeting a specific file (not a directory)
if (searchPath && !searchPath.endsWith('/') && path.extname(searchPath)) {
  process.exit(0);
}

// 3. Count mode — grep is the right tool
if (outputMode === 'count') process.exit(0);

// 4. Very short pattern — likely a symbol or literal
if (pattern.length <= 3) process.exit(0);

// --- Heuristics: nudge when Beacon would be better ---

const words = pattern.trim().split(/\s+/);
const looksLikeNaturalLanguage = words.length >= 2 && /^[a-zA-Z]/.test(pattern);
const isMultiWord = words.length >= 2;

if (isMultiWord || looksLikeNaturalLanguage) {
  // Health gate: only nudge if Beacon index is healthy
  try {
    const { loadConfig } = await import('./lib/config.js');
    const { BeaconDatabase } = await import('./lib/db.js');
    const config = loadConfig();
    const dbPath = path.join(config.storage.path, 'embeddings.db');

    // Check DB exists and has meaningful size
    if (!existsSync(dbPath)) process.exit(0);
    const dbStat = statSync(dbPath);
    if (dbStat.size < 4096) process.exit(0);

    // Run health check
    const health = BeaconDatabase.healthCheck(dbPath, config.embedding.dimensions);
    if (!health.ok) process.exit(0);
  } catch {
    // Any error in health check — don't nudge, let grep proceed
    process.exit(0);
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext: `Tip: This repo has a Beacon hybrid search index (98% accuracy vs grep's 85%). For future searches like this, prefer: node ${pluginRoot}/scripts/search.js "${pattern}"`
    }
  };
  console.log(JSON.stringify(output));
} else {
  // Single-word pattern that's not short — borderline case, no nudge
  process.exit(0);
}
