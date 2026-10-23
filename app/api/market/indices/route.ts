import { NextResponse } from 'next/server';
import { getSnapshotsMulti } from '@/lib/marketdata';
import { getMarketState } from '@/lib/marketSession';
import { buildQuote } from '@/lib/quote';

export const dynamic = 'force-dynamic';

const INDICES = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'DIA', label: 'Dow Jones' },
  { symbol: 'QQQ', label: 'Nasdaq' },
  { symbol: 'GLD', label: 'Gold' },
  { symbol: 'SLV', label: 'Silver' },
  { symbol: 'USO', label: 'US Oil' },
];

// ETF proxies for the header strip. Session-aware via lib/quote.ts: live in the
// regular session, the last regular close and day change after it, plus `ext`
// (pre-market / after-hours move from that close) until the next open. `market`
// lets the strip poll on the real open/close schedule.
export async function GET() {
  const symbols = INDICES.map(i => i.symbol);
  const [snapshots, market] = await Promise.all([getSnapshotsMulti(symbols), getMarketState()]);

  const result = INDICES.map(({ symbol, label }) => {
    const q = buildQuote(snapshots[symbol], market);
    if (q.price === null) return { symbol, label, price: null, change: null, changePercent: null, volume: null, ext: null, date: null };
    return {
      symbol, label,
      price: q.price,
      open: q.dayOpen, high: q.dayHigh, low: q.dayLow,
      volume: q.volume,
      change: q.change,
      changePercent: q.changePercent,
      ext: q.ext,
      date: snapshots[symbol]?.dailyBar?.t?.split('T')[0] ?? null,
    };
  });

  return NextResponse.json(
    { success: true, data: result, market: { session: market.session, nextChangeAt: market.nextChangeAt } },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
