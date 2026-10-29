import { NextRequest, NextResponse } from 'next/server';
import { getAllStocksLatest, getAllStocksByDate, getAllStocksByDateAndExpiry, getAvailableDates, getAvailableExpiryDates } from '@/lib/db';
import { calculateLevels, findClosestLevel, rebaseLevels } from '@/lib/calculations';
import { deriveFilterOptions, getSecuritiesFilterOptions, getSecuritiesMeta, applySecuritiesFilters, attachSecuritiesMeta } from '@/lib/securitiesFilters';
import { getLatestPrices, getDayClosePrices, type ReferencePrices } from '@/lib/quadrantPrices';
import { format } from 'date-fns';
import { requireFeatureApi } from '@/lib/routeGuards';
import { levelGate } from '@/lib/levelAccess';
import { FEATURE_EARNINGS, FEATURE_QUADRANT, FEATURE_WATCHLISTS, hasFeature } from '@/lib/features';
import { earningsBadge, getEarningsSummary, todayET } from '@/lib/earnings';
import { EARNINGS_FILTER_OPTIONS, earningsFilterMatches, type EarningsFilter } from '@/lib/earningsFilter';
import { getWatchlistsForUser, getWatchlistSymbols } from '@/lib/watchlists';
import { isLevelCompare, levelCompareMatches } from '@/lib/levelCompare';
import { expiryAllowed, filterByExpiry, filterExpiries, WEEKLY_EXPIRY_ERROR } from '@/lib/expiryAccess';

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
    const rawEarnings = earningsEnabled ? searchParams.get('earnings') : null;
    // Unknown values are ignored rather than filtering everything out.
    const earningsFilter = rawEarnings === 'exclude' || EARNINGS_FILTER_OPTIONS.some(o => o.value === rawEarnings) ? rawEarnings : null;
    // Put/Call Int vs Put High / Call Low (lib/levelCompare.ts); unknown values are ignored.
    const rawCompare = searchParams.get('levelCompare');
    const levelCompare = isLevelCompare(rawCompare) ? rawCompare : null;
    const isoDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const earningsFrom = isoDate(searchParams.get('earningsFrom'));
    const earningsTo = isoDate(searchParams.get('earningsTo'));

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
          expiryDates: filterExpiries(ctx.features, expiryDates),
          filterOptions,
          watchlists,
          earningsEnabled,
        },
      });
    }

    // The stock rows and the latest-date check are independent, as are the
    // live snapshots and the securities metadata below — each pair goes out
    // together instead of as four sequential round trips.
    if (expiryDate && !expiryAllowed(ctx.features, expiryDate)) {
      return NextResponse.json(WEEKLY_EXPIRY_ERROR, { status: 403 });
    }
    const [rawStocksData, [latestDate]] = await Promise.all([
      date && expiryDate
        ? getAllStocksByDateAndExpiry(date, expiryDate)
        : date
          ? getAllStocksByDate(date)
          : getAllStocksLatest(),
      date ? getAvailableDates(1) : Promise.resolve([] as string[]),
    ]);

    // Plans limited to monthly/quarterly expiries only see those rows (lib/expiryAccess.ts).
    const stocksData = filterByExpiry(ctx.features, rawStocksData, d => d.EXPIRY_DT);

    // Every level is measured against one reference price per stock:
    //   latest load date -> live (regular session, shared 5-min cache) or the last regular
    //                       close (stored until the next session opens);
    //   past load date   -> the close of that date's own session. (The EOD table's `close`
    //                       for load date D is session D-1's close, so it is not used.)
    // lib/quadrantPrices.ts has the caching rules. A stock with no price keeps its stored close.
    const isLatestDate = !date || date === latestDate;
    const allSymbols = Array.from(new Set(stocksData.map(d => d.SYMBOL)));
    const noPrices: ReferencePrices = { prices: {}, source: 'day-close', asOf: null, session: null, nextChangeAt: null };
    const loadDate = stocksData[0]?.TRADE_DATE;
    const [refPrices, allSecMeta, watchlistSymbols, earningsMap] = await Promise.all([
      allSymbols.length === 0
        ? Promise.resolve(noPrices)
        : isLatestDate
          ? getLatestPrices(allSymbols)
          : getDayClosePrices(loadDate, allSymbols),
      getSecuritiesMeta(allSymbols),
      watchlistId && watchlistsEnabled ? getWatchlistSymbols(watchlistId, ctx.userId) : Promise.resolve(null),
      earningsEnabled ? getEarningsSummary(allSymbols) : Promise.resolve(null),
    ]);

    // Process each stock to calculate levels
    const processedStocks = stocksData.map(data => {
      const levels = calculateLevels(data);
      const refPrice = refPrices.prices[data.SYMBOL];
      const effectiveLevels = refPrice ? rebaseLevels(levels, refPrice) : levels;
      const closest = findClosestLevel(effectiveLevels);

      return {
        symbol: data.SYMBOL,
        close: data.CLOSE,
        // The price the levels are measured against, and where it came from ('stored' = no
        // price available, the EOD close was used).
        refPrice: refPrice ?? data.CLOSE,
        refSource: refPrice ? refPrices.source : 'stored',
        livePrice: refPrice && refPrices.source !== 'day-close' ? refPrice : null,
        tradeDate: data.TRADE_DATE,
        expiryDate: data.EXPIRY_DT,
        levels: effectiveLevels.map(l => ({
          name: l.name,
          value: l.value,
          price: l.price,
        })),
        // Put High / Call Low: shown in the stock tooltip only; they never decide the closest level.
        // 0 = no data, so such a level is left out.
        altLevels: ([['put_high', data.put_HIGH], ['call_low', data.call_low]] as const)
          .filter(([, price]) => price > 0)
          .map(([name, price]) => ({
            name, price,
            value: (refPrice ?? data.CLOSE) ? ((refPrice ?? data.CLOSE) - price) / (refPrice ?? data.CLOSE) : 0,
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

    // Put/Call Int against Put High / Call Low (and Put High against Call Int), on the levels' own prices (no reference price involved).
    if (levelCompare) {
      const raw = new Map(stocksData.map(d => [`${d.SYMBOL}|${d.EXPIRY_DT}`, d]));
      filteredStocks = filteredStocks.filter(stock => {
        const d = raw.get(`${stock.symbol}|${stock.expiryDate}`);
        return !!d && levelCompareMatches(levelCompare, d.PUT_CALL_INT, d.put_HIGH, d.call_low, d.CALL_INT);
      });
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
          ...(withheld ? { levels: [], altLevels: [] } : {}),
          ...(earningsMap ? { earnings: earningsBadge(earningsMap.get(s.symbol), s.expiryDate) } : {}),
        };
      })
      .filter(s => {
        if (!earningsFilter) return true;
        const e = s.earnings;
        // 'exclude' predates the shared filters: keeps rows with no report at all.
        if (earningsFilter === 'exclude') return !e?.beforeExpiry;
        return earningsFilterMatches(
          {
            nextDate: e?.nextDate ?? null,
            nextEstimated: !!e?.nextEstimated,
            reportedDate: e?.lastDate ?? null,
            beforeExpiry: !!e?.beforeExpiry,
          },
          earningsFilter as EarningsFilter,
          { today: todayET(), from: earningsFrom, to: earningsTo },
        );
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
        price: {
          source: refPrices.source,
          asOf: refPrices.asOf,
          session: refPrices.session,
          nextChangeAt: refPrices.nextChangeAt,
          isLatest: isLatestDate,
        },
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
