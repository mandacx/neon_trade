import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { deletePref, getPref, isPrefKey, setPref } from '@/lib/userPrefs';

export const dynamic = 'force-dynamic';

/** The signed-in user's own saved UI preference for a known key (value is null when none saved). */
async function auth(key: string) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.userId) return { error: NextResponse.json({ success: false, error: 'Login required' }, { status: 401 }) };
  if (!isPrefKey(key)) return { error: NextResponse.json({ success: false, error: 'Unknown preference' }, { status: 404 }) };
  return { userId: ctx.userId };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const a = await auth(key);
  if ('error' in a) return a.error;
  try {
    return NextResponse.json({ success: true, data: { key, value: (await getPref(a.userId!, key)) ?? null } });
  } catch (error) {
    console.error('[prefs] read failed', error);
    return NextResponse.json({ success: false, error: 'Failed to load preference' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const a = await auth(key);
  if ('error' in a) return a.error;
  let body: { value?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }
  try {
    const stored = await setPref(a.userId!, key, body?.value);
    if (stored === null) return NextResponse.json({ success: false, error: 'Invalid value' }, { status: 400 });
    return NextResponse.json({ success: true, data: { key, value: stored } });
  } catch (error) {
    console.error('[prefs] save failed', error);
    return NextResponse.json({ success: false, error: 'Failed to save preference' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const a = await auth(key);
  if ('error' in a) return a.error;
  try {
    await deletePref(a.userId!, key);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[prefs] reset failed', error);
    return NextResponse.json({ success: false, error: 'Failed to reset preference' }, { status: 500 });
  }
}
