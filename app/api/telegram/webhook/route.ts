import { NextRequest, NextResponse } from 'next/server';
import { consumeLinkCode, linkTelegramChat, sendTelegramMessage } from '@/lib/telegram';

// Telegram webhook receiver. Registered once (manually, via a `setWebhook`
// call with `secret_token=$TELEGRAM_WEBHOOK_SECRET`) to point at this URL.
// Always returns 200 — Telegram retries non-2xx responses, and
// consumeLinkCode()'s `consumed_at` check makes a retried delivery a safe
// no-op, so no separate update_id dedupe table is needed.
export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: any;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = update?.message;
  if (!message || message.chat?.type !== 'private' || typeof message.text !== 'string') {
    return NextResponse.json({ ok: true });
  }

  const chatId = String(message.chat.id);
  const match = message.text.trim().match(/^\/start(?:\s+([A-Za-z0-9]{4,12}))?$/);

  if (!match) {
    return NextResponse.json({ ok: true });
  }

  const code = match[1]?.toUpperCase();
  if (!code) {
    await sendTelegramMessage(chatId, "Hi! To link your Neon Trade account, open your Profile page and tap “Link Telegram” — it'll give you a link back here.");
    return NextResponse.json({ ok: true });
  }

  const userId = await consumeLinkCode(code);
  if (!userId) {
    await sendTelegramMessage(chatId, "That link code is invalid or has expired. Go back to your Profile page and generate a new one.");
    return NextResponse.json({ ok: true });
  }

  const linked = await linkTelegramChat(userId, chatId);
  if (!linked) {
    await sendTelegramMessage(chatId, "This Telegram account is already linked to a different Neon Trade account. Unlink it there first, or use a different Telegram account.");
    return NextResponse.json({ ok: true });
  }
  await sendTelegramMessage(chatId, "✅ Linked! Pick a watchlist to get alerts for from your Profile page on Neon Trade.");
  return NextResponse.json({ ok: true });
}
