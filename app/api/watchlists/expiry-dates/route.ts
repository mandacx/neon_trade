import { NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_WATCHLISTS } from '@/lib/features';
import { getAvailableExpiryDates } from '@/lib/db';
import { isThirdFridayOfMonth } from '@/lib/utils';

// Global (not per-watchlist) list of upcoming standard monthly expiries — the
// 3rd Friday of each month, restricted to dates that actually exist as
// expiry_dt somewhere in eod_usmkts_price rather than freely computed
// calendar dates. Backs the watchlist page's expiry toggle.
export async function GET() {
  const { blocked } = await requireFeatureApi(FEATURE_WATCHLISTS);
  if (blocked) return blocked;

  const allFutureExpiries = await getAvailableExpiryDates();
  const monthlyExpiries = allFutureExpiries.filter(isThirdFridayOfMonth).sort();

  return NextResponse.json({ success: true, data: { monthlyExpiries } });
}
