import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cronAuth';
import { warmDailyBars } from '@/lib/dailyBars';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Manual / on-demand run of the stored-daily-bars fill (lib/dailyBars.ts), with no time-of-day window.
 * The market-catalog cron already does the daily top-up; call this to start or finish the history backfill
 * right away. Resumable: if the 50s budget runs out, call it again. `?days=` sets how far back to cover
 * (default 380 calendar days), `?symbols=AAPL,MSFT` limits it to some symbols.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const sp = request.nextUrl.searchParams;
  const days = Math.min(Math.max(Math.trunc(Number(sp.get('days')) || 380), 5), 3650);
  const symbols = sp.get('symbols')?.split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9.\-]{1,10}$/.test(s)).slice(0, 1000);
  try {
    const result = await warmDailyBars({ days, symbols: symbols?.length ? symbols : undefined, deadline: Date.now() + 50_000 });
    console.log('[cron/daily-bars]', JSON.stringify(result));
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[cron/daily-bars] failed', error);
    return NextResponse.json(
      { success: false, error: 'Daily bars fill failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
