import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { getRateLimitSettings, resetRateLimits, saveRateLimits, validateRateLimits } from '@/lib/rateLimitConfig';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) return { ctx, blocked: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  return { ctx, blocked: null };
}

/** The effective rate limits with their defaults and who last changed them (admin only). */
export async function GET() {
  const { blocked } = await requireAdmin();
  if (blocked) return blocked;
  return NextResponse.json({ success: true, data: await getRateLimitSettings() });
}

/** Save limits: `{ limiters: { <name>: { standard, entitled } } }`. Validated server-side (whole numbers, entitled >= standard). */
export async function PUT(request: NextRequest) {
  const { ctx, blocked } = await requireAdmin();
  if (blocked) return blocked;
  let body: { limiters?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }
  const checked = validateRateLimits(body?.limiters);
  if (!checked.ok) return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
  await saveRateLimits(checked.values, ctx.email ?? ctx.userId);
  return NextResponse.json({ success: true, data: await getRateLimitSettings() });
}

/** Restore the built-in defaults. */
export async function DELETE() {
  const { blocked } = await requireAdmin();
  if (blocked) return blocked;
  await resetRateLimits();
  return NextResponse.json({ success: true, data: await getRateLimitSettings() });
}
