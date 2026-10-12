import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { getSessionHistory, getUserHistory } from '@/lib/adminHistory';

// GET /api/admin/history?user=<id>   or   ?session=<tracker session id>
export async function GET(request: NextRequest) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const user = sp.get('user');
  const session = sp.get('session');
  if ((!user && !session) || (user && session) || (user ?? session)!.length > 100) {
    return NextResponse.json({ success: false, error: 'Pass exactly one of user or session' }, { status: 400 });
  }

  try {
    const data = user ? await getUserHistory(user) : await getSessionHistory(session!);
    if (!data) return NextResponse.json({ success: false, error: user ? 'User not found' : 'Session not found' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('admin history failed', err);
    return NextResponse.json({ success: false, error: 'Failed to load history' }, { status: 500 });
  }
}
