import { NextRequest, NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse, readJson } from '@/lib/ideasApi';
import { previewTake, takeIdea, takenForIdea } from '@/lib/ideaTaken';
import { IDEA_DISCLAIMER } from '@/lib/ideaDisclaimer';

export const dynamic = 'force-dynamic';

/** Has the signed-in user recorded this idea? (Their own record only.) */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  const { id } = await params;
  try {
    return NextResponse.json({ success: true, data: { taken: await takenForIdea(access.userId, id) } });
  } catch (error) {
    return ideaErrorResponse('taken get', error);
  }
}

/**
 * "I took this". Body `{ qty, entryPrice, note? }`: both numbers are the subscriber's own and required (never defaulted).
 * `?dry_run=true` returns the preview (position value, risk at their stop, profit at each target) and saves nothing.
 * It records the subscriber's own journal entry; no order is placed anywhere.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  const { id } = await params;
  const body = await readJson(request);
  if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  try {
    if (request.nextUrl.searchParams.get('dry_run') === 'true') {
      return NextResponse.json({ success: true, data: { ...(await previewTake(access, id, body)), disclaimer: IDEA_DISCLAIMER } });
    }
    const takenId = await takeIdea(access, id, body);
    return NextResponse.json({ success: true, data: { id: takenId } }, { status: 201 });
  } catch (error) {
    return ideaErrorResponse('taken', error);
  }
}
