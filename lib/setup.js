const fs = require('fs');
const readline = require('readline');
const { CONFIG_DIR, CERTS_DIR, TOKEN_FILE, ensureConfigDir, saveConfig, loadConfig } = require('./config');
const { YahooAuth } = require('./yahoo-auth');
const { YahooClient } = require('./yahoo-client');

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
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
  fs.writeFileSync(`${CERTS_DIR}/cert.pem`, pems.cert);
  fs.writeFileSync(`${CERTS_DIR}/key.pem`, pems.private);
  console.log('  Generated self-signed SSL certificates');
}

async function promptCredentials(rl) {
  console.log('\n━━━ Yahoo Developer App Setup ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('  1. Go to https://developer.yahoo.com/apps/create/');
  console.log('  2. Create an app with these settings:');
  console.log('     - Application Name: anything (e.g. "Fantasy Hockey Streamer")');
  console.log('     - Application Type: Installed Application');
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

async function promptLeague(rl, client) {
  console.log('\n  Fetching your NHL fantasy leagues...');
  const leagues = await client.getUserLeagues(['nhl']);

  if (leagues.length === 0) {
    console.log('  No NHL fantasy leagues found for this account.');
    return null;
  }

  console.log('\n  Your NHL leagues:');
  for (let i = 0; i < leagues.length; i++) {
    const lg = leagues[i];
    const scoring = lg.scoringType === 'headpoint' ? 'Points' : 'Categories';
    console.log(`    ${i + 1}. ${lg.name} (${lg.numTeams} teams, ${scoring}) — ${lg.leagueKey}`);
  }

  const choice = (await ask(rl, `\n  Default league [1-${leagues.length}]: `)).trim();
  const idx = parseInt(choice) - 1;
  if (idx >= 0 && idx < leagues.length) {
    return leagues[idx].leagueKey;
  }
  return leagues[0].leagueKey;
}

async function runSetup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║          Fantasy Hockey Streamer — First-Run Setup          ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    // Step 1: Credentials
    const { clientId, clientSecret } = await promptCredentials(rl);

    // Step 2: Generate certs
    ensureConfigDir();
    console.log('\n  Generating SSL certificates...');
    generateCerts();

    // Step 3: OAuth
    console.log('\n━━━ Yahoo Authentication ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const auth = new YahooAuth({
      clientId,
      clientSecret,
      tokenFile: TOKEN_FILE,
      certsDir: CERTS_DIR,
    });

    await auth.authenticateInteractive();
    console.log('  Authenticated successfully!');

    // Step 4: League selection
    const client = new YahooClient(auth);
    const defaultLeague = await promptLeague(rl, client);

    // Step 5: Save config
    saveConfig({ clientId, clientSecret, defaultLeague });
    console.log(`\n  Config saved to ${CONFIG_DIR}/`);
    console.log('  Setup complete!\n');

    return { clientId, clientSecret, defaultLeague };
  } finally {
    rl.close();
  }
}

async function runAuth() {
  const config = loadConfig();
  if (!config || !config.clientId) {
    console.error('No config found. Run: stream setup');
    process.exit(1);
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

module.exports = { runSetup, runAuth, generateCerts };
