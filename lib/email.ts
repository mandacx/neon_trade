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

export const BATCH_MAX = 100; // Resend: up to 100 emails per /emails/batch call

/**
 * Send many individual emails (each with its own recipient and headers) in as few API calls as possible: Resend's
 * /emails/batch, 100 per call. Recipients never see each other (one message each). Results line up with `inputs`.
 * A 4xx on a chunk means the batch was rejected before sending, so its emails are retried one by one through
 * sendEmail (one bad address cannot sink the rest). Any other failure (timeout, 5xx) is reported as failed for the
 * whole chunk, never resent, because some of it may already have gone out. Never throws.
 */
export async function sendEmailBatch(inputs: SendEmailInput[]): Promise<SendEmailResult[]> {
  if (!emailConfigured()) {
    console.warn('[email] not configured; batch of', inputs.length, 'skipped');
    return inputs.map(() => ({ ok: false as const, error: 'email not configured' }));
  }
  const results: SendEmailResult[] = new Array(inputs.length);
  for (let start = 0; start < inputs.length; start += BATCH_MAX) {
    const chunk = inputs.slice(start, start + BATCH_MAX);
    const fill = (r: SendEmailResult[]) => r.forEach((x, i) => { results[start + i] = x; });
    if (chunk.length === 1) { fill([await sendEmail(chunk[0])]); continue; }
    try {
      const body = chunk.map(input => {
        const headers = cleanHeaders(input.headers);
        return {
          from: input.fromName ? formatFrom(process.env.EMAIL_FROM, input.fromName) : process.env.EMAIL_FROM,
          to: Array.isArray(input.to) ? input.to : [input.to],
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
          reply_to: input.replyTo || process.env.EMAIL_REPLY_TO || undefined,
          ...(headers ? { headers } : {}),
        };
      });
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }[]; message?: string };
      if (res.ok && Array.isArray(json.data) && json.data.length === chunk.length && json.data.every(d => d?.id)) {
        fill(json.data.map(d => ({ ok: true as const, id: d.id as string })));
      } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        console.warn('[email] batch rejected, sending individually', res.status, json.message);
        const single: SendEmailResult[] = [];
        for (const input of chunk) single.push(await sendEmail(input));
        fill(single);
      } else {
        const error = json.message ?? `HTTP ${res.status}`;
        console.error('[email] batch failed', res.status, error);
        fill(chunk.map(() => ({ ok: false as const, error })));
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'send failed';
      console.error('[email] batch error', error);
      fill(chunk.map(() => ({ ok: false as const, error })));
    }
  }
  return results;
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
