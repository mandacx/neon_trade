import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSessionUser } from '@/lib/appUsers';
import { claimAnonymousEvents, isIgnoredUserAgent, recordActivity, type ActivityEventType } from '@/lib/activity';

// Public (not matched by middleware). Always answers 204 — tracking must never
// surface an error to the visitor.
const TYPES: ActivityEventType[] = ['pageview', 'error_client'];
const SID_COOKIE = 'nn_sid';

export async function POST(request: NextRequest) {
  try {
    const ua = request.headers.get('user-agent');
    if (isIgnoredUserAgent(ua)) return new NextResponse(null, { status: 204 });

    // sendBeacon posts text/plain, so parse the raw body.
    const body = JSON.parse(await request.text()) as {
      type?: string; path?: string; referrer?: string; durationMs?: number; message?: string;
    };
    if (!body.type || !TYPES.includes(body.type as ActivityEventType) || typeof body.path !== 'string') {
      return new NextResponse(null, { status: 204 });
    }

    const existing = request.cookies.get(SID_COOKIE)?.value;
    const sessionId = existing || randomUUID();
    const user = await getSessionUser();

    await recordActivity({
      sessionId,
      userId: user?.id ?? null,
      eventType: body.type as ActivityEventType,
      path: body.path,
      referrer: typeof body.referrer === 'string' ? body.referrer : null,
      durationMs: typeof body.durationMs === 'number' ? body.durationMs : null,
      message: typeof body.message === 'string' ? body.message : null,
      userAgent: ua,
    });
    if (user && existing) await claimAnonymousEvents(existing, user.id);

    const res = new NextResponse(null, { status: 204 });
    if (!existing) {
      res.cookies.set(SID_COOKIE, sessionId, { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 365 });
    }
    return res;
  } catch (err) {
    console.error('track: failed', err);
    return new NextResponse(null, { status: 204 });
  }
}
