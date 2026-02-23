#!/usr/bin/env node
// Called by: /terminate-indexer command
// Purpose: kill a running sync process and clean up state

import { BeaconDatabase } from './lib/db.js';
import { loadConfig } from './lib/config.js';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import path from 'path';

const config = loadConfig();
const dbDir = path.resolve(config.storage.path);
const pidFile = path.join(dbDir, 'sync.pid');
const dbPath = path.join(dbDir, 'embeddings.db');

// Read PID file
if (!existsSync(pidFile)) {
  console.log(JSON.stringify({ status: 'no_process', message: 'No sync process is currently running (no PID file found).' }, null, 2));
  process.exit(0);
}

const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
if (isNaN(pid)) {
  console.log(JSON.stringify({ status: 'error', message: 'Invalid PID file contents.' }, null, 2));
  try { unlinkSync(pidFile); } catch { /* ignore */ }
  process.exit(0);
}

// Try to kill the process
let killed = false;
try {
  process.kill(pid, 'SIGTERM');
  killed = true;
} catch (err) {
  if (err.code === 'ESRCH') {
    // Process doesn't exist — stale PID file
    killed = false;
  } else {
    console.log(JSON.stringify({ status: 'error', message: `Failed to kill process ${pid}: ${err.message}` }, null, 2));
    process.exit(1);
  }
}

// Clean up PID file
try { unlinkSync(pidFile); } catch { /* ignore */ }

// Clean up DB sync state
if (existsSync(dbPath)) {
  let db;
  try {
    db = new BeaconDatabase(dbPath, config.embedding.dimensions);
    db.clearSyncProgress();
    db.setSyncState('sync_status', 'idle');
  } catch (err) {
    console.error(`Beacon: warning — failed to clean up DB state: ${err.message}`);
  } finally {
    db?.close();
  }
}

if (killed) {
  console.log(JSON.stringify({ status: 'terminated', pid, message: `Sync process ${pid} terminated and state cleaned up.` }, null, 2));
} else {
  console.log(JSON.stringify({ status: 'cleaned', pid, message: `Sync process ${pid} was not running (stale PID). Cleaned up state.` }, null, 2));
}
