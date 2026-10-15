import { NextResponse } from 'next/server';
import { guardOi, serverError } from '@/lib/oiTrackerApi';
import { getOiLoadDates, MAX_LOADS, MAX_LOADS_CONTRACT } from '@/lib/oiTracker';
import { catalogExpiries } from '@/lib/marketCatalog';
import { getSecuritiesFilterOptions } from '@/lib/securitiesFilters';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Load dates, upcoming expiries and securities filter options for the OI tracker page. */
export async function GET() {
  const { blocked } = await guardOi();
  if (blocked) return blocked;
  try {
    const [loadDates, expiries, filters] = await Promise.all([
      getOiLoadDates(400),
      catalogExpiries('opt_chg', { when: 'upcoming', limit: 150 }, async () => {
        const rows = await sql`
          SELECT DISTINCT expiry_dt::text AS d FROM public.us_opt_chg_rpt
          WHERE load_dt >= CURRENT_DATE - 7 AND expiry_dt >= CURRENT_DATE ORDER BY d LIMIT 150
        `;
        return rows.map((r: any) => r.d as string);
      }),
      getSecuritiesFilterOptions(),
    ]);
    return NextResponse.json({
      success: true,
      data: { loadDates, latest: loadDates[0] ?? null, expiries, filters, maxLoads: MAX_LOADS, maxLoadsContract: MAX_LOADS_CONTRACT },
    });
  } catch (error) {
    return serverError('meta', error);
  }
}
