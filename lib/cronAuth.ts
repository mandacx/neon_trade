import { NextRequest } from 'next/server';

/** Cron caller (Railway, or any external scheduler) sends `Authorization: Bearer ${CRON_SECRET}`. */
export function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured -> allow (e.g. local/dev)
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}
