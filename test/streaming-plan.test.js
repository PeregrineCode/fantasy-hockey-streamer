const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { _internals: { buildStreamingPlan, findDropCandidates } } = require('../lib/stream');

function makeDay(date, totalEmpty, isPast = false, empty = {}) {
  return {
    date,
    dayAbbrev: 'Mon',
    numberOfGames: 8,
    isOffNight: false,
    isPast,
    playingPlayers: [],
    filled: {},
    empty: empty || { C: totalEmpty > 0 ? 1 : 0, Util: Math.max(0, totalEmpty - 1) },
    benched: [],
    totalEmpty,
    totalFilled: 11 - totalEmpty,
    totalSlots: 11,
  };
}

function makeStreamer(name, fillsDays, score = 5) {
  return {
    playerKey: `465.p.${name.toLowerCase().replace(/\s/g, '')}`,
    name,
    nhlTeam: 'TOR',
    displayPosition: 'C',
    eligiblePositions: ['C', 'Util'],
    playingPositions: ['C'],
    isGoalie: false,
    stats: {},
    fillsDays,
    futureGameDays: fillsDays,
    gameDays: fillsDays,
    score,
    scoringScore: score,
    bangerScore: score,
    gamesRemaining: fillsDays.length,
    quality: score,
  };
}

describe('buildStreamingPlan', () => {
  it('returns null with 0 adds remaining', () => {
    const days = [makeDay('2026-03-17', 2)];
    const streamers = [makeStreamer('Player A', ['2026-03-17'])];
    assert.equal(buildStreamingPlan(streamers, days, 0, {}), null);
  });

  it('returns null when all days are past', () => {
    const days = [makeDay('2026-03-17', 2, true)];
    const streamers = [makeStreamer('Player A', ['2026-03-17'])];
    assert.equal(buildStreamingPlan(streamers, days, 3, {}), null);
  });

  it('builds a single-wave plan', () => {
    const days = [
      makeDay('2026-03-17', 2),
      makeDay('2026-03-18', 1),
    ];
    const streamers = [
      makeStreamer('Player A', ['2026-03-17', '2026-03-18'], 10),
      makeStreamer('Player B', ['2026-03-17'], 8),
    ];
    const plan = buildStreamingPlan(streamers, days, 2, { C: 2 });
    assert.ok(plan, 'plan should not be null');
    assert.ok(plan.totalGames > 0);
    assert.ok(plan.wavePlans.length >= 1);
    // Should pick at most 2 players
    const totalPicked = plan.wavePlans.reduce((sum, wp) => sum + wp.length, 0);
    assert.ok(totalPicked <= 2);
  });

  it('respects add limit', () => {
    const days = [
      makeDay('2026-03-17', 3),
      makeDay('2026-03-18', 3),
      makeDay('2026-03-19', 3),
    ];
    const streamers = [
      makeStreamer('A', ['2026-03-17', '2026-03-18', '2026-03-19'], 10),
      makeStreamer('B', ['2026-03-17', '2026-03-18'], 9),
      makeStreamer('C', ['2026-03-18', '2026-03-19'], 8),
      makeStreamer('D', ['2026-03-19'], 7),
    ];
    const plan = buildStreamingPlan(streamers, days, 2, { C: 2 });
    const totalPicked = plan.wavePlans.reduce((sum, wp) => sum + wp.length, 0);
    assert.ok(totalPicked <= 2, `should not exceed 2 adds, got ${totalPicked}`);
  });

  it('caps effective adds for unlimited leagues', () => {
    const days = [makeDay('2026-03-17', 2), makeDay('2026-03-18', 1)];
    const streamers = [
      makeStreamer('A', ['2026-03-17', '2026-03-18'], 10),
      makeStreamer('B', ['2026-03-17'], 8),
      makeStreamer('C', ['2026-03-18'], 7),
    ];
    // Infinity adds, but only 3 total empty slots
    const plan = buildStreamingPlan(streamers, days, Infinity, { C: 2 });
    const totalPicked = plan.wavePlans.reduce((sum, wp) => sum + wp.length, 0);
    assert.ok(totalPicked <= 3, `should be capped by empty slots, got ${totalPicked}`);
  });

  it('does not reuse players across waves', () => {
    const days = [
      makeDay('2026-03-17', 2),
      makeDay('2026-03-18', 0),
      makeDay('2026-03-19', 2),
    ];
    const streamers = [
      makeStreamer('A', ['2026-03-17', '2026-03-19'], 10),
      makeStreamer('B', ['2026-03-17'], 8),
      makeStreamer('C', ['2026-03-19'], 7),
    ];
    const plan = buildStreamingPlan(streamers, days, 4, { C: 2 });
    if (plan.wavePlans.length > 1) {
      const allKeys = plan.wavePlans.flatMap(wp => wp.map(p => p.playerKey));
      const uniqueKeys = new Set(allKeys);
      assert.equal(allKeys.length, uniqueKeys.size, 'no player should appear in multiple waves');
    }
  });
});

describe('findDropCandidates', () => {
  function makeRosterPlayer(name, quality, opts = {}) {
    return {
      playerKey: `465.p.${name.toLowerCase()}`,
      name,
      nhlTeam: 'TOR',
      displayPosition: 'C',
      isGoalie: false,
      isIR: false,
      quality,
      stats: {},
      playingPositions: ['C'],
      eligiblePositions: ['C'],
      ...opts,
    };
  }

  // Days where all TOR players play but slots are tight (some get benched)
  function makeDaysForDropTest(players) {
    // Single future day where all TOR players are "playing" but with limited slots
    // We need playingPlayers and benched arrays to match what analyzeDays produces
    const playing = players.filter(p => !p.isIR);
    // Simulate: best quality players start, worst get benched
    const sorted = [...playing].sort((a, b) => (b.quality || 0) - (a.quality || 0));
    const starters = sorted.slice(0, 2); // only 2 slots
    const benchedPlayers = sorted.slice(2);
    return [{
      date: '2099-12-31', isPast: false, numberOfGames: 8, isOffNight: false,
      playingPlayers: playing, benched: benchedPlayers,
      filled: { C: 2 }, empty: { C: 0 }, totalEmpty: 0, totalFilled: 2, totalSlots: 2,
    }];
  }

  const emptyDays = [];

  it('returns players at or below median drop value', () => {
    const players = [
      makeRosterPlayer('Best', 20),
      makeRosterPlayer('Good', 15),
      makeRosterPlayer('Mid', 10),
      makeRosterPlayer('Weak', 5),
    ];
    const teamGameDays = new Map([['TOR', ['2099-12-31']]]);
    const days = makeDaysForDropTest(players);
    const drops = findDropCandidates(players, teamGameDays, days);
    // Weak and Mid are benched (only 2 slots), so dropValue = quality * 0.1
    // Best and Good start, dropValue = quality * 1
    // Median is the 2nd value in sorted order — both benched players should surface
    assert.ok(drops.length >= 2, `expected at least 2 drops, got ${drops.length}`);
    assert.equal(drops[0].name, 'Weak');
    assert.equal(drops[1].name, 'Mid');
  });

  it('ranks benched players as better drop candidates', () => {
    // Higher quality but benched every game vs lower quality but starts
    const benchedStar = makeRosterPlayer('BenchedStar', 12, { nhlTeam: 'MTL' });
    const weakStarter = makeRosterPlayer('WeakStarter', 8, { nhlTeam: 'TOR' });
    const players = [benchedStar, weakStarter];

    const teamGameDays = new Map([
      ['MTL', ['2099-12-31']],
      ['TOR', ['2099-12-31']],
    ]);
    // Day where TOR player starts, MTL player is benched
    const days = [{
      date: '2099-12-31', isPast: false, numberOfGames: 8, isOffNight: false,
      playingPlayers: [benchedStar, weakStarter],
      benched: [benchedStar], // benchedStar doesn't make the lineup
      filled: { C: 1 }, empty: {}, totalEmpty: 0, totalFilled: 1, totalSlots: 1,
    }];

    const drops = findDropCandidates(players, teamGameDays, days);
    // BenchedStar: quality 12 * 0.1 (0 starts) = 1.2
    // WeakStarter: quality 8 * 1 (1 start) = 8
    // BenchedStar should be the better drop candidate (lower dropValue)
    assert.equal(drops[0].name, 'BenchedStar');
    assert.equal(drops[0].starts, 0);
    assert.equal(drops[0].benched, 1);
  });

  it('excludes goalies', () => {
    const players = [
      makeRosterPlayer('Skater', 10),
      makeRosterPlayer('Goalie', 1, { isGoalie: true }),
    ];
    const teamGameDays = new Map([['TOR', []]]);
    const drops = findDropCandidates(players, teamGameDays, emptyDays);
    assert.ok(drops.every(d => !d.isGoalie));
  });

  it('excludes IR players', () => {
    const players = [
      makeRosterPlayer('Active', 10),
      makeRosterPlayer('Injured', 1, { isIR: true }),
    ];
    const teamGameDays = new Map([['TOR', []]]);
    const drops = findDropCandidates(players, teamGameDays, emptyDays);
    assert.ok(drops.every(d => !d.isIR));
  });

  it('excludes specified player keys', () => {
    const players = [
      makeRosterPlayer('Keep', 5),
      makeRosterPlayer('Drop', 3),
    ];
    const teamGameDays = new Map([['TOR', []]]);
    const drops = findDropCandidates(players, teamGameDays, emptyDays, new Set(['465.p.drop']));
    assert.ok(drops.every(d => d.playerKey !== '465.p.drop'));
  });
});
