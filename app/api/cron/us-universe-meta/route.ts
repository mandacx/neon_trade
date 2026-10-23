import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cronAuth';
import { applyMeta, pendingMetaSymbols, refreshTop1000, type MetaInput } from '@/lib/usUniverse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Metadata hand-off for the Railway Python worker (railway/us-universe-meta-cron), which has no
 * database credentials:
 *   GET  ?limit=N            -> { symbols }   scanner stocks needing sector / industry / market cap
 *   POST { results: {SYM: {name, sector, industry, marketCap} | {error}} } -> { updated, errors, top1000 }
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = Math.trunc(Number(request.nextUrl.searchParams.get('limit')) || 100);
  try {
    return NextResponse.json({ success: true, data: { symbols: await pendingMetaSymbols(limit) } });
  } catch (error) {
    console.error('[cron/us-universe-meta] GET failed', error);
    return NextResponse.json({ success: false, error: 'Could not list symbols' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  let body: { results?: Record<string, MetaInput> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body?.results || typeof body.results !== 'object') {
    return NextResponse.json({ success: false, error: 'results required' }, { status: 400 });
  }
  try {
    const res = await applyMeta(body.results);
    // New caps change the "≈ Russell 1000" set.
    const top1000 = res.updated > 0 ? await refreshTop1000() : undefined;
    return NextResponse.json({ success: true, data: { ...res, top1000 } });
  } catch (error) {
    console.error('[cron/us-universe-meta] POST failed', error);
    return NextResponse.json({ success: false, error: 'Could not store metadata' }, { status: 500 });
  }
}
