#!/usr/bin/env node

const { hasConfig, resolveCredentials, TOKEN_FILE, CERTS_DIR, CONFIG_DIR, loadConfig } = require('../lib/config');
const fs = require('fs');

const args = process.argv.slice(2);
const subcommand = args[0];

// ── Subcommand routing ──────────────────────────────────────

if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
  printHelp();
  process.exit(0);
}

const SUBCOMMANDS = new Set(['setup', 'auth', 'leagues', 'status', 'help']);

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
} else if (subcommand && !subcommand.startsWith('-') && !subcommand.match(/^\d+\.l\.\d+$/) && !SUBCOMMANDS.has(subcommand)) {
  console.error(`Unknown command: ${subcommand}\nRun "stream help" for usage.`);
  process.exit(1);
} else {
  // Default: run the streamer (no subcommand, or a league key, or flags)
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
  const creds = resolveCredentials();
  if (!creds.clientId || !creds.clientSecret) {
    console.error('Missing Yahoo credentials. Run: stream setup');
    process.exit(1);
  }

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

  const config = loadConfig() || {};
  for (const lg of leagues) {
    const scoring = lg.scoringType === 'headpoint' ? 'Points' : 'Categories';
    const isDefault = lg.leagueKey === config.defaultLeague ? ' ← default' : '';
    console.log(`  ${lg.name}`);
    console.log(`    Key: ${lg.leagueKey} | ${lg.numTeams} teams | H2H ${scoring}${isDefault}\n`);
  }
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
  stream <league_key>             Analyze specific league
  stream --next                   Analyze next week
  stream --week <num>             Analyze specific fantasy week
  stream --date <YYYY-MM-DD>      Analyze week containing date
  stream --adds-used <n>          Override auto-detected adds used
  stream --goalies                Include goalie slots in analysis
  stream --add "<Name>"           Simulate adding a player
  stream --add "<Name>:<Day>"     Simulate adding starting on a day
  stream --no-matchup             Skip matchup adjustment (raw league weights)
  stream --boost "HIT,BLK"       Manually boost specific categories (2.5x)

Subcommands:
  stream setup                    Run setup wizard
  stream auth                     Re-authenticate with Yahoo
  stream leagues                  List your NHL fantasy leagues
  stream status                   Show config and token status
  stream help                     Show this help

Examples:
  stream                          Current week, default league
  stream 465.l.26962              Specific league
  stream --next --add "Schneider:Tue"
  stream --adds-used 2 --goalies
`);
}
