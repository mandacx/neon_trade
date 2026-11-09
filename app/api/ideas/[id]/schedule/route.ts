import { NextRequest, NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse, readJson } from '@/lib/ideasApi';
import { scheduleIdea, unscheduleIdea } from '@/lib/ideas';

export const dynamic = 'force-dynamic';

/**
 * Publishers: schedule a draft to publish automatically. Body `{ at: <ISO instant> }`, between 2 minutes and 90 days ahead.
 * The tracker publishes it on its first tick after that time (every 30 minutes), so it can be up to one tick late.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, blocked } = await guardIdeas({ publish: true });
  if (blocked) return blocked;
  const { id } = await params;
  const body = await readJson(request);
  try {
    return NextResponse.json({ success: true, data: await scheduleIdea(access, id, body?.at) });
  } catch (error) {
    return ideaErrorResponse('schedule', error);
  }
}

/** Cancel the schedule; the idea goes back to a plain draft. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, blocked } = await guardIdeas({ publish: true });
  if (blocked) return blocked;
  const { id } = await params;
  try {
    const ok = await unscheduleIdea(access, id);
    if (!ok) return NextResponse.json({ success: false, error: 'Scheduled idea not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: { unscheduled: true } });
  } catch (error) {
    return ideaErrorResponse('unschedule', error);
  }
}
