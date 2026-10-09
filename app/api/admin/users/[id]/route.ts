import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { deleteUser, getUserDetail, updateUserPlan } from '@/lib/admin';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const user = await getUserDetail(id);
  if (!user) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, data: { user } });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const planId = Number(body?.planId);
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ success: false, error: 'planId is required' }, { status: 400 });
  }
  const planExpiresAt = body?.planExpiresAt ? new Date(body.planExpiresAt).toISOString() : null;

  await updateUserPlan(id, planId, planExpiresAt);
  return NextResponse.json({ success: true });
}

// Permanent delete. Guards: not yourself, not another admin (demote first), and
// the caller must echo the user's email so a stray request can't delete by id alone.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  if (id === ctx.userId) {
    return NextResponse.json({ success: false, error: "You can't delete your own account" }, { status: 400 });
  }
  const user = await getUserDetail(id);
  if (!user) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  if (user.role === 'admin') {
    return NextResponse.json({ success: false, error: 'Remove admin role before deleting this user' }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.confirmEmail !== 'string' || body.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ success: false, error: 'Confirmation email does not match' }, { status: 400 });
  }

  await deleteUser(id, user.email);
  return NextResponse.json({ success: true });
}
