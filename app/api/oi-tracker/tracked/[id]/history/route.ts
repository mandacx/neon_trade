import { NextRequest, NextResponse } from 'next/server';
import { guardOi, serverError } from '@/lib/oiTrackerApi';
import { getTrackedHistory } from '@/lib/oiTracked';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Daily P&L since entry for one of the user's positions (its whole strategy group when it has one). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, blocked } = await guardOi(true);
  if (blocked) return blocked;
  const { id } = await params;
  try {
    const history = await getTrackedHistory(ctx.userId!, id);
    if (!history) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: history });
  } catch (error) {
    return serverError('position history', error);
  }
}
