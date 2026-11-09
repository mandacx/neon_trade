import { NextRequest, NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse, readJson } from '@/lib/ideasApi';
import { listIdeas, previewIdea, saveDraft, getAck } from '@/lib/ideas';
import { IDEA_DISCLAIMER } from '@/lib/ideaDisclaimer';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** The board: published ideas in the viewer's terms. `?tab=open|closed|all&horizon=&direction=&symbol=&limit=&offset=` */
export async function GET(request: NextRequest) {
  const { access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  const sp = request.nextUrl.searchParams;
  const tab = sp.get('tab') === 'closed' ? 'closed' : sp.get('tab') === 'all' ? 'all' : 'open';
  try {
    const [list, ack] = await Promise.all([
      listIdeas(access, {
        tab, horizon: sp.get('horizon'), direction: sp.get('direction'), symbol: sp.get('symbol'),
        limit: Number(sp.get('limit')) || 50, offset: Number(sp.get('offset')) || 0,
      }),
      getAck(access.userId),
    ]);
    return NextResponse.json({
      success: true,
      data: { ...list, canPublish: access.canPublish, terms: access.terms, acknowledged: ack.acknowledged, disclaimer: IDEA_DISCLAIMER },
    });
  } catch (error) {
    return ideaErrorResponse('list', error);
  }
}

/**
 * Publishers: save a draft, or with `?dry_run=true` return exactly what each plan tier will receive (and the
 * alert payload) without saving anything. Body: the plan (see lib/ideaTypes.ts IdeaPlanInput); `id` updates a draft.
 */
export async function POST(request: NextRequest) {
  const { access, blocked } = await guardIdeas({ publish: true });
  if (blocked) return blocked;
  const body = await readJson(request);
  if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  try {
    if (request.nextUrl.searchParams.get('dry_run') === 'true') {
      return NextResponse.json({ success: true, data: await previewIdea(access, body) });
    }
    const id = await saveDraft(access, body, typeof body.id === 'string' || typeof body.id === 'number' ? String(body.id) : undefined);
    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error) {
    return ideaErrorResponse('save', error);
  }
}
