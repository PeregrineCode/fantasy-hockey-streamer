const BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';

class YahooClient {
  constructor(auth, options = {}) {
    this.auth = auth;
    this.minInterval = options.minInterval || 2000;
    this.userAgent = options.userAgent || 'FantasyHockeyStreamer/1.0';
    this._lastApiCall = 0;
    this._gameKeyCache = new Map();
    this._log = options.log || auth._log || ((type, msg) => console.log(`[YahooClient] ${msg}`));
  }

  async get(endpoint) {
    const accessToken = await this.auth.getAccessToken();

    const now = Date.now();
    const timeSinceLast = now - this._lastApiCall;
    if (timeSinceLast < this.minInterval) {
      await new Promise(r => setTimeout(r, this.minInterval - timeSinceLast));
    }
    this._lastApiCall = Date.now();

    const url = `${BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}format=json`;
    this._log('api', `GET ${endpoint}`);

    const makeRequest = async () => {
      const token = this.auth.token.access_token;
      return fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': this.userAgent,
        },
      });
    };

    let res = await makeRequest();

    if (res.status === 401) {
      this._log('warn', `401 on ${endpoint} — refreshing token`);
      await this.auth.refreshToken();
      res = await makeRequest();
    }

    if (res.status === 999) {
      this._log('warn', `999 rate limited on ${endpoint} — waiting 5s`);
      await new Promise(r => setTimeout(r, 5000));
      res = await makeRequest();
      if (res.status === 999) {
        this._log('error', `999 persists on ${endpoint} after retry`);
        throw new Error('Yahoo rate limited (999). Try again in a moment.');
      }
    }

    if (!res.ok) {
      const text = await res.text();
      this._log('error', `${res.status} on ${endpoint}: ${text.substring(0, 300)}`);
      throw new Error(`Yahoo API error: ${res.status} - ${text}`);
    }

    const data = await res.json();
    this._log('api', `OK ${endpoint}`);
    return data;
  }

  async resolveGameKey(gameCode) {
    if (this._gameKeyCache.has(gameCode)) {
      return this._gameKeyCache.get(gameCode);
    }
    const data = await this.get(`/game/${gameCode}`);
    const gameKey = data.fantasy_content.game[0].game_key;
    this._gameKeyCache.set(gameCode, gameKey);
    this._log('info', `Resolved ${gameCode} game key: ${gameKey}`);
    return gameKey;
  }

  async getUserLeagues(gameCodes = ['nhl']) {
    const gameKeys = [];
    for (const code of gameCodes) {
      const key = await this.resolveGameKey(code);
      gameKeys.push({ code, key });
    }

    const keyList = gameKeys.map(g => g.key).join(',');
    const data = await this.get(`/users;use_login=1/games;game_keys=${keyList}/leagues`);

    const leagues = [];
    try {
      const games = data.fantasy_content.users[0].user[1].games;
      const gameCount = games.count;
      for (let i = 0; i < gameCount; i++) {
        const game = games[i].game;
        const gameInfo = game[0];
        const gameCode = gameInfo.code;
        const gameKey = gameInfo.game_key;
        const gameName = gameInfo.name;

        if (game[1] && game[1].leagues) {
          const leagueData = game[1].leagues;
          const leagueCount = leagueData.count;
          for (let j = 0; j < leagueCount; j++) {
            const lg = leagueData[j].league[0];
            leagues.push({
              name: lg.name,
              sport: gameCode,
              sportName: gameName,
              gameKey: gameKey,
              leagueId: lg.league_id,
              leagueKey: lg.league_key,
              season: lg.season,
              numTeams: lg.num_teams,
              scoringType: lg.scoring_type,
            });
          }
        }
      }
    } catch (e) {
      this._log('error', `Error parsing leagues response: ${e.message}`);
      throw new Error(`Failed to parse leagues: ${e.message}`);
    }

    return leagues;
  }

  async getLeagueSettings(leagueKey) {
    const data = await this.get(`/league/${leagueKey}/settings`);
    try {
      const league = data.fantasy_content.league;
      const meta = league[0];
      const settings = league[1].settings[0];
      return { meta, settings };
    } catch (e) {
      throw new Error(`Failed to parse league settings: ${e.message}`);
    }
  }
}

module.exports = { YahooClient };
