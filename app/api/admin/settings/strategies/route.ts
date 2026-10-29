import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { getStrategySettings, saveStrategySettings, validateDisabled } from '@/lib/strategySettings';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) return { ctx, blocked: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  return { ctx, blocked: null };
}

/** Strategy Builder templates that are switched off (admin only). */
export async function GET() {
  const { blocked } = await requireAdmin();
  if (blocked) return blocked;
  return NextResponse.json({ success: true, data: await getStrategySettings() });
}

/** Save `{ disabled: templateId[] }`; unknown ids are dropped. */
export async function PUT(request: NextRequest) {
  const { ctx, blocked } = await requireAdmin();
  if (blocked) return blocked;
  let body: { disabled?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }
  const disabled = validateDisabled(body?.disabled);
  if (!disabled) return NextResponse.json({ success: false, error: 'disabled must be an array of template ids' }, { status: 400 });
  await saveStrategySettings(disabled, ctx.email ?? ctx.userId);
  return NextResponse.json({ success: true, data: await getStrategySettings() });
}
