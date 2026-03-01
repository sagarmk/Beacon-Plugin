import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import {
  extractIdentifiers,
  prepareFTSQuery,
  normalizeBM25,
  rrfScore,
  getFileTypeMultiplier,
  getIdentifierBoost,
} from './tokenizer.js';

function float32Buffer(arr) {
  return Buffer.from(new Float32Array(arr).buffer);
}

// sqlite-vec requires BigInt for primary key values
function toBigInt(val) {
  return typeof val === 'bigint' ? val : BigInt(val);
}

const SCHEMA_VERSION = 2;

export class BeaconDatabase {
  constructor(dbPath, dimensions) {
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);
    this.dimensions = dimensions;
    this.init();
  }

  init() {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        embedding BLOB NOT NULL,
        file_hash TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(file_path, chunk_index)
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
    `);

    // Create vector table with cosine distance metric
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding float[${this.dimensions}] distance_metric=cosine
      );
    `);

    // Migrate to schema v2: add identifiers column + FTS5 table
    this._migrateToV2();
  }

  _migrateToV2() {
    const currentVersion = parseInt(this.getSyncState('schema_version') || '1', 10);
    if (currentVersion >= SCHEMA_VERSION) return;

    // Add identifiers column if missing
    const cols = this.db.pragma('table_info(chunks)');
    const hasIdentifiers = cols.some(c => c.name === 'identifiers');
    if (!hasIdentifiers) {
      this.db.exec('ALTER TABLE chunks ADD COLUMN identifiers TEXT DEFAULT ""');
    }

    // Create FTS5 virtual table (content-synced with chunks table)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        file_path,
        chunk_text,
        identifiers,
        content='chunks',
        content_rowid='id',
        tokenize='porter unicode61'
      );
    `);

    // Backfill identifiers and populate FTS from existing chunks
    const allChunks = this.db.prepare('SELECT id, file_path, chunk_text FROM chunks').all();
    if (allChunks.length > 0) {
      const updateIds = this.db.prepare('UPDATE chunks SET identifiers = ? WHERE id = ?');
      const insertFts = this.db.prepare(
        'INSERT INTO chunks_fts(rowid, file_path, chunk_text, identifiers) VALUES (?, ?, ?, ?)'
      );

      const backfill = this.db.transaction(() => {
        for (const row of allChunks) {
          const ids = extractIdentifiers(row.chunk_text);
          updateIds.run(ids, row.id);
          insertFts.run(row.id, row.file_path, row.chunk_text, ids);
        }
      });
      backfill();
    }

    this.setSyncState('schema_version', String(SCHEMA_VERSION));
  }

  upsertChunk(filePath, chunkIndex, chunkText, startLine, endLine, embedding, fileHash, identifiers) {
    // If identifiers not provided, compute them
    if (identifiers === undefined || identifiers === null) {
      identifiers = extractIdentifiers(chunkText);
    }
    this._upsertTransaction(filePath, chunkIndex, chunkText, startLine, endLine, embedding, fileHash, identifiers);
  }

  _upsertTransaction = (() => {
    let tx = null;
    return (filePath, chunkIndex, chunkText, startLine, endLine, embedding, fileHash, identifiers) => {
      if (!tx) {
        tx = this.db.transaction((fp, ci, ct, sl, el, emb, fh, ids) => {
          const existing = this.db.prepare(
            'SELECT id FROM chunks WHERE file_path = ? AND chunk_index = ?'
          ).get(fp, ci);

          const embBuffer = float32Buffer(emb);

          if (existing) {
            // Delete old FTS row before update
            this.db.prepare(
              'INSERT INTO chunks_fts(chunks_fts, rowid, file_path, chunk_text, identifiers) VALUES(\'delete\', ?, ?, (SELECT chunk_text FROM chunks WHERE id = ?), (SELECT identifiers FROM chunks WHERE id = ?))'
            ).run(existing.id, fp, existing.id, existing.id);

            this.db.prepare(`
              UPDATE chunks SET chunk_text = ?, start_line = ?, end_line = ?,
              embedding = ?, file_hash = ?, identifiers = ?, updated_at = datetime('now')
              WHERE file_path = ? AND chunk_index = ?
            `).run(ct, sl, el, embBuffer, fh, ids, fp, ci);

            // Insert updated FTS row
            this.db.prepare(
              'INSERT INTO chunks_fts(rowid, file_path, chunk_text, identifiers) VALUES(?, ?, ?, ?)'
            ).run(existing.id, fp, ct, ids);

            this.db.prepare('DELETE FROM chunks_vec WHERE chunk_id = ?').run(toBigInt(existing.id));
            this.db.prepare('INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)').run(toBigInt(existing.id), embBuffer);
          } else {
            const result = this.db.prepare(`
              INSERT INTO chunks (file_path, chunk_index, chunk_text, start_line, end_line, embedding, file_hash, identifiers)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(fp, ci, ct, sl, el, embBuffer, fh, ids);

            // Insert FTS row
            this.db.prepare(
              'INSERT INTO chunks_fts(rowid, file_path, chunk_text, identifiers) VALUES(?, ?, ?, ?)'
            ).run(result.lastInsertRowid, fp, ct, ids);

            this.db.prepare('INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)').run(toBigInt(result.lastInsertRowid), embBuffer);
          }
        });
      }
      tx(filePath, chunkIndex, chunkText, startLine, endLine, embedding, fileHash, identifiers);
    };
  })();

  deleteFileChunks(filePath) {
    const deleteTransaction = this.db.transaction((fp) => {
      const rows = this.db.prepare('SELECT id, chunk_text, identifiers FROM chunks WHERE file_path = ?').all(fp);
      for (const row of rows) {
        // Delete FTS row
        this.db.prepare(
          'INSERT INTO chunks_fts(chunks_fts, rowid, file_path, chunk_text, identifiers) VALUES(\'delete\', ?, ?, ?, ?)'
        ).run(row.id, fp, row.chunk_text, row.identifiers || '');
        // Delete vector row
        this.db.prepare('DELETE FROM chunks_vec WHERE chunk_id = ?').run(toBigInt(row.id));
      }
      this.db.prepare('DELETE FROM chunks WHERE file_path = ?').run(fp);
    });
    deleteTransaction(filePath);
  }

  deleteOrphanChunks(filePath, maxChunkIndex) {
    const orphanTransaction = this.db.transaction((fp, maxIdx) => {
      const orphans = this.db.prepare(
        'SELECT id, chunk_text, identifiers FROM chunks WHERE file_path = ? AND chunk_index > ?'
      ).all(fp, maxIdx);
      for (const row of orphans) {
        // Delete FTS row
        this.db.prepare(
          'INSERT INTO chunks_fts(chunks_fts, rowid, file_path, chunk_text, identifiers) VALUES(\'delete\', ?, ?, ?, ?)'
        ).run(row.id, fp, row.chunk_text, row.identifiers || '');
        // Delete vector row
        this.db.prepare('DELETE FROM chunks_vec WHERE chunk_id = ?').run(toBigInt(row.id));
      }
      this.db.prepare('DELETE FROM chunks WHERE file_path = ? AND chunk_index > ?').run(fp, maxIdx);
    });
    orphanTransaction(filePath, maxChunkIndex);
  }

  search(queryEmbedding, topK, threshold, queryText, config, pathPrefix) {
    const hybrid = config?.search?.hybrid;

    // Fallback to pure vector search when hybrid is disabled or no config
    if (!hybrid?.enabled || !queryText) {
      return this._vectorSearch(queryEmbedding, topK, threshold, pathPrefix);
    }

    const wVec = hybrid.weight_vector ?? 0.4;
    const wBM25 = hybrid.weight_bm25 ?? 0.3;
    const wRRF = hybrid.weight_rrf ?? 0.3;
    const debug = hybrid.debug ?? false;

    // Stage 1: Parallel retrieval
    // Vector search — fetch extra candidates for re-ranking headroom
    const vecResults = this._vectorSearchRaw(queryEmbedding, topK * 2, pathPrefix);

    // FTS search (tiered: AND-first for 3+ token queries, OR fallback)
    const ftsQuery = prepareFTSQuery(queryText);
    let ftsResults = [];
    if (ftsQuery) {
      if (typeof ftsQuery === 'object' && ftsQuery.andQuery) {
        ftsResults = this._ftsSearch(ftsQuery.andQuery, topK * 2, pathPrefix);
        if (ftsResults.length === 0) {
          ftsResults = this._ftsSearch(ftsQuery.orQuery, topK * 2, pathPrefix);
        }
      } else {
        ftsResults = this._ftsSearch(ftsQuery, topK * 2, pathPrefix);
      }
    }

    // Stage 2: Score fusion — merge candidates into a map by chunk_id
    const candidates = new Map();

    vecResults.forEach((r, rank) => {
      candidates.set(r.id, {
        ...r,
        vecRank: rank + 1,
        vecSimilarity: r.similarity,
        ftsRank: null,
        bm25Score: null,
      });
    });

    ftsResults.forEach((r, rank) => {
      if (candidates.has(r.id)) {
        const existing = candidates.get(r.id);
        existing.ftsRank = rank + 1;
        existing.bm25Score = r.bm25Score;
      } else {
        candidates.set(r.id, {
          ...r,
          vecRank: null,
          vecSimilarity: null,
          ftsRank: rank + 1,
          bm25Score: r.bm25Score,
        });
      }
    });

    // Normalize BM25 scores
    const bm25Scores = [];
    const bm25Ids = [];
    for (const [id, c] of candidates) {
      if (c.bm25Score !== null) {
        bm25Scores.push(c.bm25Score);
        bm25Ids.push(id);
      }
    }
    const normalizedBM25 = normalizeBM25(bm25Scores);
    bm25Ids.forEach((id, i) => {
      candidates.get(id).bm25Normalized = normalizedBM25[i];
    });

    // Compute fused scores
    const scored = [];
    for (const [, c] of candidates) {
      const vecComponent = c.vecSimilarity !== null ? wVec * c.vecSimilarity : 0;
      const bm25Component = c.bm25Normalized !== undefined ? wBM25 * c.bm25Normalized : 0;
      const rrfComponent = wRRF * rrfScore(c.vecRank, c.ftsRank);

      let fusedScore = vecComponent + bm25Component + rrfComponent;

      // Stage 3: Re-rank with file type multiplier and identifier boost
      const fileMultiplier = getFileTypeMultiplier(c.filePath);
      const idBoost = getIdentifierBoost(queryText, c.chunkText);
      fusedScore *= fileMultiplier * idBoost;

      scored.push({
        filePath: c.filePath,
        chunkText: c.chunkText,
        startLine: c.startLine,
        endLine: c.endLine,
        similarity: c.vecSimilarity ?? 0,
        score: fusedScore,
        ...(debug ? {
          _debug: {
            vecRank: c.vecRank, ftsRank: c.ftsRank,
            vecSimilarity: c.vecSimilarity, bm25Normalized: c.bm25Normalized,
            fileMultiplier, idBoost, vecComponent, bm25Component, rrfComponent,
          }
        } : {}),
      });
    }

    // File-frequency reranking: files with more matching chunks get a cumulative boost
    const fileHits = new Map();
    for (const s of scored) {
      fileHits.set(s.filePath, (fileHits.get(s.filePath) || 0) + 1);
    }
    for (const s of scored) {
      const hitCount = fileHits.get(s.filePath);
      if (hitCount > 1) {
        const freqBoost = Math.min(1 + 0.1 * (hitCount - 1), 1.5);
        s.score *= freqBoost;
        if (s._debug) s._debug.fileFreqBoost = freqBoost;
      }
    }

    // Sort by fused score descending, filter by threshold on similarity (if available), take top K
    return scored
      .sort((a, b) => b.score - a.score)
      .filter(r => r.similarity >= threshold || (r.similarity === 0 && r.score > 0))
      .slice(0, topK);
  }

  // Pure vector search (backward-compatible return format)
  _vectorSearch(queryEmbedding, topK, threshold, pathPrefix) {
    const fetchLimit = pathPrefix ? topK * 4 : topK;
    const results = this.db.prepare(`
      SELECT
        chunks_vec.chunk_id,
        chunks_vec.distance,
        chunks.file_path,
        chunks.chunk_text,
        chunks.start_line,
        chunks.end_line
      FROM chunks_vec
      LEFT JOIN chunks ON chunks.id = chunks_vec.chunk_id
      WHERE chunks_vec.embedding MATCH ?
        AND k = ?
      ORDER BY chunks_vec.distance ASC
    `).all(float32Buffer(queryEmbedding), fetchLimit);

    let mapped = results
      .map(r => ({
        filePath: r.file_path,
        chunkText: r.chunk_text,
        startLine: r.start_line,
        endLine: r.end_line,
        similarity: 1 - r.distance
      }))
      .filter(r => r.similarity >= threshold);

    if (pathPrefix) {
      mapped = mapped.filter(r => r.filePath.startsWith(pathPrefix));
    }

    return mapped.slice(0, topK);
  }

  // Vector search returning raw data for fusion
  _vectorSearchRaw(queryEmbedding, limit, pathPrefix) {
    // sqlite-vec doesn't support WHERE clauses beyond MATCH/k, so we filter post-query
    // Fetch extra results when path-filtering to ensure enough candidates
    const fetchLimit = pathPrefix ? limit * 4 : limit;
    const results = this.db.prepare(`
      SELECT
        chunks_vec.chunk_id,
        chunks_vec.distance,
        chunks.id,
        chunks.file_path,
        chunks.chunk_text,
        chunks.start_line,
        chunks.end_line
      FROM chunks_vec
      LEFT JOIN chunks ON chunks.id = chunks_vec.chunk_id
      WHERE chunks_vec.embedding MATCH ?
        AND k = ?
      ORDER BY chunks_vec.distance ASC
    `).all(float32Buffer(queryEmbedding), fetchLimit);

    let mapped = results.map(r => ({
      id: r.id,
      filePath: r.file_path,
      chunkText: r.chunk_text,
      startLine: r.start_line,
      endLine: r.end_line,
      similarity: 1 - r.distance,
    }));

    if (pathPrefix) {
      mapped = mapped.filter(r => r.filePath.startsWith(pathPrefix));
    }

    return mapped.slice(0, limit);
  }

  // FTS5 search with BM25 scoring (column weights: chunk_text=10, identifiers=5, file_path=1)
  _ftsSearch(ftsQuery, limit, pathPrefix) {
    try {
      let results;
      if (pathPrefix) {
        results = this.db.prepare(`
          SELECT
            chunks.id,
            chunks.file_path,
            chunks.chunk_text,
            chunks.start_line,
            chunks.end_line,
            chunks_fts.rank AS bm25_rank
          FROM chunks_fts
          JOIN chunks ON chunks.id = chunks_fts.rowid
          WHERE chunks_fts MATCH ?
            AND chunks.file_path LIKE ?
          ORDER BY chunks_fts.rank
          LIMIT ?
        `).all(ftsQuery, pathPrefix + '%', limit);
      } else {
        results = this.db.prepare(`
          SELECT
            chunks.id,
            chunks.file_path,
            chunks.chunk_text,
            chunks.start_line,
            chunks.end_line,
            chunks_fts.rank AS bm25_rank
          FROM chunks_fts
          JOIN chunks ON chunks.id = chunks_fts.rowid
          WHERE chunks_fts MATCH ?
          ORDER BY chunks_fts.rank
          LIMIT ?
        `).all(ftsQuery, limit);
      }

      return results.map(r => ({
        id: r.id,
        filePath: r.file_path,
        chunkText: r.chunk_text,
        startLine: r.start_line,
        endLine: r.end_line,
        bm25Score: r.bm25_rank,
      }));
    } catch (err) {
      console.error(`Beacon: FTS query failed (${ftsQuery}): ${err.message}`);
      return [];
    }
  }

  getIndexedFiles() {
    return this.db.prepare('SELECT DISTINCT file_path FROM chunks').all().map(r => r.file_path);
  }

  getFileHash(filePath) {
    const row = this.db.prepare('SELECT file_hash FROM chunks WHERE file_path = ? LIMIT 1').get(filePath);
    return row?.file_hash || null;
  }

  getSyncState(key) {
    const row = this.db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
    return row?.value || null;
  }

  setSyncState(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)').run(key, String(value));
  }

  getStats() {
    const fileCount = this.db.prepare('SELECT COUNT(DISTINCT file_path) as n FROM chunks').get().n;
    const chunkCount = this.db.prepare('SELECT COUNT(*) as n FROM chunks').get().n;
    return { fileCount, chunkCount };
  }

  getFileStats() {
    return this.db.prepare(`
      SELECT
        file_path,
        COUNT(*) as chunk_count,
        MAX(updated_at) as last_updated
      FROM chunks
      GROUP BY file_path
      ORDER BY last_updated DESC
    `).all().map(r => ({
      filePath: r.file_path,
      chunkCount: r.chunk_count,
      lastUpdated: r.last_updated
    }));
  }

  getDbSizeBytes() {
    const row = this.db.prepare(
      'SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()'
    ).get();
    return row?.size || 0;
  }

  getSyncProgress() {
    const rows = this.db.prepare(
      "SELECT key, value FROM sync_state WHERE key LIKE 'sync_%'"
    ).all();
    const result = {};
    for (const { key, value } of rows) {
      result[key] = value;
    }
    return result;
  }

  clearSyncProgress() {
    this.db.prepare(
      "DELETE FROM sync_state WHERE key IN ('sync_status', 'sync_total_files', 'sync_completed_files', 'sync_current_file', 'sync_started_at', 'sync_error')"
    ).run();
  }

  // Health check — opens DB read-only style, returns status object
  static healthCheck(dbPath, dimensions) {
    try {
      const db = new Database(dbPath, { readonly: true });
      sqliteVec.load(db);

      // Check chunks table exists
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'"
      ).get();
      if (!tableExists) {
        db.close();
        return { ok: false, fileCount: 0, chunkCount: 0, syncStatus: null, dimensionMismatch: false };
      }

      const fileCount = db.prepare('SELECT COUNT(DISTINCT file_path) as n FROM chunks').get().n;
      const chunkCount = db.prepare('SELECT COUNT(*) as n FROM chunks').get().n;

      const syncStatusRow = db.prepare("SELECT value FROM sync_state WHERE key = 'sync_status'").get();
      const syncStatus = syncStatusRow?.value || 'idle';

      // Check dimension mismatch
      const dimRow = db.prepare("SELECT value FROM sync_state WHERE key = 'embedding_dimensions'").get();
      const storedDimensions = dimRow ? parseInt(dimRow.value, 10) : null;
      const dimensionMismatch = storedDimensions !== null && storedDimensions !== dimensions;

      db.close();

      const ok = fileCount > 0 && syncStatus !== 'error' && !dimensionMismatch;
      return { ok, fileCount, chunkCount, syncStatus, dimensionMismatch };
    } catch {
      return { ok: false, fileCount: 0, chunkCount: 0, syncStatus: null, dimensionMismatch: false };
    }
  }

  // FTS-only search — no embeddings needed
  ftsOnlySearch(queryText, topK, pathPrefix) {
    const ftsQuery = prepareFTSQuery(queryText);
    if (!ftsQuery) return [];

    let ftsResults;
    if (typeof ftsQuery === 'object' && ftsQuery.andQuery) {
      ftsResults = this._ftsSearch(ftsQuery.andQuery, topK * 2, pathPrefix);
      if (ftsResults.length === 0) {
        ftsResults = this._ftsSearch(ftsQuery.orQuery, topK * 2, pathPrefix);
      }
    } else {
      ftsResults = this._ftsSearch(ftsQuery, topK * 2, pathPrefix);
    }
    if (ftsResults.length === 0) return [];

    // Normalize BM25 scores
    const bm25Scores = ftsResults.map(r => r.bm25Score);
    const normalized = normalizeBM25(bm25Scores);

    // Score with file-type multiplier and identifier boost
    const scored = ftsResults.map((r, i) => {
      let score = normalized[i];
      score *= getFileTypeMultiplier(r.filePath);
      score *= getIdentifierBoost(queryText, r.chunkText);
      return {
        filePath: r.filePath,
        chunkText: r.chunkText,
        startLine: r.startLine,
        endLine: r.endLine,
        similarity: 0,
        score,
        _note: 'FTS-only result (embedding server unavailable)',
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // Check if stored dimensions match current config
  checkDimensions() {
    const stored = this.getSyncState('embedding_dimensions');
    if (stored === null) return { ok: true, stored: null, current: this.dimensions };
    const storedNum = parseInt(stored, 10);
    return { ok: storedNum === this.dimensions, stored: storedNum, current: this.dimensions };
  }

  // Store current dimensions in sync_state
  storeDimensions() {
    this.setSyncState('embedding_dimensions', String(this.dimensions));
  }

  close() {
    this.db.close();
  }
}
