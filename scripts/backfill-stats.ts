/**
 * Backfill daily stats snapshots for a date range.
 *
 * Usage:
 *   yarn ts-node scripts/backfill-stats.ts --from 2024-01-01 --to 2026-04-18
 *
 * Idempotent — re-runs overwrite existing rows via the same upsert path.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { StatsService } from '../src/modules/stats/stats.service';
import { parseOsloYmd, osloDayBounds, osloYmd } from '../src/modules/stats/util/oslo-date';

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const eqArg = process.argv.find((a) => a.startsWith(prefix));
  if (eqArg) return eqArg.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

async function main() {
  const fromYmd = parseArg('from');
  const toYmd = parseArg('to');
  if (!fromYmd || !toYmd) {
    console.error('Usage: --from YYYY-MM-DD --to YYYY-MM-DD');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const stats = app.get(StatsService);

  let cursor = parseOsloYmd(fromYmd);
  const end = parseOsloYmd(toYmd);
  let total = 0;
  while (cursor.getTime() <= end.getTime()) {
    const label = osloYmd(cursor);
    process.stdout.write(`Snapshotting ${label}… `);
    const { written } = await stats.runDailySnapshot(cursor);
    total += written;
    console.log(`wrote ${written} rows`);
    cursor = osloDayBounds(cursor).end;
  }

  console.log(`\nDone. ${total} total row-writes across range.`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
