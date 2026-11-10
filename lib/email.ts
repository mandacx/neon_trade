import 'server-only';
import { cleanHeaders, formatFrom } from '@/lib/emailFormat';

// Transactional email through Resend's HTTP API (no SDK dependency).
// Env: EMAIL_PROVIDER=resend, EMAIL_API_KEY, EMAIL_FROM ("Name <addr@domain>"),
// EMAIL_REPLY_TO (optional). The sender domain must be verified in Resend.
// Callers that pass `fromName` get "fromName <address>" built from EMAIL_FROM's address part only.
// Never throws: callers get { ok: false, error } so a mail outage cannot break a request.

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** Display name for the From header; the address part still comes from EMAIL_FROM. */
  fromName?: string;
  /** Extra message headers (e.g. List-Unsubscribe). Values may carry tokens: never logged. */
  headers?: Record<string, string>;
}

export type SendEmailResult = { ok: true; id: string } | { ok: false; error: string };

export function emailConfigured(): boolean {
  return process.env.EMAIL_PROVIDER === 'resend' && !!process.env.EMAIL_API_KEY && !!process.env.EMAIL_FROM;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!emailConfigured()) {
    console.warn('[email] not configured (EMAIL_PROVIDER / EMAIL_API_KEY / EMAIL_FROM); skipped:', input.subject);
    return { ok: false, error: 'email not configured' };
  }
  try {
    const headers = cleanHeaders(input.headers);
    const payload = {
      from: input.fromName ? formatFrom(process.env.EMAIL_FROM, input.fromName) : process.env.EMAIL_FROM,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      reply_to: input.replyTo || process.env.EMAIL_REPLY_TO || undefined,
    };
    const post = (extra: Record<string, unknown>) => fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.EMAIL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, ...extra }),
      signal: AbortSignal.timeout(10_000),
    });
    let res = await post(headers ? { headers } : {});
    // Guard: if the provider rejects the custom headers (a 4xx validation error, so nothing was sent), resend once
    // without them rather than lose the alert. Remove once a real send confirms headers are accepted.
    if (!res.ok && headers && (res.status === 400 || res.status === 422)) {
      console.warn('[email] provider rejected custom headers, resending without them', res.status);
      res = await post({});
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !body.id) {
      console.error('[email] send failed', res.status, body.message);
      return { ok: false, error: body.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, id: body.id };
  } catch (e) {
    console.error('[email] send error', e);
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}
