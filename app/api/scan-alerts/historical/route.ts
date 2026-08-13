import { NextRequest, NextResponse } from 'next/server';
import {
  getScanAlerts,
  getScanAlertMonths,
  getScanTradeDatesInMonth,
  getScanExpiryDatesInMonth,
} from '@/lib/scanAlerts';
import { deriveFilterOptions, getSecuritiesFilterOptions, getSecuritiesMeta, applySecuritiesFilters, attachSecuritiesMeta } from '@/lib/securitiesFilters';
import { requireFeatureApi } from '@/lib/routeGuards';
import { hasFeature, FEATURE_LEVELS, FEATURE_SCAN_ALERTS_HISTORY } from '@/lib/features';

// Historical scan alerts: browsed by calendar month. `metadata=true` alone lists
// available months; `metadata=true&month=YYYY-MM` scopes trade/expiry date
// dropdowns to that month once selected.
export async function GET(request: NextRequest) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_SCAN_ALERTS_HISTORY);
  if (blocked) return blocked;

  try {
    const searchParams = request.nextUrl.searchParams;
    const metadataOnly = searchParams.get('metadata') === 'true';
    const month = searchParams.get('month') || undefined; // 'YYYY-MM'
    const sector = searchParams.get('sector');
    const industry = searchParams.get('industry');
    const marketCapTier = searchParams.get('marketCapTier');
    const indexCode = searchParams.get('index');

    if (metadataOnly) {
      if (!month) {
        const [months, filterOptions] = await Promise.all([
          getScanAlertMonths(),
          getSecuritiesFilterOptions(),
        ]);
        return NextResponse.json({ success: true, data: { months, filterOptions } });
      }
      const [tradeDates, expiryDates] = await Promise.all([
        getScanTradeDatesInMonth(month),
        getScanExpiryDatesInMonth(month),
      ]);
      return NextResponse.json({ success: true, data: { tradeDates, expiryDates } });
    }

    if (!month) {
      return NextResponse.json({ success: false, error: 'month is required (format YYYY-MM)' }, { status: 400 });
    }

    const tradeDate = searchParams.get('tradeDate') || undefined;
    const expiryDate = searchParams.get('expiry') || undefined;

    let alerts = await getScanAlerts({ yearMonth: month, tradeDate, expiryDate });

    const symbols = alerts.map(a => a.symbol);
    const secMeta = await getSecuritiesMeta(symbols);
    const derivedFilterOptions = deriveFilterOptions(secMeta);

    alerts = applySecuritiesFilters(alerts, secMeta, { sector, industry, marketCapTier, indexCode });

    // See app/api/scan-alerts/latest/route.ts — same redaction pattern.
    const levelsVisible = hasFeature(ctx.features, FEATURE_LEVELS);
    const enriched = alerts.map(a => {
      const withMeta = attachSecuritiesMeta(a, secMeta);
      return levelsVisible ? withMeta : { ...withMeta, levels: [] };
    });

    return NextResponse.json({
      success: true,
      data: {
        month,
        count: enriched.length,
        alerts: enriched,
        filterOptions: derivedFilterOptions,
        hasSecurities: Object.keys(secMeta).length > 0,
        levelsRedacted: !levelsVisible,
      },
    });
  } catch (error) {
    console.error('Error fetching historical scan alerts:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch historical scan alerts', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
