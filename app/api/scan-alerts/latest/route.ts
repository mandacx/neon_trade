import { NextRequest, NextResponse } from 'next/server';
import { getScanAlerts, getScanTradeDates, getScanExpiryDates, getLatestScanTradeDate } from '@/lib/scanAlerts';
import { deriveFilterOptions, getSecuritiesFilterOptions, getSecuritiesMeta, applySecuritiesFilters, attachSecuritiesMeta } from '@/lib/securitiesFilters';
import { requireFeatureApi } from '@/lib/routeGuards';
import { hasFeature, FEATURE_EARNINGS, FEATURE_LEVELS, FEATURE_SCAN_ALERTS_LATEST, FEATURE_WATCHLISTS } from '@/lib/features';
import { earningsBadge, getEarningsSummary } from '@/lib/earnings';
import { getWatchlistsForUser, getWatchlistSymbols } from '@/lib/watchlists';

// Latest scan alerts: always scoped to expiry_dt >= today, per the "future dated
// expiries only" requirement for this page. `expiry` further narrows to one date.
export async function GET(request: NextRequest) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_SCAN_ALERTS_LATEST);
  if (blocked) return blocked;

  try {
    const searchParams = request.nextUrl.searchParams;
    const metadataOnly = searchParams.get('metadata') === 'true';
    const sector = searchParams.get('sector');
    const industry = searchParams.get('industry');
    const marketCapTier = searchParams.get('marketCapTier');
    const indexCode = searchParams.get('index');
    const watchlistId = searchParams.get('watchlist');
    const watchlistsEnabled = hasFeature(ctx.features, FEATURE_WATCHLISTS);

    if (metadataOnly) {
      const [tradeDates, expiryDates, filterOptions, watchlists] = await Promise.all([
        getScanTradeDates(30),
        getScanExpiryDates({ futureOnly: true }),
        getSecuritiesFilterOptions(),
        watchlistsEnabled ? getWatchlistsForUser(ctx.userId) : Promise.resolve([]),
      ]);
      return NextResponse.json({ success: true, data: { tradeDates, expiryDates, filterOptions, watchlists } });
    }

    const tradeDate = searchParams.get('tradeDate') || (await getLatestScanTradeDate()) || undefined;
    const expiryDate = searchParams.get('expiry') || undefined;

    const [allAlerts, watchlistSymbols] = await Promise.all([
      getScanAlerts({ tradeDate, expiryDate, futureExpiryOnly: true }),
      watchlistId && watchlistsEnabled ? getWatchlistSymbols(watchlistId, ctx.userId) : Promise.resolve(null),
    ]);
    // Restrict to a watchlist's symbols first, so the meta/earnings lookups and
    // derived filter options below only cover the alerts that will be shown.
    const allowed = watchlistSymbols ? new Set(watchlistSymbols) : null;
    let alerts = allowed ? allAlerts.filter(a => allowed.has(a.symbol)) : allAlerts;

    const symbols = alerts.map(a => a.symbol);
    // Earnings flags (Pro): next report relative to each alert's expiry.
    const earningsEnabled = hasFeature(ctx.features, FEATURE_EARNINGS);
    const [secMeta, earningsMap] = await Promise.all([
      getSecuritiesMeta(symbols),
      earningsEnabled ? getEarningsSummary(symbols) : Promise.resolve(null),
    ]);
    const derivedFilterOptions = deriveFilterOptions(secMeta);

    alerts = applySecuritiesFilters(alerts, secMeta, { sector, industry, marketCapTier, indexCode });

    // A scan alert reveals a level by construction (price crossed it), so a
    // delayed viewer's `levels` array is stripped here — after the filters
    // above (which need real level values) but before the response. Kept:
    // `closestLevel`/`closestValue`, since the alert badge just names the
    // level, not its price.
    const levelsVisible = hasFeature(ctx.features, FEATURE_LEVELS);
    const enriched = alerts.map(a => {
      const withMeta = {
        ...attachSecuritiesMeta(a, secMeta),
        ...(earningsMap ? { earnings: earningsBadge(earningsMap.get(a.symbol), a.expiryDate) } : {}),
      };
      return levelsVisible ? withMeta : { ...withMeta, levels: [] };
    });

    return NextResponse.json({
      success: true,
      data: {
        tradeDate: tradeDate ?? null,
        count: enriched.length,
        alerts: enriched,
        filterOptions: derivedFilterOptions,
        hasSecurities: Object.keys(secMeta).length > 0,
        levelsRedacted: !levelsVisible,
        earningsEnabled,
      },
    });
  } catch (error) {
    console.error('Error fetching latest scan alerts:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch scan alerts', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
