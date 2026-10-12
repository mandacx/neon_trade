import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { DRILL_METRICS, getDrill, type DrillMetric } from '@/lib/adminDrill';
import { YMD_RE, addDaysYmd, ctDateString } from '@/lib/time';

const MAX_SPAN_DAYS = 366;

// GET /api/admin/drill?metric=sessions&from=2026-10-01&to=2026-10-09
// from/to are inclusive Central Time calendar days; both default to today (Central).
export async function GET(request: NextRequest) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const metric = sp.get('metric') as DrillMetric | null;
  if (!metric || !DRILL_METRICS.includes(metric)) {
    return NextResponse.json({ success: false, error: 'Unknown metric' }, { status: 400 });
  }
  const today = ctDateString();
  const from = sp.get('from') ?? today;
  const to = sp.get('to') ?? today;
  if (!YMD_RE.test(from) || !YMD_RE.test(to) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
    return NextResponse.json({ success: false, error: 'from/to must be YYYY-MM-DD' }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ success: false, error: 'from must not be after to' }, { status: 400 });
  }
  if (addDaysYmd(from, MAX_SPAN_DAYS) < to) {
    return NextResponse.json({ success: false, error: `Period too long (max ${MAX_SPAN_DAYS} days)` }, { status: 400 });
  }

  try {
    return NextResponse.json({ success: true, data: await getDrill(metric, from, to) });
  } catch (err) {
    console.error('admin drill failed', metric, err);
    return NextResponse.json({ success: false, error: 'Failed to load drill-down' }, { status: 500 });
  }
}
