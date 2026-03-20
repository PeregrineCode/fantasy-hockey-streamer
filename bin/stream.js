#!/usr/bin/env node

const { hasConfig, resolveCredentials, resolveLeague, TOKEN_FILE, CERTS_DIR, CONFIG_DIR, loadConfig, saveConfig, saveCachedSettings } = require('../lib/config');
const fs = require('fs');

const args = process.argv.slice(2);
const subcommand = args[0];

// ── Subcommand routing ──────────────────────────────────────

if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
  printHelp();
  process.exit(0);
}

if (subcommand === 'setup') {
  const { runSetup } = require('../lib/setup');
  runSetup().catch(err => { console.error('Setup error:', err.message); process.exit(1); });
} else if (subcommand === 'auth') {
  const { runAuth } = require('../lib/setup');
  runAuth().catch(err => { console.error('Auth error:', err.message); process.exit(1); });
} else if (subcommand === 'leagues') {
  runLeagues().catch(err => { console.error('Error:', err.message); process.exit(1); });
} else if (subcommand === 'status') {
  runStatus();
} else {
  // Default: run the streamer (no subcommand, league key, alias, or flags)
  runStream().catch(err => { console.error('Error:', err.message); process.exit(1); });
}

// ── Subcommand implementations ──────────────────────────────

async function runStream() {
  // First-run detection
  if (!hasConfig()) {
    console.log('No configuration found. Starting first-run setup...\n');
    const { runSetup } = require('../lib/setup');
    await runSetup();
    // After setup, run the streamer immediately
    console.log('\n━━━ Running streaming analysis ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  const creds = resolveCredentials();
  if (!creds.clientId || !creds.clientSecret) {
    console.error('Missing Yahoo credentials. Run: stream setup');
    process.exit(1);
  }

  const config = {
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    defaultLeague: creds.defaultLeague,
    tokenFile: TOKEN_FILE,
    certsDir: CERTS_DIR,
  };

  const { run } = require('../lib/stream');
  await run(config, process.argv);
}

async function runLeagues() {
  const refresh = args.includes('--refresh');
  const creds = resolveCredentials();
  if (!creds.clientId || !creds.clientSecret) {
    console.error('Missing Yahoo credentials. Run: stream setup');
    process.exit(1);
  }

  const config = loadConfig() || {};
  const existingAliases = config.leagues || {};

  // If we have aliases and not refreshing, just show them
  if (!refresh && Object.keys(existingAliases).length > 0) {
    console.log('Your NHL fantasy leagues:\n');
    const reverseMap = {};
    for (const [alias, key] of Object.entries(existingAliases)) {
      reverseMap[key] = alias;
    }
    for (const [alias, key] of Object.entries(existingAliases)) {
      const isDefault = key === config.defaultLeague ? ' ← default' : '';
      console.log(`  ${alias.padEnd(15)} ${key}${isDefault}`);
    }
    console.log(`\nUsage: stream ${Object.keys(existingAliases)[0]}`);
    console.log('Run "stream leagues --refresh" to update from Yahoo.\n');
    return;
  }

  // Fetch from API
  const { YahooAuth } = require('../lib/yahoo-auth');
  const { YahooClient } = require('../lib/yahoo-client');

  const auth = new YahooAuth({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    tokenFile: TOKEN_FILE,
    certsDir: CERTS_DIR,
  });

  if (!auth.isAuthenticated()) {
    console.error('Not authenticated. Run: stream auth');
    process.exit(1);
  }

  const client = new YahooClient(auth);
  console.log('Fetching your NHL fantasy leagues...\n');
  const leagues = await client.getUserLeagues(['nhl']);

  if (leagues.length === 0) {
    console.log('No NHL fantasy leagues found.');
    return;
  }

  // Generate aliases
  const { generateAlias } = require('../lib/setup');
  const usedAliases = new Set();
  const leagueAliases = {};
  for (const lg of leagues) {
    const alias = generateAlias(lg.name, usedAliases);
    usedAliases.add(alias);
    leagueAliases[alias] = lg.leagueKey;
  }

  // Save updated aliases
  saveConfig({ ...config, leagues: leagueAliases });

  // Cache league settings (saves an API call on each run)
  console.log('Caching league settings...');
  for (const lg of leagues) {
    const settings = await client.getLeagueSettings(lg.leagueKey);
    saveCachedSettings(lg.leagueKey, settings);
  }

  for (const lg of leagues) {
    const alias = Object.entries(leagueAliases).find(([, k]) => k === lg.leagueKey)?.[0];
    const scoring = lg.scoringType === 'headpoint' ? 'Points' : 'Categories';
    const isDefault = lg.leagueKey === config.defaultLeague ? ' ← default' : '';
    console.log(`  ${lg.name} (${lg.numTeams} teams, ${scoring})${isDefault}`);
    console.log(`    alias: ${alias}  key: ${lg.leagueKey}\n`);
  }
  console.log(`Usage: stream ${Object.keys(leagueAliases)[0]}`);
}

function runStatus() {
  const config = loadConfig();
  if (!config) {
    console.log('No configuration found. Run: stream setup');
    return;
  }

  console.log('\nFantasy Hockey Streamer — Status\n');
  console.log(`  Config dir:     ${CONFIG_DIR}`);
  console.log(`  Client ID:      ${config.clientId ? config.clientId.substring(0, 12) + '...' : 'not set'}`);
  console.log(`  Client Secret:  ${config.clientSecret ? '****' : 'not set'}`);
  console.log(`  Default league: ${config.defaultLeague || 'not set'}`);

  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const token = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
      const expires = new Date(token.expires_at);
      const isValid = Date.now() < token.expires_at;
      console.log(`  Token:          ${isValid ? 'valid' : 'expired'} (expires ${expires.toLocaleString()})`);
    } catch {
      console.log('  Token:          invalid (corrupted file)');
    }
  } else {
    console.log('  Token:          not found');
  }

  const certPath = `${CERTS_DIR}/cert.pem`;
  console.log(`  SSL certs:      ${fs.existsSync(certPath) ? 'present' : 'not found'}`);
  console.log();
}

function printHelp() {
  console.log(`
Fantasy Hockey Streamer — find the best free agent pickups

Usage:
  stream                          Analyze current week (default league)
  stream <alias>                  Analyze by league alias (e.g. dads, kkupfl)
  stream <league_key>             Analyze by league key (e.g. 465.l.26962)
  stream --next                   Analyze next week
  stream --week <num>             Analyze specific fantasy week
  stream --date <YYYY-MM-DD>      Analyze week containing date
  stream --adds-used <n>          Override auto-detected adds used
  stream --goalies                Include goalie slots in analysis
  stream --add "<Name>"           Simulate adding a player
  stream --add "<Name>:<Day>"     Simulate adding starting on a day
  stream --no-matchup             Skip matchup adjustment (raw league weights)
  stream --boost "HIT,BLK"        Manually boost specific categories (2.5x)
  stream --refresh-settings       Re-fetch league settings from Yahoo

Subcommands:
  stream setup                    Run setup wizard
  stream auth                     Re-authenticate with Yahoo
  stream leagues                  List leagues and aliases
  stream leagues --refresh        Re-fetch leagues from Yahoo and update aliases
  stream status                   Show config and token status
  stream help                     Show this help

Examples:
  stream                          Current week, default league
  stream kkupfl                   Use league alias
  stream dads --next              Next week for a specific league
  stream --boost "HIT,BLK"        Boost specific categories
  stream --add "Schneider:Tue" --goalies
`);
}
