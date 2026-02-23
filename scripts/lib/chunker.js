import path from 'path';

// Regex-based boundary detection per language
// No `g` flag — we test one line at a time, so `g` would cause lastIndex bugs
const BOUNDARIES = {
  '.ts':   /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const\s+\w+\s*=\s*(?:async\s+)?\(|enum)\b/m,
  '.tsx':  /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const\s+\w+\s*=\s*(?:async\s+)?\(|enum)\b/m,
  '.js':   /^(?:export\s+)?(?:async\s+)?(?:function|class|const\s+\w+\s*=\s*(?:async\s+)?\()\b/m,
  '.jsx':  /^(?:export\s+)?(?:async\s+)?(?:function|class|const\s+\w+\s*=\s*(?:async\s+)?\()\b/m,
  '.py':   /^(?:def |class |async def )/m,
  '.go':   /^(?:func |type )/m,
  '.rs':   /^(?:pub\s+)?(?:fn |struct |enum |impl |trait |mod )/m,
  '.java': /^(?:public |private |protected )?(?:static\s+)?(?:class |interface |enum |.*\s+\w+\s*\()/m,
  '.rb':   /^(?:def |class |module )/m,
  '.php':  /^(?:function |class |interface |trait )/m,
  '.sql':  /^(?:CREATE |ALTER |DROP |INSERT |SELECT |WITH |-- ===)/im,
};

export function chunkCode(content, filePath, config) {
  const ext = path.extname(filePath);
  const strategy = config.chunking.strategy; // "syntax", "fixed", or "hybrid"

  if (strategy === 'syntax' || strategy === 'hybrid') {
    const syntaxChunks = trySyntaxChunk(content, ext);
    if (syntaxChunks.length > 0) return syntaxChunks;
    // hybrid: fall through to fixed if syntax found nothing
  }

  return fixedChunk(content, config.chunking.max_tokens, config.chunking.overlap_tokens);
}

function trySyntaxChunk(content, ext) {
  const pattern = BOUNDARIES[ext];
  if (!pattern) return [];

  const lines = content.split('\n');
  const boundaries = [];

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      boundaries.push(i);
    }
  }

  if (boundaries.length < 2) return [];

  const chunks = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i];
    const end = (i + 1 < boundaries.length) ? boundaries[i + 1] - 1 : lines.length - 1;
    const text = lines.slice(start, end + 1).join('\n');

    chunks.push({
      index: i,
      text,
      startLine: start + 1,
      endLine: end + 1
    });
  }

  return chunks;
}

function fixedChunk(content, maxTokens, overlapTokens) {
  // Approximate: 1 token ~ 4 chars
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;
  const lines = content.split('\n');
  const chunks = [];
  let currentChunk = [];
  let currentLen = 0;
  let startLine = 1;
  let chunkIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentChunk.push(line);
    currentLen += line.length + 1;

    if (currentLen >= maxChars) {
      chunks.push({
        index: chunkIndex++,
        text: currentChunk.join('\n'),
        startLine,
        endLine: i + 1
      });

      // Overlap: keep last N chars worth of lines
      const overlapLines = [];
      let overlapLen = 0;
      for (let j = currentChunk.length - 1; j >= 0 && overlapLen < overlapChars; j--) {
        overlapLines.unshift(currentChunk[j]);
        overlapLen += currentChunk[j].length + 1;
      }
      currentChunk = overlapLines;
      currentLen = overlapLen;
      startLine = i + 1 - overlapLines.length + 1;
    }
  }

  // Final chunk
  if (currentChunk.length > 0) {
    chunks.push({
      index: chunkIndex,
      text: currentChunk.join('\n'),
      startLine,
      endLine: lines.length
    });
  }

  return chunks;
}
