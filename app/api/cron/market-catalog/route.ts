import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cronAuth';
import { catchUpMarketCatalog } from '@/lib/marketCatalog';
import { captureOptionBars } from '@/lib/optionVolume';
import { warmDailyBars } from '@/lib/dailyBars';

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
 *
 * After the catalog, the same run captures option volume for the latest
 * options load (lib/optionVolume.ts; resumable, so a day that doesn't fit in
 * one run finishes on the next). Before that it tops up the stored daily stock
 * bars for every tracked symbol (lib/dailyBars.ts: one or two market-data requests a
 * day; the first runs also backfill a year of history, resumable, 20s budget).
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

  const started = Date.now();
  try {
    const results = await catchUpMarketCatalog(now.day);
    console.log('[cron/market-catalog]', JSON.stringify(results));
    let dailyBars: unknown;
    try {
      dailyBars = await warmDailyBars({ deadline: started + 20_000 });
      console.log('[cron/market-catalog] daily bars', JSON.stringify(dailyBars));
    } catch (error) {
      console.error('[cron/market-catalog] daily bars top-up failed', error);
      dailyBars = { error: error instanceof Error ? error.message : 'Unknown error' };
    }
    let optionVolume: unknown;
    try {
      optionVolume = await captureOptionBars({ deadline: started + 50_000 });
      console.log('[cron/market-catalog] option volume', JSON.stringify(optionVolume));
    } catch (error) {
      console.error('[cron/market-catalog] option volume capture failed', error);
      optionVolume = { error: error instanceof Error ? error.message : 'Unknown error' };
    }
    return NextResponse.json({ success: true, data: results, dailyBars, optionVolume });
  } catch (error) {
    console.error('[cron/market-catalog] catch-up failed', error);
    return NextResponse.json(
      { success: false, error: 'Catalog catch-up failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
