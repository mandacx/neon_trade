import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { setFeatureOverride, removeFeatureOverride } from '@/lib/admin';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  if (typeof body?.feature !== 'string' || typeof body?.granted !== 'boolean') {
    return NextResponse.json({ success: false, error: 'feature (string) and granted (boolean) are required' }, { status: 400 });
  }

  await setFeatureOverride(id, body.feature, body.granted, ctx.userId!);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const feature = request.nextUrl.searchParams.get('feature');
  if (!feature) {
    return NextResponse.json({ success: false, error: 'feature query param is required' }, { status: 400 });
  }

  await removeFeatureOverride(id, feature);
  return NextResponse.json({ success: true });
}
