import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { removeSymbol, restoreSymbol, updateStrikeSize } from '@/lib/levelRequests';
import { normalizeLevelSymbol, parseStrikeSize } from '@/lib/levelRequestRules';

export const dynamic = 'force-dynamic';

/**
 * Body: { action: 'remove' | 'restore' | 'strike', strikeSize? }.
 * 'remove' is a soft delete (active = false, deleted_at = now()); the row stays and old levels stay visible.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const symbol = normalizeLevelSymbol(decodeURIComponent((await params).symbol));
  if (!symbol) return NextResponse.json({ success: false, error: 'Invalid ticker' }, { status: 400 });
  let body: { action?: unknown; strikeSize?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }

  let changed = false;
  if (body.action === 'remove') changed = await removeSymbol(symbol);
  else if (body.action === 'restore') changed = await restoreSymbol(symbol);
  else if (body.action === 'strike') {
    const strike = parseStrikeSize(body.strikeSize);
    if (strike == null || body.strikeSize === undefined || body.strikeSize === '') return NextResponse.json({ success: false, error: 'Strike size must be a positive number' }, { status: 400 });
    changed = await updateStrikeSize(symbol, strike);
  } else return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });

  if (!changed) return NextResponse.json({ success: false, error: 'Nothing changed (symbol not found or already in that state)' }, { status: 404 });
  return NextResponse.json({ success: true });
}
