import { NextRequest, NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse, readJson } from '@/lib/ideasApi';
import { addUpdate } from '@/lib/ideas';

export const dynamic = 'force-dynamic';

/**
 * Append a timeline entry to a published idea: { type: note|stop_moved|partial_booked|dates_changed|closed|cancelled, body?, stop?, price?, pct?, validUntil?, entryBy? }.
 * Append-only: there is no edit or delete. The original entry, targets and stop are still what gets scored.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, blocked } = await guardIdeas({ publish: true });
  if (blocked) return blocked;
  const { id } = await params;
  const body = await readJson(request);
  if (!body || typeof body.type !== 'string') return NextResponse.json({ success: false, error: 'type is required' }, { status: 400 });
  try {
    const updateId = await addUpdate(access, id, {
      type: body.type, body: typeof body.body === 'string' ? body.body : '',
      stop: typeof body.stop === 'number' ? body.stop : undefined,
      price: typeof body.price === 'number' ? body.price : undefined,
      pct: typeof body.pct === 'number' ? body.pct : undefined,
      // dates_changed: a key that is present is changed (null or '' clears it); an absent key is left alone.
      ...('validUntil' in body ? { validUntil: typeof body.validUntil === 'string' && body.validUntil.trim() ? body.validUntil : body.validUntil === undefined ? undefined : null } : {}),
      ...('entryBy' in body ? { entryBy: typeof body.entryBy === 'string' && body.entryBy.trim() ? body.entryBy : body.entryBy === undefined ? undefined : null } : {}),
    });
    return NextResponse.json({ success: true, data: { id: updateId } }, { status: 201 });
  } catch (error) {
    return ideaErrorResponse('update', error);
  }
}
