const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'fantasy-hockey-streamer')
  : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'fantasy-hockey-streamer');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const TOKEN_FILE = path.join(CONFIG_DIR, 'token.json');
const CERTS_DIR = path.join(CONFIG_DIR, 'certs');

const SETTINGS_DIR = path.join(CONFIG_DIR, 'settings');

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(CERTS_DIR, { recursive: true });
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

function settingsPath(leagueKey) {
  return path.join(SETTINGS_DIR, leagueKey.replace(/\./g, '-') + '.json');
}

function loadCachedSettings(leagueKey) {
  const file = settingsPath(leagueKey);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCachedSettings(leagueKey, settings) {
  ensureConfigDir();
  fs.writeFileSync(settingsPath(leagueKey), JSON.stringify(settings, null, 2), { mode: 0o600 });
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
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function hasConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return false;
  const config = loadConfig();
  return !!(config && config.clientId);
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

/**
 * Resolve a league alias or key to a league key.
 * Accepts: full key (465.l.26962), alias (dads), or null (returns default).
 */
function resolveLeague(nameOrKey) {
  const config = loadConfig() || {};
  if (!nameOrKey) return config.defaultLeague || null;
  // Already a league key
  if (nameOrKey.match(/^\d+\.l\.\d+$/)) return nameOrKey;
  // Look up alias
  const aliases = config.leagues || {};
  const lower = nameOrKey.toLowerCase();
  if (aliases[lower]) return aliases[lower];
  // Partial match — find first alias that starts with the input
  for (const [alias, key] of Object.entries(aliases)) {
    if (alias.startsWith(lower)) return key;
  }
  return null;
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
  resolveLeague,
  SETTINGS_DIR,
  loadCachedSettings,
  saveCachedSettings,
};
