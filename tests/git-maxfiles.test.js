import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We test walkDirectory indirectly through getRepoFiles
// Since getRepoFiles checks for git, we'll test the walkDirectory fallback
// by creating a non-git temp directory

describe('git.js file count cap', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'beacon-git-test-'));
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('walkDirectory respects maxFiles limit', async () => {
    // Create more files than the limit
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir);
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(srcDir, `file${i}.js`), `// file ${i}`);
    }

    // chdir to tmpDir so getRepoFiles uses walkDirectory (no .git)
    process.chdir(tmpDir);

    const { getRepoFiles } = await import('../scripts/lib/git.js');
    const files = getRepoFiles(10); // cap at 10
    expect(files.length).toBeLessThanOrEqual(10);
  });

  it('returns all files when under limit', async () => {
    const srcDir = join(tmpDir, 'src');
    mkdirSync(srcDir);
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(srcDir, `file${i}.js`), `// file ${i}`);
    }

    process.chdir(tmpDir);

    const { getRepoFiles } = await import('../scripts/lib/git.js');
    const files = getRepoFiles(10000);
    expect(files.length).toBe(5);
  });
});
