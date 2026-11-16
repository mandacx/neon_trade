import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { addSymbolDirect, listRequests, listTracked } from '@/lib/levelRequests';
import { cleanText, MAX_COMPANY_NAME_LENGTH, normalizeLevelSymbol, parseStrikeSize } from '@/lib/levelRequestRules';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin || !ctx.userId) return { ctx, blocked: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  return { ctx, blocked: null };
}

/** Pending + recently decided requests and the tracked list. ?search=&removed=1&limit=&offset= */
export async function GET(request: NextRequest) {
  const { blocked } = await requireAdmin();
  if (blocked) return blocked;
  const sp = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 100, 1), 500);
  const offset = Math.max(Number(sp.get('offset')) || 0, 0);
  try {
    const [pending, decided, tracked] = await Promise.all([
      listRequests('pending'),
      listRequests('decided', 50),
      listTracked({ search: sp.get('search')?.trim() || null, includeRemoved: sp.get('removed') === '1', limit, offset }),
    ]);
    return NextResponse.json({ success: true, data: { pending, decided, tracked } });
  } catch (error) {
    console.error('[admin/level-symbols] list failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'Could not load the list (has scripts/create-level-requests.mjs been run?)' }, { status: 500 });
  }
}

/** Add (or reactivate) a symbol directly. Body: { symbol, companyName?, strikeSize? } (strike size defaults to 5). */
export async function POST(request: NextRequest) {
  const { ctx, blocked } = await requireAdmin();
  if (blocked) return blocked;
  let body: { symbol?: unknown; companyName?: unknown; strikeSize?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }
  const symbol = normalizeLevelSymbol(body?.symbol);
  if (!symbol) return NextResponse.json({ success: false, error: 'Invalid ticker' }, { status: 400 });
  const strike = parseStrikeSize(body?.strikeSize);
  if (strike == null) return NextResponse.json({ success: false, error: 'Strike size must be a positive number' }, { status: 400 });
  await addSymbolDirect(symbol, ctx.userId!, cleanText(body?.companyName, MAX_COMPANY_NAME_LENGTH), strike);
  return NextResponse.json({ success: true, data: { symbol } });
}
