import { sql } from '@/lib/db';

// Plain-fetch Telegram Bot API client — no SDK, this surface is small enough
// not to need one. Combined with the linking/subscription DB layer in this
// same file since both are small and tightly scoped to this one feature.

const TELEGRAM_API_BASE = 'https://api.telegram.org';

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  return token;
}

export interface SendMessageResult {
  ok: boolean;
  errorCode?: number;
  description?: string;
}

/**
 * Sends a plain-text message to a chat. Deliberately no `parse_mode` — some
 * tickers/symbol names can contain characters (e.g. `&`) that HTML/Markdown
 * parse modes would choke on unless escaped; plain text sidesteps that
 * entirely since nothing here needs rich formatting. Never throws — returns
 * {ok:false,...} on failure.
 */
export async function sendTelegramMessage(chatId: string, text: string): Promise<SendMessageResult> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      return { ok: false, errorCode: json.error_code, description: json.description };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, description: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/** True for errors meaning the chat is permanently gone (bot blocked, chat/user not found) vs. worth retrying. */
export function isPermanentTelegramError(result: SendMessageResult): boolean {
  return result.errorCode === 403 || (result.errorCode === 400 && /chat not found/i.test(result.description ?? ''));
}

/** 8-char code (no 0/O/1/I, avoids visual ambiguity) for the /start deep-link linking flow. */
export function generateLinkCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

export function telegramDeepLink(code: string): string {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  return `https://t.me/${username}?start=${code}`;
}

/**
 * Telegram Web doesn't auto-run the `start` payload from a `t.me` link —
 * clients register `tg://`/`t.me` handlers for the desktop/mobile apps first,
 * and per Telegram's own deep-link docs the `#` fragment web clients use for
 * routing is ignored when parsing deep links. So this just opens the bot's
 * chat in Telegram Web; the user still has to send `/start <code>` there.
 */
export function telegramWebLink(): string {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  return `https://web.telegram.org/k/#@${username}`;
}

const LINK_CODE_TTL_MS = 15 * 60 * 1000;

/** Creates a fresh link code for a user, 15-minute expiry. */
export async function createLinkCode(userId: string): Promise<string> {
  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
  await sql`INSERT INTO public.telegram_link_codes (code, user_id, expires_at) VALUES (${code}, ${userId}, ${expiresAt})`;
  return code;
}

/**
 * Validates and consumes a link code. Returns the owning user_id, or null if
 * the code doesn't exist, already expired, or was already used — the
 * `consumed_at` check makes a retried Telegram webhook delivery a safe
 * no-op (no separate update_id dedupe table needed).
 */
export async function consumeLinkCode(code: string): Promise<string | null> {
  const rows = await sql`
    UPDATE public.telegram_link_codes
    SET consumed_at = now()
    WHERE code = ${code} AND consumed_at IS NULL AND expires_at > now()
    RETURNING user_id
  `;
  return (rows[0] as { user_id: string } | undefined)?.user_id ?? null;
}

/**
 * Links a chat to a user. Returns false instead of throwing if that chat is
 * already linked to a *different* user — `telegram_chat_id` is unique per
 * `app_user_profiles_telegram_chat_id_uq`, so one Telegram account can only
 * ever back one Neon Trade user.
 */
export async function linkTelegramChat(userId: string, chatId: string): Promise<boolean> {
  try {
    await sql`
      UPDATE public.app_user_profiles
      SET telegram_chat_id = ${chatId}, telegram_linked_at = now(), updated_at = now()
      WHERE user_id = ${userId}
    `;
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === '23505') {
      return false;
    }
    throw error;
  }
}

export async function unlinkTelegram(userId: string): Promise<void> {
  await sql`UPDATE public.app_user_profiles SET telegram_chat_id = NULL, telegram_linked_at = NULL, updated_at = now() WHERE user_id = ${userId}`;
  await sql`DELETE FROM public.telegram_alert_subscriptions WHERE user_id = ${userId}`;
  await sql`DELETE FROM public.telegram_alert_cursors WHERE user_id = ${userId}`;
}

export interface TelegramStatus {
  linked: boolean;
  disabled: boolean;
  activeWatchlistId: string | null;
}

export async function getTelegramStatus(userId: string): Promise<TelegramStatus> {
  const rows = await sql`
    SELECT u.telegram_chat_id, s.watchlist_id, c.disabled_at
    FROM public.app_user_profiles u
    LEFT JOIN public.telegram_alert_subscriptions s ON s.user_id = u.user_id
    LEFT JOIN public.telegram_alert_cursors c ON c.user_id = u.user_id
    WHERE u.user_id = ${userId}
  `;
  const row = rows[0] as { telegram_chat_id: string | null; watchlist_id: string | null; disabled_at: string | null } | undefined;
  return {
    linked: !!row?.telegram_chat_id,
    disabled: !!row?.disabled_at,
    activeWatchlistId: row?.watchlist_id ?? null,
  };
}

/**
 * Sets which watchlist a linked user gets Telegram alerts for. The cursor
 * bootstraps to `now()` only on first-ever subscribe (`ON CONFLICT DO
 * NOTHING`) — a brand-new linker shouldn't get weeks of back-alerts blasted
 * at once. Switching the active watchlist afterward leaves the cursor
 * untouched, so alerts for the newly-selected list since the user's *last
 * delivery* still surface (not just from the moment they switched).
 */
export async function setTelegramSubscription(userId: string, watchlistId: string): Promise<void> {
  await sql`
    INSERT INTO public.telegram_alert_subscriptions (user_id, watchlist_id, updated_at)
    VALUES (${userId}, ${watchlistId}, now())
    ON CONFLICT (user_id) DO UPDATE SET watchlist_id = EXCLUDED.watchlist_id, updated_at = now()
  `;
  await sql`
    INSERT INTO public.telegram_alert_cursors (user_id, last_alert_time)
    VALUES (${userId}, now())
    ON CONFLICT (user_id) DO NOTHING
  `;
  // Re-enable delivery if a prior disable (e.g. from repeated send failures)
  // is still in effect — picking a new/same watchlist is an explicit signal
  // the user wants alerts again.
  await sql`UPDATE public.telegram_alert_cursors SET disabled_at = NULL, consecutive_failures = 0 WHERE user_id = ${userId}`;
}
