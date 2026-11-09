import { NextRequest, NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse, readJson } from '@/lib/ideasApi';
import { closeTaken, deleteTaken } from '@/lib/ideaTaken';

export const dynamic = 'force-dynamic';

/** Close one of my own trades at my own exit price: `{ exitPrice, note? }`. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tid: string }> }) {
  const { access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  const { tid } = await params;
  const body = await readJson(request);
  if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  try {
    await closeTaken(access.userId, tid, body.exitPrice, body.note);
    return NextResponse.json({ success: true, data: { closed: true } });
  } catch (error) {
    return ideaErrorResponse('taken close', error);
  }
}

/** Remove one of my own records. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ tid: string }> }) {
  const { access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  const { tid } = await params;
  try {
    const ok = await deleteTaken(access.userId, tid);
    if (!ok) return NextResponse.json({ success: false, error: 'Trade not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    return ideaErrorResponse('taken delete', error);
  }
}
