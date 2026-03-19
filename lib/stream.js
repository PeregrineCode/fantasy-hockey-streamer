const { YahooAuth } = require('./yahoo-auth');
const { YahooClient } = require('./yahoo-client');

// Module-level references, set by run()
let auth, client, leagueKey;

// ── CLI Argument Parsing ────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  let parsedLeagueKey = null;
  let targetDate = null;
  let addsUsed = 0;
  let addsUsedExplicit = false;
  let includeGoalies = false;
  const projectedAdds = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--week') {
      const val = args[++i];
      if (!val) { console.error('--week requires a number'); process.exit(1); }
      targetDate = { type: 'week', value: parseInt(val) };
    } else if (args[i] === '--next') {
      targetDate = { type: 'next' };
    } else if (args[i] === '--date') {
      const val = args[++i];
      if (!val) { console.error('--date requires a YYYY-MM-DD value'); process.exit(1); }
      targetDate = { type: 'date', value: val };
    } else if (args[i] === '--adds-used') {
      const val = args[++i];
      if (!val) { console.error('--adds-used requires a number'); process.exit(1); }
      addsUsed = parseInt(val);
      addsUsedExplicit = true;
    } else if (args[i] === '--goalies') {
      includeGoalies = true;
    } else if (args[i] === '--add') {
      const raw = args[++i];
      if (!raw) { console.error('--add requires a player name'); process.exit(1); }
      const colonIdx = raw.lastIndexOf(':');
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      if (colonIdx > 0 && dayNames.some(d => d.toLowerCase() === raw.slice(colonIdx + 1).toLowerCase())) {
        projectedAdds.push({ searchName: raw.slice(0, colonIdx), startDay: raw.slice(colonIdx + 1) });
      } else {
        projectedAdds.push({ searchName: raw, startDay: null });
      }
    } else if (args[i].match(/^\d+\.l\.\d+$/)) {
      parsedLeagueKey = args[i];
    }
  }

  return { leagueKey: parsedLeagueKey, targetDate, addsUsed, addsUsedExplicit, includeGoalies, projectedAdds };
}

// ── Helpers ─────────────────────────────────────────────────

function getMondayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function perGame(value, gp) {
  if (!gp || gp <= 0) return String(Math.round(value));
  return (value / gp).toFixed(1);
}

function resolveDayToDate(dayAbbrev, weekDates) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (const dateStr of weekDates) {
    const d = new Date(dateStr + 'T12:00:00');
    if (dayNames[d.getDay()].toLowerCase() === dayAbbrev.toLowerCase()) return dateStr;
  }
  return null;
}

const YAHOO_TO_NHL = { 'LA': 'LAK', 'NJ': 'NJD', 'SJ': 'SJS', 'TB': 'TBL' };
function normalizeTeam(yahooAbbr) {
  return YAHOO_TO_NHL[yahooAbbr] || yahooAbbr;
}

function formatStatLine(player, showPerGame = false) {
  const s = player.stats || {};
  const gp = s['0'] || player.gamesPlayed || 0;
  if (player.isGoalie) {
    const w = s['19'] || 0;
    const gaa = s['23'] || 0;
    const svp = s['26'] || 0;
    if (w === 0 && gaa === 0) return '';
    return `${w}W, ${gaa.toFixed(2)} GAA, ${svp.toFixed(3)} SV%${gp ? ` (${gp} GP)` : ''}`;
  }
  const g = s['1'] || 0;
  const a = s['2'] || 0;
  const p = s['3'] || 0;
  const sog = s['14'] || 0;
  const hit = s['31'] || 0;
  const blk = s['32'] || 0;
  if (g === 0 && a === 0) return '';
  if (showPerGame && gp > 0) {
    const ppg = (p / gp).toFixed(2);
    return `${g}G ${a}A ${p}P in ${gp} GP (${ppg}/gm), ${sog} SOG, ${hit} HIT, ${blk} BLK`;
  }
  return `${g}G ${a}A ${p}P, ${sog} SOG, ${hit} HIT, ${blk} BLK`;
}

// ── Data Fetching ───────────────────────────────────────────

async function loadLeagueSettings(leagueKey) {
  return await client.getLeagueSettings(leagueKey);
}

async function findMyTeamKey(leagueKey) {
  const data = await client.get(`/league/${leagueKey}/teams`);
  const teams = data.fantasy_content.league[1].teams;
  for (let i = 0; i < teams.count; i++) {
    const team = teams[i].team[0];
    let key = '', name = '', rosterAdds = null;
    for (const item of team) {
      if (item && item.team_key) key = item.team_key;
      if (item && item.name) name = item.name;
      if (item && item.roster_adds) rosterAdds = item.roster_adds;
      if (item && item.managers) {
        for (const m of item.managers) {
          if (m.manager && m.manager.is_current_login === '1') {
            // roster_adds: { coverage_type: "week", coverage_value: "17", value: "3" }
            const weekAdds = rosterAdds ? parseInt(rosterAdds.value) || 0 : 0;
            return { teamKey: key, teamName: name, weekAdds };
          }
        }
      }
    }
  }
  throw new Error('Could not find your team in this league');
}

async function fetchNHLSchedule(dateStr) {
  const res = await fetch(`https://api-web.nhle.com/v1/schedule/${dateStr}`);
  if (!res.ok) throw new Error(`NHL API error: ${res.status}`);
  const data = await res.json();

  const weekSchedule = new Map();
  const teamGameDays = new Map();

  for (const day of data.gameWeek) {
    const teams = new Set();
    for (const game of day.games) {
      teams.add(game.awayTeam.abbrev);
      teams.add(game.homeTeam.abbrev);
      for (const abbrev of [game.awayTeam.abbrev, game.homeTeam.abbrev]) {
        if (!teamGameDays.has(abbrev)) teamGameDays.set(abbrev, []);
        teamGameDays.get(abbrev).push(day.date);
      }
    }
    weekSchedule.set(day.date, {
      dayAbbrev: day.dayAbbrev,
      numberOfGames: day.numberOfGames,
      teams,
    });
  }

  return { weekSchedule, teamGameDays };
}

async function fetchMyRoster(teamKey) {
  const data = await client.get(`/team/${teamKey}/roster`);
  const roster = data.fantasy_content.team[1].roster;
  const playersData = roster['0'].players;
  const players = [];

  for (let i = 0; i < playersData.count; i++) {
    const p = playersData[i].player;
    const meta = p[0];
    const selPos = p[1];
    const player = { positions: [], eligiblePositions: [] };

    for (const item of meta) {
      if (item && item.player_key) player.playerKey = item.player_key;
      if (item && item.name) player.name = item.name.full;
      if (item && item.editorial_team_abbr) player.nhlTeam = normalizeTeam(item.editorial_team_abbr);
      if (item && item.display_position) player.displayPosition = item.display_position;
      if (item && item.eligible_positions) {
        player.eligiblePositions = item.eligible_positions
          .map(e => e.position)
          .filter(p => !['BN', 'IR', 'IR+', 'NA', 'DL', 'DL+'].includes(p));
      }
    }

    if (selPos && selPos.selected_position) {
      for (const s of selPos.selected_position) {
        if (s.position) player.selectedPosition = s.position;
      }
    }

    player.isGoalie = player.eligiblePositions.includes('G') && !player.eligiblePositions.some(p => ['C', 'LW', 'RW', 'D'].includes(p));
    player.playingPositions = player.eligiblePositions.filter(p => ['C', 'LW', 'RW', 'D', 'G'].includes(p));
    player.isIR = ['IR', 'IR+', 'NA', 'DL', 'DL+'].includes(player.selectedPosition);

    players.push(player);
  }

  return players;
}

async function fetchFreeAgents(leagueKey, position, pages = 1) {
  const players = [];

  for (let page = 0; page < pages; page++) {
    const start = page * 25;
    const data = await client.get(`/league/${leagueKey}/players;status=A;position=${position};sort=OR;start=${start};count=25/stats;type=lastmonth`);
    const playersData = data.fantasy_content.league[1].players;
    if (Array.isArray(playersData) && playersData.length === 0) break;
    if (!playersData.count) break;

    for (let i = 0; i < playersData.count; i++) {
      const p = playersData[i].player;
      const meta = p[0];
      const player = { eligiblePositions: [], stats: {} };

      for (const item of meta) {
        if (item && item.player_key) player.playerKey = item.player_key;
        if (item && item.name) player.name = item.name.full;
        if (item && item.editorial_team_abbr) player.nhlTeam = normalizeTeam(item.editorial_team_abbr);
        if (item && item.display_position) player.displayPosition = item.display_position;
        if (item && item.eligible_positions) {
          player.eligiblePositions = item.eligible_positions
            .map(e => e.position)
            .filter(p => ['C', 'LW', 'RW', 'D', 'G', 'Util'].includes(p));
        }
      }
      player.yahooRank = start + i + 1;

      if (p[1] && p[1].player_stats && p[1].player_stats.stats) {
        for (const s of p[1].player_stats.stats) {
          player.stats[s.stat.stat_id] = parseFloat(s.stat.value) || 0;
        }
      }

      players.push(player);
    }
  }

  return players;
}

// ── Stat Definitions ────────────────────────────────────────

// Comprehensive Yahoo Fantasy Hockey stat_id -> abbreviation mapping
const YAHOO_STATS = {
  '0': { abbr: 'GP', name: 'Games Played', position: 'any' },
  '1': { abbr: 'G', name: 'Goals', position: 'skater' },
  '2': { abbr: 'A', name: 'Assists', position: 'skater' },
  '3': { abbr: 'P', name: 'Points', position: 'skater' },
  '4': { abbr: '+/-', name: 'Plus/Minus', position: 'skater' },
  '8': { abbr: 'PPP', name: 'Powerplay Points', position: 'skater' },
  '11': { abbr: 'SHP', name: 'Shorthanded Points', position: 'skater' },
  '14': { abbr: 'SOG', name: 'Shots on Goal', position: 'skater' },
  '16': { abbr: 'FW', name: 'Faceoffs Won', position: 'skater' },
  '31': { abbr: 'HIT', name: 'Hits', position: 'skater' },
  '32': { abbr: 'BLK', name: 'Blocks', position: 'skater' },
  '19': { abbr: 'W', name: 'Wins', position: 'goalie' },
  '22': { abbr: 'GA', name: 'Goals Against', position: 'goalie' },
  '23': { abbr: 'GAA', name: 'Goals Against Average', position: 'goalie' },
  '24': { abbr: 'SA', name: 'Shots Against', position: 'goalie' },
  '25': { abbr: 'SV', name: 'Saves', position: 'goalie' },
  '26': { abbr: 'SV%', name: 'Save Percentage', position: 'goalie' },
  '27': { abbr: 'SHO', name: 'Shutouts', position: 'goalie' },
};

// Stats where lower is better (for category gap calculations)
const LOWER_IS_BETTER = new Set(['22', '23']); // GA, GAA

// Convenience aliases
const STAT_IDS = { G: '1', A: '2', P: '3', SOG: '14', HIT: '31', BLK: '32', W: '19', GA: '22', GAA: '23', SV: '25', SVP: '26', GP: '0' };

// ── League Stat Weights ─────────────────────────────────────

// Default per-game weights for H2H categories leagues (used when no matchup data)
const DEFAULT_SKATER_WEIGHTS = { '1': 3, '2': 2, '3': 0, '4': 0.5, '8': 1.5, '11': 1.5, '14': 0.3, '16': 0.2, '31': 0.3, '32': 0.3 };
const DEFAULT_GOALIE_WEIGHTS = { '19': 5, '22': -1, '23': 0, '25': 0.1, '26': 0, '27': 3 };

/**
 * Extract stat weights from league settings.
 * - Points leagues: use stat_modifiers directly
 * - Categories leagues: use defaults for scoring stats, 0 for display-only
 * Returns { skaterWeights: { statId: weight }, goalieWeights: { statId: weight }, isPoints: bool, scoringStatIds: Set }
 */
function buildLeagueWeights(settings) {
  const cats = settings.settings.stat_categories.stats;
  const isPoints = settings.meta?.scoring_type === 'headpoint';

  // Identify which stats are scoring (not display-only)
  const scoringStatIds = new Set();
  for (const c of cats) {
    if (c.stat.is_only_display_stat !== '1') {
      scoringStatIds.add(String(c.stat.stat_id));
    }
  }

  const skaterWeights = {};
  const goalieWeights = {};

  if (isPoints && settings.settings.stat_modifiers) {
    // Points league: use actual point values
    for (const sm of settings.settings.stat_modifiers.stats) {
      const statId = String(sm.stat.stat_id);
      const value = parseFloat(sm.stat.value) || 0;
      const info = YAHOO_STATS[statId];
      if (!info) continue;
      if (info.position === 'skater') skaterWeights[statId] = value;
      else if (info.position === 'goalie') goalieWeights[statId] = value;
    }
  } else {
    // Categories league: use defaults for stats this league scores
    for (const statId of scoringStatIds) {
      const info = YAHOO_STATS[statId];
      if (!info) continue;
      if (info.position === 'skater') {
        skaterWeights[statId] = DEFAULT_SKATER_WEIGHTS[statId] || 1;
      } else if (info.position === 'goalie') {
        goalieWeights[statId] = DEFAULT_GOALIE_WEIGHTS[statId] || 1;
      }
    }
  }

  return { skaterWeights, goalieWeights, isPoints, scoringStatIds };
}

// ── Player Quality Scoring ──────────────────────────────────

/**
 * Compute quality score for a skater using league-derived weights.
 */
function skaterQuality(stats, gp, weights) {
  if (!gp || gp <= 0) return 0;
  let score = 0;
  for (const [statId, weight] of Object.entries(weights)) {
    score += (stats[statId] || 0) * weight;
  }
  return score / gp;
}

/**
 * Compute quality score for a goalie using league-derived weights.
 * Rate stats (GAA, SV%) get special handling — they're already per-game.
 */
function goalieQuality(stats, gp, weights) {
  if (!gp || gp <= 0) return 0;
  let score = 0;
  for (const [statId, weight] of Object.entries(weights)) {
    const val = stats[statId] || 0;
    // GAA and SV% are already rate stats — don't divide by GP
    if (statId === '23' || statId === '26') {
      // For GAA: lower is better, so invert (weight should be negative or use bonus)
      // For SV%: higher is better, use bonus above baseline
      if (statId === '26') {
        score += Math.max(0, (val - 0.900)) * 200;
      } else {
        score += Math.max(0, (3.00 - val)) * 2;
      }
    } else {
      score += val * weight;
    }
  }
  return score / gp;
}

function playerQuality(player, leagueWeights) {
  const stats = player.stats || {};
  const gp = stats['0'] || player.gamesPlayed || 0;
  if (player.isGoalie) return goalieQuality(stats, gp, leagueWeights.goalieWeights);
  return skaterQuality(stats, gp, leagueWeights.skaterWeights);
}

async function fetchRosterStats(leagueKey, players, leagueWeights) {
  const activePlayers = players.filter(p => !p.isIR && p.playerKey);
  const keys = activePlayers.map(p => p.playerKey);
  const statMap = new Map();

  for (let i = 0; i < keys.length; i += 25) {
    const batch = keys.slice(i, i + 25);
    const data = await client.get(`/players;player_keys=${batch.join(',')}/stats`);
    const playersData = data.fantasy_content.players;
    for (let j = 0; j < (playersData.count || 0); j++) {
      const p = playersData[j].player;
      let playerKey = '';
      for (const item of p[0]) {
        if (item && item.player_key) playerKey = item.player_key;
      }
      const stats = {};
      if (p[1] && p[1].player_stats && p[1].player_stats.stats) {
        for (const s of p[1].player_stats.stats) {
          stats[s.stat.stat_id] = parseFloat(s.stat.value) || 0;
        }
      }
      statMap.set(playerKey, stats);
    }
  }

  for (const p of players) {
    if (p.isIR) {
      p.stats = {};
      p.quality = 0;
      continue;
    }
    p.stats = statMap.get(p.playerKey) || {};
    p.gamesPlayed = p.stats['0'] || 0;
    p.quality = playerQuality(p, leagueWeights);
  }
}

// ── Roster Slot Analysis ────────────────────────────────────

function parseRosterPositions(settings) {
  const slots = {};
  const positions = settings.settings.roster_positions;
  for (const rp of positions) {
    const pos = rp.roster_position.position;
    const count = parseInt(rp.roster_position.count);
    if (['C', 'LW', 'RW', 'D', 'Util', 'G'].includes(pos)) {
      slots[pos] = count;
    }
  }
  return slots;
}

function getMaxWeeklyAdds(settings) {
  const s = settings.settings;
  if (s.max_weekly_adds) return parseInt(s.max_weekly_adds);
  return Infinity; // no weekly limit
}

function assignSlots(playingPlayers, rosterSlots) {
  const skaters = playingPlayers.filter(p => !p.isGoalie);
  const goalies = playingPlayers.filter(p => p.isGoalie);

  const assigned = new Map();
  const filled = {};
  const empty = {};

  const gSlots = rosterSlots['G'] || 0;
  goalies.sort((a, b) => (b.quality || 0) - (a.quality || 0));
  const assignedGoalies = goalies.slice(0, gSlots);
  assignedGoalies.forEach(g => assigned.set(g.playerKey, 'G'));
  filled['G'] = assignedGoalies.length;
  empty['G'] = Math.max(0, gSlots - assignedGoalies.length);

  const skaterPool = [...skaters].sort((a, b) => (b.quality || 0) - (a.quality || 0));

  for (const pos of ['D', 'C', 'LW', 'RW']) {
    const slotsAvail = rosterSlots[pos] || 0;
    const eligible = skaterPool
      .filter(p => !assigned.has(p.playerKey) && p.playingPositions.includes(pos))
      .sort((a, b) => a.playingPositions.length - b.playingPositions.length);

    let count = 0;
    for (const p of eligible) {
      if (count >= slotsAvail) break;
      assigned.set(p.playerKey, pos);
      count++;
    }
    filled[pos] = count;
    empty[pos] = Math.max(0, slotsAvail - count);
  }

  const utilSlots = rosterSlots['Util'] || 0;
  const unassignedSkaters = skaterPool.filter(p => !assigned.has(p.playerKey));
  let utilFilled = 0;
  for (const p of unassignedSkaters) {
    if (utilFilled >= utilSlots) break;
    assigned.set(p.playerKey, 'Util');
    utilFilled++;
  }
  filled['Util'] = utilFilled;
  empty['Util'] = Math.max(0, utilSlots - utilFilled);

  const benched = playingPlayers.filter(p => !assigned.has(p.playerKey));
  const totalEmpty = Object.values(empty).reduce((a, b) => a + b, 0);
  const totalFilled = Object.values(filled).reduce((a, b) => a + b, 0);

  return { assigned, filled, empty, benched, totalEmpty, totalFilled };
}

// ── Day Analysis ────────────────────────────────────────────

function analyzeDays(rosterPlayers, weekSchedule, teamGameDays, rosterSlots) {
  const days = [];
  const dates = [...weekSchedule.keys()].sort();
  const gameCounts = dates.map(d => weekSchedule.get(d).numberOfGames);
  const medianGames = gameCounts.sort((a, b) => a - b)[Math.floor(gameCounts.length / 2)];

  for (const date of [...weekSchedule.keys()].sort()) {
    const dayInfo = weekSchedule.get(date);
    const playingPlayers = rosterPlayers.filter(p =>
      p.nhlTeam && dayInfo.teams.has(p.nhlTeam) && !p.isIR
      && (!p.availableFrom || date >= p.availableFrom)
    );

    const { assigned, filled, empty, benched, totalEmpty, totalFilled } = assignSlots(playingPlayers, rosterSlots);
    const isPast = date < today();

    days.push({
      date,
      dayAbbrev: dayInfo.dayAbbrev,
      numberOfGames: dayInfo.numberOfGames,
      isOffNight: dayInfo.numberOfGames < medianGames,
      isPast,
      playingPlayers,
      filled,
      empty,
      benched,
      totalEmpty,
      totalFilled,
      totalSlots: Object.values(rosterSlots).reduce((a, b) => a + b, 0),
    });
  }

  return days;
}

// ── Matchup & Category Needs ────────────────────────────────

async function fetchMatchupNeeds(teamKey, leagueKey, week, settings, leagueWeights) {
  const scoringType = settings.meta?.scoring_type;
  if (scoringType === 'headpoint') return null;

  try {
    const data = await client.get(`/team/${teamKey}/matchups;weeks=${week}`);
    const matchups = data.fantasy_content.team[1].matchups;
    if (!matchups || matchups.count === 0) return null;

    const matchup = matchups[0].matchup;
    if (!matchup.stat_winners) return null;

    const teams = matchup[0].teams;

    let myStats = {}, oppStats = {};
    for (let i = 0; i < teams.count; i++) {
      const team = teams[i].team;
      let key = '';
      for (const item of team[0]) { if (item && item.team_key) key = item.team_key; }
      const stats = {};
      for (const s of team[1].team_stats.stats) {
        stats[s.stat.stat_id] = parseFloat(s.stat.value) || 0;
      }
      if (key === teamKey) myStats = stats;
      else oppStats = stats;
    }

    const categories = [];
    for (const sw of matchup.stat_winners) {
      const w = sw.stat_winner;
      const statId = String(w.stat_id);
      const info = YAHOO_STATS[statId];
      if (!info) continue;
      // Only track stats this league actually scores
      if (!leagueWeights.scoringStatIds.has(statId)) continue;

      const myVal = myStats[statId] || 0;
      const oppVal = oppStats[statId] || 0;
      const isTied = w.is_tied === '1';
      const amWinning = !isTied && w.winner_team_key === teamKey;

      let gap = 0;
      if (oppVal > 0) {
        gap = LOWER_IS_BETTER.has(statId)
          ? (oppVal - myVal) / oppVal
          : (myVal - oppVal) / oppVal;
      }

      categories.push({
        statId,
        name: info.abbr,
        position: info.position,
        myVal,
        oppVal,
        status: isTied ? 'tied' : amWinning ? 'winning' : 'losing',
        gap,
      });
    }

    return categories;
  } catch (e) {
    return null;
  }
}

/**
 * Build multipliers for league weights based on matchup category needs.
 * Applies to all skater scoring stats in this league, not a hardcoded subset.
 */
function buildCategoryWeights(categoryNeeds, leagueWeights) {
  if (!categoryNeeds) return null;

  const multipliers = {};
  for (const cat of categoryNeeds) {
    // Only adjust skater stats (goalie streaming is separate)
    if (cat.position !== 'skater') continue;
    const statId = cat.statId;
    if (cat.status === 'losing') {
      multipliers[statId] = 2.0 + Math.min(1.0, Math.abs(cat.gap));
    } else if (cat.status === 'tied') {
      multipliers[statId] = 1.5;
    } else {
      multipliers[statId] = cat.gap > 0.3 ? 0.5 : 1.0;
    }
  }
  return multipliers;
}

/**
 * Compute quality score with category-weighted adjustments.
 * Uses the league's own stat weights, multiplied by matchup need.
 */
function weightedQuality(stats, gp, leagueWeights, categoryMultipliers) {
  if (!gp || gp <= 0) return 0;
  let score = 0;
  for (const [statId, weight] of Object.entries(leagueWeights.skaterWeights)) {
    const multiplier = (categoryMultipliers && categoryMultipliers[statId]) || 1;
    score += (stats[statId] || 0) * weight * multiplier;
  }
  return score / gp;
}

// ── Streamer Scoring ────────────────────────────────────────

function isBangerLeague(leagueWeights) {
  return leagueWeights.scoringStatIds.has('31') || leagueWeights.scoringStatIds.has('32');
}

/**
 * Scoring-focused quality: emphasize goals, assists, SOG.
 * Uses league weights but boosts pure scoring stats.
 */
function scoringQualityPerGame(stats, gp, leagueWeights) {
  if (!gp || gp <= 0) return 0;
  const SCORING_BOOST = { '1': 4, '2': 3, '3': 1, '8': 2, '11': 2, '14': 0.4 };
  let score = 0;
  for (const statId of Object.keys(leagueWeights.skaterWeights)) {
    const boost = SCORING_BOOST[statId];
    if (boost) score += (stats[statId] || 0) * boost;
  }
  return score / gp;
}

/**
 * Banger quality: HIT and BLK are king, SOG secondary, scoring minor.
 * Uses raw totals (not per-game) since lastmonth stats lack GP.
 */
function bangerQualityRaw(stats, leagueWeights) {
  const BANGER_WEIGHTS = { '31': 1.5, '32': 1.5, '14': 0.3, '1': 0.5, '2': 0.3 };
  let score = 0;
  for (const statId of Object.keys(leagueWeights.skaterWeights)) {
    const w = BANGER_WEIGHTS[statId];
    if (w) score += (stats[statId] || 0) * w;
  }
  return score;
}

function scoreStreamers(freeAgents, days, teamGameDays, categoryMultipliers, leagueWeights) {
  const futureDays = days.filter(d => !d.isPast && d.totalEmpty > 0);

  const enriched = freeAgents.map(fa => {
    const gameDays = teamGameDays.get(fa.nhlTeam) || [];
    const futureGameDays = gameDays.filter(d => d >= today());
    let scheduleScore = 0;
    const fillsDays = [];

    for (const day of futureDays) {
      if (gameDays.includes(day.date)) {
        const faPositions = fa.eligiblePositions.filter(p => ['C', 'LW', 'RW', 'D', 'G'].includes(p));
        const fillsSlot = faPositions.some(p => (day.empty[p] || 0) > 0) || (day.empty['Util'] || 0) > 0;
        if (fillsSlot) {
          scheduleScore += 3;
          if (day.isOffNight) scheduleScore += 2;
          fillsDays.push(day.date);
        }
      }
    }
    scheduleScore += Math.max(0, futureGameDays.length - 1);

    const gp = fa.stats?.['0'] || fa.gamesPlayed || 0;
    const effectiveGp = gp || 10;

    fa.scoringQuality = scoringQualityPerGame(fa.stats || {}, effectiveGp, leagueWeights);
    fa.bangerQuality = bangerQualityRaw(fa.stats || {}, leagueWeights);

    fa.quality = categoryMultipliers
      ? weightedQuality(fa.stats || {}, effectiveGp, leagueWeights, categoryMultipliers)
      : playerQuality(fa, leagueWeights);

    const scoringBonus = Math.min(10, fa.scoringQuality / 3);
    const bangerBonus = Math.min(10, fa.bangerQuality / 15);
    const overallBonus = Math.min(10, fa.quality / 5);
    const rankBonus = (26 - fa.yahooRank) * 0.01;

    return {
      ...fa,
      gameDays,
      futureGameDays,
      fillsDays,
      scheduleScore,
      scoringScore: scheduleScore + scoringBonus + rankBonus,
      bangerScore: scheduleScore + bangerBonus + rankBonus,
      score: scheduleScore + overallBonus + rankBonus,
      gamesRemaining: futureGameDays.length,
    };
  }).filter(fa => fa.fillsDays.length > 0);

  return enriched.sort((a, b) => b.score - a.score);
}

// ── Drop Candidates ─────────────────────────────────────────

function findDropCandidates(rosterPlayers, teamGameDays, excludeKeys = new Set()) {
  const enriched = rosterPlayers.map(p => {
    const gameDays = teamGameDays.get(p.nhlTeam) || [];
    const futureGames = gameDays.filter(d => d >= today());
    return { ...p, futureGames, gamesRemaining: futureGames.length };
  });

  enriched.sort((a, b) => (a.quality || 0) - (b.quality || 0));

  const skaters = enriched.filter(p => !p.isGoalie && !p.isIR && !excludeKeys.has(p.playerKey));
  const cutoff = Math.ceil(skaters.length * 0.25);
  const bottomTier = skaters.slice(0, cutoff);

  return bottomTier;
}

// ── Multi-Wave Streaming Plan ───────────────────────────────

function buildStreamingPlan(scoredStreamers, days, addsRemaining, rosterSlots) {
  const futureDays = days.filter(d => !d.isPast);
  if (futureDays.length === 0 || addsRemaining === 0) return null;

  // Cap effective adds for planning — unlimited leagues still need a practical limit
  const totalEmptySlots = futureDays.reduce((sum, d) => sum + d.totalEmpty, 0);
  const effectiveAdds = Math.min(addsRemaining, totalEmptySlots, 14); // at most 2 per day

  const futureDates = futureDays.map(d => d.date);

  const strategies = [];

  strategies.push({
    label: 'Full week',
    waves: [{ dates: futureDates, adds: effectiveAdds }],
  });

  for (let splitIdx = 1; splitIdx < futureDates.length - 1; splitIdx++) {
    const wave1Dates = futureDates.slice(0, splitIdx);
    const wave2Dates = futureDates.slice(splitIdx);
    const wave1Adds = Math.floor(effectiveAdds / 2);
    const wave2Adds = effectiveAdds - wave1Adds;
    if (wave1Adds > 0 && wave2Adds > 0) {
      strategies.push({
        label: `2 waves (${formatDate(wave1Dates[0])}–${formatDate(wave1Dates[wave1Dates.length - 1])} → ${formatDate(wave2Dates[0])}–${formatDate(wave2Dates[wave2Dates.length - 1])})`,
        waves: [
          { dates: wave1Dates, adds: wave1Adds },
          { dates: wave2Dates, adds: wave2Adds },
        ],
      });
    }
  }

  if (effectiveAdds >= 3 && futureDates.length >= 3) {
    for (let s1 = 1; s1 < futureDates.length - 1; s1++) {
      for (let s2 = s1 + 1; s2 < futureDates.length; s2++) {
        const w1 = futureDates.slice(0, s1);
        const w2 = futureDates.slice(s1, s2);
        const w3 = futureDates.slice(s2);
        const a1 = Math.floor(effectiveAdds / 3);
        const a2 = Math.floor(effectiveAdds / 3);
        const a3 = effectiveAdds - a1 - a2;
        if (a1 > 0 && a2 > 0 && a3 > 0) {
          strategies.push({
            label: `3 waves`,
            waves: [
              { dates: w1, adds: a1 },
              { dates: w2, adds: a2 },
              { dates: w3, adds: a3 },
            ],
          });
        }
      }
    }
  }

  let bestStrategy = null;
  let bestScore = -1;

  for (const strategy of strategies) {
    let totalGames = 0;
    const coveredDays = new Set();
    const wavePlans = [];

    for (const wave of strategy.waves) {
      const waveStreamers = scoredStreamers
        .map(s => {
          const waveGameDays = s.fillsDays.filter(d => wave.dates.includes(d));
          return { ...s, waveGameDays, waveGames: waveGameDays.length };
        })
        .filter(s => s.waveGames > 0);

      const picked = [];
      const usedKeys = new Set(wavePlans.flatMap(wp => wp.map(p => p.playerKey)));
      const pickedPositions = {};

      while (picked.length < wave.adds) {
        let bestCandidate = null;
        let bestCandidateScore = -Infinity;

        for (const s of waveStreamers) {
          if (usedKeys.has(s.playerKey)) continue;

          const newDays = s.waveGameDays.filter(d => !coveredDays.has(d)).length;

          const positions = s.playingPositions || s.eligiblePositions.filter(p => ['C', 'LW', 'RW', 'D'].includes(p));
          const positionNeed = positions.some(p => !pickedPositions[p]) ? 2 : 0;

          const candidateScore = s.waveGames * 3 + newDays * 2 + positionNeed + s.score * 0.1;

          if (candidateScore > bestCandidateScore) {
            bestCandidateScore = candidateScore;
            bestCandidate = s;
          }
        }

        if (!bestCandidate) break;
        picked.push(bestCandidate);
        usedKeys.add(bestCandidate.playerKey);
        totalGames += bestCandidate.waveGames;
        bestCandidate.waveGameDays.forEach(d => coveredDays.add(d));

        const positions = bestCandidate.playingPositions || bestCandidate.eligiblePositions.filter(p => ['C', 'LW', 'RW', 'D'].includes(p));
        for (const pos of positions) pickedPositions[pos] = (pickedPositions[pos] || 0) + 1;
      }
      wavePlans.push(picked);
    }

    const coverageBonus = coveredDays.size * 2;
    const combinedScore = totalGames + coverageBonus;
    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestStrategy = { ...strategy, wavePlans, totalGames, coveredDays: coveredDays.size };
    }
  }

  return bestStrategy;
}

// ── Output ──────────────────────────────────────────────────

function printHeader(leagueSettings, teamName, weekDates, addsRemaining, maxAdds, addsUsed) {
  const leagueName = leagueSettings.meta?.name || leagueKey;
  const startDate = weekDates[0];
  const endDate = weekDates[weekDates.length - 1];
  const addsInfo = maxAdds === Infinity
    ? `Adds: ${addsUsed} used (no weekly limit)`
    : `Adds: ${addsRemaining} of ${maxAdds} remaining`;
  console.log(`\nHockey Streaming Optimizer — ${leagueName}`);
  console.log(`${formatDate(startDate)} – ${formatDate(endDate)} | Team: ${teamName} | ${addsInfo}\n`);
}

function printProjectedAdds(players, teamGameDays) {
  console.log('══ PROJECTED ADDS ════════════════════════════════════════════');
  for (const p of players) {
    const gameDayStrs = (p.futureGameDays || []).map(d => formatDate(d).split(' ')[0]).join('/');
    const availNote = p.availableFrom ? ` (from ${formatDate(p.availableFrom)})` : '';
    console.log(`  + ${p.name} (${p.nhlTeam}) ${p.displayPosition} — ${p.gamesRemaining} games (${gameDayStrs})${availNote}`);
  }
  console.log();
}

function printMatchupStatus(categoryNeeds) {
  const winning = categoryNeeds.filter(c => c.status === 'winning');
  const losing = categoryNeeds.filter(c => c.status === 'losing');
  const tied = categoryNeeds.filter(c => c.status === 'tied');

  console.log('══ MATCHUP STATUS ════════════════════════════════════════════');

  const formatCat = (c) => {
    const arrow = c.status === 'winning' ? '✓' : c.status === 'losing' ? '✗' : '~';
    return `${arrow} ${c.name.padEnd(4)} ${String(c.myVal).padStart(6)} vs ${String(c.oppVal).padStart(6)}`;
  };

  for (const c of categoryNeeds) {
    console.log(`  ${formatCat(c)}`);
  }

  const score = `${winning.length}-${losing.length}` + (tied.length ? `-${tied.length}` : '');
  console.log(`\n  Score: ${score} | Target cats: ${losing.map(c => c.name).join(', ') || 'none'}`);
  console.log();
}

function printWeeklyOverview(days) {
  console.log('══ WEEKLY OVERVIEW ═══════════════════════════════════════════');
  console.log('Day          Games  Playing  Slots  Empty  Bench  Note');
  console.log('─────────────────────────────────────────────────────────────');
  for (const day of days) {
    const pastMark = day.isPast ? ' (past)' : '';
    const offNight = day.isOffNight && !day.isPast ? '★ OFF NIGHT' : '';
    const benchNote = day.benched.length > 0 ? `${day.benched.length} benched` : '';
    const note = [offNight, benchNote, pastMark.trim()].filter(Boolean).join(', ');
    console.log(
      `${formatDate(day.date).padEnd(12)} ${String(day.numberOfGames).padStart(5)}  ${String(day.playingPlayers.length).padStart(7)}  ${String(day.totalSlots).padStart(5)}  ${String(day.totalEmpty).padStart(5)}  ${String(day.benched.length).padStart(5)}  ${note}`
    );
  }
  console.log();
}

function printStreamingRecommendations(days, scoredStreamers, isBanger) {
  const futureDays = days.filter(d => !d.isPast && d.totalEmpty > 0);
  if (futureDays.length === 0) {
    console.log('══ STREAMING RECOMMENDATIONS ═════════════════════════════════');
    console.log('  No empty slots on remaining days — roster is fully loaded!\n');
    return;
  }

  if (isBanger) {
    printStreamerTable('SCORING TARGETS', futureDays, scoredStreamers, 'scoringScore',
      (s) => {
        const stats = s.stats || {};
        const g = stats[STAT_IDS.G] || 0;
        const a = stats[STAT_IDS.A] || 0;
        const p = stats[STAT_IDS.P] || 0;
        const sog = stats[STAT_IDS.SOG] || 0;
        if (g === 0 && a === 0) return '';
        return `Last 30d: ${g}G ${a}A ${p}P, ${sog} SOG`;
      });
    const bangerStreamers = scoredStreamers.filter(s => {
      const stats = s.stats || {};
      return ((stats[STAT_IDS.HIT] || 0) + (stats[STAT_IDS.BLK] || 0)) >= 15;
    });
    printStreamerTable('BANGER TARGETS', futureDays, bangerStreamers, 'bangerScore',
      (s) => {
        const stats = s.stats || {};
        const hit = stats[STAT_IDS.HIT] || 0;
        const blk = stats[STAT_IDS.BLK] || 0;
        const sog = stats[STAT_IDS.SOG] || 0;
        if (hit === 0 && blk === 0) return '';
        return `Last 30d: ${hit} HIT, ${blk} BLK, ${sog} SOG`;
      });
  } else {
    printStreamerTable('STREAMING RECOMMENDATIONS', futureDays, scoredStreamers, 'score',
      (s) => formatStatLine(s));
  }
}

function printStreamerTable(title, futureDays, scoredStreamers, sortKey, statFormatter) {
  console.log(`══ ${title} ${'═'.repeat(Math.max(0, 57 - title.length))}`);
  for (const day of futureDays) {
    const offTag = day.isOffNight ? ' (OFF NIGHT) ★' : '';
    console.log(`${formatDate(day.date)} — ${day.totalEmpty} empty${offTag}`);

    const emptyPositions = Object.entries(day.empty).filter(([, v]) => v > 0).map(([k]) => k);
    console.log(`  Need: ${emptyPositions.join(', ')}`);

    const dayStreamers = scoredStreamers
      .filter(s => s.fillsDays.includes(day.date))
      .sort((a, b) => b[sortKey] - a[sortKey])
      .slice(0, 5);

    if (dayStreamers.length === 0) {
      console.log('  No matching free agents found');
    } else {
      for (const s of dayStreamers) {
        const gameDayStrs = s.futureGameDays.map(d => formatDate(d).split(' ')[0]).join('/');
        const goalieNote = s.eligiblePositions.includes('G') ? ' ⚠ goalie risk' : '';
        const statLine = statFormatter(s);
        console.log(`  ${s.displayPosition.padEnd(5)} ${s.name} (${s.nhlTeam}) — ${s.gamesRemaining} games (${gameDayStrs})${goalieNote}`);
        if (statLine) console.log(`        ${statLine}`);
      }
    }
    console.log();
  }
}

// ── Dual-Threat Flagging ──────────────────────────────────

function printDualThreats(scoredStreamers) {
  const scoringSorted = [...scoredStreamers].sort((a, b) => b.scoringScore - a.scoringScore);
  const realBangers = scoredStreamers.filter(s => {
    const stats = s.stats || {};
    return ((stats[STAT_IDS.HIT] || 0) + (stats[STAT_IDS.BLK] || 0)) >= 15;
  });
  const bangerSorted = [...realBangers].sort((a, b) => b.bangerScore - a.bangerScore);

  const topScoringKeys = new Set(scoringSorted.slice(0, 15).map(s => s.playerKey));
  const topBangerKeys = new Set(bangerSorted.slice(0, 15).map(s => s.playerKey));

  const dualThreats = scoredStreamers.filter(s =>
    topScoringKeys.has(s.playerKey) && topBangerKeys.has(s.playerKey)
  ).sort((a, b) => (b.scoringScore + b.bangerScore) - (a.scoringScore + a.bangerScore));

  if (dualThreats.length === 0) return;

  console.log('══ DUAL-THREAT STREAMERS ═════════════════════════════════════');
  console.log('  (Top 15 in BOTH scoring and banger rankings)\n');
  for (const s of dualThreats) {
    const dayStrs = s.fillsDays.map(d => formatDate(d).split(' ')[0]).join('/');
    const stats = s.stats || {};
    const g = stats[STAT_IDS.G] || 0, a = stats[STAT_IDS.A] || 0, p = stats[STAT_IDS.P] || 0;
    const hit = stats[STAT_IDS.HIT] || 0, blk = stats[STAT_IDS.BLK] || 0, sog = stats[STAT_IDS.SOG] || 0;
    console.log(`  ${s.displayPosition.padEnd(5)} ${s.name} (${s.nhlTeam}) — ${s.fillsDays.length} games (${dayStrs})`);
    console.log(`        Last 30d: ${g}G ${a}A ${p}P, ${sog} SOG | ${hit} HIT, ${blk} BLK`);
  }
  console.log();
}

// ── Consolidated Top Streamers ────────────────────────────

function printTopStreamers(scoredStreamers, isBanger) {
  console.log('══ TOP STREAMERS (consolidated) ══════════════════════════════');
  if (scoredStreamers.length === 0) {
    console.log('  No matching streamers found\n');
    return;
  }

  if (isBanger) {
    console.log('  ── Scoring ──');
    const scoringSorted = [...scoredStreamers].sort((a, b) => b.scoringScore - a.scoringScore).slice(0, 10);
    for (const s of scoringSorted) {
      const dayStrs = s.fillsDays.map(d => formatDate(d).split(' ')[0]).join('/');
      const stats = s.stats || {};
      const g = stats[STAT_IDS.G] || 0, a = stats[STAT_IDS.A] || 0, p = stats[STAT_IDS.P] || 0, sog = stats[STAT_IDS.SOG] || 0;
      const statLine = g || a ? `${g}G ${a}A ${p}P, ${sog} SOG` : '';
      console.log(`  ${s.displayPosition.padEnd(5)} ${s.name} (${s.nhlTeam}) — ${s.fillsDays.length} games (${dayStrs})${statLine ? ' | ' + statLine : ''}`);
    }

    console.log('\n  ── Banger ──');
    const bangerFiltered = scoredStreamers.filter(s => {
      const stats = s.stats || {};
      return ((stats[STAT_IDS.HIT] || 0) + (stats[STAT_IDS.BLK] || 0)) >= 15;
    });
    const bangerSorted = [...bangerFiltered].sort((a, b) => b.bangerScore - a.bangerScore).slice(0, 10);
    for (const s of bangerSorted) {
      const dayStrs = s.fillsDays.map(d => formatDate(d).split(' ')[0]).join('/');
      const stats = s.stats || {};
      const hit = stats[STAT_IDS.HIT] || 0, blk = stats[STAT_IDS.BLK] || 0, sog = stats[STAT_IDS.SOG] || 0;
      const statLine = hit || blk ? `${hit} HIT, ${blk} BLK, ${sog} SOG` : '';
      console.log(`  ${s.displayPosition.padEnd(5)} ${s.name} (${s.nhlTeam}) — ${s.fillsDays.length} games (${dayStrs})${statLine ? ' | ' + statLine : ''}`);
    }
  } else {
    const sorted = [...scoredStreamers].sort((a, b) => b.score - a.score).slice(0, 10);
    for (const s of sorted) {
      const dayStrs = s.fillsDays.map(d => formatDate(d).split(' ')[0]).join('/');
      console.log(`  ${s.displayPosition.padEnd(5)} ${s.name} (${s.nhlTeam}) — ${s.fillsDays.length} games (${dayStrs}) | ${formatStatLine(s)}`);
    }
  }
  console.log();
}

// ── Before/After Diff ─────────────────────────────────

function printBeforeAfterDiff(beforeDays, afterDays) {
  console.log('══ BEFORE / AFTER ADDS ═══════════════════════════════════════');
  console.log('Day          Empty(before) → Empty(after)  Change');
  console.log('─────────────────────────────────────────────────────────────');
  let totalBefore = 0, totalAfter = 0;
  for (let i = 0; i < afterDays.length; i++) {
    const before = beforeDays[i];
    const after = afterDays[i];
    if (before.isPast) continue;
    totalBefore += before.totalEmpty;
    totalAfter += after.totalEmpty;
    const diff = after.totalEmpty - before.totalEmpty;
    const diffStr = diff < 0 ? `${diff}` : diff === 0 ? ' 0' : `+${diff}`;
    console.log(`${formatDate(after.date).padEnd(12)} ${String(before.totalEmpty).padStart(12)} → ${String(after.totalEmpty).padStart(11)}  ${diffStr}`);
  }
  const totalDiff = totalAfter - totalBefore;
  const totalDiffStr = totalDiff < 0 ? `${totalDiff}` : totalDiff === 0 ? ' 0' : `+${totalDiff}`;
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`${'Total'.padEnd(12)} ${String(totalBefore).padStart(12)} → ${String(totalAfter).padStart(11)}  ${totalDiffStr}`);
  console.log();
}

// ── Remaining Gap Analysis ────────────────────────────

function printRemainingGaps(plan, days, scoredStreamers) {
  if (!plan) return;

  const futureDays = days.filter(d => !d.isPast);
  const allPicked = plan.wavePlans.flat();
  const pickedKeys = new Set(allPicked.map(p => p.playerKey));

  const gapDays = [];
  for (const day of futureDays) {
    const planFills = allPicked.filter(p =>
      (p.waveGameDays || p.fillsDays).includes(day.date)
    ).length;
    const remainingEmpty = Math.max(0, day.totalEmpty - planFills);
    if (remainingEmpty > 0) {
      const emptyPositions = Object.entries(day.empty).filter(([, v]) => v > 0).map(([k]) => k);
      gapDays.push({ date: day.date, remainingEmpty, emptyPositions, isOffNight: day.isOffNight });
    }
  }

  console.log('══ REMAINING GAPS ════════════════════════════════════════════');
  if (gapDays.length === 0) {
    console.log('  Plan fills all remaining gaps!\n');
    return;
  }

  for (const g of gapDays) {
    const offTag = g.isOffNight ? ' ★' : '';
    console.log(`  ${formatDate(g.date)} — ${g.remainingEmpty} empty (${g.emptyPositions.join(', ')})${offTag}`);
  }

  const gapDateSet = new Set(gapDays.map(g => g.date));
  const gapTargets = scoredStreamers
    .filter(s => !pickedKeys.has(s.playerKey) && s.fillsDays.some(d => gapDateSet.has(d)))
    .sort((a, b) => {
      const aGapGames = a.fillsDays.filter(d => gapDateSet.has(d)).length;
      const bGapGames = b.fillsDays.filter(d => gapDateSet.has(d)).length;
      return bGapGames - aGapGames || b.score - a.score;
    })
    .slice(0, 3);

  if (gapTargets.length > 0) {
    console.log('\n  Best remaining targets for gaps:');
    for (const s of gapTargets) {
      const gapGameDays = s.fillsDays.filter(d => gapDateSet.has(d));
      const dayStrs = gapGameDays.map(d => formatDate(d).split(' ')[0]).join('/');
      console.log(`  ${s.displayPosition.padEnd(5)} ${s.name} (${s.nhlTeam}) — covers ${gapGameDays.length} gap days (${dayStrs})`);
    }
  }
  console.log();
}

function printDropCandidates(candidates) {
  console.log('══ DROP CANDIDATES (lowest value on roster) ═══════════════════');
  if (candidates.length === 0) {
    console.log('  No obvious drop candidates\n');
    return;
  }
  for (const p of candidates) {
    const gamesInfo = `${p.gamesRemaining} games left`;
    const statLine = formatStatLine(p, true);
    console.log(`  ${p.name} (${p.nhlTeam}) ${p.displayPosition} — ${gamesInfo} | Season: ${statLine || 'n/a'}`);
  }
  console.log();
}

function printStreamingPlan(plan, addsRemaining) {
  const addsLabel = addsRemaining === Infinity ? 'unlimited' : `${addsRemaining}`;
  console.log(`══ SUGGESTED STREAMING PLAN (${addsLabel} adds) ══════════════════════════`);
  if (!plan) {
    console.log('  No streaming plan possible (no adds remaining or no empty slots)\n');
    return;
  }

  console.log(`  Strategy: ${plan.label} — ${plan.totalGames} games gained\n`);

  for (let w = 0; w < plan.waves.length; w++) {
    const wave = plan.waves[w];
    const picked = plan.wavePlans[w];
    const dateRange = `${formatDate(wave.dates[0])} – ${formatDate(wave.dates[wave.dates.length - 1])}`;

    if (plan.waves.length > 1) {
      const dropNote = w > 0 ? ' — drop wave ' + w + ' players first' : '';
      console.log(`  WAVE ${w + 1}: ${dateRange} (${wave.adds} adds)${dropNote}`);
    }

    for (const s of picked) {
      const waveGameDays = s.waveGameDays || s.fillsDays.filter(d => wave.dates.includes(d));
      const dayStrs = waveGameDays.map(d => formatDate(d).split(' ')[0]).join('/');
      const hotStreak = s.quality >= 15 ? ' 🔥' : '';
      console.log(`    Add ${s.name} (${s.nhlTeam}) ${s.displayPosition} — plays ${dayStrs} (${waveGameDays.length} games)${hotStreak}`);
    }
    console.log();
  }
}

// ── Main ────────────────────────────────────────────────────

async function run(config, cliArgs) {
  // Initialize module-level auth and client
  auth = new YahooAuth({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tokenFile: config.tokenFile,
    certsDir: config.certsDir,
  });
  client = new YahooClient(auth);

  if (!auth.isAuthenticated()) {
    console.error('Not authenticated. Run: stream auth');
    process.exit(1);
  }

  // Parse CLI args
  const parsed = parseArgs(cliArgs);
  leagueKey = parsed.leagueKey || config.defaultLeague;
  if (!leagueKey) {
    console.error('No league specified. Pass a league key or run: stream setup');
    process.exit(1);
  }

  let { targetDate, addsUsed, addsUsedExplicit, includeGoalies, projectedAdds } = parsed;

  console.log('Loading league settings...');
  const settings = await loadLeagueSettings(leagueKey);
  const rosterSlots = parseRosterPositions(settings);
  if (!includeGoalies) delete rosterSlots['G'];
  const maxAdds = getMaxWeeklyAdds(settings);
  const leagueWeights = buildLeagueWeights(settings);

  let monday;
  const todayStr = today();
  if (!targetDate) {
    monday = getMondayOfWeek(todayStr);
  } else if (targetDate.type === 'next') {
    const thisMon = getMondayOfWeek(todayStr);
    monday = addDays(thisMon, 7);
  } else if (targetDate.type === 'date') {
    monday = getMondayOfWeek(targetDate.value);
  } else if (targetDate.type === 'week') {
    const startDate = settings.meta?.start_date;
    if (startDate) {
      const startMonday = getMondayOfWeek(startDate);
      monday = addDays(startMonday, (targetDate.value - 1) * 7);
    } else {
      monday = getMondayOfWeek(todayStr);
    }
  }

  console.log('Finding your team...');
  const { teamKey, teamName, weekAdds } = await findMyTeamKey(leagueKey);

  // Determine adds used: CLI flag > API detection > 0 for future weeks
  const isCurrentWeekTarget = getMondayOfWeek(todayStr) === monday;
  if (addsUsedExplicit) {
    // User explicitly set --adds-used, trust it
  } else if (isCurrentWeekTarget) {
    // Auto-detect from Yahoo API
    addsUsed = weekAdds;
  } else {
    addsUsed = 0;
  }
  let addsRemaining = maxAdds === Infinity ? Infinity : maxAdds - addsUsed;

  console.log('Fetching NHL schedule...');
  const { weekSchedule, teamGameDays } = await fetchNHLSchedule(monday);
  const weekDates = [...weekSchedule.keys()].sort();

  console.log('Fetching your roster...');
  const rosterPlayers = await fetchMyRoster(teamKey);

  console.log('Fetching player stats...');
  await fetchRosterStats(leagueKey, rosterPlayers, leagueWeights);

  for (const p of rosterPlayers) {
    p.gameDays = teamGameDays.get(p.nhlTeam) || [];
    p.futureGameDays = p.gameDays.filter(d => d >= todayStr);
    p.gamesRemaining = p.futureGameDays.length;
  }

  const prelimDays = analyzeDays(rosterPlayers, weekSchedule, teamGameDays, rosterSlots);
  const neededPositions = new Set();
  for (const day of prelimDays) {
    if (day.isPast) continue;
    for (const [pos, count] of Object.entries(day.empty)) {
      if (count > 0) {
        if (pos === 'Util') {
          neededPositions.add('C');
          neededPositions.add('LW');
          neededPositions.add('RW');
          neededPositions.add('D');
        } else {
          neededPositions.add(pos);
        }
      }
    }
  }

  const banger = isBangerLeague(leagueWeights);
  const faPages = banger ? 3 : 1;
  console.log(`Fetching free agents (${[...neededPositions].join(', ')})...`);
  const allFreeAgents = [];
  const seenKeys = new Set();
  for (const pos of neededPositions) {
    const fas = await fetchFreeAgents(leagueKey, pos, faPages);
    for (const fa of fas) {
      if (!seenKeys.has(fa.playerKey)) {
        seenKeys.add(fa.playerKey);
        allFreeAgents.push(fa);
      }
    }
  }

  for (const fa of allFreeAgents) {
    fa.gameDays = teamGameDays.get(fa.nhlTeam) || [];
    fa.futureGameDays = fa.gameDays.filter(d => d >= todayStr);
    fa.gamesRemaining = fa.futureGameDays.length;
  }

  const projectedAddPlayers = [];
  if (projectedAdds.length > 0) {
    console.log('Applying projected adds...');
    for (const addSpec of projectedAdds) {
      const needle = addSpec.searchName.toLowerCase();
      const matches = allFreeAgents.filter(fa =>
        fa.name.toLowerCase().includes(needle)
      );
      if (matches.length > 1) {
        console.log(`  ✗ "${addSpec.searchName}" matches multiple players:`);
        for (const m of matches.slice(0, 8)) {
          console.log(`      ${m.name} (${m.nhlTeam}) ${m.displayPosition}`);
        }
        console.log(`    Be more specific, e.g. --add "${matches[0].name.split(' ').pop()}"`);
        continue;
      }
      const match = matches[0];
      if (match) {
        match.isGoalie = match.eligiblePositions.includes('G') && !match.eligiblePositions.some(p => ['C', 'LW', 'RW', 'D'].includes(p));
        match.playingPositions = match.eligiblePositions.filter(p => ['C', 'LW', 'RW', 'D', 'G'].includes(p));
        match.isIR = false;
        match.selectedPosition = null;
        match.stats = match.stats || {};
        match.quality = playerQuality(match, leagueWeights);

        if (addSpec.startDay) {
          match.availableFrom = resolveDayToDate(addSpec.startDay, weekDates);
          if (match.availableFrom) {
            match.futureGameDays = match.gameDays.filter(d => d >= match.availableFrom);
            match.gamesRemaining = match.futureGameDays.length;
          }
        }

        rosterPlayers.push(match);
        projectedAddPlayers.push(match);
        addsUsed++;
        const availNote = match.availableFrom ? ` (from ${formatDate(match.availableFrom)})` : '';
        console.log(`  + ${match.name} (${match.nhlTeam}) ${match.displayPosition} — ${match.gamesRemaining} games${availNote}`);
      } else {
        console.log(`  ✗ "${addSpec.searchName}" not found in free agent pool`);
      }
    }
    const addedKeys = new Set(projectedAddPlayers.map(p => p.playerKey));
    for (let i = allFreeAgents.length - 1; i >= 0; i--) {
      if (addedKeys.has(allFreeAgents[i].playerKey)) allFreeAgents.splice(i, 1);
    }
    addsRemaining = maxAdds - addsUsed;
  }

  const days = analyzeDays(rosterPlayers, weekSchedule, teamGameDays, rosterSlots);

  // current_week must come from the live API — cached settings go stale
  let categoryNeeds = null;
  let categoryWeights = null;
  const leagueMeta = await client.get(`/league/${leagueKey}/metadata`);
  const currentWeek = leagueMeta.fantasy_content.league[0].current_week;
  const isCurrentWeek = getMondayOfWeek(todayStr) === monday;
  if (currentWeek && isCurrentWeek) {
    console.log('Fetching matchup data...');
    categoryNeeds = await fetchMatchupNeeds(teamKey, leagueKey, currentWeek, settings, leagueWeights);
    categoryWeights = buildCategoryWeights(categoryNeeds, leagueWeights);
  }

  const scoredStreamers = scoreStreamers(allFreeAgents, days, teamGameDays, categoryWeights, leagueWeights);

  const addedKeys = new Set(projectedAddPlayers.map(p => p.playerKey));
  const dropCandidates = findDropCandidates(rosterPlayers, teamGameDays, addedKeys);

  const plan = buildStreamingPlan(scoredStreamers, days, addsRemaining, rosterSlots);

  console.log('');
  printHeader(settings, teamName, weekDates, addsRemaining, maxAdds, addsUsed);
  if (projectedAddPlayers.length > 0) {
    printProjectedAdds(projectedAddPlayers, teamGameDays);
    printBeforeAfterDiff(prelimDays, days);
  }
  if (categoryNeeds) printMatchupStatus(categoryNeeds);
  printWeeklyOverview(days);
  if (banger) printDualThreats(scoredStreamers);
  printTopStreamers(scoredStreamers, banger);
  printStreamingRecommendations(days, scoredStreamers, banger);
  printDropCandidates(dropCandidates);
  printStreamingPlan(plan, addsRemaining);
  printRemainingGaps(plan, days, scoredStreamers);
}

module.exports = { run };
