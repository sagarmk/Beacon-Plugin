#!/usr/bin/env node
// Called by: /whitelist command
// Subcommands: (none)=show, add [path], remove <path>, clear

import { loadGlobalConfig, saveGlobalConfig } from './lib/safety.js';
import path from 'path';

const args = process.argv.slice(2);
const subcommand = args[0] || 'show';

const config = loadGlobalConfig();

switch (subcommand) {
  case 'show': {
    console.log(JSON.stringify({
      whitelist: config.whitelist || [],
      note: 'Whitelisted paths override the blacklist. Subdirectories of whitelisted paths are also allowed.'
    }, null, 2));
    break;
  }

  case 'add': {
    const addPath = args[1] || process.cwd();
    const resolved = path.resolve(addPath);
    if (!config.whitelist) config.whitelist = [];
    if (!config.whitelist.includes(resolved)) {
      config.whitelist.push(resolved);
      saveGlobalConfig(config);
    }
    console.log(JSON.stringify({ action: 'added', path: resolved, whitelist: config.whitelist }, null, 2));
    break;
  }

  case 'remove': {
    const rmPath = args[1];
    if (!rmPath) {
      console.error('Usage: whitelist-manager.js remove <path>');
      process.exit(1);
    }
    const resolvedRm = path.resolve(rmPath);
    config.whitelist = (config.whitelist || []).filter(p => p !== resolvedRm);
    saveGlobalConfig(config);
    console.log(JSON.stringify({ action: 'removed', path: resolvedRm, whitelist: config.whitelist }, null, 2));
    break;
  }

  case 'clear': {
    config.whitelist = [];
    saveGlobalConfig(config);
    console.log(JSON.stringify({ action: 'cleared', whitelist: [] }, null, 2));
    break;
  }

  default:
    console.error(`Unknown subcommand: ${subcommand}. Use: show, add, remove, clear`);
    process.exit(1);
}
