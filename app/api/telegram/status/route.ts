import { NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_TELEGRAM_ALERTS } from '@/lib/features';
import { getTelegramStatus } from '@/lib/telegram';

export async function GET() {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_TELEGRAM_ALERTS);
  if (blocked) return blocked;

  const status = await getTelegramStatus(ctx.userId!);
  return NextResponse.json({ success: true, data: status });
}
