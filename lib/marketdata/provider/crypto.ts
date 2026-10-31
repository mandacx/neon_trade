/**
 * Crypto provider: Deribit public market data (no key, no account). Server-only, reached through the
 * facade (lib/marketdata/index.ts) as getCryptoTickers / getCryptoBars. Vendor names stay in this file.
 *
 * Every coin is priced from its USDC-margined perpetual (`<COIN>_USDC-PERPETUAL`), including BTC and
 * ETH, so one book-summary request covers every coin's live quote, and the candles and the header
 * price come from the same instrument. The index price (what the levels snapshot's `cmp` tracks) is
 * returned alongside. Daily candles open at 08:00 UTC (Deribit's settlement time).
 */
import type { Bar } from '../types';
import { getOrSet } from '@/lib/ttlCache';
import type { CryptoInterval } from '@/lib/cryptoInstruments';

const BASE = process.env.DERIBIT_API_URL || 'https://www.deribit.com/api/v2';
const TIMEOUT_MS = 6000;

export interface CryptoTicker {
  coin: string;
  /** Last trade on the perpetual. */
  price: number;
  /** Underlying index. */
  index: number | null;
  mark: number | null;
  /** Rolling 24 h. */
  high24h: number | null;
  low24h: number | null;
  changePct24h: number | null;
  volumeUsd24h: number | null;
  /** Epoch ms the quote was read. */
  at: number;
}

// Errors thrown from here can reach a response body, so they never name the vendor.
async function call<T>(method: string, params: Record<string, string | number>): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  let res: Response;
  try {
    res = await fetch(`${BASE}/public/${method}?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    console.error(`crypto provider ${method} failed:`, err instanceof Error ? err.message : err);
    throw new Error('Crypto market data unavailable');
  }
  const body = await res.json().catch(() => null) as { result?: T; error?: { message?: string } } | null;
  if (!res.ok || !body || body.result === undefined) {
    console.error(`crypto provider ${method} HTTP ${res.status}:`, body?.error?.message ?? 'no result');
    throw new Error('Crypto market data unavailable');
  }
  return body.result;
}

const perpetual = (coin: string) => `${coin.toUpperCase()}_USDC-PERPETUAL`;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

interface BookSummaryRow {
  instrument_name: string;
  last?: number;
  mark_price?: number;
  estimated_delivery_price?: number;
  high?: number;
  low?: number;
  price_change?: number;
  volume_usd?: number;
}

/** Live quotes keyed by coin (one upstream request, cached 3 s per instance). Coins without a perpetual are left out. */
export async function getCryptoTickers(coins: string[]): Promise<Record<string, CryptoTicker>> {
  const rows = await getOrSet('crypto:book-summary:usdc-future', 3000, () =>
    call<BookSummaryRow[]>('get_book_summary_by_currency', { currency: 'USDC', kind: 'future' }));
  const byName = new Map(rows.map(r => [r.instrument_name, r]));
  const at = Date.now();
  const out: Record<string, CryptoTicker> = {};
  for (const coin of coins) {
    const r = byName.get(perpetual(coin));
    const price = num(r?.last);
    if (!r || price === null) continue;
    out[coin] = {
      coin,
      price,
      index: num(r.estimated_delivery_price),
      mark: num(r.mark_price),
      high24h: num(r.high),
      low24h: num(r.low),
      changePct24h: num(r.price_change),
      volumeUsd24h: num(r.volume_usd),
      at,
    };
  }
  return out;
}

const RESOLUTION: Record<CryptoInterval, string> = {
  '5min': '5', '15min': '15', '30min': '30', '1hour': '60', daily: '1D',
};

interface ChartData {
  status: string;
  ticks: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

/**
 * Candles for a coin between two instants (epoch ms). Cached per window: 60 s for daily, 15 s for
 * intraday, so the open candle stays current without a request per page view.
 */
export async function getCryptoBars(coin: string, interval: CryptoInterval, fromMs: number, toMs: number): Promise<Bar[]> {
  const ttl = interval === 'daily' ? 60_000 : 15_000;
  // Round the window so viewers opening the same chart share a cache entry.
  const step = interval === 'daily' ? 3_600_000 : 60_000;
  const from = Math.floor(fromMs / step) * step;
  const to = Math.ceil(toMs / step) * step;
  const data = await getOrSet(`crypto:bars:${coin}:${interval}:${from}:${to}`, ttl, () =>
    call<ChartData>('get_tradingview_chart_data', {
      instrument_name: perpetual(coin), resolution: RESOLUTION[interval], start_timestamp: from, end_timestamp: to,
    }));
  if (data.status !== 'ok' || !Array.isArray(data.ticks)) return [];
  return data.ticks.map((t, i) => ({
    t: new Date(t).toISOString(),
    o: data.open[i],
    h: data.high[i],
    l: data.low[i],
    c: data.close[i],
    v: data.volume[i] ?? 0,
  }));
}
