import { NextRequest, NextResponse } from 'next/server';
import { guardOi, parseScreenParams, serverError } from '@/lib/oiTrackerApi';
import { getStrategyRows } from '@/lib/oiTracker';
import { detectStrategies } from '@/lib/oiStrategies';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_CANDIDATES = 500;

/**
 * Possible multi-leg strategies: legs of one underlying on one load date whose
 * |OI change| agree within `tol` % (default 3, 0.5–10). `minLeg` (default 500)
 * drops small legs. Filters as for /screen (dates, symbols, expiries, type).
 */
export async function GET(request: NextRequest) {
  const { blocked } = await guardOi(true);
  if (blocked) return blocked;
  const sp = request.nextUrl.searchParams;
  const params = parseScreenParams(sp);
  if (typeof params === 'string') return NextResponse.json({ success: false, error: params }, { status: 400 });
  const tol = Math.min(10, Math.max(0.5, Number(sp.get('tol')) || 3));
  const minLeg = Math.max(101, Math.trunc(Number(sp.get('minLeg')) || 500));
  try {
    const rows = await getStrategyRows({ ...params, minLeg });
    const all = detectStrategies(rows, tol, minLeg);
    return NextResponse.json({
      success: true,
      data: { tol, minLeg, legsScanned: rows.length, total: all.length, truncated: all.length > MAX_CANDIDATES, candidates: all.slice(0, MAX_CANDIDATES) },
    });
  } catch (error) {
    return serverError('strategies', error);
  }
}
