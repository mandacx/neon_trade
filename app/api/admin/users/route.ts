import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { listUsers } from '@/lib/admin';

export async function GET(request: NextRequest) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const search = sp.get('search');
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 25;
  const offset = sp.get('offset') ? Number(sp.get('offset')) : 0;

  const { users, total } = await listUsers({ search, limit, offset });
  return NextResponse.json({ success: true, data: { users, total } });
}
