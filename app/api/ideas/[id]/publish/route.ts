import { NextRequest, NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse } from '@/lib/ideasApi';
import { publishIdea } from '@/lib/ideas';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Publish a draft. The plan is frozen from this moment (a DB trigger rejects edits); changes become updates. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, blocked } = await guardIdeas({ publish: true });
  if (blocked) return blocked;
  const { id } = await params;
  try {
    await publishIdea(access, id);
    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    return ideaErrorResponse('publish', error);
  }
}
