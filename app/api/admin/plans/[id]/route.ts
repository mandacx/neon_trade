import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { setPlanActive, updatePlanFeatures } from '@/lib/admin';

/** Body: `{ features?: string[], isActive?: boolean }`, at least one. `isActive` = listed on /upgrade. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const planId = Number(id);
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ success: false, error: 'Invalid plan id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const hasFeatures = body?.features !== undefined;
  const hasActive = body?.isActive !== undefined;
  if (!hasFeatures && !hasActive) {
    return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 });
  }
  if (hasFeatures && (!Array.isArray(body.features) || !body.features.every((f: unknown) => typeof f === 'string'))) {
    return NextResponse.json({ success: false, error: 'features must be a string array' }, { status: 400 });
  }
  if (hasActive && typeof body.isActive !== 'boolean') {
    return NextResponse.json({ success: false, error: 'isActive must be a boolean' }, { status: 400 });
  }

  if (hasFeatures) await updatePlanFeatures(planId, body.features);
  if (hasActive && !(await setPlanActive(planId, body.isActive))) {
    return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
