const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { _internals: { parseArgs } } = require('../lib/stream');

describe('parseArgs', () => {
  // Helper: simulate argv with node + script prefix
  const parse = (...args) => parseArgs(['node', 'stream.js', ...args]);

  it('returns defaults with no args', () => {
    const result = parse();
    assert.equal(result.leagueKey, null);
    assert.equal(result.targetDate, null);
    assert.equal(result.addsUsed, 0);
    assert.equal(result.addsUsedExplicit, false);
    assert.equal(result.includeGoalies, false);
    assert.equal(result.noMatchup, false);
    assert.equal(result.manualBoosts, null);
    assert.deepEqual(result.projectedAdds, []);
  });

  it('parses league key', () => {
    const result = parse('465.l.26962');
    assert.equal(result.leagueKey, '465.l.26962');
  });

  it('rejects non-.l. league key patterns', () => {
    const result = parse('465.x.26962');
    assert.equal(result.leagueKey, null);
  });

  it('parses --next', () => {
    const result = parse('--next');
    assert.deepEqual(result.targetDate, { type: 'next' });
  });

  it('parses --week', () => {
    const result = parse('--week', '21');
    assert.deepEqual(result.targetDate, { type: 'week', value: 21 });
  });

  it('parses --date', () => {
    const result = parse('--date', '2026-03-23');
    assert.deepEqual(result.targetDate, { type: 'date', value: '2026-03-23' });
  });

  it('parses --adds-used', () => {
    const result = parse('--adds-used', '3');
    assert.equal(result.addsUsed, 3);
    assert.equal(result.addsUsedExplicit, true);
  });

  it('parses --goalies', () => {
    const result = parse('--goalies');
    assert.equal(result.includeGoalies, true);
  });

  it('parses --no-matchup', () => {
    const result = parse('--no-matchup');
    assert.equal(result.noMatchup, true);
  });

  it('parses --boost', () => {
    const result = parse('--boost', 'HIT,BLK,SOG');
    assert.deepEqual(result.manualBoosts, ['HIT', 'BLK', 'SOG']);
  });

  it('parses --add without day', () => {
    const result = parse('--add', 'Schneider');
    assert.deepEqual(result.projectedAdds, [{ searchName: 'Schneider', startDay: null }]);
  });

  it('parses --add with day suffix', () => {
    const result = parse('--add', 'Schneider:Tue');
    assert.deepEqual(result.projectedAdds, [{ searchName: 'Schneider', startDay: 'Tue' }]);
  });

  it('does not treat non-day suffix as a day', () => {
    const result = parse('--add', 'O\'Brien:Jr');
    assert.deepEqual(result.projectedAdds, [{ searchName: "O'Brien:Jr", startDay: null }]);
  });

  it('parses multiple --add flags', () => {
    const result = parse('--add', 'Schneider:Tue', '--add', 'Benoit');
    assert.equal(result.projectedAdds.length, 2);
    assert.equal(result.projectedAdds[0].searchName, 'Schneider');
    assert.equal(result.projectedAdds[0].startDay, 'Tue');
    assert.equal(result.projectedAdds[1].searchName, 'Benoit');
    assert.equal(result.projectedAdds[1].startDay, null);
  });

  it('handles combined flags', () => {
    const result = parse('465.l.43677', '--next', '--goalies', '--adds-used', '2', '--add', 'Schneider');
    assert.equal(result.leagueKey, '465.l.43677');
    assert.deepEqual(result.targetDate, { type: 'next' });
    assert.equal(result.includeGoalies, true);
    assert.equal(result.addsUsed, 2);
    assert.equal(result.projectedAdds.length, 1);
  });
});
