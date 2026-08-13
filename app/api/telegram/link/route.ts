import { NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_TELEGRAM_ALERTS } from '@/lib/features';
import { createLinkCode, telegramDeepLink, telegramWebLink } from '@/lib/telegram';

export async function POST() {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_TELEGRAM_ALERTS);
  if (blocked) return blocked;

  const code = await createLinkCode(ctx.userId!);
  return NextResponse.json({
    success: true,
    data: { code, deepLink: telegramDeepLink(code), webLink: telegramWebLink() },
  });
}
