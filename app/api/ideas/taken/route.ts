import { NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse } from '@/lib/ideasApi';
import { listTaken } from '@/lib/ideaTaken';
import { IDEA_DISCLAIMER } from '@/lib/ideaDisclaimer';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** My own recorded trades (private), marked to the latest price while open, and followed vs not followed. */
export async function GET() {
  const { access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  try {
    return NextResponse.json({ success: true, data: { ...(await listTaken(access)), disclaimer: IDEA_DISCLAIMER } });
  } catch (error) {
    return ideaErrorResponse('taken list', error);
  }
}
