import { NextRequest, NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse, readJson } from '@/lib/ideasApi';
import { evaluateIdeas, publishDueIdeas } from '@/lib/ideas';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Publisher/admin: re-run the tracker now. `{ ideaId }` for one idea, `{ all: true }` to rebuild every published
 * idea's outcome from the bars (outcomes are derived, so this is always safe).
 */
export async function POST(request: NextRequest) {
  const { blocked } = await guardIdeas({ publish: true });
  if (blocked) return blocked;
  const body = (await readJson(request)) ?? {};
  try {
    const due = await publishDueIdeas(Date.now() + 20_000);
    const result = await evaluateIdeas({
      all: body.all === true, ideaId: typeof body.ideaId === 'string' || typeof body.ideaId === 'number' ? String(body.ideaId) : undefined,
      deadline: Date.now() + 50_000,
    });
    return NextResponse.json({ success: true, data: { ...result, scheduledPublished: due.published, scheduledFailed: due.failed } });
  } catch (error) {
    return ideaErrorResponse('evaluate', error);
  }
}
