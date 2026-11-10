import { NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_TELEGRAM_ALERTS } from '@/lib/features';
import { createLinkCode, telegramBotUsername, telegramDeepLink, telegramWebLink } from '@/lib/telegram';

export async function POST() {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_TELEGRAM_ALERTS);
  if (blocked) return blocked;

  // Without the bot's username there is no link to give (it would point at t.me/undefined).
  const botUsername = telegramBotUsername();
  if (!botUsername) {
    return NextResponse.json({ success: false, error: 'Telegram alerts are not available right now. Please try again later.' }, { status: 503 });
  }

  const code = await createLinkCode(ctx.userId!);
  return NextResponse.json({
    success: true,
    data: { code, botUsername, deepLink: telegramDeepLink(code), webLink: telegramWebLink() },
  });
}
