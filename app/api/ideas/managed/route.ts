import { NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse } from '@/lib/ideasApi';
import { listManaged, getAck } from '@/lib/ideas';
import { IDEA_DISCLAIMER } from '@/lib/ideaDisclaimer';

export const dynamic = 'force-dynamic';

/** Publisher workspace: your own ideas, drafts first (admins see everyone's). */
export async function GET() {
  const { access, blocked } = await guardIdeas({ publish: true });
  if (blocked) return blocked;
  try {
    const items = await listManaged(access);
    const ack = await getAck(access.userId);
    return NextResponse.json({ success: true, data: { items, acknowledged: ack.acknowledged, disclaimer: IDEA_DISCLAIMER } });
  } catch (error) {
    return ideaErrorResponse('managed', error);
  }
}
