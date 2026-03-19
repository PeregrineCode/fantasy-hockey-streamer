const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { _internals: { getMondayOfWeek, addDays, formatDate, normalizeTeam, resolveDayToDate } } = require('../lib/stream');

describe('getMondayOfWeek', () => {
  it('returns Monday for a Monday', () => {
    assert.equal(getMondayOfWeek('2026-03-16'), '2026-03-16'); // Monday
  });

  it('returns Monday for a Wednesday', () => {
    assert.equal(getMondayOfWeek('2026-03-18'), '2026-03-16');
  });

  it('returns Monday for a Sunday', () => {
    assert.equal(getMondayOfWeek('2026-03-22'), '2026-03-16');
  });

  it('returns Monday for a Saturday', () => {
    assert.equal(getMondayOfWeek('2026-03-21'), '2026-03-16');
  });
});

describe('addDays', () => {
  it('adds positive days', () => {
    assert.equal(addDays('2026-03-16', 3), '2026-03-19');
  });

  it('adds 7 days for next week', () => {
    assert.equal(addDays('2026-03-16', 7), '2026-03-23');
  });

  it('handles month boundary', () => {
    assert.equal(addDays('2026-03-30', 3), '2026-04-02');
  });
});

describe('formatDate', () => {
  it('formats a Monday', () => {
    assert.equal(formatDate('2026-03-16'), 'Mon 3/16');
  });

  it('formats a Sunday', () => {
    assert.equal(formatDate('2026-03-22'), 'Sun 3/22');
  });
});

describe('normalizeTeam', () => {
  it('maps Yahoo abbreviations to NHL', () => {
    assert.equal(normalizeTeam('LA'), 'LAK');
    assert.equal(normalizeTeam('NJ'), 'NJD');
    assert.equal(normalizeTeam('SJ'), 'SJS');
    assert.equal(normalizeTeam('TB'), 'TBL');
  });

  it('passes through matching abbreviations', () => {
    assert.equal(normalizeTeam('TOR'), 'TOR');
    assert.equal(normalizeTeam('NYR'), 'NYR');
    assert.equal(normalizeTeam('BOS'), 'BOS');
  });
});

describe('resolveDayToDate', () => {
  const weekDates = ['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20', '2026-03-21', '2026-03-22'];

  it('resolves Mon to Monday', () => {
    assert.equal(resolveDayToDate('Mon', weekDates), '2026-03-16');
  });

  it('resolves Fri to Friday', () => {
    assert.equal(resolveDayToDate('Fri', weekDates), '2026-03-20');
  });

  it('is case insensitive', () => {
    assert.equal(resolveDayToDate('tue', weekDates), '2026-03-17');
    assert.equal(resolveDayToDate('TUE', weekDates), '2026-03-17');
  });

  it('returns null for invalid day', () => {
    assert.equal(resolveDayToDate('Xyz', weekDates), null);
  });
});
