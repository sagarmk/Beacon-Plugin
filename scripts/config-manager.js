#!/usr/bin/env node
// Called by: /config command
// Subcommands: show | set <key> <value> | provider <name> | reset [section]
// Output: JSON to stdout for Claude to format

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');

// --- File paths ---
const defaultsPath = path.join(PLUGIN_ROOT, 'config', 'beacon.default.json');
const providersPath = path.join(PLUGIN_ROOT, 'config', 'providers.json');
const userConfigPath = path.resolve('.claude', 'beacon.json');

// --- Load files ---
const defaults = JSON.parse(readFileSync(defaultsPath, 'utf-8'));
const providers = JSON.parse(readFileSync(providersPath, 'utf-8'));

function loadUserConfig() {
  if (existsSync(userConfigPath)) {
    return JSON.parse(readFileSync(userConfigPath, 'utf-8'));
  }
  return {};
}

function saveUserConfig(config) {
  const dir = path.dirname(userConfigPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(userConfigPath, JSON.stringify(config, null, 2) + '\n');
}

// --- Helpers ---

function getNestedValue(obj, dotPath) {
  const keys = dotPath.split('.');
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function setNestedValue(obj, dotPath, value) {
  const keys = dotPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] == null || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

function deleteNestedValue(obj, dotPath) {
  const keys = dotPath.split('.');
  if (keys.length === 1) {
    delete obj[keys[0]];
    return;
  }
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] == null || typeof current[keys[i]] !== 'object') return;
    current = current[keys[i]];
  }
  delete current[keys[keys.length - 1]];
}

function flattenConfig(obj, prefix = '') {
  const results = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      results.push(...flattenConfig(value, fullKey));
    } else {
      results.push({ key: fullKey, value });
    }
  }
  return results;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
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

function detectProvider(effectiveConfig, providers) {
  const emb = effectiveConfig.embedding;
  for (const [name, preset] of Object.entries(providers)) {
    const p = preset.embedding;
    if (
      emb.api_base === p.api_base &&
      emb.model === p.model &&
      emb.dimensions === p.dimensions
    ) {
      return name;
    }
  }
  return null;
}

function parseValue(str, defaultValue) {
  // Match type of default value
  if (typeof defaultValue === 'number') {
    const n = Number(str);
    if (isNaN(n)) throw new Error(`Expected a number, got "${str}"`);
    return n;
  }
  if (typeof defaultValue === 'boolean') {
    if (str === 'true') return true;
    if (str === 'false') return false;
    throw new Error(`Expected true/false, got "${str}"`);
  }
  if (Array.isArray(defaultValue)) {
    // Accept comma-separated or JSON array
    if (str.startsWith('[')) {
      try { return JSON.parse(str); } catch { /* fall through to comma split */ }
    }
    return str.split(',').map(s => s.trim()).filter(Boolean);
  }
  return str;
}

function getEffectiveDimensions(userConfig) {
  const merged = deepMerge(defaults, userConfig);
  return merged.embedding.dimensions;
}

// --- Subcommands ---

function cmdShow() {
  const userConfig = loadUserConfig();
  const merged = deepMerge(defaults, userConfig);
  const flatDefaults = flattenConfig(defaults);
  const flatUser = flattenConfig(userConfig);
  const userKeys = new Set(flatUser.map(f => f.key));

  const settings = flatDefaults.map(({ key }) => {
    const effectiveValue = getNestedValue(merged, key);
    return {
      key,
      value: effectiveValue,
      source: userKeys.has(key) ? 'user' : 'default'
    };
  });

  const activeProvider = detectProvider(merged, providers);
  const availableProviders = Object.entries(providers).map(([name, p]) => ({
    name,
    description: p.description
  }));

  console.log(JSON.stringify({
    settings,
    active_provider: activeProvider || 'custom',
    available_providers: availableProviders,
    override_file: userConfigPath,
    override_exists: existsSync(userConfigPath)
  }, null, 2));
}

function cmdSet(dotPath, rawValue) {
  if (!dotPath || rawValue === undefined) {
    console.error(JSON.stringify({ error: 'Usage: config-manager.js set <key> <value>' }));
    process.exit(1);
  }

  // Validate key exists in defaults
  const defaultValue = getNestedValue(defaults, dotPath);
  if (defaultValue === undefined) {
    const validKeys = flattenConfig(defaults).map(f => f.key);
    console.error(JSON.stringify({
      error: `Unknown config key: "${dotPath}"`,
      valid_keys: validKeys
    }));
    process.exit(1);
  }

  // Parse and validate value
  let parsedValue;
  try {
    parsedValue = parseValue(rawValue, defaultValue);
  } catch (err) {
    console.error(JSON.stringify({ error: err.message, key: dotPath }));
    process.exit(1);
  }

  // Additional validation
  if (dotPath === 'embedding.dimensions' || dotPath === 'embedding.batch_size' || dotPath === 'search.top_k') {
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      console.error(JSON.stringify({ error: `${dotPath} must be a positive integer`, value: parsedValue }));
      process.exit(1);
    }
  }
  if (dotPath === 'search.similarity_threshold') {
    if (parsedValue < 0 || parsedValue > 1) {
      console.error(JSON.stringify({ error: 'similarity_threshold must be between 0 and 1', value: parsedValue }));
      process.exit(1);
    }
  }

  const userConfig = loadUserConfig();
  const oldDimensions = getEffectiveDimensions(userConfig);
  const oldValue = getNestedValue(deepMerge(defaults, userConfig), dotPath);

  setNestedValue(userConfig, dotPath, parsedValue);
  saveUserConfig(userConfig);

  const newDimensions = getEffectiveDimensions(userConfig);

  console.log(JSON.stringify({
    action: 'set',
    key: dotPath,
    old_value: oldValue,
    new_value: parsedValue,
    dimensions_changed: oldDimensions !== newDimensions,
    old_dimensions: oldDimensions,
    new_dimensions: newDimensions
  }, null, 2));
}

function cmdProvider(name) {
  if (!name) {
    const available = Object.entries(providers).map(([n, p]) => ({
      name: n,
      description: p.description,
      model: p.embedding.model,
      dimensions: p.embedding.dimensions
    }));
    console.log(JSON.stringify({ action: 'list_providers', providers: available }, null, 2));
    return;
  }

  const preset = providers[name];
  if (!preset) {
    const available = Object.keys(providers);
    console.error(JSON.stringify({
      error: `Unknown provider: "${name}"`,
      available_providers: available
    }));
    process.exit(1);
  }

  const userConfig = loadUserConfig();
  const oldDimensions = getEffectiveDimensions(userConfig);

  // Replace the entire embedding section with the preset
  userConfig.embedding = { ...preset.embedding };
  saveUserConfig(userConfig);

  const newDimensions = getEffectiveDimensions(userConfig);

  console.log(JSON.stringify({
    action: 'provider',
    provider: name,
    description: preset.description,
    applied_settings: {
      api_base: preset.embedding.api_base,
      model: preset.embedding.model,
      dimensions: preset.embedding.dimensions,
      api_key_env: preset.embedding.api_key_env || '(none)'
    },
    dimensions_changed: oldDimensions !== newDimensions,
    old_dimensions: oldDimensions,
    new_dimensions: newDimensions
  }, null, 2));
}

function cmdReset(section) {
  const userConfig = loadUserConfig();

  if (Object.keys(userConfig).length === 0 && !existsSync(userConfigPath)) {
    console.log(JSON.stringify({
      action: 'reset',
      message: 'No overrides to reset — already using defaults'
    }, null, 2));
    return;
  }

  const oldDimensions = getEffectiveDimensions(userConfig);

  if (section) {
    if (getNestedValue(defaults, section) === undefined) {
      console.error(JSON.stringify({
        error: `Unknown section: "${section}"`,
        valid_sections: Object.keys(defaults)
      }));
      process.exit(1);
    }
    deleteNestedValue(userConfig, section);
    // Clean up empty parent objects
    const topKey = section.split('.')[0];
    if (userConfig[topKey] && typeof userConfig[topKey] === 'object' && Object.keys(userConfig[topKey]).length === 0) {
      delete userConfig[topKey];
    }
  } else {
    // Full reset — clear everything
    for (const key of Object.keys(userConfig)) {
      delete userConfig[key];
    }
  }

  if (Object.keys(userConfig).length === 0) {
    // Write empty object rather than deleting file
    saveUserConfig({});
  } else {
    saveUserConfig(userConfig);
  }

  const newDimensions = getEffectiveDimensions(userConfig);

  console.log(JSON.stringify({
    action: 'reset',
    section: section || 'all',
    dimensions_changed: oldDimensions !== newDimensions,
    old_dimensions: oldDimensions,
    new_dimensions: newDimensions
  }, null, 2));
}

// --- Main ---
const [subcommand, ...args] = process.argv.slice(2);

switch (subcommand || 'show') {
  case 'show':
    cmdShow();
    break;
  case 'set':
    cmdSet(args[0], args.slice(1).join(' '));
    break;
  case 'provider':
    cmdProvider(args[0]);
    break;
  case 'reset':
    cmdReset(args[0]);
    break;
  default:
    console.error(JSON.stringify({
      error: `Unknown subcommand: "${subcommand}"`,
      usage: 'config-manager.js [show | set <key> <value> | provider [name] | reset [section]]'
    }));
    process.exit(1);
}
