import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { updatePlanFeatures } from '@/lib/admin';

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

  const body = await request.json();
  if (!Array.isArray(body?.features) || !body.features.every((f: unknown) => typeof f === 'string')) {
    return NextResponse.json({ success: false, error: 'features must be a string array' }, { status: 400 });
  }

  await updatePlanFeatures(planId, body.features);
  return NextResponse.json({ success: true });
}
