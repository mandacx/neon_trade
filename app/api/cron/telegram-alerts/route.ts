import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cronAuth';
import { sql } from '@/lib/db';
import { getScanAlertsSince, TickerAlert } from '@/lib/scanAlerts';
import { getWatchlistSymbols } from '@/lib/watchlists';
import { sendTelegramMessage, isPermanentTelegramError } from '@/lib/telegram';
import { getLevelDisplayName, isUsMarketHours } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_CONSECUTIVE_FAILURES = 5;
const SEND_STAGGER_MS = 35; // Telegram's ~30 msg/sec global limit — a non-issue at this send pattern/scale.

interface Subscriber {
  user_id: string;
  watchlist_id: string;
  telegram_chat_id: string;
  last_alert_time: string | null;
  consecutive_failures: number;
  tg_alerts: boolean;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatAlertLine(a: TickerAlert): string {
  const up = a.direction === 'buy_above';
  const time = a.loadDateTime.split(' ')[1]?.slice(0, 5) ?? a.loadDateTime;
  return `${a.symbol} — ${up ? '▲' : '▼'} ${getLevelDisplayName(a.level)} @ $${a.price.toFixed(2)} (${time})`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // The Railway cron schedule is deliberately a wide UTC superset spanning
  // both DST states (see railway/telegram-alerts-cron/railway.json) — this
  // is the precise cut, so the schedule doesn't need to encode NYSE hours
  // exactly and stays correct across DST transitions without editing.
  if (!isUsMarketHours(new Date())) {
    return NextResponse.json({ success: true, data: { skipped: 'outside market hours' } });
  }

  try {
    // Entitlement is resolved here rather than in the loop so a downgrade or an
    // expired plan takes effect on the very next run. `eff` mirrors
    // getCurrentUserContext()'s semantics: plan features, minus revoked
    // overrides, plus granted ones.
    const subscribers = await sql`
      WITH eff AS (
        SELECT u.user_id, u.plan_expires_at,
          COALESCE((
            SELECT jsonb_agg(f) FROM (
              SELECT jsonb_array_elements_text(p.features) AS f
              EXCEPT
              SELECT o.feature FROM public.nt_user_feature_overrides o
                WHERE o.user_id = u.user_id AND NOT o.granted
              UNION
              SELECT o.feature FROM public.nt_user_feature_overrides o
                WHERE o.user_id = u.user_id AND o.granted
            ) x
          ), '[]'::jsonb) AS features
        FROM public.nt_app_user_profiles u
        JOIN public.nt_plans p ON p.id = u.plan_id
      )
      SELECT s.user_id, s.watchlist_id, u.telegram_chat_id,
             c.last_alert_time::timestamp::text as last_alert_time, c.consecutive_failures,
             (e.features ? 'telegram_alerts') AS tg_alerts
      FROM public.nt_telegram_alert_subscriptions s
      JOIN public.nt_app_user_profiles u ON u.user_id = s.user_id
      JOIN public.nt_telegram_alert_cursors c ON c.user_id = s.user_id
      JOIN eff e ON e.user_id = s.user_id
      WHERE u.telegram_chat_id IS NOT NULL AND c.disabled_at IS NULL
        AND (e.plan_expires_at IS NULL OR e.plan_expires_at > now())
        AND (e.features ? 'telegram_alerts')
    ` as unknown as Subscriber[];

    if (subscribers.length === 0) {
      return NextResponse.json({ success: true, data: { subscribers: 0, sent: 0 } });
    }

    // One shared fetch for everyone, from the earliest cursor among them —
    // over-fetching here is always safe, never a source of dropped alerts.
    const validCursors = subscribers.map(s => s.last_alert_time).filter((t): t is string => !!t);
    if (validCursors.length === 0) {
      return NextResponse.json({ success: true, data: { subscribers: subscribers.length, sent: 0, note: 'no valid cursors' } });
    }
    const globalSince = validCursors.reduce((min, t) => (t < min ? t : min));
    const batch = await getScanAlertsSince(globalSince, 500);

    let sent = 0;
    let skippedEmpty = 0;
    let failed = 0;

    for (const sub of subscribers) {
      try {
        const symbols = new Set(await getWatchlistSymbols(sub.watchlist_id, sub.user_id));
        const sinceThisUser = sub.last_alert_time ?? globalSince;
        const newForUser = batch.filter(a => a.loadDateTime > sinceThisUser);
        // Filter deliberately sits AFTER newForUser (which newCursor is
        // derived from) so an unentitled user's alerts still advance the
        // cursor — otherwise a later upgrade would blast the whole backlog.
        const matched = newForUser
          .filter(a => symbols.has(a.symbol))
          .filter(() => sub.tg_alerts);

        // Cursor advances to everything this user *considered*, matched or
        // not — prevents endless re-scanning of irrelevant rows and still
        // surfaces alerts for symbols added to the watchlist later.
        const newCursor = newForUser.length > 0
          ? newForUser.reduce((max, a) => (a.loadDateTime > max ? a.loadDateTime : max), newForUser[0].loadDateTime)
          : sinceThisUser;

        if (matched.length === 0) {
          skippedEmpty++;
          if (newCursor !== sinceThisUser) {
            await sql`UPDATE public.nt_telegram_alert_cursors SET last_alert_time = ${newCursor}, updated_at = now() WHERE user_id = ${sub.user_id}`;
          }
          continue;
        }

        const text = `📈 Alert Update (${matched.length} new)\n${matched.map(formatAlertLine).join('\n')}`;
        const result = await sendTelegramMessage(sub.telegram_chat_id, text);

        if (result.ok) {
          sent++;
          await sql`
            UPDATE public.nt_telegram_alert_cursors
            SET last_alert_time = ${newCursor}, consecutive_failures = 0, updated_at = now()
            WHERE user_id = ${sub.user_id}
          `;
        } else if (isPermanentTelegramError(result)) {
          failed++;
          console.error(`telegram-alerts: permanent failure for user ${sub.user_id}:`, result.description);
          // Cursor still advances (the alert remains visible in-app; only
          // Telegram delivery is disabled) so a re-link later doesn't
          // trigger a backlog blast.
          await sql`
            UPDATE public.nt_telegram_alert_cursors
            SET last_alert_time = ${newCursor}, disabled_at = now(), updated_at = now()
            WHERE user_id = ${sub.user_id}
          `;
        } else {
          failed++;
          console.error(`telegram-alerts: transient failure for user ${sub.user_id}:`, result.description);
          const failures = sub.consecutive_failures + 1;
          const disable = failures >= MAX_CONSECUTIVE_FAILURES;
          // Cursor NOT advanced on transient failure — must retry this batch next run.
          await sql`
            UPDATE public.nt_telegram_alert_cursors
            SET consecutive_failures = ${failures}, disabled_at = ${disable ? sql`now()` : null}, updated_at = now()
            WHERE user_id = ${sub.user_id}
          `;
        }

        await sleep(SEND_STAGGER_MS);
      } catch (err) {
        // One bad subscriber must never break the run for everyone else.
        failed++;
        console.error(`telegram-alerts: unexpected error for user ${sub.user_id}:`, err);
      }
    }

    return NextResponse.json({ success: true, data: { subscribers: subscribers.length, sent, skippedEmpty, failed } });
  } catch (error) {
    console.error('telegram-alerts cron error', error);
    return NextResponse.json(
      { success: false, error: 'Telegram alert delivery failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
