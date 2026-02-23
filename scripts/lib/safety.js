import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.claude', 'beacon-global.json');

export function loadGlobalConfig() {
  if (!existsSync(GLOBAL_CONFIG_PATH)) {
    const dir = path.dirname(GLOBAL_CONFIG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const defaults = { blacklist: [], whitelist: [] };
    writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    return JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, 'utf-8'));
  } catch {
    return { blacklist: [], whitelist: [] };
  }
}

export function saveGlobalConfig(config) {
  const dir = path.dirname(GLOBAL_CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Computed default blacklist: all ancestor dirs from / to homedir
// e.g. /, /Users, /Users/<username>
function getDefaultBlacklist() {
  const home = os.homedir();
  const parts = home.split(path.sep).filter(Boolean);
  const ancestors = ['/'];
  let current = '/';
  for (const part of parts) {
    current = path.join(current, part);
    ancestors.push(current);
  }
  return ancestors;
}

export function getEffectiveBlacklist() {
  const config = loadGlobalConfig();
  const defaults = getDefaultBlacklist();
  const userEntries = config.blacklist || [];
  // Merge and deduplicate
  return [...new Set([...defaults, ...userEntries])];
}

export function isCwdBlacklisted() {
  const cwd = process.cwd();
  const config = loadGlobalConfig();
  const whitelist = config.whitelist || [];

  // Whitelist takes precedence — exact match or cwd is under a whitelisted path
  for (const w of whitelist) {
    const resolved = path.resolve(w);
    if (cwd === resolved || cwd.startsWith(resolved + path.sep)) {
      return false;
    }
  }

  const blacklist = getEffectiveBlacklist();
  for (const b of blacklist) {
    const resolved = path.resolve(b);
    if (cwd === resolved) {
      return true;
    }
  }
  return false;
}

export function isCwdWhitelisted() {
  const cwd = process.cwd();
  const config = loadGlobalConfig();
  const whitelist = config.whitelist || [];
  for (const w of whitelist) {
    const resolved = path.resolve(w);
    if (cwd === resolved || cwd.startsWith(resolved + path.sep)) {
      return true;
    }
  }
  return false;
}

export { GLOBAL_CONFIG_PATH };
