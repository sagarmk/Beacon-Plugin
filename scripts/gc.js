#!/usr/bin/env node
// Called by: PostToolUse hook on Bash (after git checkout, rm, mv, etc.)
// Purpose: detect deleted files and remove their embeddings

import { BeaconDatabase } from './lib/db.js';
import { loadConfig } from './lib/config.js';
import { existsSync } from 'fs';
import path from 'path';

const config = loadConfig();
const dbPath = path.join(config.storage.path, 'embeddings.db');
if (!existsSync(dbPath)) process.exit(0);

// Safe DB init
let db;
try {
  db = new BeaconDatabase(dbPath, config.embedding.dimensions);
} catch (err) {
  console.error(`Beacon: gc failed to open database: ${err.message}`);
  process.exit(0);
}

try {
  const indexedFiles = db.getIndexedFiles();
  let removed = 0;

  for (const filePath of indexedFiles) {
    if (!existsSync(filePath)) {
      db.deleteFileChunks(filePath);
      removed++;
    }
  }

  if (removed > 0) {
    console.log(`Beacon: garbage collected ${removed} deleted files from index`);
  }
} finally {
  db?.close();
}
