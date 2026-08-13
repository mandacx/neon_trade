import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { getUserDetail, updateUserPlan } from '@/lib/admin';

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
