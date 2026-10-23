import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cronAuth';
import { acquireLease, releaseLease } from '@/lib/jobLease';
import { refreshLiquidity, syncIndexFlags, syncListings } from '@/lib/usUniverse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Weekly refresh of the scanner universe (lib/usUniverse.ts): listings, index flags, then the
 * 20-session liquidity scan of every active listing (paced, resumable: each call works for ~45 s and
 * the next call continues). Each step is skipped while its last run is under 6 days old, so the
 * Railway schedule can call this every few minutes on Saturday and the work finishes in a few calls.
 * `?force=1` restarts every step.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const force = request.nextUrl.searchParams.get('force') === '1';
  const started = Date.now();
  if (!(await acquireLease('us-universe', 60))) {
    return NextResponse.json({ success: true, data: { skipped: 'another run holds the lease' } });
  }
  const out: Record<string, unknown> = {};
  const step = async (key: string, fn: () => Promise<unknown>) => {
    try { out[key] = await fn(); } catch (e) { out[key] = { error: e instanceof Error ? e.message : String(e) }; }
  };
  try {
    await step('listings', () => syncListings({ force }));
    await step('indexes', () => syncIndexFlags({ force }));
    await step('liquidity', () => refreshLiquidity({ deadline: started + 48_000, force }));
  } finally {
    await releaseLease('us-universe');
  }
  console.log('[cron/us-universe]', JSON.stringify(out));
  return NextResponse.json({ success: true, data: out });
}
