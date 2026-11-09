/**
 * Trade Ideas alert delivery beyond the in-app feed: email, Telegram and web push (docs/trade-ideas.md, "Alerts").
 * Server-only. All three share one pattern:
 *   1. find (event, user) pairs for opted-in users whose *effective* features include the event's term
 *      (plan, minus revoked overrides, plus granted ones, plan not expired), in the last 3 days, with no
 *      delivery row yet for that channel;
 *   2. reserve a `nt_idea_deliveries` row first (unique per event, user, channel), so exactly one alert goes out
 *      even with overlapping runs; 3. send; 4. record the result. Failures are recorded and not retried.
 * A channel that is not configured (no Resend key / bot token / VAPID keys) is skipped, never marked delivered.
 */
import 'server-only';
import { sendNotification, setVapidDetails } from 'web-push';
import { sql } from '@/lib/db';
import { sendEmail, emailConfigured } from '@/lib/email';
import { isPermanentTelegramError, sendTelegramMessage } from '@/lib/telegram';
import { SITE_URL } from '@/lib/site';
import { disclaimerHtml, disclaimerText } from '@/lib/ideaDisclaimer';
import { pushPayload, telegramText } from '@/lib/ideaMessages';

export const telegramConfigured = () => !!process.env.TELEGRAM_BOT_TOKEN;
export const pushConfigured = () => !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? null;

// ---------------------------------------------------------------------------------------------------
// Web push subscriptions (one row per device)
// ---------------------------------------------------------------------------------------------------

export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }

export function parsePushSubscription(raw: any): PushSub | null {
  const endpoint = raw?.endpoint;
  const p256dh = raw?.keys?.p256dh;
  const auth = raw?.keys?.auth;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) return null;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export async function savePushSubscription(userId: string, sub: PushSub, userAgent: string | null): Promise<void> {
  // The endpoint is unique per device; a re-subscribe by another account on the same browser moves it.
  await sql(
    `INSERT INTO public.nt_idea_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, user_agent = $5`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent?.slice(0, 300) ?? null],
  );
}

export async function removePushSubscription(userId: string, endpoint: string): Promise<number> {
  await sql(`DELETE FROM public.nt_idea_push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [userId, endpoint]);
  const left = await sql(`SELECT count(*)::int AS n FROM public.nt_idea_push_subscriptions WHERE user_id = $1`, [userId]);
  return Number(left[0]?.n ?? 0);
}

export async function countPushDevices(userId: string): Promise<number> {
  const rows = await sql(`SELECT count(*)::int AS n FROM public.nt_idea_push_subscriptions WHERE user_id = $1`, [userId]);
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------------------------------

type Channel = 'email' | 'telegram' | 'push';
const PREF_COLUMN: Record<Channel, string> = { email: 'email_alerts', telegram: 'telegram_alerts', push: 'push_alerts' };

interface Candidate { event_id: number; idea_id: number; summary: string; event_type: string; user_id: string; email: string | null; telegram_chat_id: string | null }

async function candidates(channel: Channel): Promise<Candidate[]> {
  // The column name comes from a fixed map, never from input.
  const flag = PREF_COLUMN[channel];
  // Telegram alerts are the plan's existing "Telegram Alerts" feature: needs it, and a linked chat.
  const extra = channel === 'telegram' ? `AND u.telegram_chat_id IS NOT NULL AND eff.features ? 'telegram_alerts'` : channel === 'push' ? `AND EXISTS (SELECT 1 FROM public.nt_idea_push_subscriptions s WHERE s.user_id = p.user_id)` : '';
  const rows = await sql(`
    WITH eff AS (
      SELECT u.user_id, u.plan_expires_at,
        COALESCE((
          SELECT jsonb_agg(f) FROM (
            SELECT jsonb_array_elements_text(p.features) AS f
            EXCEPT SELECT o.feature FROM public.nt_user_feature_overrides o WHERE o.user_id = u.user_id AND NOT o.granted
            UNION SELECT o.feature FROM public.nt_user_feature_overrides o WHERE o.user_id = u.user_id AND o.granted
          ) x
        ), '[]'::jsonb) AS features
      FROM public.nt_app_user_profiles u JOIN public.nt_plans p ON p.id = u.plan_id
    )
    SELECT e.id AS event_id, e.idea_id, e.summary, e.event_type, p.user_id, a.email, u.telegram_chat_id
    FROM public.nt_idea_events e
    JOIN public.nt_idea_prefs p ON p.${flag}
    JOIN public.nt_app_user_profiles u ON u.user_id = p.user_id
    JOIN eff ON eff.user_id = p.user_id AND (eff.plan_expires_at IS NULL OR eff.plan_expires_at > now())
    JOIN neon_auth."user" a ON a.id = p.user_id::uuid
    WHERE e.created_at > now() - interval '3 days'
      AND ((e.horizon IN ('intraday','swing') AND eff.features ? 'ideas_short_term')
        OR (e.horizon IN ('positional','long_term') AND eff.features ? 'ideas_long_term'))
      ${extra}
      AND NOT EXISTS (SELECT 1 FROM public.nt_idea_deliveries d WHERE d.event_id = e.id AND d.user_id = p.user_id AND d.channel = $1)
    ORDER BY e.id LIMIT 200
  `, [channel]);
  return rows as unknown as Candidate[];
}

/** Reserve the (event, user, channel) row. Null when another run already has it. */
async function claim(c: Candidate, channel: Channel): Promise<string | null> {
  const r = await sql(`INSERT INTO public.nt_idea_deliveries (event_id, user_id, channel, status) VALUES ($1,$2,$3,'sending') ON CONFLICT DO NOTHING RETURNING id`, [c.event_id, c.user_id, channel]);
  return r.length ? String(r[0].id) : null;
}
const finish = (id: string, ok: boolean, error: string | null) =>
  sql(`UPDATE public.nt_idea_deliveries SET status=$2, error=$3 WHERE id=$1`, [id, ok ? 'sent' : 'failed', error?.slice(0, 300) ?? null]);

export interface ChannelResult { configured: boolean; candidates: number; sent: number; failed: number }
export interface DeliveryResult { email: ChannelResult; telegram: ChannelResult; push: ChannelResult }

const empty = (configured: boolean): ChannelResult => ({ configured, candidates: 0, sent: 0, failed: 0 });

async function deliverEmail(deadline: number): Promise<ChannelResult> {
  const out = empty(emailConfigured());
  if (!out.configured) return out;
  const cands = await candidates('email');
  out.candidates = cands.length;
  for (const c of cands) {
    if (Date.now() > deadline) break;
    const id = await claim(c, 'email');
    if (!id || !c.email) { if (id) await finish(id, false, 'no email address'); continue; }
    const link = `${SITE_URL}/ideas/${c.idea_id}`;
    const r = await sendEmail({
      to: c.email,
      subject: c.summary.slice(0, 120),
      text: `${c.summary}\n\nOpen the idea: ${link}\n\n${disclaimerText()}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827"><p style="font-size:15px">${c.summary.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p><p><a href="${link}">Open the idea</a></p>${disclaimerHtml()}</div>`,
    });
    await finish(id, r.ok, r.ok ? null : r.error);
    if (r.ok) out.sent++; else out.failed++;
  }
  return out;
}

async function deliverTelegram(deadline: number): Promise<ChannelResult> {
  const out = empty(telegramConfigured());
  if (!out.configured) return out;
  const cands = await candidates('telegram');
  out.candidates = cands.length;
  for (const c of cands) {
    if (Date.now() > deadline) break;
    const id = await claim(c, 'telegram');
    if (!id || !c.telegram_chat_id) { if (id) await finish(id, false, 'no linked chat'); continue; }
    const r = await sendTelegramMessage(c.telegram_chat_id, telegramText(c.summary, `${SITE_URL}/ideas/${c.idea_id}`));
    await finish(id, r.ok, r.ok ? null : `${r.errorCode ?? ''} ${r.description ?? 'failed'}`.trim());
    // A blocked bot or a deleted chat will never work: stop trying for this user (they can switch it back on).
    if (!r.ok && isPermanentTelegramError(r)) await sql(`UPDATE public.nt_idea_prefs SET telegram_alerts = false, updated_at = now() WHERE user_id = $1`, [c.user_id]);
    if (r.ok) out.sent++; else out.failed++;
  }
  return out;
}

async function deliverPush(deadline: number): Promise<ChannelResult> {
  const out = empty(pushConfigured());
  if (!out.configured) return out;
  setVapidDetails(process.env.VAPID_SUBJECT || `mailto:${process.env.EMAIL_REPLY_TO || 'support@stockstrendz.com'}`, process.env.VAPID_PUBLIC_KEY as string, process.env.VAPID_PRIVATE_KEY as string);
  const cands = await candidates('push');
  out.candidates = cands.length;
  for (const c of cands) {
    if (Date.now() > deadline) break;
    const id = await claim(c, 'push');
    if (!id) continue;
    const subs = await sql(`SELECT endpoint, p256dh, auth FROM public.nt_idea_push_subscriptions WHERE user_id = $1`, [c.user_id]);
    const body = JSON.stringify(pushPayload(c.summary, c.idea_id, c.event_type));
    let ok = 0;
    let lastError: string | null = null;
    for (const s of subs as any[]) {
      try {
        await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600, urgency: 'normal' });
        ok++;
        await sql(`UPDATE public.nt_idea_push_subscriptions SET last_ok_at = now() WHERE endpoint = $1`, [s.endpoint]);
      } catch (e: any) {
        lastError = `${e?.statusCode ?? ''} ${e?.body ?? e?.message ?? 'failed'}`.trim();
        // 404 / 410: the browser dropped the subscription; remove it so we stop trying.
        if (e?.statusCode === 404 || e?.statusCode === 410) await sql(`DELETE FROM public.nt_idea_push_subscriptions WHERE endpoint = $1`, [s.endpoint]);
      }
    }
    await finish(id, ok > 0, ok > 0 ? null : lastError ?? 'no devices');
    if (ok > 0) out.sent++; else out.failed++;
  }
  return out;
}

/** Run every configured channel. Never throws for one channel's failure. */
export async function deliverAlerts(deadline: number): Promise<DeliveryResult> {
  const safe = async (fn: () => Promise<ChannelResult>, configured: boolean): Promise<ChannelResult> => {
    try { return await fn(); } catch (error) { console.error('[ideas] channel delivery failed', error instanceof Error ? error.message : error); return { ...empty(configured), failed: 1 }; }
  };
  const email = await safe(() => deliverEmail(deadline), emailConfigured());
  const telegram = await safe(() => deliverTelegram(deadline), telegramConfigured());
  const push = await safe(() => deliverPush(deadline), pushConfigured());
  return { email, telegram, push };
}
