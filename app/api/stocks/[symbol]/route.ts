import { NextRequest, NextResponse } from 'next/server';
import { getLatestStockData, getStockDataAsOf } from '@/lib/db';
import { processStockData } from '@/lib/calculations';
import { formatPercentage } from '@/lib/utils';
import { getCurrentUserContext } from '@/lib/appUsers';
import { getSecuritiesMeta } from '@/lib/securitiesFilters';
import { levelGate, LEVEL_POINT_RATE } from '@/lib/levelAccess';
import { checkRateLimit, rateLimitKey, rateLimitHeaders } from '@/lib/rateLimit';

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
    const ctx = await getCurrentUserContext();
    const gate = levelGate(ctx.features);

    const limit = await checkRateLimit(
      LEVEL_POINT_RATE.name,
      rateLimitKey(request.headers, ctx.userId),
      LEVEL_POINT_RATE.limit,
      LEVEL_POINT_RATE.windowSeconds
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded', message: `Too many requests — retry in ${limit.resetSeconds}s` },
        { status: 429, headers: rateLimitHeaders(limit) }
      );
    }

    // Company name/sector/market cap for the page header. That lives in
    // public.securities rather than the levels table, so it's fetched
    // alongside — in parallel, since neither read depends on the other.
    const [stockData, secRows] = await Promise.all([
      gate.meta.levelsWithheldAfter
        ? getStockDataAsOf(symbol, gate.meta.levelsWithheldAfter)
        : getLatestStockData(symbol),
      getSecuritiesMeta([symbol.toUpperCase()]),
    ]);

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
