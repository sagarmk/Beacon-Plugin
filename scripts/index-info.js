#!/usr/bin/env node
// Called by: /index command
// Output: Colored dashboard (--pretty) or JSON for programmatic use

import { openDatabase } from './lib/open-db.js';
import { loadConfig } from './lib/config.js';
import { getRepoFiles } from './lib/git.js';
import { shouldIndex } from './lib/ignore.js';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const PRETTY = process.argv.includes('--pretty');
const SHOW_FILES = process.argv.includes('--files');

const config = loadConfig();
const dbPath = path.join(config.storage.path, 'embeddings.db');

// ─── ANSI helpers ────────────────────────────────────
const c = {
  bold:    s => `\x1b[1m${s}\x1b[22m`,
  dim:     s => `\x1b[2m${s}\x1b[22m`,
  green:   s => `\x1b[32m${s}\x1b[39m`,
  cyan:    s => `\x1b[36m${s}\x1b[39m`,
  yellow:  s => `\x1b[33m${s}\x1b[39m`,
  magenta: s => `\x1b[35m${s}\x1b[39m`,
  blue:    s => `\x1b[34m${s}\x1b[39m`,
  red:     s => `\x1b[31m${s}\x1b[39m`,
  gray:    s => `\x1b[90m${s}\x1b[39m`,
};
const PALETTE = [c.green, c.cyan, c.yellow, c.magenta, c.blue];
const GRID_COLS = 5, GRID_ROWS = 4, GRID_TOTAL = 20;
const PAD = ' '.repeat(14);

// ─── Formatting helpers ──────────────────────────────
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function parseTS(ts) {
  if (!ts) return null;
  if (!ts.endsWith('Z') && !ts.includes('+')) return new Date(ts.replace(' ', 'T') + 'Z');
  return new Date(ts);
}

function fmtRel(ts) {
  const d = parseTS(ts);
  if (!d) return 'never';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const dy = Math.floor(h / 24);
  return `about ${dy} day${dy === 1 ? '' : 's'} ago`;
}

function fmtShort(ts) {
  const d = parseTS(ts);
  if (!d) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return '~now';
  const m = Math.floor(s / 60);
  if (m < 60) return `~${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `~${h}h`;
  return `~${Math.floor(h / 24)}d`;
}

// ─── Grid helpers ────────────────────────────────────
function buildGrid(extensions, eligible) {
  const cells = [];
  if (eligible > 0) {
    for (let i = 0; i < extensions.length; i++) {
      const n = Math.round((extensions[i].count / eligible) * GRID_TOTAL);
      for (let j = 0; j < n; j++) cells.push(PALETTE[i % PALETTE.length]('●'));
    }
  }
  while (cells.length < GRID_TOTAL) cells.push(c.gray('○'));
  return cells.slice(0, GRID_TOTAL);
}

function solidGrid(ch, colorFn) { return Array(GRID_TOTAL).fill(colorFn(ch)); }

function row(cells, r, text) {
  const s = r * GRID_COLS;
  const disc = cells.slice(s, s + GRID_COLS).join(' ');
  return text ? `${disc}    ${text}` : disc;
}

// ─── Pretty renderers ───────────────────────────────
function prettyNoIndex(cfg) {
  const g = solidGrid('○', c.gray);
  console.log([
    c.bold('Beacon Index'), '',
    row(g, 0, `${cfg.model} · ${cfg.provider_description}`),
    row(g, 1, `${cfg.dimensions} dims`),
    row(g, 2, ''),
    row(g, 3, 'No index found'),
    '',
    `${PAD}Will be created on next session start.`,
    `${PAD}Storage: ${cfg.storage_path}`,
  ].join('\n'));
}

function prettyDbError(msg, cfg) {
  const g = solidGrid('⊠', c.red);
  console.log([
    c.bold('Beacon Index'), '',
    row(g, 0, `${cfg.model} · ${cfg.provider_description}`),
    row(g, 1, `${cfg.dimensions} dims`),
    row(g, 2, ''),
    row(g, 3, c.red('⚠ Database Error')),
    '',
    `${PAD}${msg}`,
    `${PAD}Try /reindex to force a fresh sync`,
  ].join('\n'));
}

function prettyDashboard(data) {
  const { index, sync, config: cfg, files } = data;
  const eligible = index.eligible_files || index.files_indexed;
  const L = [];

  L.push(c.bold('Beacon Index'), '');

  // Build grid based on sync state
  let grid, row3;
  if (sync.status === 'error') {
    grid = solidGrid('⊠', c.red);
    row3 = c.red(`⚠ ${sync.error}`);
  } else if (sync.status === 'stale') {
    grid = solidGrid('⊠', c.yellow);
    row3 = c.yellow('⚠ Sync Stalled');
  } else if (sync.status === 'in_progress') {
    grid = buildGrid(index.extensions, eligible);
    row3 = c.yellow(`Syncing: ${sync.percent}% (${sync.completed}/${sync.total})`);
  } else {
    grid = buildGrid(index.extensions, eligible);
    const cov = index.coverage_percent;
    row3 = `Coverage: ${cov ?? '?'}% (${index.files_indexed}/${eligible} files)`;
  }

  L.push(row(grid, 0, `${cfg.model} · ${cfg.provider_description}`));
  L.push(row(grid, 1, `${cfg.dimensions} dims · ${fmtSize(index.db_size_bytes)}`));
  L.push(row(grid, 2, ''));
  L.push(row(grid, 3, row3));

  // Sync-specific detail lines
  if (sync.status === 'in_progress') {
    L.push('');
    if (sync.current_file) L.push(`${PAD}Currently: ${sync.current_file}`);
    const filled = Math.round((sync.percent || 0) / 5);
    L.push(`${PAD}${'█'.repeat(filled)}${'░'.repeat(20 - filled)} ${sync.percent}%`);
  } else if (sync.status === 'error') {
    L.push('');
    L.push(`${PAD}Last successful sync: ${fmtRel(sync.last_sync)}`);
    L.push(`${PAD}Try /reindex to force a fresh sync`);
  } else if (sync.status === 'stale') {
    L.push('');
    L.push(`${PAD}Sync appears to have stalled (started over 5m ago)`);
    L.push(`${PAD}Try /reindex to force a fresh sync`);
  }

  if (index.coverage_percent != null && index.coverage_percent < 50) {
    L.push(`${PAD}${c.yellow('⚠ Low coverage — consider running /reindex')}`);
  }

  // Extensions
  L.push('');
  L.push(`${PAD}${c.dim('Indexed by extension')}`);
  const mxExt = index.extensions.length ? Math.max(...index.extensions.map(e => e.ext.length)) : 0;
  index.extensions.forEach((ext, i) => {
    const fn = PALETTE[i % PALETTE.length];
    const cnt = `${ext.count} ${ext.count === 1 ? 'file' : 'files'}`;
    L.push(`${PAD}${fn('●')} ${ext.ext.padEnd(mxExt + 2)}${cnt}`);
  });

  // Statistics
  L.push('');
  L.push(`${PAD}${c.dim('Statistics')}`);
  L.push(`${PAD}Indexed files    ${index.files_indexed}`);
  L.push(`${PAD}Total chunks     ${index.total_chunks}`);
  L.push(`${PAD}Avg chunks/file  ${index.avg_chunks_per_file}`);
  L.push(`${PAD}Last sync        ${fmtRel(sync.last_sync)}`);

  // Files — only shown with --files flag
  if (SHOW_FILES && files.length > 0) {
    L.push('');
    const max = 20;
    const show = files.slice(0, max);
    const rest = data.files_total_count - show.length;
    const hdr = rest > 0 ? `Files (${max} of ${data.files_total_count})` : 'Files';
    L.push(`${PAD}${c.dim(hdr)}`);
    const mxP = Math.max(...show.map(f => f.path.length));
    const mxC = Math.max(...show.map(f => `${f.chunks}`.length));
    for (const f of show) {
      const p = f.path.padEnd(mxP + 1);
      const n = `${f.chunks}`.padStart(mxC);
      const w = f.chunks === 1 ? 'chunk ' : 'chunks';
      const t = fmtShort(f.last_updated);
      L.push(`${PAD}${c.dim(p)} ${n} ${w}  ${c.dim(t)}`);
    }
    if (rest > 0) L.push(`${PAD}${c.dim(`...and ${rest} more`)}`);
  } else if (files.length > 0) {
    L.push('');
    L.push(`${PAD}${c.dim(`${data.files_total_count} files indexed — run with --files to list`)}`);
  }

  console.log(L.join('\n'));
}

// ─── Provider detection ──────────────────────────────
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

// ─── No-DB case ──────────────────────────────────────
if (!existsSync(dbPath)) {
  const provider = detectProvider();
  const cfg = {
    model: config.embedding.model,
    endpoint: config.embedding.api_base,
    dimensions: config.embedding.dimensions,
    provider: provider.name,
    provider_description: provider.description,
    storage_path: config.storage.path
  };
  if (PRETTY) {
    prettyNoIndex(cfg);
  } else {
    console.log(JSON.stringify({ status: 'no_index', message: 'No index found. It will be created on next session start.', config: cfg }, null, 2));
  }
  process.exit(0);
}

// ─── DB init ─────────────────────────────────────────
let db;
try {
  db = openDatabase(dbPath, config.embedding.dimensions);
} catch (err) {
  const provider = detectProvider();
  const cfg = {
    model: config.embedding.model,
    endpoint: config.embedding.api_base,
    dimensions: config.embedding.dimensions,
    provider: provider.name,
    provider_description: provider.description,
    storage_path: config.storage.path
  };
  if (PRETTY) {
    prettyDbError(`Failed to open database: ${err.message}. Try /reindex.`, cfg);
  } else {
    console.log(JSON.stringify({ status: 'error', message: `Failed to open database: ${err.message}. Try /reindex.`, config: cfg }, null, 2));
  }
  process.exit(0);
}

// ─── Main ────────────────────────────────────────────
try {
  const stats = db.getStats();
  const fileStats = db.getFileStats();
  const syncProgress = db.getSyncProgress();
  const lastSync = db.getSyncState('last_sync_time');
  const dbSizeBytes = db.getDbSizeBytes();
  const provider = detectProvider();

  let eligibleFiles = [];
  try {
    eligibleFiles = getRepoFiles().filter(f => shouldIndex(f, config));
  } catch { /* git may not be available */ }

  const extCounts = {};
  for (const f of fileStats) {
    const ext = path.extname(f.filePath) || '(none)';
    extCounts[ext] = (extCounts[ext] || 0) + 1;
  }
  const extensions = Object.entries(extCounts)
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count);

  const avgChunksPerFile = stats.fileCount > 0
    ? Math.round((stats.chunkCount / stats.fileCount) * 10) / 10
    : 0;

  const syncStatus = syncProgress.sync_status || 'idle';
  let effectiveStatus = syncStatus;
  if (syncStatus === 'in_progress' && syncProgress.sync_started_at) {
    const elapsed = Date.now() - new Date(syncProgress.sync_started_at).getTime();
    if (elapsed > 5 * 60 * 1000) effectiveStatus = 'stale';
  }

  let progress;
  if (effectiveStatus === 'in_progress') {
    const total = parseInt(syncProgress.sync_total_files || '0', 10);
    const completed = parseInt(syncProgress.sync_completed_files || '0', 10);
    progress = {
      status: 'in_progress', total, completed,
      current_file: syncProgress.sync_current_file || null,
      started_at: syncProgress.sync_started_at || null,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0
    };
  } else if (effectiveStatus === 'error') {
    progress = { status: 'error', error: syncProgress.sync_error || 'Unknown error' };
  } else if (effectiveStatus === 'stale') {
    progress = { status: 'stale', message: 'Sync appears to have stalled (started over 5 minutes ago)', started_at: syncProgress.sync_started_at };
  } else {
    progress = { status: 'idle' };
  }

  const MAX_FILES = 200;
  const truncated = fileStats.length > MAX_FILES;

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
    sync: { ...progress, last_sync: lastSync },
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

  if (PRETTY) {
    prettyDashboard(output);
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
} finally {
  db?.close();
}
