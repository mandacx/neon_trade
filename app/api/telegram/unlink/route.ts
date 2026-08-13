import { NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_TELEGRAM_ALERTS } from '@/lib/features';
import { unlinkTelegram } from '@/lib/telegram';

export async function POST() {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_TELEGRAM_ALERTS);
  if (blocked) return blocked;

  await unlinkTelegram(ctx.userId!);
  return NextResponse.json({ success: true });
}
