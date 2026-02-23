#!/usr/bin/env node
// Called by: /blacklist command
// Subcommands: (none)=show, add <path>, remove <path>, reset

import { loadGlobalConfig, saveGlobalConfig, getEffectiveBlacklist } from './lib/safety.js';
import path from 'path';

const args = process.argv.slice(2);
const subcommand = args[0] || 'show';

const config = loadGlobalConfig();

switch (subcommand) {
  case 'show': {
    const effective = getEffectiveBlacklist();
    const userEntries = config.blacklist || [];
    console.log(JSON.stringify({
      effective_blacklist: effective,
      user_additions: userEntries,
      note: 'Default blacklist includes all ancestor directories from / to your home directory. User additions are merged on top.'
    }, null, 2));
    break;
  }

  case 'add': {
    const addPath = args[1];
    if (!addPath) {
      console.error('Usage: blacklist-manager.js add <path>');
      process.exit(1);
    }
    const resolved = path.resolve(addPath);
    if (!config.blacklist) config.blacklist = [];
    if (!config.blacklist.includes(resolved)) {
      config.blacklist.push(resolved);
      saveGlobalConfig(config);
    }
    console.log(JSON.stringify({ action: 'added', path: resolved, blacklist: config.blacklist }, null, 2));
    break;
  }

  case 'remove': {
    const rmPath = args[1];
    if (!rmPath) {
      console.error('Usage: blacklist-manager.js remove <path>');
      process.exit(1);
    }
    const resolvedRm = path.resolve(rmPath);
    config.blacklist = (config.blacklist || []).filter(p => p !== resolvedRm);
    saveGlobalConfig(config);
    console.log(JSON.stringify({ action: 'removed', path: resolvedRm, blacklist: config.blacklist }, null, 2));
    break;
  }

  case 'reset': {
    config.blacklist = [];
    saveGlobalConfig(config);
    console.log(JSON.stringify({ action: 'reset', blacklist: [], note: 'User additions cleared. Default blacklist still applies.' }, null, 2));
    break;
  }

  default:
    console.error(`Unknown subcommand: ${subcommand}. Use: show, add, remove, reset`);
    process.exit(1);
}
