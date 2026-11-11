import { NextRequest, NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse } from '@/lib/ideasApi';
import { deleteDraft, getIdea, getAck } from '@/lib/ideas';
import { getOptionTrack } from '@/lib/ideaOptions';
import { IDEA_DISCLAIMER } from '@/lib/ideaDisclaimer';

export const dynamic = 'force-dynamic';

/** One idea with its update timeline. 404 for a missing idea and for one outside the viewer's plan (the same answer). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  const { id } = await params;
  try {
    const [idea, ack] = await Promise.all([getIdea(access, id), getAck(access.userId)]);
    if (!idea) return NextResponse.json({ success: false, error: 'Idea not found' }, { status: 404 });
    // The estimated option P&L (separate from the idea's R); the idea was read through the gated SQL above.
    const optionTrack = idea.optionStrategy ? await getOptionTrack(idea.id, idea.optionStrategy, !!idea.outcome?.enteredOn).catch(() => null) : null;
    return NextResponse.json({ success: true, data: { idea, optionTrack, canPublish: access.canPublish, acknowledged: ack.acknowledged, disclaimer: IDEA_DISCLAIMER } });
  } catch (error) {
    return ideaErrorResponse('get', error);
  }
}

/** Delete a draft. Published ideas cannot be deleted (cancel them instead). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, blocked } = await guardIdeas({ publish: true });
  if (blocked) return blocked;
  const { id } = await params;
  try {
    const ok = await deleteDraft(access, id);
    if (!ok) return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    return ideaErrorResponse('delete', error);
  }
}
