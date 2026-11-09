import { NextRequest, NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse, readJson } from '@/lib/ideasApi';
import { countPushDevices, parsePushSubscription, pushConfigured, removePushSubscription, savePushSubscription, vapidPublicKey } from '@/lib/ideaChannels';
import { setPrefs } from '@/lib/ideas';

export const dynamic = 'force-dynamic';

/** The VAPID public key the browser needs to subscribe (null when push is not configured), and this user's device count. */
export async function GET() {
  const { access, blocked } = await guardIdeas({ rateLimited: false });
  if (blocked) return blocked;
  try {
    return NextResponse.json({ success: true, data: { available: pushConfigured(), publicKey: pushConfigured() ? vapidPublicKey() : null, devices: await countPushDevices(access.userId) } });
  } catch (error) {
    return ideaErrorResponse('push get', error);
  }
}

/** Register this browser: `{ subscription: PushSubscription.toJSON() }`. Also switches push alerts on. */
export async function POST(request: NextRequest) {
  const { access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  if (!pushConfigured()) return NextResponse.json({ success: false, error: 'Browser notifications are not set up on the server yet.' }, { status: 503 });
  const body = await readJson(request);
  const sub = parsePushSubscription(body?.subscription);
  if (!sub) return NextResponse.json({ success: false, error: 'Invalid subscription' }, { status: 400 });
  try {
    await savePushSubscription(access.userId, sub, request.headers.get('user-agent'));
    await setPrefs(access.userId, { pushAlerts: true });
    return NextResponse.json({ success: true, data: { devices: await countPushDevices(access.userId) } }, { status: 201 });
  } catch (error) {
    return ideaErrorResponse('push subscribe', error);
  }
}

/** Remove this browser: `{ endpoint }`. Push alerts switch off when no device is left. */
export async function DELETE(request: NextRequest) {
  const { access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  const body = await readJson(request);
  if (!body || typeof body.endpoint !== 'string') return NextResponse.json({ success: false, error: 'endpoint is required' }, { status: 400 });
  try {
    const left = await removePushSubscription(access.userId, body.endpoint);
    if (left === 0) await setPrefs(access.userId, { pushAlerts: false });
    return NextResponse.json({ success: true, data: { devices: left } });
  } catch (error) {
    return ideaErrorResponse('push unsubscribe', error);
  }
}
