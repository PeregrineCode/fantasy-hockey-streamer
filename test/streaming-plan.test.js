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
      ...opts,
    };
  }

  it('returns bottom 25% of roster by quality', () => {
    const players = [
      makeRosterPlayer('Best', 20),
      makeRosterPlayer('Good', 15),
      makeRosterPlayer('Mid', 10),
      makeRosterPlayer('Weak', 5),
    ];
    const teamGameDays = new Map([['TOR', ['2026-03-17']]]);
    const drops = findDropCandidates(players, teamGameDays);
    assert.equal(drops.length, 1); // ceil(4 * 0.25) = 1
    assert.equal(drops[0].name, 'Weak');
  });

  it('excludes goalies', () => {
    const players = [
      makeRosterPlayer('Skater', 10),
      makeRosterPlayer('Goalie', 1, { isGoalie: true }),
    ];
    const teamGameDays = new Map([['TOR', []]]);
    const drops = findDropCandidates(players, teamGameDays);
    assert.ok(drops.every(d => !d.isGoalie));
  });

  it('excludes IR players', () => {
    const players = [
      makeRosterPlayer('Active', 10),
      makeRosterPlayer('Injured', 1, { isIR: true }),
    ];
    const teamGameDays = new Map([['TOR', []]]);
    const drops = findDropCandidates(players, teamGameDays);
    assert.ok(drops.every(d => !d.isIR));
  });

  it('excludes specified player keys', () => {
    const players = [
      makeRosterPlayer('Keep', 5),
      makeRosterPlayer('Drop', 3),
    ];
    const teamGameDays = new Map([['TOR', []]]);
    const drops = findDropCandidates(players, teamGameDays, new Set(['465.p.drop']));
    assert.ok(drops.every(d => d.playerKey !== '465.p.drop'));
  });
});
