import { NextRequest, NextResponse } from 'next/server';
import { getLatestStockData, getStockDataAsOf } from '@/lib/db';
import { processStockData } from '@/lib/calculations';
import { formatPercentage } from '@/lib/utils';
import { getSessionUser, getUserContextFor } from '@/lib/appUsers';
import { getSecuritiesMeta } from '@/lib/securitiesFilters';
import { levelGate, levelAccessFor, LEVEL_POINT_RATE } from '@/lib/levelAccess';
import { recordHit, rateLimitKey, rateLimitHeaders } from '@/lib/rateLimit';
import { applyTieredLimit } from '@/lib/rateLimitConfig';
import { FEATURE_EARNINGS, hasFeature } from '@/lib/features';
import { getEarningsSummary } from '@/lib/earnings';
import { standardExpiryOnly } from '@/lib/expiryAccess';
import { getFundamentals } from '@/lib/usUniverse';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    // Levels are the paid product — unentitled viewers get the newest row
    // outside the withheld window instead of the latest one, so the panel is
    // stale rather than empty. See lib/levelAccess.ts.
    // The rate-limit key only needs the session user id, so the counter
    // write runs alongside the plan/feature queries instead of after them.
    const user = await getSessionUser();
    const rlKey = rateLimitKey(request.headers, user?.id ?? null);
    const [ctx, hit] = await Promise.all([
      getUserContextFor(user),
      recordHit(LEVEL_POINT_RATE.name, rlKey, LEVEL_POINT_RATE.windowSeconds)
        .catch(err => { console.error('rateLimit: counter unavailable, failing open', err); return null; }),
    ]);
    const gate = levelGate(ctx.features);
    // Users with live levels get the higher, admin-editable limit (lib/rateLimitConfig.ts).
    const limit = await applyTieredLimit(hit, LEVEL_POINT_RATE.name, rlKey, levelAccessFor(ctx.features) === 'latest');

    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded', message: `Too many requests — retry in ${limit.resetSeconds}s` },
        { status: 429, headers: rateLimitHeaders(limit) }
      );
    }

    // Company name/sector/market cap for the page header. That lives in
    // public.securities rather than the levels table, so it's fetched
    // alongside — in parallel, since neither read depends on the other.
    // Earnings (next/last report) are a separate Pro feature: entitled
    // viewers get the summary, everyone else an `earningsLocked` flag so the
    // header can show an upgrade link instead.
    const earningsEnabled = hasFeature(ctx.features, FEATURE_EARNINGS);
    // Fundamentals (P/E, debt, cash) come from the scanner universe table, refreshed weekly; null for ETFs/indices.
    const [stockData, secRows, earningsMap, fundamentals] = await Promise.all([
      gate.meta.levelsWithheldAfter
        ? getStockDataAsOf(symbol, gate.meta.levelsWithheldAfter, null, standardExpiryOnly(ctx.features))
        : getLatestStockData(symbol, standardExpiryOnly(ctx.features)),
      getSecuritiesMeta([symbol.toUpperCase()]),
      earningsEnabled ? getEarningsSummary([symbol]) : Promise.resolve(null),
      getFundamentals(symbol),
    ]);
    const earnings = earningsMap?.get(symbol.toUpperCase()) ?? null;
    const earningsFields = { earnings, earningsLocked: !earningsEnabled };

    const sec = secRows[symbol.toUpperCase()];
    // Returned at the top level rather than inside `data` so the header still
    // gets a name in broker-only mode, where `data` is null.
    const security = sec
      ? {
          name: sec.name ?? null,
          sector: sec.sector ?? null,
          industry: sec.industry ?? null,
          marketCap: sec.market_cap == null ? null : Number(sec.market_cap),
          marketCapTier: sec.market_cap_tier ?? null,
          exchange: sec.exchange ?? null,
        }
      : null;

    if (!stockData) {
      // No database data - return success with null to indicate broker-only mode
      return NextResponse.json({
        success: true,
        data: null,
        security,
        fundamentals,
        ...earningsFields,
        levelAccess: gate.meta.levelAccess,
        message: 'Stock not found in database, using broker data only'
      });
    }

    // Process and calculate levels
    const processed = processStockData(stockData);
    const withheld = gate.withheld(processed.tradeDate);

    return NextResponse.json({
      success: true,
      data: {
        symbol: processed.symbol,
        close: processed.close,
        tradeDate: processed.tradeDate,
        expiryDate: processed.expiryDate,
        levels: withheld ? [] : processed.levels.map(level => ({
          name: level.name,
          value: level.value,
          price: level.price,
          distance: level.distance,
          percentage: formatPercentage(level.value),
        })),
        closestLevel: !withheld && processed.closestLevel
          ? {
              name: processed.closestLevel.name,
              value: processed.closestLevel.value,
              price: processed.closestLevel.price,
              percentage: formatPercentage(processed.closestLevel.value),
            }
          : null,
        ...gate.meta,
      },
      security,
      fundamentals,
      ...earningsFields,
    });
  } catch (error) {
    console.error('Error fetching stock details:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch stock details',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
