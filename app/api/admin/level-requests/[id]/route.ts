import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { approveRequest, rejectRequest } from '@/lib/levelRequests';
import { cleanText, MAX_COMPANY_NAME_LENGTH, MAX_NOTE_LENGTH, parseStrikeSize } from '@/lib/levelRequestRules';

export const dynamic = 'force-dynamic';

/** Body: { action: 'approve' | 'reject', strikeSize? (default 5), companyName?, note? }. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin || !ctx.userId) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
  let body: { action?: unknown; strikeSize?: unknown; companyName?: unknown; note?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }
  const note = cleanText(body?.note, MAX_NOTE_LENGTH);

  if (body.action === 'approve') {
    const strikeSize = parseStrikeSize(body.strikeSize);
    if (strikeSize == null) return NextResponse.json({ success: false, error: 'Strike size must be a positive number' }, { status: 400 });
    const out = await approveRequest(id, ctx.userId, { strikeSize, companyName: cleanText(body.companyName, MAX_COMPANY_NAME_LENGTH), note });
    if (!out) return NextResponse.json({ success: false, error: 'Request not found or already decided' }, { status: 404 });
    return NextResponse.json({ success: true, data: out });
  }
  if (body.action === 'reject') {
    const ok = await rejectRequest(id, ctx.userId, note);
    if (!ok) return NextResponse.json({ success: false, error: 'Request not found or already decided' }, { status: 404 });
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
}
