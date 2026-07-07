import { NextRequest, NextResponse } from 'next/server';
import { getRecentScanAlerts } from '@/lib/scanAlerts';
import { getSecuritiesMeta, attachSecuritiesMeta } from '@/lib/securitiesFilters';

// Most recently loaded alerts, for the scrolling ticker on the Home and Latest pages.
export async function GET(request: NextRequest) {
  try {
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '40', 10), 200);
    const alerts = await getRecentScanAlerts(limit);
    const secMeta = await getSecuritiesMeta(alerts.map(a => a.symbol));
    const enriched = alerts.map(a => attachSecuritiesMeta(a, secMeta));
    return NextResponse.json({ success: true, data: { alerts: enriched } });
  } catch (error) {
    console.error('Error fetching recent scan alerts:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch recent scan alerts', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
