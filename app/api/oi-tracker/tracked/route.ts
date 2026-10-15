import { NextRequest, NextResponse } from 'next/server';
import { guardOi, serverError } from '@/lib/oiTrackerApi';
import { createTracked, listTracked, withPerformance, TrackError, type NewLeg } from '@/lib/oiTracked';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The signed-in user's own tracked positions with current price and P&L. Never anyone else's. */
export async function GET() {
  const { ctx, blocked } = await guardOi();
  if (blocked) return blocked;
  try {
    const positions = await withPerformance(await listTracked(ctx.userId!));
    return NextResponse.json({ success: true, data: { positions } });
  } catch (error) {
    return serverError('tracked positions', error);
  }
}

/**
 * Track 1–4 legs: { legs: [{ underlying, contract, side: 'BTO'|'STO', qty, entryPrice? }], entryDate?, note?, strategyLabel? }.
 * Legs added together share a strategy group. Entry price defaults to the contract's price on the entry date.
 */
export async function POST(request: NextRequest) {
  const { ctx, blocked } = await guardOi(true);
  if (blocked) return blocked;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }
  const legs: NewLeg[] = Array.isArray(body?.legs) ? body.legs : [];
  try {
    const created = await createTracked(ctx.userId!, legs, {
      entryDate: typeof body?.entryDate === 'string' ? body.entryDate : null,
      note: typeof body?.note === 'string' ? body.note : null,
      strategyLabel: typeof body?.strategyLabel === 'string' ? body.strategyLabel : null,
    });
    return NextResponse.json({ success: true, data: { positions: created } }, { status: 201 });
  } catch (error) {
    if (error instanceof TrackError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    return serverError('track', error);
  }
}
