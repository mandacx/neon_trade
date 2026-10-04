import { NextRequest, NextResponse } from 'next/server';
import { getAllStocksLatest, getAllStocksByDate, getAllStocksByDateAndExpiry, getAvailableDates, getAvailableExpiryDates } from '@/lib/db';
import { calculateLevels, findClosestLevel, rebaseLevels } from '@/lib/calculations';
import { deriveFilterOptions, getSecuritiesFilterOptions, getSecuritiesMeta, applySecuritiesFilters, attachSecuritiesMeta } from '@/lib/securitiesFilters';
import { getSnapshotsMulti } from '@/lib/alpaca';
import { format } from 'date-fns';
import { requireFeatureApi } from '@/lib/routeGuards';
import { levelGate } from '@/lib/levelAccess';
import { FEATURE_EARNINGS, FEATURE_QUADRANT, FEATURE_WATCHLISTS, hasFeature } from '@/lib/features';
import { earningsBadge, getEarningsSummary } from '@/lib/earnings';
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
    // Earnings flags/filter are a separate Pro feature. Filter values:
    // 'week' (reports within 7 days), 'beforeExpiry' (reports on/before the
    // row's expiry), 'exclude' (drop those that do).
    const earningsEnabled = hasFeature(ctx.features, FEATURE_EARNINGS);
    const earningsFilter = earningsEnabled ? searchParams.get('earnings') : null;

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
          earningsEnabled,
        },
      });
    }

    // The stock rows and the latest-date check are independent, as are the
    // live snapshots and the securities metadata below — each pair goes out
    // together instead of as four sequential round trips.
    const [stocksData, [latestDate]] = await Promise.all([
      date && expiryDate
        ? getAllStocksByDateAndExpiry(date, expiryDate)
        : date
          ? getAllStocksByDate(date)
          : getAllStocksLatest(),
      date ? getAvailableDates(1) : Promise.resolve([] as string[]),
    ]);

    // Positions are only rebased onto a live LTP when looking at the latest
    // trade date — a historical date's levels stay measured against that
    // day's own close, same rule the stock detail page follows.
    const isLatestDate = !date || date === latestDate;
    const allSymbols = Array.from(new Set(stocksData.map(d => d.SYMBOL)));
    const [snapshots, allSecMeta, watchlistSymbols, earningsMap] = await Promise.all([
      isLatestDate && allSymbols.length > 0
        ? getSnapshotsMulti(allSymbols)
        : Promise.resolve({} as Awaited<ReturnType<typeof getSnapshotsMulti>>),
      getSecuritiesMeta(allSymbols),
      watchlistId && watchlistsEnabled ? getWatchlistSymbols(watchlistId, ctx.userId) : Promise.resolve(null),
      earningsEnabled ? getEarningsSummary(allSymbols) : Promise.resolve(null),
    ]);
    const liveBySymbol: Record<string, number> = {};
    for (const [symbol, snap] of Object.entries(snapshots)) {
      const price = snap.dailyBar?.c ?? snap.latestTrade?.p;
      if (price) liveBySymbol[symbol] = price;
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

    // Securities metadata was fetched for every row above; narrow it to the
    // stocks that survived the all-100% filter so the derived filter options
    // (and hasSecurities) describe exactly what's plotted, as before.
    const secMeta: Record<string, any> = {};
    for (const s of filteredStocks) {
      if (allSecMeta[s.symbol]) secMeta[s.symbol] = allSecMeta[s.symbol];
    }

    // §4 — derive filter options from the present universe (pre sector/industry filtering).
    const derivedFilterOptions = deriveFilterOptions(secMeta);

    // Apply securities-based filters
    filteredStocks = applySecuritiesFilters(filteredStocks, secMeta, { sector, industry, marketCapTier, indexCode });

    // Restrict to a personal/curated watchlist's symbols (Pro only)
    if (watchlistSymbols) {
      const allowed = new Set(watchlistSymbols);
      filteredStocks = filteredStocks.filter(stock => allowed.has(stock.symbol));
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
    const enriched = withMeta
      .map(s => {
        const withheld = gate.withheld(s.tradeDate);
        return {
          ...s,
          ...(withheld ? { levels: [] } : {}),
          ...(earningsMap ? { earnings: earningsBadge(earningsMap.get(s.symbol), s.expiryDate) } : {}),
        };
      })
      .filter(s => {
        if (!earningsFilter) return true;
        const e = s.earnings;
        if (earningsFilter === 'week') return e?.daysUntil != null && e.daysUntil <= 7;
        if (earningsFilter === 'beforeExpiry') return !!e?.beforeExpiry;
        if (earningsFilter === 'exclude') return !e?.beforeExpiry;
        return true;
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
        earningsEnabled,
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
