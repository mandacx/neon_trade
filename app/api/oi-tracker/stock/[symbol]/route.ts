import { NextRequest, NextResponse } from 'next/server';
import { guardOi, parseScreenParams, scopeExpiry, serverError } from '@/lib/oiTrackerApi';
import { filterByExpiry, isStandardExpiry, standardExpiryOnly } from '@/lib/expiryAccess';
import { getOiScreen, getStockFullOi, getStrategyRows, getOiLoadDates } from '@/lib/oiTracker';
import { detectStrategies } from '@/lib/oiStrategies';
import { getOptionChainSnapshots, getSnapshotsMulti, type AlpacaOptionSnapshot } from '@/lib/alpaca';
import { etDateOf } from '@/lib/marketSession';
import type { OiContractRow, OiGroupRow } from '@/types/oiTracker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export interface LiveOption {
  contract: string;
  /** Volume of the snapshot's daily bar and the ET date of that bar. */
  vol: number | null;
  barDate: string | null;
  prevVol: number | null;
  last: number | null;
  bid: number | null;
  ask: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
}

function toLive(contract: string, s: AlpacaOptionSnapshot): LiveOption {
  return {
    contract,
    vol: s.dailyBar?.v ?? null,
    barDate: s.dailyBar?.t ? etDateOf(Date.parse(s.dailyBar.t) + 6 * 3_600_000) : null,
    prevVol: s.prevDailyBar?.v ?? null,
    last: s.latestTrade?.p ?? s.dailyBar?.c ?? null,
    bid: s.latestQuote?.bp ?? null,
    ask: s.latestQuote?.ap ?? null,
    iv: s.impliedVolatility ?? null,
    delta: s.greeks?.delta ?? null,
    gamma: s.greeks?.gamma ?? null,
    theta: s.greeks?.theta ?? null,
  };
}

/**
 * Everything the stock OI modal needs for one underlying: report contracts over
 * the range (all of them, up to 2,000), per-expiry / per-strike / per-date
 * aggregates, full OI per expiry (eod_usmkts_price), strategy candidates, and
 * the live Alpaca chain (volume, IV, greeks) merged by OCC symbol. The live
 * part is best-effort: null when Alpaca has no chain for the symbol (e.g.
 * indices) or the call fails.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { ctx, blocked } = await guardOi(true);
  if (blocked) return blocked;
  const symbol = (await params).symbol.toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return NextResponse.json({ success: false, error: 'Invalid symbol' }, { status: 400 });

  const sp = new URLSearchParams(request.nextUrl.searchParams);
  if (!sp.get('to')) {
    const [latest] = await getOiLoadDates(1);
    if (!latest) return NextResponse.json({ success: false, error: 'No option data' }, { status: 404 });
    sp.set('to', latest);
  }
  sp.set('symbols', symbol);
  const parsed = parseScreenParams(sp);
  if (typeof parsed === 'string') return NextResponse.json({ success: false, error: parsed }, { status: 400 });
  // The modal filters inside its own tables; only dates, expiry and type narrow the query.
  const base = scopeExpiry({
    from: parsed.from, to: parsed.to, symbols: [symbol], optType: parsed.optType,
    expiryFrom: parsed.expiryFrom, expiryTo: parsed.expiryTo, expiries: parsed.expiries, expiryKind: parsed.expiryKind,
  }, ctx);
  const tol = Math.min(10, Math.max(0.5, Number(sp.get('tol')) || 3));
  const minLeg = Math.max(101, Math.trunc(Number(sp.get('minLeg')) || 200));
  const today = etDateOf(Date.now());

  try {
    const [contracts, byExpiry, byStrike, byDate, fullOi, stratRows, chain, stock] = await Promise.all([
      getOiScreen({ ...base, groupBy: 'contract', sort: 'abs_chg', limit: 2000 }),
      getOiScreen({ ...base, groupBy: 'expiry', sort: 'key', sortDir: 'asc', limit: 200 }),
      getOiScreen({ ...base, groupBy: 'strike', sort: 'key', sortDir: 'asc', limit: 1000 }),
      getOiScreen({ ...base, groupBy: 'date', limit: 200 }),
      getStockFullOi(symbol, parsed.to),
      getStrategyRows({ ...base, groupBy: 'contract', minLeg }),
      getOptionChainSnapshots(symbol, { expiryFrom: today, maxPages: 6 }).catch(() => ({} as Record<string, AlpacaOptionSnapshot>)),
      getSnapshotsMulti([symbol]),
    ]);

    const chainKeys = Object.keys(chain);
    let live: { contracts: Record<string, LiveOption>; top: LiveOption[]; count: number } | null = null;
    if (chainKeys.length) {
      // OCC symbol = root + YYMMDD + C/P + 8-digit strike, so the expiry is the 6 digits before the last 9 characters.
      const occExpiry = (c: string) => `20${c.slice(-15, -13)}-${c.slice(-13, -11)}-${c.slice(-11, -9)}`;
      const all = chainKeys
        .filter(k => !standardExpiryOnly(ctx.features) || isStandardExpiry(occExpiry(k)))
        .map(k => toLive(k, chain[k]));
      const inReport = new Set((contracts.rows as OiContractRow[]).map(r => r.contract));
      live = {
        contracts: Object.fromEntries(all.filter(o => inReport.has(o.contract)).map(o => [o.contract, o])),
        top: all.filter(o => (o.vol ?? 0) > 0).sort((a, b) => (b.vol ?? 0) - (a.vol ?? 0)).slice(0, 100),
        count: all.length,
      };
    }
    const snap = stock[symbol];
    const quote = snap ? { price: snap.latestTrade?.p ?? snap.dailyBar?.c ?? null, prevClose: snap.prevDailyBar?.c ?? null } : null;

    return NextResponse.json({
      success: true,
      data: {
        symbol,
        from: contracts.from,
        to: contracts.to,
        loadDates: contracts.loadDates,
        summary: contracts.summary,
        volumeCoverage: contracts.volumeCoverage,
        contracts: contracts.rows as OiContractRow[],
        truncated: contracts.truncated,
        byExpiry: byExpiry.rows as OiGroupRow[],
        byStrike: byStrike.rows as OiGroupRow[],
        byDate: byDate.rows as OiGroupRow[],
        fullOi: { ...fullOi, rows: filterByExpiry(ctx.features, fullOi.rows, r => r.expiry) },
        strategies: detectStrategies(stratRows, tol, minLeg).slice(0, 200),
        tol,
        minLeg,
        live,
        quote,
      },
    });
  } catch (error) {
    return serverError('stock', error);
  }
}
