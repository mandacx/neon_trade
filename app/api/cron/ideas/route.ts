import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cronAuth';
import { acquireLease, releaseLease } from '@/lib/jobLease';
import { evaluateIdeas, publishDueIdeas } from '@/lib/ideas';
import { deliverAlerts } from '@/lib/ideaChannels';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LEASE = 'ideas';

/**
 * Trade Ideas tracker (lib/ideas.ts, docs/trade-ideas.md). Re-scores every live / in-trade idea against the
 * daily bars, stores the outcome, records one event per change, then sends opted-in email alerts (one per
 * event and subscriber). Idempotent, so it is safe to call as often as you like; a single-row lease stops
 * overlapping runs. `?force=true` rebuilds every published idea's outcome. A scheduler must call it
 * (see docs/trade-ideas.md, "Scheduling"); it is not wired to Railway yet.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const startedAt = Date.now();
  if (!(await acquireLease(LEASE, 120))) return NextResponse.json({ success: true, data: { skipped: 'another run holds the lease' } });
  try {
    // Scheduled ideas first, so a just-published idea is announced on this same tick.
    const published = await publishDueIdeas(startedAt + 20_000);
    const evaluated = await evaluateIdeas({ all: request.nextUrl.searchParams.get('force') === 'true', deadline: startedAt + 40_000 });
    const alerts = await deliverAlerts(startedAt + 52_000);
    console.log('[cron/ideas]', JSON.stringify({ published, evaluated, alerts }));
    return NextResponse.json({ success: true, data: { published, evaluated, alerts, ms: Date.now() - startedAt } });
  } catch (error) {
    console.error('[cron/ideas] failed', error);
    return NextResponse.json({ success: false, error: 'Ideas tracker failed', message: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  } finally {
    await releaseLease(LEASE).catch(() => {});
  }
}
