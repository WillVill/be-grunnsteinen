import { fromZonedTime, toZonedTime, format as formatTz } from 'date-fns-tz';

const OSLO_TZ = 'Europe/Oslo';

/**
 * Return the UTC Date that is Oslo-midnight of the day containing `d`.
 */
export function osloDayStart(d: Date): Date {
  const zoned = toZonedTime(d, OSLO_TZ);
  zoned.setHours(0, 0, 0, 0);
  return fromZonedTime(zoned, OSLO_TZ);
}

/**
 * Return the half-open interval [start, end) covering one Oslo day.
 * Handles DST — on 23-hour and 25-hour days the interval length differs.
 */
export function osloDayBounds(d: Date): { start: Date; end: Date } {
  const start = osloDayStart(d);
  const zonedNext = toZonedTime(start, OSLO_TZ);
  zonedNext.setDate(zonedNext.getDate() + 1);
  const end = fromZonedTime(zonedNext, OSLO_TZ);
  return { start, end };
}

/**
 * Format a UTC Date as YYYY-MM-DD in Oslo tz.
 */
export function osloYmd(d: Date): string {
  return formatTz(d, 'yyyy-MM-dd', { timeZone: OSLO_TZ });
}

/**
 * Parse a YYYY-MM-DD string as Oslo-midnight, returning the UTC instant.
 */
export function parseOsloYmd(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error(`Invalid YYYY-MM-DD: ${ymd}`);
  }
  return fromZonedTime(`${ymd}T00:00:00`, OSLO_TZ);
}

/**
 * Enumerate Oslo-midnight Date values for each day in [fromYmd, toYmd] inclusive.
 */
export function enumerateOsloDays(fromYmd: string, toYmd: string): Date[] {
  const start = parseOsloYmd(fromYmd);
  const end = parseOsloYmd(toYmd);
  const days: Date[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor);
    cursor = osloDayBounds(cursor).end;
  }
  return days;
}
