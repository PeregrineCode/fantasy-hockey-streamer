const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'fantasy-hockey-streamer');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const TOKEN_FILE = path.join(CONFIG_DIR, 'token.json');
const CERTS_DIR = path.join(CONFIG_DIR, 'certs');

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(CERTS_DIR, { recursive: true });
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function hasConfig() {
  return fs.existsSync(CONFIG_FILE);
}

/**
 * Resolve config values: CLI flags > env vars > config.json
 */
function resolveCredentials(flags = {}) {
  const config = loadConfig() || {};
  return {
    clientId: flags.clientId || process.env.YAHOO_CLIENT_ID || config.clientId,
    clientSecret: flags.clientSecret || process.env.YAHOO_CLIENT_SECRET || config.clientSecret,
    defaultLeague: flags.league || process.env.YAHOO_LEAGUE_KEY || config.defaultLeague,
  };
}

module.exports = {
  CONFIG_DIR,
  CONFIG_FILE,
  TOKEN_FILE,
  CERTS_DIR,
  ensureConfigDir,
  loadConfig,
  saveConfig,
  hasConfig,
  resolveCredentials,
};
