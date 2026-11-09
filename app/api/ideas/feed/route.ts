import { NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse } from '@/lib/ideasApi';
import { listFeed, markFeedSeen } from '@/lib/ideas';
import { IDEA_DISCLAIMER } from '@/lib/ideaDisclaimer';

export const dynamic = 'force-dynamic';

/** In-app alerts: publish, trigger, target, stop and publisher-update events on ideas the viewer may read. */
export async function GET() {
  const { access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  try {
    return NextResponse.json({ success: true, data: { ...(await listFeed(access)), disclaimer: IDEA_DISCLAIMER } });
  } catch (error) {
    return ideaErrorResponse('feed', error);
  }
}

/** Mark the feed as read. */
export async function POST() {
  const { access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  try {
    await markFeedSeen(access.userId);
    return NextResponse.json({ success: true, data: { ok: true } });
  } catch (error) {
    return ideaErrorResponse('feed seen', error);
  }
}
