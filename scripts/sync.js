#!/usr/bin/env node
// Called by: SessionStart hook (async)
// Purpose: full index on first run, diff-based catch-up on subsequent runs

import { BeaconDatabase } from './lib/db.js';
import { Embedder } from './lib/embedder.js';
import { chunkCode } from './lib/chunker.js';
import { loadConfig } from './lib/config.js';
import { getRepoFiles, getFileHash, getModifiedFilesSince } from './lib/git.js';
import { shouldIndex } from './lib/ignore.js';
import { extractIdentifiers } from './lib/tokenizer.js';
import { isCwdBlacklisted } from './lib/safety.js';
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';

// Safety: refuse to index blacklisted paths
if (isCwdBlacklisted()) {
  console.error('Beacon: refusing to index — current directory is blacklisted. Run /blacklist to manage.');
  process.exit(0);
}

const config = loadConfig();

// Auto-index check (skip if called with --force from /run-indexer)
if (!process.argv.includes('--force') && config.indexing.auto_index === false) {
  console.log('Beacon: auto-index is off. Use /run-indexer to index manually.');
  process.exit(0);
}

const dbDir = path.resolve(config.storage.path);
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

// PID file for /terminate-indexer
const pidFile = path.join(dbDir, 'sync.pid');

function writePidFile() {
  writeFileSync(pidFile, String(process.pid));
}

function deletePidFile() {
  try { unlinkSync(pidFile); } catch { /* already gone */ }
}

// Write PID file on start, delete on exit/signal
writePidFile();
process.on('SIGTERM', () => { deletePidFile(); process.exit(0); });
process.on('SIGINT', () => { deletePidFile(); process.exit(0); });
process.on('exit', () => { deletePidFile(); });

// Safe DB init
let db;
try {
  db = new BeaconDatabase(path.join(dbDir, 'embeddings.db'), config.embedding.dimensions);
} catch (err) {
  console.error(`Beacon: failed to open database: ${err.message}`);
  console.error('Beacon: try deleting .claude/.beacon/embeddings.db and restarting, or run /reindex.');
  deletePidFile();
  process.exit(0);
}

// Stale state auto-recovery: if sync was in_progress and started >5 min ago, clear it
const staleProgress = db.getSyncProgress();
if (staleProgress.sync_status === 'in_progress' && staleProgress.sync_started_at) {
  const elapsed = Date.now() - new Date(staleProgress.sync_started_at).getTime();
  if (elapsed > 5 * 60 * 1000) {
    console.log('Beacon: clearing stale sync state (previous sync timed out or was killed).');
    db.clearSyncProgress();
    db.setSyncState('sync_status', 'idle');
  }
}

// Dimension mismatch detection
const dimCheck = db.checkDimensions();
if (!dimCheck.ok) {
  console.error(`Beacon: dimension mismatch — DB has ${dimCheck.stored}d embeddings but config specifies ${dimCheck.current}d.`);
  console.error('Beacon: run /reindex to rebuild with the new dimensions.');
  db.setSyncState('sync_status', 'error');
  db.setSyncState('sync_error', `Dimension mismatch: stored=${dimCheck.stored}, config=${dimCheck.current}`);
  db.close();
  deletePidFile();
  process.exit(0);
}

const embedder = new Embedder(config);

// Health check — is the embedding endpoint reachable?
const health = await embedder.ping();
if (!health.ok) {
  console.error(`Beacon: embedding endpoint unreachable (${config.embedding.api_base}): ${health.error}`);
  console.error('Beacon: skipping sync. Check your .claude/beacon.json config or start your LiteLLM proxy.');
  db.setSyncState('sync_status', 'error');
  db.setSyncState('sync_error', `Embedding endpoint unreachable: ${health.error}`);
  db.close();
  deletePidFile();
  process.exit(0); // exit gracefully — don't block the session
}

try {
  // Record start time before fetching changed files — ensures files modified during sync
  // are picked up on the next incremental run (not missed by the timestamp window)
  const syncStartTime = new Date().toISOString();

  // Mark sync as in-progress
  db.setSyncState('sync_status', 'in_progress');
  db.setSyncState('sync_started_at', syncStartTime);

  const stats = db.getStats();
  const lastSyncTime = db.getSyncState('last_sync_time');

  if (stats.fileCount === 0) {
    // ── FIRST RUN: full index ──
    console.log('Beacon: first run detected — indexing entire repo...');

    const maxFiles = config.indexing.max_files || 10000;
    const allFiles = getRepoFiles(maxFiles).filter(f => shouldIndex(f, config));
    let indexed = 0;

    db.setSyncState('sync_total_files', String(allFiles.length));
    db.setSyncState('sync_completed_files', '0');

    for (const filePath of allFiles) {
      try {
        db.setSyncState('sync_current_file', filePath);
        await indexFile(filePath);
        indexed++;
        db.setSyncState('sync_completed_files', String(indexed));
        if (indexed % 50 === 0) console.log(`Beacon: indexed ${indexed}/${allFiles.length} files...`);
      } catch (err) {
        console.error(`Beacon: failed to index ${filePath}: ${err.message}`);
      }
    }

    console.log(`Beacon: initial index complete — ${indexed} files, ${db.getStats().chunkCount} chunks`);
  } else {
    // ── INCREMENTAL SYNC: only changed files ──
    const changedFiles = lastSyncTime
      ? getModifiedFilesSince(lastSyncTime).filter(f => shouldIndex(f, config))
      : [];

    if (changedFiles.length === 0) {
      console.log(`Beacon: index up to date (${stats.fileCount} files, ${stats.chunkCount} chunks)`);
    } else {
      console.log(`Beacon: syncing ${changedFiles.length} changed files...`);

      db.setSyncState('sync_total_files', String(changedFiles.length));
      db.setSyncState('sync_completed_files', '0');
      let completedCount = 0;

      for (const filePath of changedFiles) {
        db.setSyncState('sync_current_file', filePath);

        if (!existsSync(filePath)) {
          db.deleteFileChunks(filePath);
        } else {
          try {
            const currentHash = getFileHash(filePath);
            const indexedHash = db.getFileHash(filePath);
            if (currentHash !== indexedHash) {
              await indexFile(filePath);
            }
          } catch (err) {
            console.error(`Beacon: failed to sync ${filePath}: ${err.message}`);
          }
        }

        completedCount++;
        db.setSyncState('sync_completed_files', String(completedCount));
      }

      console.log(`Beacon: sync complete — ${changedFiles.length} files updated`);
    }
  }

  // Sync finished successfully — clear progress, then write explicit 'idle' status
  // (clearSyncProgress deletes sync_status, so we must re-set it explicitly)
  db.clearSyncProgress();
  db.setSyncState('sync_status', 'idle');
  db.setSyncState('last_sync_time', syncStartTime);
  db.storeDimensions();

} catch (err) {
  // Track error state so /index can report it
  console.error(`Beacon: sync failed: ${err.message}`);
  db.setSyncState('sync_status', 'error');
  db.setSyncState('sync_error', err.message);
} finally {
  db.close();
  deletePidFile();
}

// ── Helpers ──

async function indexFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const fileHash = getFileHash(filePath);
  const chunks = chunkCode(content, filePath, config);

  if (chunks.length === 0) return;

  // Batch embed all chunks for this file
  const texts = chunks.map(c => c.text);
  const embeddings = await embedder.embedDocuments(texts);

  // Upsert each chunk with identifiers for FTS
  for (let i = 0; i < chunks.length; i++) {
    const identifiers = extractIdentifiers(chunks[i].text);
    db.upsertChunk(
      filePath,
      chunks[i].index,
      chunks[i].text,
      chunks[i].startLine,
      chunks[i].endLine,
      embeddings[i],
      fileHash,
      identifiers
    );
  }

  // Clean up orphan chunks (file got shorter)
  db.deleteOrphanChunks(filePath, chunks.length - 1);
}
