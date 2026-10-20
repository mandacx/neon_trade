import { NextResponse } from 'next/server';
import { guardOi, serverError } from '@/lib/oiTrackerApi';
import { getOiLoadDates, MAX_LOADS, MAX_LOADS_CONTRACT } from '@/lib/oiTracker';
import { catalogExpiries } from '@/lib/marketCatalog';
import { getSecuritiesFilterOptions } from '@/lib/securitiesFilters';
import { sql } from '@/lib/db';
import { getWatchlistsForUser } from '@/lib/watchlists';
import { FEATURE_WATCHLISTS, hasFeature } from '@/lib/features';
import { filterExpiries, standardExpiryOnly } from '@/lib/expiryAccess';

export const dynamic = 'force-dynamic';

/** Load dates, upcoming expiries, securities filter options and (with the Watchlists feature) the user's watchlists. */
export async function GET() {
  const { ctx, blocked } = await guardOi();
  if (blocked) return blocked;
  try {
    const [loadDates, expiries, filters, watchlists] = await Promise.all([
      getOiLoadDates(400),
      catalogExpiries('opt_chg', { when: 'upcoming', limit: 150 }, async () => {
        const rows = await sql`
          SELECT DISTINCT expiry_dt::text AS d FROM public.us_opt_chg_rpt
          WHERE load_dt >= CURRENT_DATE - 7 AND expiry_dt >= CURRENT_DATE ORDER BY d LIMIT 150
        `;
        return rows.map((r: any) => r.d as string);
      }),
      getSecuritiesFilterOptions(),
      hasFeature(ctx.features, FEATURE_WATCHLISTS) ? getWatchlistsForUser(ctx.userId) : Promise.resolve([]),
    ]);
    return NextResponse.json({
      success: true,
      data: { loadDates, latest: loadDates[0] ?? null, expiries: filterExpiries(ctx.features, expiries), standardExpiryOnly: standardExpiryOnly(ctx.features), filters, watchlists, maxLoads: MAX_LOADS, maxLoadsContract: MAX_LOADS_CONTRACT },
    });
  } catch (error) {
    return serverError('meta', error);
  }
}
