const fs = require('fs');
const readline = require('readline');
const { CONFIG_DIR, CERTS_DIR, TOKEN_FILE, ensureConfigDir, saveConfig, loadConfig } = require('./config');
const { YahooAuth } = require('./yahoo-auth');
const { YahooClient } = require('./yahoo-client');

function ask(rl, question) {
  return new Promise((resolve, reject) => {
    let answered = false;
    rl.question(question, answer => {
      answered = true;
      resolve(answer);
    });
    rl.once('close', () => {
      if (!answered) reject(new Error('Input closed (EOF or Ctrl+C)'));
    });
  });
}

function generateCerts() {
  const selfsigned = require('selfsigned');
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = selfsigned.generate(attrs, {
    keySize: 2048,
    days: 365,
    algorithm: 'sha256',
  });

  fs.mkdirSync(CERTS_DIR, { recursive: true });
  fs.writeFileSync(`${CERTS_DIR}/cert.pem`, pems.cert, { mode: 0o600 });
  fs.writeFileSync(`${CERTS_DIR}/key.pem`, pems.private, { mode: 0o600 });
  console.log('  Generated self-signed SSL certificates');
}

async function promptCredentials(rl) {
  console.log('\n━━━ Yahoo Developer App Setup ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('  1. Go to https://developer.yahoo.com/apps/create/');
  console.log('  2. Create an app with these settings:');
  console.log('     - Application Name: anything (e.g. "Fantasy Hockey Streamer")');
  console.log('     - Home Page URL: https://localhost:3000');
  console.log('     - Redirect URI: https://localhost:3000/auth/callback');
  console.log('     - API Permissions: Fantasy Sports (Read)');
  console.log('  3. Copy the Client ID and Client Secret below\n');

  const clientId = (await ask(rl, '  Client ID: ')).trim();
  const clientSecret = (await ask(rl, '  Client Secret: ')).trim();

  if (!clientId || !clientSecret) {
    throw new Error('Client ID and Secret are required');
  }

  return { clientId, clientSecret };
}

/**
 * Generate a short alias from a league name.
 * "Dad's Hockey League 9.0" -> "dads"
 * "KKUPFL - T6 Gustafsson" -> "kkupfl"
 * "This Is The League Name" -> "this"
 */
function generateAlias(name, usedAliases) {
  // Take first word, strip non-alphanumeric, lowercase
  const words = name.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/);
  let alias = words[0].toLowerCase();
  // If collision, add second word
  if (usedAliases.has(alias) && words.length > 1) {
    alias = (words[0] + words[1]).toLowerCase();
  }
  // If still collision, append number
  let base = alias;
  let n = 2;
  while (usedAliases.has(alias)) {
    alias = base + n++;
  }
  return alias;
}

async function promptLeagues(rl, client) {
  console.log('\n  Fetching your NHL fantasy leagues...');
  const leagues = await client.getUserLeagues(['nhl']);

  if (leagues.length === 0) {
    console.log('  No NHL fantasy leagues found for this account.');
    return { defaultLeague: null, leagueAliases: {} };
  }

  // Generate aliases
  const usedAliases = new Set();
  const leagueAliases = {};
  for (const lg of leagues) {
    const alias = generateAlias(lg.name, usedAliases);
    usedAliases.add(alias);
    leagueAliases[alias] = lg.leagueKey;
  }

  console.log('\n  Your NHL leagues:');
  const aliasEntries = Object.entries(leagueAliases);
  for (let i = 0; i < leagues.length; i++) {
    const lg = leagues[i];
    const alias = aliasEntries[i][0];
    const scoring = lg.scoringType === 'headpoint' ? 'Points' : 'Categories';
    console.log(`    ${i + 1}. ${lg.name} (${lg.numTeams} teams, ${scoring})`);
    console.log(`       alias: ${alias}  key: ${lg.leagueKey}`);
  }

  const choice = (await ask(rl, `\n  Default league [1-${leagues.length}]: `)).trim();
  const idx = parseInt(choice) - 1;
  const defaultLeague = (idx >= 0 && idx < leagues.length)
    ? leagues[idx].leagueKey
    : leagues[0].leagueKey;

  return { defaultLeague, leagueAliases };
}

async function runSetup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║          Fantasy Hockey Streamer — First-Run Setup          ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    // Step 1: Credentials
    const { clientId, clientSecret } = await promptCredentials(rl);

    // Step 2: Save credentials immediately (so auth failure doesn't lose them)
    ensureConfigDir();
    const existingConfig = loadConfig() || {};
    saveConfig({ clientId, clientSecret, defaultLeague: existingConfig.defaultLeague || null });

    // Step 3: Generate certs
    console.log('\n  Generating SSL certificates...');
    generateCerts();

    // Step 4: OAuth
    console.log('\n━━━ Yahoo Authentication ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const auth = new YahooAuth({
      clientId,
      clientSecret,
      tokenFile: TOKEN_FILE,
      certsDir: CERTS_DIR,
    });

    await auth.authenticateInteractive();
    console.log('  Authenticated successfully!');

    // Step 5: League selection and alias generation
    const client = new YahooClient(auth);
    const { defaultLeague, leagueAliases } = await promptLeagues(rl, client);

    // Step 6: Update config with league and aliases
    saveConfig({ clientId, clientSecret, defaultLeague, leagues: leagueAliases });
    console.log(`\n  Config saved to ${CONFIG_DIR}/`);
    if (Object.keys(leagueAliases).length > 0) {
      console.log(`  League aliases: ${Object.keys(leagueAliases).join(', ')}`);
    }
    console.log('  Setup complete!\n');

    return { clientId, clientSecret, defaultLeague };
  } finally {
    rl.close();
  }
}

async function runAuth() {
  const config = loadConfig();
  if (!config || !config.clientId || !config.clientSecret) {
    throw new Error('No config found. Run: stream setup');
  }

  ensureConfigDir();

  // Regenerate certs if missing
  const certPath = `${CERTS_DIR}/cert.pem`;
  if (!fs.existsSync(certPath)) {
    console.log('  Generating SSL certificates...');
    generateCerts();
  }

  const auth = new YahooAuth({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tokenFile: TOKEN_FILE,
    certsDir: CERTS_DIR,
  });

  await auth.authenticateInteractive();
  console.log('  Authenticated successfully!');
}

module.exports = { runSetup, runAuth, generateAlias };
