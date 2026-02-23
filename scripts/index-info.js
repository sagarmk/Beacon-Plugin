#!/usr/bin/env node
// Called by: /index command
// Output: Rich JSON for Claude to format as a visual index overview

import { BeaconDatabase } from './lib/db.js';
import { loadConfig } from './lib/config.js';
import { getRepoFiles } from './lib/git.js';
import { shouldIndex } from './lib/ignore.js';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');

const config = loadConfig();
const dbPath = path.join(config.storage.path, 'embeddings.db');

// --- Provider detection ---
function detectProvider() {
  try {
    const providersPath = path.join(PLUGIN_ROOT, 'config', 'providers.json');
    const providers = JSON.parse(readFileSync(providersPath, 'utf-8'));
    const emb = config.embedding;
    for (const [name, preset] of Object.entries(providers)) {
      const p = preset.embedding;
      if (emb.api_base === p.api_base && emb.model === p.model && emb.dimensions === p.dimensions) {
        return { name, description: preset.description };
      }
    }
  } catch { /* ignore */ }
  return { name: 'custom', description: 'Custom' };
}

// Handle no-DB case
if (!existsSync(dbPath)) {
  const provider = detectProvider();
  console.log(JSON.stringify({
    status: 'no_index',
    message: 'No index found. It will be created on next session start.',
    config: {
      model: config.embedding.model,
      endpoint: config.embedding.api_base,
      dimensions: config.embedding.dimensions,
      provider: provider.name,
      provider_description: provider.description,
      storage_path: config.storage.path
    }
  }, null, 2));
  process.exit(0);
}

// Safe DB init
let db;
try {
  db = new BeaconDatabase(dbPath, config.embedding.dimensions);
} catch (err) {
  const provider = detectProvider();
  console.log(JSON.stringify({
    status: 'error',
    message: `Failed to open database: ${err.message}. Try /reindex.`,
    config: {
      model: config.embedding.model,
      endpoint: config.embedding.api_base,
      dimensions: config.embedding.dimensions,
      provider: provider.name,
      provider_description: provider.description,
      storage_path: config.storage.path
    }
  }, null, 2));
  process.exit(0);
}

try {
  // Gather all data
  const stats = db.getStats();
  const fileStats = db.getFileStats();
  const syncProgress = db.getSyncProgress();
  const lastSync = db.getSyncState('last_sync_time');
  const dbSizeBytes = db.getDbSizeBytes();
  const provider = detectProvider();

  // Get eligible file count from repo (for coverage calculation)
  let eligibleFiles = [];
  try {
    eligibleFiles = getRepoFiles().filter(f => shouldIndex(f, config));
  } catch {
    // git may not be available — graceful fallback
  }

  // Compute extension breakdown from indexed files
  const extCounts = {};
  for (const f of fileStats) {
    const ext = path.extname(f.filePath) || '(none)';
    extCounts[ext] = (extCounts[ext] || 0) + 1;
  }
  const extensions = Object.entries(extCounts)
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count);

  // Average chunks per file
  const avgChunksPerFile = stats.fileCount > 0
    ? Math.round((stats.chunkCount / stats.fileCount) * 10) / 10
    : 0;

  // Determine sync status
  const syncStatus = syncProgress.sync_status || 'idle';
  const isInProgress = syncStatus === 'in_progress';

  // Detect stale in-progress state (sync hook timeout is 300s)
  let effectiveStatus = syncStatus;
  if (isInProgress && syncProgress.sync_started_at) {
    const elapsed = Date.now() - new Date(syncProgress.sync_started_at).getTime();
    if (elapsed > 5 * 60 * 1000) {
      effectiveStatus = 'stale';
    }
  }

  // Build progress object
  let progress;
  if (effectiveStatus === 'in_progress') {
    const total = parseInt(syncProgress.sync_total_files || '0', 10);
    const completed = parseInt(syncProgress.sync_completed_files || '0', 10);
    progress = {
      status: 'in_progress',
      total,
      completed,
      current_file: syncProgress.sync_current_file || null,
      started_at: syncProgress.sync_started_at || null,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0
    };
  } else if (effectiveStatus === 'error') {
    progress = {
      status: 'error',
      error: syncProgress.sync_error || 'Unknown error'
    };
  } else if (effectiveStatus === 'stale') {
    progress = {
      status: 'stale',
      message: 'Sync appears to have stalled (started over 5 minutes ago)',
      started_at: syncProgress.sync_started_at
    };
  } else {
    progress = { status: 'idle' };
  }

  // Cap file list at 200 entries
  const MAX_FILES = 200;
  const truncated = fileStats.length > MAX_FILES;

  // Build the output
  const output = {
    index: {
      files_indexed: stats.fileCount,
      total_chunks: stats.chunkCount,
      eligible_files: eligibleFiles.length,
      coverage_percent: eligibleFiles.length > 0
        ? Math.round((stats.fileCount / eligibleFiles.length) * 100)
        : null,
      avg_chunks_per_file: avgChunksPerFile,
      extensions,
      db_size_bytes: dbSizeBytes,
      db_path: dbPath
    },
    sync: {
      ...progress,
      last_sync: lastSync
    },
    config: {
      model: config.embedding.model,
      endpoint: config.embedding.api_base,
      dimensions: config.embedding.dimensions,
      provider: provider.name,
      provider_description: provider.description,
      chunking_strategy: config.chunking.strategy,
      max_tokens_per_chunk: config.chunking.max_tokens
    },
    files: fileStats.slice(0, MAX_FILES).map(f => ({
      path: f.filePath,
      chunks: f.chunkCount,
      last_updated: f.lastUpdated
    })),
    files_truncated: truncated,
    files_total_count: fileStats.length
  };

  console.log(JSON.stringify(output, null, 2));
} finally {
  db?.close();
}
