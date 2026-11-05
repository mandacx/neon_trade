import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cronAuth';
import { syncScannerAlerts } from '@/lib/scannerSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// The crypto project's us_alerts_intraday job quotes roughly 08:00–14:50 CT; the window leaves a margin.
const WINDOW_START = 7 * 60 + 45; // 07:45 CT
const WINDOW_END = 15 * 60 + 45;  // 15:45 CT, inclusive

/** Weekday and minutes-since-midnight in US Central time. */
function centralNow(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return {
    weekday: get('weekday'),
    // hour12:false can render midnight as "24".
    minutes: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10),
  };
}

/**
 * Copies new scan alerts from the crypto project's us_scanner into intra_us_scanner_eod
 * (lib/scannerSync.ts). Readers also trigger this lazily; the cron makes alerts land with nobody
 * browsing. Railway calls it every 15 min on a UTC schedule wide enough for both DST states
 * (railway/.railway/railway.ts → scanner-sync-cron); the exact weekday window is enforced here, so the
 * schedule never needs editing at a DST change. `?force=true` skips the window check.
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
    return NextResponse.json({ success: true, data: { skipped: 'outside 07:45-15:45 CT weekday window' } });
  }

  // force=true on the sync itself: the cron must not be skipped because a reader synced a minute ago.
  const newRows = await syncScannerAlerts(true);
  console.log('[cron/scanner-sync]', JSON.stringify({ newRows }));
  if (newRows === null) {
    return NextResponse.json({ success: false, error: 'Scanner sync failed' }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: { newRows } });
}
