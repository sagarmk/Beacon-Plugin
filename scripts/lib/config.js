import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');

export function loadConfig() {
  // Load defaults from plugin's config directory
  const defaultsPath = path.join(PLUGIN_ROOT, 'config', 'beacon.default.json');
  let defaults;
  try {
    defaults = JSON.parse(readFileSync(defaultsPath, 'utf-8'));
  } catch (err) {
    console.error(`Beacon: failed to parse config defaults (${defaultsPath}): ${err.message}`);
    process.exit(1);
  }

  // Load user overrides from repo's .claude/beacon.json (cwd = repo root)
  const userConfigPath = path.resolve('.claude', 'beacon.json');
  let userConfig = {};
  if (existsSync(userConfigPath)) {
    try {
      userConfig = JSON.parse(readFileSync(userConfigPath, 'utf-8'));
    } catch (err) {
      console.error(`Beacon: failed to parse .claude/beacon.json: ${err.message}`);
      process.exit(1);
    }
  }

  // Deep merge: defaults <- user config (user wins)
  return deepMerge(defaults, userConfig);
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else if (Array.isArray(source[key]) && Array.isArray(target[key])) {
      // Merge arrays: combine default and user arrays, deduplicate
      // This is especially important for include/exclude patterns where users want to ADD patterns
      result[key] = [...new Set([...target[key], ...source[key]])];
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
