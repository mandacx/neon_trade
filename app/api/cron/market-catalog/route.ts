import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cronAuth';
import { catchUpMarketCatalog } from '@/lib/marketCatalog';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDOW_START = 8 * 60 + 30; // 8:30 CT
const WINDOW_END = 11 * 60 + 30;  // 11:30 CT, inclusive

/** Today's date, weekday and minutes-since-midnight in US Central time. */
function centralNow(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    // hour12:false can render midnight as "24".
    minutes: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10),
  };
}

/**
 * Safety net for the market date catalog (lib/marketCatalog.ts): the daily
 * load script normally upserts it, and this catches up if that step didn't
 * run. Railway calls it every 30 min on a UTC schedule wide enough for both
 * DST states (railway/market-catalog-cron/railway.json); the exact 8:30–11:30
 * America/Chicago weekday window is enforced here, so the schedule never
 * needs editing at a DST change. `?force=true` skips the window check for a
 * manual run.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const now = centralNow(new Date());
  const force = request.nextUrl.searchParams.get('force') === 'true';
  const inWindow = now.weekday !== 'Sat' && now.weekday !== 'Sun'
    && now.minutes >= WINDOW_START && now.minutes <= WINDOW_END;
  if (!force && !inWindow) {
    return NextResponse.json({ success: true, data: { skipped: 'outside 8:30-11:30 CT weekday window' } });
  }

  try {
    const results = await catchUpMarketCatalog(now.day);
    console.log('[cron/market-catalog]', JSON.stringify(results));
    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    console.error('[cron/market-catalog] catch-up failed', error);
    return NextResponse.json(
      { success: false, error: 'Catalog catch-up failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
