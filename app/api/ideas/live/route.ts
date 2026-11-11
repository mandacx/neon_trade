import { NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse } from '@/lib/ideasApi';
import { listOpenForLive } from '@/lib/ideas';
import { liveBlocksFor } from '@/lib/ideaLive';

export const dynamic = 'force-dynamic';

/**
 * Provisional live marks of every open idea the viewer's plan can read (the board's chips). Same gate and maths as
 * GET /api/ideas/[id]/live; one snapshot request serves the whole batch. Never stored, not the tracked result.
 * `data.live` is an object keyed by idea id; ideas outside the plan are simply absent.
 */
export async function GET() {
  const { access, blocked } = await guardIdeas({ limiter: 'ideas_live' });
  if (blocked) return blocked;
  try {
    const ideas = await listOpenForLive(access);
    if (ideas.length === 0) return NextResponse.json({ success: true, data: { live: {}, market: null } });
    const { blocks, market } = await liveBlocksFor(ideas);
    return NextResponse.json({ success: true, data: { live: Object.fromEntries(blocks), market } });
  } catch (error) {
    return ideaErrorResponse('live-batch', error);
  }
}
