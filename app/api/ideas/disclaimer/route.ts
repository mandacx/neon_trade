import { NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse } from '@/lib/ideasApi';
import { acknowledgeDisclaimer, getAck } from '@/lib/ideas';
import { IDEA_DISCLAIMER } from '@/lib/ideaDisclaimer';

export const dynamic = 'force-dynamic';

/** The disclaimer text (the single server-side copy) and whether this user has acknowledged the current version. */
export async function GET() {
  const { access, blocked } = await guardIdeas({ rateLimited: false });
  if (blocked) return blocked;
  try {
    return NextResponse.json({ success: true, data: { disclaimer: IDEA_DISCLAIMER, ...(await getAck(access.userId)) } });
  } catch (error) {
    return ideaErrorResponse('disclaimer', error);
  }
}

/** Record the first-time acknowledgement (timestamped and versioned). */
export async function POST() {
  const { access, blocked } = await guardIdeas({ rateLimited: false });
  if (blocked) return blocked;
  try {
    await acknowledgeDisclaimer(access.userId);
    return NextResponse.json({ success: true, data: await getAck(access.userId) });
  } catch (error) {
    return ideaErrorResponse('acknowledge', error);
  }
}
