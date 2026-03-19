const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { _internals: { assignSlots, analyzeDays, parseRosterPositions, getMaxWeeklyAdds } } = require('../lib/stream');

function makePlayer(overrides) {
  return {
    playerKey: `465.p.${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Player',
    nhlTeam: 'TOR',
    displayPosition: 'C',
    eligiblePositions: ['C'],
    playingPositions: ['C'],
    isGoalie: false,
    isIR: false,
    quality: 5,
    stats: {},
    ...overrides,
  };
}

const standardSlots = { C: 2, LW: 2, RW: 2, D: 4, Util: 1 };

describe('assignSlots', () => {
  it('fills slots when players match positions', () => {
    const players = [
      makePlayer({ playingPositions: ['C'], quality: 10 }),
      makePlayer({ playingPositions: ['C'], quality: 8 }),
      makePlayer({ playingPositions: ['LW'], quality: 7 }),
    ];
    const result = assignSlots(players, standardSlots);
    assert.equal(result.filled['C'], 2);
    assert.equal(result.filled['LW'], 1);
    assert.equal(result.totalFilled, 3);
    assert.equal(result.benched.length, 0);
  });

  it('reports empty slots when not enough players', () => {
    const players = [makePlayer({ playingPositions: ['C'], quality: 10 })];
    const result = assignSlots(players, standardSlots);
    assert.equal(result.filled['C'], 1);
    assert.equal(result.empty['C'], 1);
    assert.equal(result.empty['LW'], 2);
    assert.equal(result.empty['D'], 4);
    assert.equal(result.totalEmpty, 1 + 2 + 2 + 4 + 1); // C:1, LW:2, RW:2, D:4, Util:1
  });

  it('assigns multi-position player to most constrained slot', () => {
    // One D-only player, one C/D player, 1 D slot, 1 C slot
    const dOnly = makePlayer({ playingPositions: ['D'], quality: 5 });
    const cd = makePlayer({ playingPositions: ['C', 'D'], quality: 8 });
    const result = assignSlots([dOnly, cd], { C: 1, D: 1 });
    // D-only should get D slot (more constrained), C/D should get C
    assert.equal(result.filled['D'], 1);
    assert.equal(result.filled['C'], 1);
    assert.equal(result.benched.length, 0);
  });

  it('puts overflow players on bench', () => {
    const players = [
      makePlayer({ playingPositions: ['C'], quality: 10 }),
      makePlayer({ playingPositions: ['C'], quality: 8 }),
      makePlayer({ playingPositions: ['C'], quality: 6 }),
    ];
    const result = assignSlots(players, { C: 1, Util: 1 });
    assert.equal(result.filled['C'], 1);
    assert.equal(result.filled['Util'], 1);
    assert.equal(result.benched.length, 1);
    // Lowest quality should be benched
    assert.equal(result.benched[0].quality, 6);
  });

  it('assigns goalies to G slots', () => {
    const g1 = makePlayer({ playingPositions: ['G'], isGoalie: true, quality: 15 });
    const g2 = makePlayer({ playingPositions: ['G'], isGoalie: true, quality: 10 });
    const g3 = makePlayer({ playingPositions: ['G'], isGoalie: true, quality: 5 });
    const result = assignSlots([g1, g2, g3], { G: 2 });
    assert.equal(result.filled['G'], 2);
    assert.equal(result.benched.length, 1);
    assert.equal(result.benched[0].quality, 5);
  });

  it('handles empty roster', () => {
    const result = assignSlots([], standardSlots);
    assert.equal(result.totalFilled, 0);
    assert.equal(result.totalEmpty, 11); // 2+2+2+4+1
    assert.equal(result.benched.length, 0);
  });
});

describe('parseRosterPositions', () => {
  it('extracts roster slot counts', () => {
    const settings = {
      settings: {
        roster_positions: [
          { roster_position: { position: 'C', count: '2' } },
          { roster_position: { position: 'LW', count: '2' } },
          { roster_position: { position: 'RW', count: '2' } },
          { roster_position: { position: 'D', count: '4' } },
          { roster_position: { position: 'Util', count: '1' } },
          { roster_position: { position: 'G', count: '2' } },
          { roster_position: { position: 'BN', count: '4' } },
          { roster_position: { position: 'IR+', count: '2' } },
        ],
      },
    };
    const slots = parseRosterPositions(settings);
    assert.equal(slots['C'], 2);
    assert.equal(slots['D'], 4);
    assert.equal(slots['G'], 2);
    assert.equal(slots['Util'], 1);
    assert.ok(!slots['BN'], 'BN should not be included');
    assert.ok(!slots['IR+'], 'IR+ should not be included');
  });
});

describe('getMaxWeeklyAdds', () => {
  it('returns the configured limit', () => {
    assert.equal(getMaxWeeklyAdds({ settings: { max_weekly_adds: '6' } }), 6);
    assert.equal(getMaxWeeklyAdds({ settings: { max_weekly_adds: '4' } }), 4);
  });

  it('returns Infinity when no limit set', () => {
    assert.equal(getMaxWeeklyAdds({ settings: {} }), Infinity);
  });
});
