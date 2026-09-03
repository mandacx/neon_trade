import { NextRequest, NextResponse } from 'next/server';
import { getAllStocksLatest, getAllStocksByDate, getAllStocksByDateAndExpiry, getAvailableDates, getAvailableExpiryDates } from '@/lib/db';
import { calculateLevels, findClosestLevel, rebaseLevels } from '@/lib/calculations';
import { deriveFilterOptions, getSecuritiesFilterOptions, getSecuritiesMeta, applySecuritiesFilters, attachSecuritiesMeta } from '@/lib/securitiesFilters';
import { getSnapshotsMulti } from '@/lib/alpaca';
import { format } from 'date-fns';
import { requireFeatureApi } from '@/lib/routeGuards';
import { levelGate } from '@/lib/levelAccess';
import { FEATURE_QUADRANT, FEATURE_WATCHLISTS, hasFeature } from '@/lib/features';
import { getWatchlistsForUser, getWatchlistSymbols } from '@/lib/watchlists';

export async function GET(request: NextRequest) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_QUADRANT);
  if (blocked) return blocked;

  try {
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    const expiryDate = searchParams.get('expiry');
    const threshold = searchParams.get('threshold') ? parseFloat(searchParams.get('threshold')!) : undefined;
    const search = searchParams.get('search');
    const metadataOnly = searchParams.get('metadata') === 'true';
    const sector = searchParams.get('sector');
    const industry = searchParams.get('industry');
    const marketCapTier = searchParams.get('marketCapTier');
    const indexCode = searchParams.get('index');
    const watchlistId = searchParams.get('watchlist');
    const watchlistsEnabled = hasFeature(ctx.features, FEATURE_WATCHLISTS);

    // If requesting metadata only (dates + filter options)
    if (metadataOnly) {
      const [tradeDates, expiryDates, filterOptions, watchlists] = await Promise.all([
        getAvailableDates(30),
        getAvailableExpiryDates(),
        getSecuritiesFilterOptions(),
        watchlistsEnabled ? getWatchlistsForUser(ctx.userId) : Promise.resolve([]),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          tradeDates,
          expiryDates,
          filterOptions,
          watchlists,
        },
      });
    }

    // Get all stocks for the specified filters
    let stocksData;

    if (date && expiryDate) {
      stocksData = await getAllStocksByDateAndExpiry(date, expiryDate);
    } else if (date) {
      stocksData = await getAllStocksByDate(date);
    } else {
      stocksData = await getAllStocksLatest();
    }

    // Positions are only rebased onto a live LTP when looking at the latest
    // trade date — a historical date's levels stay measured against that
    // day's own close, same rule the stock detail page follows.
    const [latestDate] = date ? await getAvailableDates(1) : [];
    const isLatestDate = !date || date === latestDate;
    const liveBySymbol: Record<string, number> = {};
    if (isLatestDate && stocksData.length > 0) {
      const snapshots = await getSnapshotsMulti(stocksData.map(d => d.SYMBOL));
      for (const [symbol, snap] of Object.entries(snapshots)) {
        const price = snap.dailyBar?.c ?? snap.latestTrade?.p;
        if (price) liveBySymbol[symbol] = price;
      }
    }

    // Process each stock to calculate levels
    const processedStocks = stocksData.map(data => {
      const levels = calculateLevels(data);
      const livePrice = liveBySymbol[data.SYMBOL];
      const effectiveLevels = livePrice ? rebaseLevels(levels, livePrice) : levels;
      const closest = findClosestLevel(effectiveLevels);

      return {
        symbol: data.SYMBOL,
        close: data.CLOSE,
        livePrice: livePrice ?? null,
        tradeDate: data.TRADE_DATE,
        expiryDate: data.EXPIRY_DT,
        levels: effectiveLevels.map(l => ({
          name: l.name,
          value: l.value,
          price: l.price,
        })),
        closestLevel: closest.name,
        closestValue: closest.value,
      };
    });

    // Filter out stocks where all levels are 100%
    let filteredStocks = processedStocks.filter(stock =>
      !stock.levels.every(level => level.value === 1)
    );

    // Enrich with securities metadata
    const symbols = filteredStocks.map(s => s.symbol);
    const secMeta = await getSecuritiesMeta(symbols);

    // §4 — derive filter options from the present universe (pre sector/industry filtering).
    const derivedFilterOptions = deriveFilterOptions(secMeta);

    // Apply securities-based filters
    filteredStocks = applySecuritiesFilters(filteredStocks, secMeta, { sector, industry, marketCapTier, indexCode });

    // Restrict to a personal/curated watchlist's symbols (Pro only)
    if (watchlistId && watchlistsEnabled) {
      const watchlistSymbols = new Set(await getWatchlistSymbols(watchlistId, ctx.userId));
      filteredStocks = filteredStocks.filter(stock => watchlistSymbols.has(stock.symbol));
    }

    // Filter by threshold
    if (threshold !== undefined) {
      filteredStocks = filteredStocks.filter(stock =>
        Math.abs(stock.closestValue) <= threshold
      );
    }

    // Filter by search
    if (search) {
      const searchUpper = search.toUpperCase();
      filteredStocks = filteredStocks.filter(stock =>
        stock.symbol.includes(searchUpper)
      );
    }

    // Attach securities metadata to output
    const withMeta = filteredStocks.map(s => attachSecuritiesMeta(s, secMeta));

    // Levels are stripped for delayed (non-Pro) viewers, applied after the
    // value-based filters above so those filters keep seeing real numbers.
    // `closestLevel`/`closestValue` are kept so the chart's X axis still
    // works — QuadrantChart degrades to discrete rungs without `levels`.
    const gate = levelGate(ctx.features);
    const enriched = withMeta.map(s => {
      const withheld = gate.withheld(s.tradeDate);
      return { ...s, ...(withheld ? { levels: [] } : {}) };
    });

    const tradeDate = processedStocks.length > 0
      ? processedStocks[0].tradeDate
      : format(new Date(), 'yyyy-MM-dd');

    return NextResponse.json({
      success: true,
      data: {
        date: tradeDate,
        count: enriched.length,
        total: processedStocks.length,
        stocks: enriched,
        filterOptions: derivedFilterOptions,
        hasSecurities: Object.keys(secMeta).length > 0,
      },
    });
  } catch (error) {
    console.error('Error fetching quadrant data:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch quadrant data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
