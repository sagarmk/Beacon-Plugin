import { describe, it, expect } from 'vitest';
import {
  extractIdentifiers,
  prepareFTSQuery,
  normalizeBM25,
  rrfScore,
  getFileTypeMultiplier,
  getIdentifierBoost,
} from '../scripts/lib/tokenizer.js';

describe('extractIdentifiers', () => {
  it('splits camelCase identifiers', () => {
    const result = extractIdentifiers('function signInWithGoogle() {}');
    expect(result).toContain('signInWithGoogle');
    expect(result).toContain('sign');
    expect(result).toContain('Google');
  });

  it('splits snake_case identifiers', () => {
    const result = extractIdentifiers('const user_auth_token = 123');
    expect(result).toContain('user_auth_token');
    expect(result).toContain('user');
    expect(result).toContain('auth');
    expect(result).toContain('token');
  });

  it('handles PascalCase', () => {
    const result = extractIdentifiers('class MyComponent extends React.Component');
    expect(result).toContain('MyComponent');
    expect(result).toContain('My');
    expect(result).toContain('Component');
  });

  it('deduplicates identifiers', () => {
    const result = extractIdentifiers('signInWithGoogle signInWithGoogle');
    const occurrences = result.split('signInWithGoogle').length - 1;
    expect(occurrences).toBe(1); // original only once
  });

  it('returns empty string for plain text without identifiers', () => {
    const result = extractIdentifiers('the quick brown fox');
    expect(result).toBe('');
  });
});

describe('prepareFTSQuery', () => {
  it('strips stop words and quotes tokens', () => {
    const result = prepareFTSQuery('how does the authentication flow work');
    expect(result).toContain('"authentication"');
    expect(result).toContain('"flow"');
    expect(result).toContain('"work"');
    expect(result).not.toContain('"how"');
    expect(result).not.toContain('"does"');
    expect(result).not.toContain('"the"');
  });

  it('returns null for all stop words', () => {
    expect(prepareFTSQuery('how does the it is')).toBeNull();
  });

  it('expands camelCase tokens in query', () => {
    const result = prepareFTSQuery('signInWithGoogle function');
    expect(result).toContain('"signInWithGoogle"');
    expect(result).toContain('"sign"');
    expect(result).toContain('"Google"');
    expect(result).toContain('"function"');
  });

  it('handles empty input', () => {
    expect(prepareFTSQuery('')).toBeNull();
  });

  it('strips punctuation', () => {
    const result = prepareFTSQuery('file.path: auth/login.ts');
    expect(result).not.toContain('.');
    expect(result).not.toContain(':');
  });

  it('joins tokens with OR', () => {
    const result = prepareFTSQuery('auth login');
    expect(result).toBe('"auth" OR "login"');
  });
});

describe('normalizeBM25', () => {
  it('normalizes negative BM25 scores to [0, 1]', () => {
    const result = normalizeBM25([-20, -10, -1]);
    expect(result[0]).toBeCloseTo(1.0);  // most negative = best
    expect(result[2]).toBeCloseTo(0.0);  // least negative = worst
  });

  it('handles single score', () => {
    expect(normalizeBM25([-5])).toEqual([1.0]);
  });

  it('handles empty array', () => {
    expect(normalizeBM25([])).toEqual([]);
  });

  it('handles equal scores', () => {
    expect(normalizeBM25([-5, -5, -5])).toEqual([1.0, 1.0, 1.0]);
  });
});

describe('rrfScore', () => {
  it('combines vector and FTS ranks', () => {
    const score = rrfScore(1, 1, 60);
    expect(score).toBeCloseTo(2 / 61);
  });

  it('handles null vector rank', () => {
    const score = rrfScore(null, 1, 60);
    expect(score).toBeCloseTo(1 / 61);
  });

  it('handles null FTS rank', () => {
    const score = rrfScore(1, null, 60);
    expect(score).toBeCloseTo(1 / 61);
  });

  it('returns 0 for both null', () => {
    expect(rrfScore(null, null)).toBe(0);
  });
});

describe('getFileTypeMultiplier', () => {
  it('penalizes README.md', () => {
    expect(getFileTypeMultiplier('README.md')).toBe(0.5);
    expect(getFileTypeMultiplier('docs/README.md')).toBe(0.5);
  });

  it('penalizes other markdown', () => {
    expect(getFileTypeMultiplier('docs/guide.md')).toBe(0.7);
  });

  it('penalizes test files', () => {
    expect(getFileTypeMultiplier('src/auth.test.ts')).toBe(0.85);
    expect(getFileTypeMultiplier('src/auth.spec.js')).toBe(0.85);
  });

  it('penalizes config files', () => {
    expect(getFileTypeMultiplier('package.json')).toBe(0.8);
    expect(getFileTypeMultiplier('config.yaml')).toBe(0.8);
  });

  it('gives full score to source code', () => {
    expect(getFileTypeMultiplier('src/auth.ts')).toBe(1.0);
    expect(getFileTypeMultiplier('lib/db.js')).toBe(1.0);
    expect(getFileTypeMultiplier('main.py')).toBe(1.0);
  });
});

describe('getIdentifierBoost', () => {
  it('boosts for exact camelCase match', () => {
    const boost = getIdentifierBoost(
      'signInWithGoogle function',
      'export function signInWithGoogle(provider) { ... }'
    );
    expect(boost).toBe(1.5);
  });

  it('boosts for exact snake_case match', () => {
    const boost = getIdentifierBoost(
      'user_auth_token',
      'const user_auth_token = getToken();'
    );
    expect(boost).toBe(1.5);
  });

  it('caps boost at 2.5', () => {
    const boost = getIdentifierBoost(
      'signInWithGoogle handleAuthCallback resetAuthState refreshToken',
      'signInWithGoogle handleAuthCallback resetAuthState refreshToken code'
    );
    expect(boost).toBe(2.5);
  });

  it('returns 1.0 for no identifier matches', () => {
    const boost = getIdentifierBoost(
      'how does authentication work',
      'export function login() {}'
    );
    expect(boost).toBe(1.0);
  });

  it('returns 1.0 for queries without identifiers', () => {
    const boost = getIdentifierBoost('how does it work', 'signInWithGoogle');
    expect(boost).toBe(1.0);
  });
});
