import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_STRATEGY_BUILDER } from '@/lib/features';
import { expiryAllowed, WEEKLY_EXPIRY_ERROR } from '@/lib/expiryAccess';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rateLimit';
import { resolveLimit } from '@/lib/rateLimitConfig';
import { getFallbackQuote, getOptionChainSnapshots, getSnapshotsMulti, type OptionSnapshot } from '@/lib/marketdata';
import { etDateOf, getMarketState } from '@/lib/marketSession';
import { buildQuote } from '@/lib/quote';
import { parseOcc } from '@/lib/occ';
import { enabledStrategyIds } from '@/lib/strategySettings';
import type { ChainRow, OptionChain, OptQuote } from '@/lib/payoff/chain';

export const dynamic = 'force-dynamic';

// Live option chain for one expiry, for the stock page's Strategy Builder
// (docs/strategy-builder.md). Pro feature `strategy_builder`, rate limited
// (`option_chain`, admin-editable). The client loads it once per expiry and
// only re-requests on "Refresh quotes"; the 15 s cache absorbs double clicks.
// Response is vendor-neutral: strikes with call/put bid, ask, mid, last, IV,
// greeks and volume, plus the underlying's spot.

const LIMITER = 'option_chain';
const CACHE_MS = 15_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const cache = new Map<string, { at: number; data: OptionChain }>();
// Index weeklies are listed under their own underlying (verified 2026-10-28: SPX returns nothing for
// the 10-30 weekly, SPXW returns 974 contracts), so an empty index chain is retried under this root.
const WEEKLY_ROOT: Record<string, string> = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW', VIX: 'VIXW' };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toQuote(s: OptionSnapshot): OptQuote {
  const bid = num(s.latestQuote?.bp), ask = num(s.latestQuote?.ap);
  const last = num(s.latestTrade?.p) ?? num(s.dailyBar?.c);
  const mid = ask !== null && ask > 0 && bid !== null && bid >= 0 && ask >= bid
    ? Math.round(((bid + ask) / 2) * 10000) / 10000
    : last;
  return {
    bid, ask, mid, last,
    iv: num(s.impliedVolatility),
    delta: num(s.greeks?.delta), gamma: num(s.greeks?.gamma), theta: num(s.greeks?.theta), vega: num(s.greeks?.vega),
    vol: num(s.dailyBar?.v),
  };
}

/** Underlying price: the session-aware regular price (live when open, else last close); fallback feed for indices. */
async function spotOf(symbol: string): Promise<number | null> {
  const [snaps, market] = await Promise.all([getSnapshotsMulti([symbol]), getMarketState()]);
  const q = buildQuote(snaps[symbol], market);
  if (q.price !== null && q.price > 0) return q.price;
  try {
    const fq = await getFallbackQuote(symbol);
    const p = Number(fq?.last ?? fq?.close);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

async function loadChain(symbol: string, expiry: string): Promise<OptionChain | null> {
  const range = { expiryFrom: expiry, expiryTo: expiry, maxPages: 5 };
  const [first, spot] = await Promise.all([getOptionChainSnapshots(symbol, range), spotOf(symbol)]);
  const snaps = !Object.keys(first).length && WEEKLY_ROOT[symbol] ? await getOptionChainSnapshots(WEEKLY_ROOT[symbol], range) : first;
  if (!spot) return null;
  // Group by OCC root: SPX lists SPX (monthly, AM-settled) and SPXW (weekly/PM) for the same date.
  const byRoot = new Map<string, Map<number, ChainRow>>();
  for (const [occ, snap] of Object.entries(snaps)) {
    const o = parseOcc(occ);
    if (!o || o.expiry !== expiry) continue;
    let rows = byRoot.get(o.root);
    if (!rows) byRoot.set(o.root, (rows = new Map()));
    const row = rows.get(o.strike) ?? { strike: o.strike };
    row[o.optType] = toQuote(snap);
    rows.set(o.strike, row);
  }
  if (!byRoot.size) return null;
  const [root, rows] = [...byRoot.entries()].sort((a, b) => b[1].size - a[1].size || (a[0] === symbol ? -1 : 1))[0];
  return {
    symbol, root, expiry, spot,
    asOf: new Date().toISOString(),
    rows: [...rows.values()].sort((a, b) => a.strike - b.strike),
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_STRATEGY_BUILDER);
  if (blocked) return blocked;

  const symbol = (await params).symbol.toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return NextResponse.json({ success: false, error: 'Invalid symbol' }, { status: 400 });
  const expiry = request.nextUrl.searchParams.get('expiry') ?? '';
  if (!YMD.test(expiry)) return NextResponse.json({ success: false, error: 'expiry must be YYYY-MM-DD' }, { status: 400 });
  if (expiry < etDateOf(Date.now())) {
    return NextResponse.json({ success: false, error: 'Expired', message: 'Live quotes exist only for expiries that have not passed.' }, { status: 400 });
  }
  if (!expiryAllowed(ctx.features, expiry)) return NextResponse.json(WEEKLY_EXPIRY_ERROR, { status: 403 });

  const { limit: cap, windowSeconds } = await resolveLimit(LIMITER, false);
  const limit = await checkRateLimit(LIMITER, `user:${ctx.userId}`, cap, windowSeconds);
  if (!limit.allowed) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded', message: 'Too many quote refreshes, wait a minute.' },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  try {
    const key = `${symbol}|${expiry}`;
    const hit = cache.get(key);
    let chain = hit && Date.now() - hit.at < CACHE_MS ? hit.data : null;
    if (!chain) {
      chain = await loadChain(symbol, expiry);
      if (chain) {
        if (cache.size > 300) cache.clear();
        cache.set(key, { at: Date.now(), data: chain });
      }
    }
    const enabledStrategies = await enabledStrategyIds();
    if (!chain) {
      return NextResponse.json({ success: true, data: null, enabledStrategies, message: `No live option chain for ${symbol} on ${expiry}.` });
    }
    return NextResponse.json({ success: true, data: chain, enabledStrategies }, { headers: rateLimitHeaders(limit) });
  } catch (error) {
    console.error('Error loading option chain:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'Failed to load the option chain' }, { status: 500 });
  }
}
