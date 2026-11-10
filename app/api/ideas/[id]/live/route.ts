import { NextRequest, NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse } from '@/lib/ideasApi';
import { getIdeaForLive } from '@/lib/ideas';
import { liveBlocksFor } from '@/lib/ideaLive';
import { OPEN_STATUSES } from '@/lib/ideaTypes';
import { IDEA_DISCLAIMER } from '@/lib/ideaDisclaimer';

export const dynamic = 'force-dynamic';

/**
 * Provisional live mark of one open idea (never stored, not the tracked result). The gated read runs first:
 * 404 for a missing idea and for one outside the viewer's plan (the same answer). A closed idea answers 200
 * with `live: null` so a page that just closed can stop polling cleanly.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, blocked } = await guardIdeas({ limiter: 'ideas_live' });
  if (blocked) return blocked;
  const { id } = await params;
  try {
    const idea = await getIdeaForLive(access, id);
    if (!idea) return NextResponse.json({ success: false, error: 'Idea not found' }, { status: 404 });
    if (!OPEN_STATUSES.includes(idea.status)) {
      return NextResponse.json({ success: true, data: { live: null, reason: 'closed' } });
    }
    const { blocks, market } = await liveBlocksFor([{ id: idea.id, symbol: idea.symbol, plan: idea.plan, official: idea.official }]);
    return NextResponse.json({ success: true, data: { live: blocks.get(idea.id) ?? null, market, disclaimer: IDEA_DISCLAIMER } });
  } catch (error) {
    return ideaErrorResponse('live', error);
  }
}
