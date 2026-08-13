import { NextRequest, NextResponse } from 'next/server';
import { getScanAlerts, getScanTradeDates, getScanExpiryDates, getLatestScanTradeDate } from '@/lib/scanAlerts';
import { deriveFilterOptions, getSecuritiesFilterOptions, getSecuritiesMeta, applySecuritiesFilters, attachSecuritiesMeta } from '@/lib/securitiesFilters';
import { requireFeatureApi } from '@/lib/routeGuards';
import { hasFeature, FEATURE_LEVELS, FEATURE_SCAN_ALERTS_LATEST } from '@/lib/features';

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

    if (metadataOnly) {
      const [tradeDates, expiryDates, filterOptions] = await Promise.all([
        getScanTradeDates(30),
        getScanExpiryDates({ futureOnly: true }),
        getSecuritiesFilterOptions(),
      ]);
      return NextResponse.json({ success: true, data: { tradeDates, expiryDates, filterOptions } });
    }

    const tradeDate = searchParams.get('tradeDate') || (await getLatestScanTradeDate()) || undefined;
    const expiryDate = searchParams.get('expiry') || undefined;

    let alerts = await getScanAlerts({ tradeDate, expiryDate, futureExpiryOnly: true });

    const symbols = alerts.map(a => a.symbol);
    const secMeta = await getSecuritiesMeta(symbols);
    const derivedFilterOptions = deriveFilterOptions(secMeta);

    alerts = applySecuritiesFilters(alerts, secMeta, { sector, industry, marketCapTier, indexCode });

    // A scan alert reveals a level by construction (price crossed it), so a
    // delayed viewer's `levels` array is stripped here — after the filters
    // above (which need real level values) but before the response. Kept:
    // `closestLevel`/`closestValue`, since the alert badge just names the
    // level, not its price.
    const levelsVisible = hasFeature(ctx.features, FEATURE_LEVELS);
    const enriched = alerts.map(a => {
      const withMeta = attachSecuritiesMeta(a, secMeta);
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
