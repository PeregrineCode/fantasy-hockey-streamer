const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { _internals: { buildLeagueWeights, isBangerLeague, buildCategoryWeights, buildManualBoosts, YAHOO_STATS } } = require('../lib/stream');

// Minimal settings fixture for a H2H Categories banger league (like Dad's Hockey)
const catsBangerSettings = {
  meta: { scoring_type: 'head' },
  settings: {
    stat_categories: {
      stats: [
        { stat: { stat_id: 1, display_name: 'G', is_only_display_stat: '0' } },
        { stat: { stat_id: 2, display_name: 'A', is_only_display_stat: '0' } },
        { stat: { stat_id: 3, display_name: 'P', is_only_display_stat: '0' } },
        { stat: { stat_id: 14, display_name: 'SOG', is_only_display_stat: '0' } },
        { stat: { stat_id: 31, display_name: 'HIT', is_only_display_stat: '0' } },
        { stat: { stat_id: 32, display_name: 'BLK', is_only_display_stat: '0' } },
        { stat: { stat_id: 19, display_name: 'W', is_only_display_stat: '0' } },
        { stat: { stat_id: 22, display_name: 'GA', is_only_display_stat: '1' } },
        { stat: { stat_id: 23, display_name: 'GAA', is_only_display_stat: '0' } },
        { stat: { stat_id: 25, display_name: 'SV', is_only_display_stat: '1' } },
        { stat: { stat_id: 26, display_name: 'SV%', is_only_display_stat: '0' } },
      ],
    },
  },
};

// H2H Points league (like KKUPFL)
const pointsSettings = {
  meta: { scoring_type: 'headpoint' },
  settings: {
    stat_categories: {
      stats: [
        { stat: { stat_id: 1, display_name: 'G', is_only_display_stat: '0' } },
        { stat: { stat_id: 2, display_name: 'A', is_only_display_stat: '0' } },
        { stat: { stat_id: 11, display_name: 'SHP', is_only_display_stat: '0' } },
        { stat: { stat_id: 14, display_name: 'SOG', is_only_display_stat: '0' } },
        { stat: { stat_id: 31, display_name: 'HIT', is_only_display_stat: '0' } },
        { stat: { stat_id: 32, display_name: 'BLK', is_only_display_stat: '0' } },
        { stat: { stat_id: 19, display_name: 'W', is_only_display_stat: '0' } },
        { stat: { stat_id: 22, display_name: 'GA', is_only_display_stat: '0' } },
        { stat: { stat_id: 25, display_name: 'SV', is_only_display_stat: '0' } },
        { stat: { stat_id: 27, display_name: 'SHO', is_only_display_stat: '0' } },
      ],
    },
    stat_modifiers: {
      stats: [
        { stat: { stat_id: '1', value: '4.5' } },
        { stat: { stat_id: '2', value: '3' } },
        { stat: { stat_id: '11', value: '2' } },
        { stat: { stat_id: '14', value: '0.5' } },
        { stat: { stat_id: '31', value: '0.25' } },
        { stat: { stat_id: '32', value: '0.5' } },
        { stat: { stat_id: '19', value: '3' } },
        { stat: { stat_id: '22', value: '-1.5' } },
        { stat: { stat_id: '25', value: '0.3' } },
        { stat: { stat_id: '27', value: '3' } },
      ],
    },
  },
};

// Categories league with +/-, PPP, FW, SHO (like This Is The League Name)
const catsExtendedSettings = {
  meta: { scoring_type: 'head' },
  settings: {
    stat_categories: {
      stats: [
        { stat: { stat_id: 1, display_name: 'G', is_only_display_stat: '0' } },
        { stat: { stat_id: 2, display_name: 'A', is_only_display_stat: '0' } },
        { stat: { stat_id: 4, display_name: '+/-', is_only_display_stat: '0' } },
        { stat: { stat_id: 8, display_name: 'PPP', is_only_display_stat: '0' } },
        { stat: { stat_id: 14, display_name: 'SOG', is_only_display_stat: '0' } },
        { stat: { stat_id: 16, display_name: 'FW', is_only_display_stat: '0' } },
        { stat: { stat_id: 31, display_name: 'HIT', is_only_display_stat: '0' } },
        { stat: { stat_id: 32, display_name: 'BLK', is_only_display_stat: '0' } },
        { stat: { stat_id: 19, display_name: 'W', is_only_display_stat: '0' } },
        { stat: { stat_id: 23, display_name: 'GAA', is_only_display_stat: '0' } },
        { stat: { stat_id: 26, display_name: 'SV%', is_only_display_stat: '0' } },
        { stat: { stat_id: 27, display_name: 'SHO', is_only_display_stat: '0' } },
      ],
    },
  },
};

describe('buildLeagueWeights', () => {
  it('builds weights for a categories banger league', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    assert.equal(w.isPoints, false);
    // Skater scoring stats get weights
    assert.ok(w.skaterWeights['1'] > 0, 'G should have weight');
    assert.ok(w.skaterWeights['2'] > 0, 'A should have weight');
    assert.ok(w.skaterWeights['31'] > 0, 'HIT should have weight');
    assert.ok(w.skaterWeights['32'] > 0, 'BLK should have weight');
    // Display-only stats excluded from scoring
    assert.ok(!w.scoringStatIds.has('22'), 'GA should not be scoring');
    assert.ok(!w.scoringStatIds.has('25'), 'SV should not be scoring');
    // Goalie weights present
    assert.ok(w.goalieWeights['19'] > 0, 'W should have weight');
  });

  it('builds weights for a points league from stat_modifiers', () => {
    const w = buildLeagueWeights(pointsSettings);
    assert.equal(w.isPoints, true);
    assert.equal(w.skaterWeights['1'], 4.5);   // G
    assert.equal(w.skaterWeights['2'], 3);      // A
    assert.equal(w.skaterWeights['11'], 2);     // SHP
    assert.equal(w.skaterWeights['14'], 0.5);   // SOG
    assert.equal(w.skaterWeights['31'], 0.25);  // HIT
    assert.equal(w.skaterWeights['32'], 0.5);   // BLK
    assert.equal(w.goalieWeights['19'], 3);     // W
    assert.equal(w.goalieWeights['22'], -1.5);  // GA
    assert.equal(w.goalieWeights['25'], 0.3);   // SV
    assert.equal(w.goalieWeights['27'], 3);     // SHO
  });

  it('includes extended categories like +/-, PPP, FW, SHO', () => {
    const w = buildLeagueWeights(catsExtendedSettings);
    assert.ok(w.skaterWeights['4'] > 0, '+/- should have weight');
    assert.ok(w.skaterWeights['8'] > 0, 'PPP should have weight');
    assert.ok(w.skaterWeights['16'] > 0, 'FW should have weight');
    assert.ok(w.goalieWeights['27'] > 0, 'SHO should have weight');
    assert.ok(w.scoringStatIds.has('4'));
    assert.ok(w.scoringStatIds.has('8'));
    assert.ok(w.scoringStatIds.has('16'));
    assert.ok(w.scoringStatIds.has('27'));
  });
});

describe('isBangerLeague', () => {
  it('returns true when HIT or BLK are scoring stats', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    assert.equal(isBangerLeague(w), true);
  });

  it('returns true for points league with HIT/BLK', () => {
    const w = buildLeagueWeights(pointsSettings);
    assert.equal(isBangerLeague(w), true);
  });
});

describe('buildCategoryWeights', () => {
  it('returns null when no category needs', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    assert.equal(buildCategoryWeights(null, w), null);
  });

  it('boosts losing skater categories', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    const needs = [
      { statId: '31', name: 'HIT', position: 'skater', status: 'losing', gap: -0.3 },
      { statId: '1', name: 'G', position: 'skater', status: 'winning', gap: 0.5 },
      { statId: '19', name: 'W', position: 'goalie', status: 'losing', gap: -0.5 },
    ];
    const multipliers = buildCategoryWeights(needs, w);
    assert.ok(multipliers['31'] >= 2.0, 'HIT losing should be boosted');
    assert.ok(multipliers['1'] < 1.0, 'G winning big should be reduced');
    assert.ok(!multipliers['19'], 'goalie stats should not be in multipliers');
  });

  it('uses 1.5x for tied categories', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    const needs = [
      { statId: '14', name: 'SOG', position: 'skater', status: 'tied', gap: 0 },
    ];
    const multipliers = buildCategoryWeights(needs, w);
    assert.equal(multipliers['14'], 1.5);
  });
});

describe('buildManualBoosts', () => {
  it('boosts known scoring stats at 2.5x', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    const multipliers = buildManualBoosts(['HIT', 'BLK'], w);
    assert.equal(multipliers['31'], 2.5);
    assert.equal(multipliers['32'], 2.5);
  });

  it('returns null for empty valid boosts', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    const multipliers = buildManualBoosts(['FAKE'], w);
    assert.equal(multipliers, null);
  });

  it('ignores stats not scored in the league', () => {
    const w = buildLeagueWeights(catsBangerSettings);
    // +/- (stat 4) is not in Dad's Hockey League
    const multipliers = buildManualBoosts(['HIT', '+/-'], w);
    assert.equal(multipliers['31'], 2.5);
    assert.ok(!multipliers['4'], '+/- should be skipped');
  });

  it('handles extended stat names', () => {
    const w = buildLeagueWeights(catsExtendedSettings);
    const multipliers = buildManualBoosts(['PPP', 'FW'], w);
    assert.equal(multipliers['8'], 2.5);
    assert.equal(multipliers['16'], 2.5);
  });
});
