import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cronAuth';
import { processEarnings, type EarningsRunPlan } from '@/lib/earnings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Weekday and minutes-since-midnight in US/Eastern. */
function easternNow(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return {
    weekday: get('weekday'),
    minutes: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10),
  };
}

const at = (h: number, m = 0) => h * 60 + m;

/**
 * What a run at this moment should do (all times US/Eastern):
 *   weekdays 06:30–19:30  news results — pre-market, intraday and post-market
 *                         reports land as Benzinga headlines within minutes —
 *                         plus the Alpha Vantage calendar (once a day; later
 *                         runs see it's already synced and skip the call)
 *   weekdays 20:00–23:00  news catch-up for any scheduled date that passed
 *                         without a stored result
 *   weekends 09:00–12:00  the same catch-up (Friday's late headlines)
 */
function planFor(now: Date): EarningsRunPlan {
  const { weekday, minutes } = easternNow(now);
  const weekend = weekday === 'Sat' || weekday === 'Sun';
  if (weekend) return { calendar: false, news: false, catchUp: minutes >= at(9) && minutes <= at(12) };
  const day = minutes >= at(6, 30) && minutes <= at(19, 30);
  return { calendar: day, news: day, catchUp: minutes >= at(20) && minutes <= at(23) };
}

/**
 * Earnings sync (lib/earnings.ts). Railway calls it every 15 minutes
 * (railway/.railway/railway.ts → earnings-cron); this route decides which
 * steps run, so the schedule never needs DST edits. Outside every window it
 * returns before touching the database. `?force=true` runs all steps.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const force = request.nextUrl.searchParams.get('force') === 'true';
  const plan: EarningsRunPlan = force ? { calendar: true, news: true, catchUp: true } : planFor(new Date());
  if (!plan.calendar && !plan.news && !plan.catchUp) {
    return NextResponse.json({ success: true, data: { skipped: 'outside earnings windows' } });
  }

  try {
    // Leave headroom under maxDuration for the response and lease release.
    const result = await processEarnings(plan, startedAt + 50_000);
    console.log('[cron/earnings]', JSON.stringify({ plan, result }));
    return NextResponse.json({ success: true, data: { plan, result, ms: Date.now() - startedAt } });
  } catch (error) {
    console.error('[cron/earnings] failed', error);
    return NextResponse.json(
      { success: false, error: 'Earnings sync failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
