import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { FEATURE_OPTION_CHAIN, FEATURE_STRATEGY_BUILDER, hasFeature } from '@/lib/features';
import { expiryAllowed, WEEKLY_EXPIRY_ERROR } from '@/lib/expiryAccess';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rateLimit';
import { resolveLimit } from '@/lib/rateLimitConfig';
import { getFallbackQuote, getOptionChainContracts, getOptionChainSnapshots, type OptionChainContract, type OptionSnapshot } from '@/lib/marketdata';
import { getSnapshotsWithIndices } from '@/lib/snapshots';
import { etDateOf, getMarketState } from '@/lib/marketSession';
import { buildQuote } from '@/lib/quote';
import { parseOcc } from '@/lib/occ';
import { enabledStrategyIds } from '@/lib/strategySettings';
import type { ChainRow, OptionChain, OptQuote } from '@/lib/payoff/chain';

export const dynamic = 'force-dynamic';

// Live option chain for one expiry, for the stock page's Strategy Builder
// (docs/strategy-builder.md) or the plain chain. Pro feature `strategy_builder`
// or `option_chain` (chain only, no strategy templates), rate limited
// (`option_chain`, admin-editable). The client loads it once per expiry and
// only re-requests on "Refresh quotes"; the 15 s cache absorbs double clicks.
// Response is vendor-neutral: strikes with call/put bid, ask, mid, last, IV,
// greeks, volume and open interest (the previous session's close; the source gives no date), plus the
// underlying's spot. The chain comes from one request per expiry; if that returns nothing, quote
// snapshots are used instead (no open interest).

const LIMITER = 'option_chain';
const CACHE_MS = 15_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const cache = new Map<string, { at: number; data: OptionChain }>();
// Backup source only: its snapshots list index weeklies under their own underlying (verified 2026-10-28:
// SPX returns nothing for the 10-30 weekly, SPXW returns 974 contracts), so an empty index chain is retried
// under this root. The live chain needs no retry (SPX 10-30 returns 974 SPXW contracts, verified 2026-10-29).
const WEEKLY_ROOT: Record<string, string> = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW', VIX: 'VIXW' };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Mid of a valid two-sided quote, else the last trade. */
function midOf(bid: number | null, ask: number | null, last: number | null): number | null {
  return ask !== null && ask > 0 && bid !== null && bid >= 0 && ask >= bid ? Math.round(((bid + ask) / 2) * 10000) / 10000 : last;
}

interface Leg { root: string; optType: 'call' | 'put'; strike: number; q: OptQuote }

/** Primary source: the live chain (quote, greeks and open interest in one request per expiry). */
function fromContracts(list: OptionChainContract[]): Leg[] {
  return list.map(c => ({
    root: c.root, optType: c.optType, strike: c.strike,
    q: { bid: c.bid, ask: c.ask, mid: midOf(c.bid, c.ask, c.last), last: c.last, iv: c.iv, delta: c.delta, gamma: c.gamma, theta: c.theta, vega: c.vega, vol: c.volume, oi: c.openInterest },
  }));
}

/** Backup source when the live chain has nothing: quote snapshots (no open interest). */
function fromSnapshots(snaps: Record<string, OptionSnapshot>, expiry: string): Leg[] {
  const out: Leg[] = [];
  for (const [occ, s] of Object.entries(snaps)) {
    const o = parseOcc(occ);
    if (!o || o.expiry !== expiry) continue;
    const bid = num(s.latestQuote?.bp), ask = num(s.latestQuote?.ap);
    const last = num(s.latestTrade?.p) ?? num(s.dailyBar?.c);
    out.push({
      root: o.root, optType: o.optType, strike: o.strike,
      q: {
        bid, ask, mid: midOf(bid, ask, last), last,
        iv: num(s.impliedVolatility),
        delta: num(s.greeks?.delta), gamma: num(s.greeks?.gamma), theta: num(s.greeks?.theta), vega: num(s.greeks?.vega),
        vol: num(s.dailyBar?.v),
      },
    });
  }
  return out;
}

/** Underlying price: the session-aware regular price (live when open, else last close); fallback feed for indices. */
async function spotOf(symbol: string): Promise<number | null> {
  const [snaps, market] = await Promise.all([getSnapshotsWithIndices([symbol]), getMarketState()]);
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
  const [live, spot] = await Promise.all([
    getOptionChainContracts(symbol, expiry).catch(err => { console.error('Error fetching option chain:', err instanceof Error ? err.message : err); return [] as OptionChainContract[]; }),
    spotOf(symbol),
  ]);
  let legs = fromContracts(live);
  if (!legs.length) {
    const range = { expiryFrom: expiry, expiryTo: expiry, maxPages: 5 };
    const first = await getOptionChainSnapshots(symbol, range);
    const snaps = !Object.keys(first).length && WEEKLY_ROOT[symbol] ? await getOptionChainSnapshots(WEEKLY_ROOT[symbol], range) : first;
    legs = fromSnapshots(snaps, expiry);
  }
  if (!spot || !legs.length) return null;
  // Group by OCC root: SPX lists SPX (monthly, AM-settled) and SPXW (weekly/PM) for the same date.
  const byRoot = new Map<string, Map<number, ChainRow>>();
  for (const l of legs) {
    let rows = byRoot.get(l.root);
    if (!rows) byRoot.set(l.root, (rows = new Map()));
    const row = rows.get(l.strike) ?? { strike: l.strike };
    row[l.optType] = l.q;
    rows.set(l.strike, row);
  }
  const [root, rows] = [...byRoot.entries()].sort((a, b) => b[1].size - a[1].size || (a[0] === symbol ? -1 : 1))[0];
  return {
    symbol, root, expiry, spot,
    asOf: new Date().toISOString(),
    rows: [...rows.values()].sort((a, b) => a.strike - b.strike),
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn) return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
  const builder = hasFeature(ctx.features, FEATURE_STRATEGY_BUILDER);
  if (!builder && !hasFeature(ctx.features, FEATURE_OPTION_CHAIN)) {
    return NextResponse.json({ success: false, error: 'Upgrade required', feature: FEATURE_OPTION_CHAIN }, { status: 403 });
  }

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
    // Templates only matter to the builder; plain-chain users get none.
    const enabledStrategies = builder ? await enabledStrategyIds() : [];
    if (!chain) {
      return NextResponse.json({ success: true, data: null, enabledStrategies, message: `No live option chain for ${symbol} on ${expiry}.` });
    }
    return NextResponse.json({ success: true, data: chain, enabledStrategies }, { headers: rateLimitHeaders(limit) });
  } catch (error) {
    console.error('Error loading option chain:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'Failed to load the option chain' }, { status: 500 });
  }
}
