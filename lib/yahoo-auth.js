const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

class YahooAuth {
  constructor(options = {}) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri || 'https://localhost:3000/auth/callback';
    this.tokenFile = options.tokenFile;
    this.certsDir = options.certsDir;
    this.token = null;
    this._refreshTimer = null;
    this._log = options.log || ((type, msg) => console.log(`[YahooAuth] ${msg}`));

    if (this.tokenFile) this.loadToken();
  }

  loadToken() {
    if (this.tokenFile && fs.existsSync(this.tokenFile)) {
      try {
        this.token = JSON.parse(fs.readFileSync(this.tokenFile, 'utf-8'));
        this._log('info', `Loaded token (expires ${new Date(this.token.expires_at).toISOString()})`);
      } catch (e) {
        this._log('error', `Failed to load token: ${e.message}`);
      }
    }
    return this.token;
  }

  saveToken(token) {
    this.token = token;
    if (this.tokenFile) {
      fs.writeFileSync(this.tokenFile, JSON.stringify(token, null, 2));
      this._log('info', `Token saved (expires ${new Date(token.expires_at).toISOString()})`);
    }
  }

  isAuthenticated() {
    return !!this.token;
  }

  async getAccessToken() {
    if (!this.token) throw new Error('Not authenticated with Yahoo. Run: stream auth');
    const REFRESH_BUFFER = 5 * 60 * 1000;
    if (Date.now() >= this.token.expires_at - REFRESH_BUFFER) {
      this._log('info', 'Proactive token refresh (expires soon)');
      await this.refreshToken();
    }
    return this.token.access_token;
  }

  getAuthUrl(state) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      state: state || crypto.randomBytes(16).toString('hex'),
    });
    return `https://api.login.yahoo.com/oauth2/request_auth?${params}`;
  }

  async handleCallback(code) {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });

    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed: ${text}`);
    }

    const data = await res.json();
    this.saveToken({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    });
    return this.token;
  }

  async refreshToken() {
    if (!this.token || !this.token.refresh_token) {
      throw new Error('No refresh token available. Run: stream auth');
    }
    this._log('info', 'Refreshing token...');

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.token.refresh_token,
    });

    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      this._log('error', `Token refresh failed: ${text.substring(0, 300)}`);
      throw new Error(`Token refresh failed: ${text}`);
    }

    const data = await res.json();
    this.saveToken({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    });
    this._log('info', 'Token refreshed successfully');
    return this.token;
  }

  async authenticateInteractive(port = 3000) {
    return new Promise((resolve, reject) => {
      const certPath = path.join(this.certsDir, 'cert.pem');
      const keyPath = path.join(this.certsDir, 'key.pem');

      if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        reject(new Error(`Certs not found in ${this.certsDir}. Run: stream setup`));
        return;
      }

      const sslOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };

      const handler = async (req, res) => {
        const url = new URL(req.url, `https://localhost:${port}`);

        if (url.pathname === '/auth/callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end(`OAuth error: ${error}`);
            server.close();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('No authorization code received');
            server.close();
            reject(new Error('No authorization code received'));
            return;
          }

          try {
            await this.handleCallback(code);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h2>Authenticated! You can close this tab.</h2>');
            server.close();
            resolve(this.token);
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Auth error: ${e.message}`);
            server.close();
            reject(e);
          }
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      };

      const server = https.createServer(sslOptions, handler);
      server.listen(port, () => {
        const authUrl = this.getAuthUrl();
        console.log(`\nOpen this URL to authenticate:\n\n  ${authUrl}\n`);
        console.log(`Waiting for callback on https://localhost:${port}/auth/callback ...\n`);
      });

      server.on('error', (e) => {
        reject(new Error(`Server error: ${e.message}`));
      });
    });
  }
}

module.exports = { YahooAuth };
