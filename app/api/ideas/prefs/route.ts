import { NextRequest, NextResponse } from 'next/server';
import { guardIdeas, ideaErrorResponse, readJson } from '@/lib/ideasApi';
import { getPrefs, setPrefs } from '@/lib/ideas';
import { emailConfigured } from '@/lib/email';
import { countPushDevices, pushConfigured, telegramConfigured } from '@/lib/ideaChannels';
import { FEATURE_TELEGRAM_ALERTS, hasFeature } from '@/lib/features';

export const dynamic = 'force-dynamic';

/**
 * Alert preferences. In-app alerts are always on; email, Telegram and browser push are opt-in. The response also says
 * which channels can work at all (configured on the server, Telegram linked and on the plan, devices registered).
 */
export async function GET() {
  const { ctx, access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  try {
    const [prefs, devices] = await Promise.all([getPrefs(access.userId), countPushDevices(access.userId)]);
    return NextResponse.json({
      success: true,
      data: {
        ...prefs,
        emailAvailable: emailConfigured(),
        telegramAvailable: telegramConfigured(),
        telegramLinked: ctx.telegramLinked,
        telegramEntitled: hasFeature(ctx.features, FEATURE_TELEGRAM_ALERTS),
        pushAvailable: pushConfigured(),
        pushDevices: devices,
      },
    });
  } catch (error) {
    return ideaErrorResponse('prefs', error);
  }
}

/** Body: any of `{ emailAlerts, telegramAlerts, pushAlerts }` (booleans). */
export async function POST(request: NextRequest) {
  const { ctx, access, blocked } = await guardIdeas();
  if (blocked) return blocked;
  const body = await readJson(request);
  const keys = ['emailAlerts', 'telegramAlerts', 'pushAlerts'] as const;
  if (!body || !keys.some(k => typeof body[k] === 'boolean')) return NextResponse.json({ success: false, error: 'Send emailAlerts, telegramAlerts or pushAlerts (boolean)' }, { status: 400 });
  if (body.telegramAlerts === true) {
    if (!ctx.telegramLinked) return NextResponse.json({ success: false, error: 'Link Telegram from your profile first.' }, { status: 409 });
    if (!hasFeature(ctx.features, FEATURE_TELEGRAM_ALERTS)) return NextResponse.json({ success: false, error: 'Telegram alerts are not part of your plan.', feature: FEATURE_TELEGRAM_ALERTS }, { status: 403 });
  }
  if (body.pushAlerts === true && (await countPushDevices(access.userId)) === 0) {
    return NextResponse.json({ success: false, error: 'Enable notifications in this browser first.' }, { status: 409 });
  }
  try {
    const prefs = await setPrefs(access.userId, { emailAlerts: body.emailAlerts, telegramAlerts: body.telegramAlerts, pushAlerts: body.pushAlerts });
    return NextResponse.json({ success: true, data: prefs });
  } catch (error) {
    return ideaErrorResponse('prefs', error);
  }
}
