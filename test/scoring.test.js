const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { _internals: { skaterQuality, goalieQuality, playerQuality, buildLeagueWeights } } = require('../lib/stream');

// Reuse fixtures
const catsBangerSettings = {
  meta: { scoring_type: 'head' },
  settings: {
    stat_categories: {
      stats: [
        { stat: { stat_id: 1, display_name: 'G', is_only_display_stat: '0' } },
        { stat: { stat_id: 2, display_name: 'A', is_only_display_stat: '0' } },
        { stat: { stat_id: 14, display_name: 'SOG', is_only_display_stat: '0' } },
        { stat: { stat_id: 31, display_name: 'HIT', is_only_display_stat: '0' } },
        { stat: { stat_id: 32, display_name: 'BLK', is_only_display_stat: '0' } },
        { stat: { stat_id: 19, display_name: 'W', is_only_display_stat: '0' } },
        { stat: { stat_id: 23, display_name: 'GAA', is_only_display_stat: '0' } },
        { stat: { stat_id: 26, display_name: 'SV%', is_only_display_stat: '0' } },
      ],
    },
  },
};

const pointsSettings = {
  meta: { scoring_type: 'headpoint' },
  settings: {
    stat_categories: {
      stats: [
        { stat: { stat_id: 1, display_name: 'G', is_only_display_stat: '0' } },
        { stat: { stat_id: 2, display_name: 'A', is_only_display_stat: '0' } },
        { stat: { stat_id: 14, display_name: 'SOG', is_only_display_stat: '0' } },
        { stat: { stat_id: 31, display_name: 'HIT', is_only_display_stat: '0' } },
        { stat: { stat_id: 32, display_name: 'BLK', is_only_display_stat: '0' } },
      ],
    },
    stat_modifiers: {
      stats: [
        { stat: { stat_id: '1', value: '4.5' } },
        { stat: { stat_id: '2', value: '3' } },
        { stat: { stat_id: '14', value: '0.5' } },
        { stat: { stat_id: '31', value: '0.25' } },
        { stat: { stat_id: '32', value: '0.5' } },
      ],
    },
  },
};

describe('skaterQuality', () => {
  it('returns 0 for 0 GP', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    assert.equal(skaterQuality({ '1': 10, '2': 5 }, 0, w.skaterWeights), 0);
  });

  it('computes per-game weighted score', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    // 10 goals * 3 + 5 assists * 2 + 50 SOG * 0.3 = 30 + 10 + 15 = 55 / 20 GP = 2.75
    const stats = { '1': 10, '2': 5, '14': 50, '31': 0, '32': 0 };
    const q = skaterQuality(stats, 20, w.skaterWeights);
    assert.equal(q, 2.75);
  });

  it('uses points league weights when configured', () => {
    const w = buildLeagueWeights(pointsSettings);
    // 10 goals * 4.5 + 5 assists * 3 + 50 SOG * 0.5 = 45 + 15 + 25 = 85 / 20 GP = 4.25
    const stats = { '1': 10, '2': 5, '14': 50, '31': 0, '32': 0 };
    const q = skaterQuality(stats, 20, w.skaterWeights);
    assert.equal(q, 4.25);
  });
});

describe('goalieQuality', () => {
  it('returns 0 for 0 GP', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    assert.equal(goalieQuality({ '19': 10 }, 0, w.goalieWeights), 0);
  });

  it('gives SV% bonus above .900', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    const stats = { '19': 10, '23': 2.50, '26': 0.920 };
    const q = goalieQuality(stats, 20, w.goalieWeights);
    // Should include bonus for .920 SV% and 2.50 GAA
    assert.ok(q > 0, 'quality should be positive');
  });
});

describe('playerQuality', () => {
  it('routes skater to skaterQuality', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    const player = { isGoalie: false, stats: { '0': 20, '1': 10, '2': 5 }, gamesPlayed: 20 };
    const q = playerQuality(player, w);
    assert.ok(q > 0);
  });

  it('routes goalie to goalieQuality', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    const player = { isGoalie: true, stats: { '0': 20, '19': 10, '23': 2.50, '26': 0.920 }, gamesPlayed: 20 };
    const q = playerQuality(player, w);
    assert.ok(q > 0);
  });

  it('returns 0 for IR player with empty stats', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    const player = { isGoalie: false, stats: {}, gamesPlayed: 0 };
    assert.equal(playerQuality(player, w), 0);
  });
});
