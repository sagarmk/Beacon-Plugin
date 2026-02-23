// Hybrid search utilities — identifier extraction, FTS query prep, scoring

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am',
  'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him',
  'his', 'she', 'her', 'they', 'them', 'their'
]);

// Splits camelCase and PascalCase into parts: "signInWithGoogle" → ["sign", "In", "With", "Google"]
function splitCamelCase(word) {
  return word.replace(/([a-z])([A-Z])/g, '$1 $2')
             .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
             .split(/\s+/);
}

/**
 * Extract code identifiers from chunk text, splitting camelCase/snake_case for FTS indexing.
 * "signInWithGoogle" → "signInWithGoogle sign In With Google"
 */
export function extractIdentifiers(text) {
  // Match camelCase, PascalCase, snake_case identifiers (at least 2 chars)
  const identifierPattern = /[a-zA-Z_$][a-zA-Z0-9_$]{1,}/g;
  const seen = new Set();
  const parts = [];

  for (const match of text.matchAll(identifierPattern)) {
    const id = match[0];
    if (seen.has(id)) continue;
    seen.add(id);

    // Skip if it's a stop word or all-lowercase short word (likely prose)
    if (STOP_WORDS.has(id.toLowerCase()) && id.length < 6) continue;

    const isCamel = /[a-z][A-Z]/.test(id);
    const isSnake = id.includes('_');

    if (isCamel || isSnake) {
      parts.push(id); // keep original
      if (isCamel) {
        parts.push(...splitCamelCase(id));
      }
      if (isSnake) {
        parts.push(...id.split('_').filter(Boolean));
      }
    }
  }

  return parts.join(' ');
}

/**
 * Convert a user query into an FTS5 MATCH expression.
 * Strips stop words, quotes tokens, joins with OR.
 * Returns null if the query is purely semantic (all stop words).
 */
export function prepareFTSQuery(query) {
  const tokens = query
    .replace(/[^\w\s]/g, ' ')  // strip punctuation
    .split(/\s+/)
    .filter(t => t.length > 0)
    .filter(t => !STOP_WORDS.has(t.toLowerCase()));

  if (tokens.length === 0) return null;

  // Also split camelCase/snake_case tokens from the query
  const expanded = [];
  for (const token of tokens) {
    expanded.push(`"${token}"`);
    const isCamel = /[a-z][A-Z]/.test(token);
    const isSnake = token.includes('_');
    if (isCamel) {
      for (const part of splitCamelCase(token)) {
        if (part.length > 1 && !STOP_WORDS.has(part.toLowerCase())) {
          expanded.push(`"${part}"`);
        }
      }
    }
    if (isSnake) {
      for (const part of token.split('_')) {
        if (part.length > 1 && !STOP_WORDS.has(part.toLowerCase())) {
          expanded.push(`"${part}"`);
        }
      }
    }
  }

  // Deduplicate
  return [...new Set(expanded)].join(' OR ');
}

/**
 * Min-max normalize BM25 scores (which are negative — more negative = better match) to [0, 1].
 */
export function normalizeBM25(scores) {
  if (scores.length === 0) return [];
  if (scores.length === 1) return [1.0];

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (min === max) return scores.map(() => 1.0);

  // BM25 scores from FTS5 are negative: -20 is better than -1
  // min (most negative) = best match → 1.0, max (least negative) = worst → 0.0
  return scores.map(s => (max - s) / (max - min));
}

/**
 * Reciprocal Rank Fusion scoring.
 */
export function rrfScore(vecRank, ftsRank, k = 60) {
  let score = 0;
  if (vecRank !== null && vecRank !== undefined) score += 1 / (k + vecRank);
  if (ftsRank !== null && ftsRank !== undefined) score += 1 / (k + ftsRank);
  return score;
}

/**
 * Returns a score multiplier based on file type.
 * README.md → 0.5, other .md → 0.7, test files → 0.85, config → 0.8, source code → 1.0
 */
export function getFileTypeMultiplier(filePath) {
  const lower = filePath.toLowerCase();
  const base = lower.split('/').pop();

  if (base === 'readme.md') return 0.5;
  if (lower.endsWith('.md')) return 0.7;
  if (/\.(test|spec)\.[^.]+$/.test(lower) || /__(tests|test)__/.test(lower) || lower.includes('/test/')) return 0.85;
  if (/\.(json|ya?ml|toml|ini|cfg|conf)$/.test(lower) || base.startsWith('.')) return 0.8;
  return 1.0;
}

/**
 * Detects camelCase/snake_case identifiers in the query and returns a boost
 * multiplier if any are found as exact matches in the chunk text.
 * 1.5x boost per match, capped at 2.5x.
 */
export function getIdentifierBoost(query, chunkText) {
  const identifierPattern = /[a-zA-Z_$][a-zA-Z0-9_$]{2,}/g;
  const queryIds = [];

  for (const match of query.matchAll(identifierPattern)) {
    const id = match[0];
    if (/[a-z][A-Z]/.test(id) || id.includes('_')) {
      queryIds.push(id);
    }
  }

  if (queryIds.length === 0) return 1.0;

  let boost = 1.0;
  for (const id of queryIds) {
    if (chunkText.includes(id)) {
      boost += 0.5; // 1.5x for first match, 2.0x for second, etc.
    }
  }

  return Math.min(boost, 2.5);
}
