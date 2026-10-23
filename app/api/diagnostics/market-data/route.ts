import { NextResponse } from 'next/server';
import { getHistoricalBars, getSnapshotsMulti, hasKeys, searchSymbols } from '@/lib/marketdata';

export const dynamic = 'force-dynamic';

/**
 * Connectivity check for the market-data sources (used by /diagnostics). Public, so it reports only
 * pass/fail and counts: no keys or key prefixes, hosts, vendor names or raw vendor payloads.
 */
export async function GET() {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const check = async <T,>(fn: () => Promise<T>, ok: (v: T) => boolean, count: (v: T) => number) => {
    const t0 = Date.now();
    try {
      const v = await fn();
      return { ok: ok(v), count: count(v), ms: Date.now() - t0 };
    } catch {
      return { ok: false, count: 0, ms: Date.now() - t0 };
    }
  };

  const [quotes, dailyBars, symbolSearch] = await Promise.all([
    check(() => getSnapshotsMulti(['AAPL']), v => !!v.AAPL, v => Object.keys(v).length),
    check(() => getHistoricalBars('AAPL', '1Day', start, end), v => v.length > 0, v => v.length),
    check(() => searchSymbols('AAPL'), v => v.length > 0, v => v.length),
  ]);
  const success = quotes.ok && dailyBars.ok && symbolSearch.ok;
  return NextResponse.json(
    { success, data: { configured: hasKeys(), checks: { quotes, dailyBars, symbolSearch } } },
    { status: success ? 200 : 503 },
  );
}
