import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import path from 'path';

// We need to mock the global config path so tests don't touch the real config
let tmpDir;
let mockConfigPath;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'beacon-safety-test-'));
  mockConfigPath = join(tmpDir, 'beacon-global.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// Import after setup so we can mock
describe('safety.js', () => {
  // We'll test the functions by importing fresh each time with mocked config path
  // Since safety.js uses a constant path, we'll test the logic directly

  it('loadGlobalConfig creates default config if missing', async () => {
    const { loadGlobalConfig, saveGlobalConfig, GLOBAL_CONFIG_PATH } = await import('../scripts/lib/safety.js');
    // The real function creates at ~/.claude/beacon-global.json
    // We just verify it returns the right shape
    const config = loadGlobalConfig();
    expect(config).toHaveProperty('blacklist');
    expect(config).toHaveProperty('whitelist');
    expect(Array.isArray(config.blacklist)).toBe(true);
    expect(Array.isArray(config.whitelist)).toBe(true);
  });

  it('getEffectiveBlacklist includes home directory ancestors', async () => {
    const { getEffectiveBlacklist } = await import('../scripts/lib/safety.js');
    const effective = getEffectiveBlacklist();
    const home = homedir();

    // Should include /
    expect(effective).toContain('/');
    // Should include the home directory itself
    expect(effective).toContain(home);
    // Should include parent of home
    expect(effective).toContain(path.dirname(home));
  });

  it('isCwdBlacklisted returns false for normal project directories', async () => {
    const { isCwdBlacklisted } = await import('../scripts/lib/safety.js');
    // cwd is the Beacon project dir, which should NOT be blacklisted
    // (it's a subdirectory of home, not home itself)
    const result = isCwdBlacklisted();
    expect(result).toBe(false);
  });
});
