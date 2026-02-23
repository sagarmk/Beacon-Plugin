import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BeaconDatabase } from '../scripts/lib/db.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const DIMENSIONS = 4;

function makeEmbedding(values) {
  const arr = new Array(DIMENSIONS).fill(0);
  for (let i = 0; i < Math.min(values.length, DIMENSIONS); i++) {
    arr[i] = values[i];
  }
  return arr;
}

describe('BeaconDatabase new methods', () => {
  let db;
  let tmpDir;
  let dbPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'beacon-test-'));
    dbPath = join(tmpDir, 'test.db');
    db = new BeaconDatabase(dbPath, DIMENSIONS);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('healthCheck (static)', () => {
    it('returns ok:false for empty database', () => {
      const health = BeaconDatabase.healthCheck(dbPath, DIMENSIONS);
      expect(health.ok).toBe(false);
      expect(health.fileCount).toBe(0);
      expect(health.chunkCount).toBe(0);
    });

    it('returns ok:true for populated database', () => {
      db.upsertChunk('src/auth.ts', 0, 'function signIn() {}', 1, 5,
        makeEmbedding([1, 0, 0, 0]), 'hash1', 'signIn');

      const health = BeaconDatabase.healthCheck(dbPath, DIMENSIONS);
      expect(health.ok).toBe(true);
      expect(health.fileCount).toBe(1);
      expect(health.chunkCount).toBe(1);
      expect(health.syncStatus).toBe('idle');
      expect(health.dimensionMismatch).toBe(false);
    });

    it('returns ok:false when sync_status is error', () => {
      db.upsertChunk('src/auth.ts', 0, 'function signIn() {}', 1, 5,
        makeEmbedding([1, 0, 0, 0]), 'hash1', 'signIn');
      db.setSyncState('sync_status', 'error');

      const health = BeaconDatabase.healthCheck(dbPath, DIMENSIONS);
      expect(health.ok).toBe(false);
      expect(health.syncStatus).toBe('error');
    });

    it('detects dimension mismatch', () => {
      db.upsertChunk('src/auth.ts', 0, 'function signIn() {}', 1, 5,
        makeEmbedding([1, 0, 0, 0]), 'hash1', 'signIn');
      db.storeDimensions(); // stores 4

      const health = BeaconDatabase.healthCheck(dbPath, 768); // different dimensions
      expect(health.ok).toBe(false);
      expect(health.dimensionMismatch).toBe(true);
    });

    it('returns ok:false for non-existent path', () => {
      const health = BeaconDatabase.healthCheck('/nonexistent/path/db.sqlite', DIMENSIONS);
      expect(health.ok).toBe(false);
    });
  });

  describe('ftsOnlySearch', () => {
    beforeEach(() => {
      db.upsertChunk('src/auth.ts', 0,
        'export function signInWithGoogle(provider: string) { return firebase.auth().signInWithPopup(provider); }',
        1, 5, makeEmbedding([0.9, 0.1, 0, 0]), 'hash1');

      db.upsertChunk('src/utils.ts', 0,
        'export function formatDate(date: Date) { return date.toISOString(); }',
        1, 3, makeEmbedding([0.1, 0.1, 0.9, 0]), 'hash2');
    });

    it('returns FTS-only results with _note field', () => {
      const results = db.ftsOnlySearch('signInWithGoogle', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]._note).toBe('FTS-only result (embedding server unavailable)');
      expect(results[0].similarity).toBe(0);
      expect(results[0].filePath).toBe('src/auth.ts');
    });

    it('returns empty for no matches', () => {
      const results = db.ftsOnlySearch('xyzNonexistentTerm123', 10);
      expect(results).toHaveLength(0);
    });

    it('respects topK limit', () => {
      const results = db.ftsOnlySearch('function', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('returns scored results sorted by score', () => {
      const results = db.ftsOnlySearch('function export', 10);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe('checkDimensions', () => {
    it('returns ok:true when no dimensions stored', () => {
      const result = db.checkDimensions();
      expect(result.ok).toBe(true);
      expect(result.stored).toBeNull();
      expect(result.current).toBe(DIMENSIONS);
    });

    it('returns ok:true when dimensions match', () => {
      db.storeDimensions();
      const result = db.checkDimensions();
      expect(result.ok).toBe(true);
      expect(result.stored).toBe(DIMENSIONS);
      expect(result.current).toBe(DIMENSIONS);
    });

    it('returns ok:false when dimensions differ', () => {
      db.setSyncState('embedding_dimensions', '768');
      const result = db.checkDimensions();
      expect(result.ok).toBe(false);
      expect(result.stored).toBe(768);
      expect(result.current).toBe(DIMENSIONS);
    });
  });

  describe('storeDimensions', () => {
    it('stores current dimensions in sync_state', () => {
      db.storeDimensions();
      const stored = db.getSyncState('embedding_dimensions');
      expect(stored).toBe(String(DIMENSIONS));
    });

    it('overwrites previous dimensions', () => {
      db.setSyncState('embedding_dimensions', '768');
      db.storeDimensions();
      const stored = db.getSyncState('embedding_dimensions');
      expect(stored).toBe(String(DIMENSIONS));
    });
  });
});
