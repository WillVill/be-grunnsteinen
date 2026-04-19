import { osloDayStart, osloDayBounds, osloYmd, parseOsloYmd } from './oslo-date';

describe('oslo-date', () => {
  describe('osloDayStart', () => {
    it('returns UTC instant of Oslo-midnight (winter/CET)', () => {
      // 2026-01-15 15:00 Oslo (CET, UTC+1) — midnight Oslo = 2026-01-14T23:00:00Z
      const mid = new Date('2026-01-15T14:00:00Z');
      expect(osloDayStart(mid).toISOString()).toBe('2026-01-14T23:00:00.000Z');
    });

    it('returns UTC instant of Oslo-midnight (summer/CEST)', () => {
      // 2026-07-15 12:00 Oslo (CEST, UTC+2) — midnight Oslo = 2026-07-14T22:00:00Z
      const mid = new Date('2026-07-15T10:00:00Z');
      expect(osloDayStart(mid).toISOString()).toBe('2026-07-14T22:00:00.000Z');
    });
  });

  describe('osloDayBounds', () => {
    it('returns [start, start+24h) across DST spring-forward', () => {
      // DST starts in Oslo on 2026-03-29. The day 2026-03-29 is only 23 hours long.
      const day = parseOsloYmd('2026-03-29');
      const { start, end } = osloDayBounds(day);
      expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
      expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    });
  });

  describe('osloYmd', () => {
    it('formats a UTC Date as YYYY-MM-DD in Oslo tz', () => {
      // 2026-04-19T23:30:00Z is 2026-04-20 01:30 Oslo
      expect(osloYmd(new Date('2026-04-19T23:30:00Z'))).toBe('2026-04-20');
    });
  });

  describe('parseOsloYmd', () => {
    it('parses YYYY-MM-DD as Oslo-midnight UTC', () => {
      expect(parseOsloYmd('2026-04-18').toISOString()).toBe('2026-04-17T22:00:00.000Z');
    });
  });
});
