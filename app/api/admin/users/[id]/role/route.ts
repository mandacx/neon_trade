import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { setUserRole } from '@/lib/admin';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  if (id === ctx.userId) {
    return NextResponse.json({ success: false, error: 'You cannot change your own admin role' }, { status: 400 });
  }

  const body = await request.json();
  if (body?.role !== 'user' && body?.role !== 'admin') {
    return NextResponse.json({ success: false, error: "role must be 'user' or 'admin'" }, { status: 400 });
  }

  await setUserRole(id, body.role);
  return NextResponse.json({ success: true });
}
