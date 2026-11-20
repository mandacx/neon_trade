/**
 * Pure helpers for the secondary news / earnings feeds (request signing and response mapping). No imports from the
 * app (no path aliases), so Node scripts can load it directly (`scripts/test-feed-map.mjs`). Vendor names live in this
 * provider folder only; nothing here is ever sent to the browser.
 */
import { createHmac, randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Request signing (HMAC-SHA1 over path + sorted query/signing headers; verified live 2026-11-19 against
// GET /market-data/news/stock-news/list, HTTP 200)
// ---------------------------------------------------------------------------

export interface SignInput {
  host: string;
  path: string;
  query: Record<string, string>;
  appKey: string;
  appSecret: string;
  /** Test hooks. */
  now?: Date;
  nonce?: string;
}

/** Headers for one signed GET. The secret is only used as the HMAC key and is never sent. */
export function signedHeaders(i: SignInput): Record<string, string> {
  const timestamp = (i.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const nonce = i.nonce ?? randomUUID().replace(/-/g, '');
  const signing: Record<string, string> = {
    ...i.query,
    'x-app-key': i.appKey,
    'x-timestamp': timestamp,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-version': '1.0',
    'x-signature-nonce': nonce,
    host: i.host,
  };
  const joined = Object.keys(signing).sort().map(k => `${k}=${signing[k]}`).join('&');
  const signature = createHmac('sha1', `${i.appSecret}&`).update(encodeURIComponent(`${i.path}&${joined}`)).digest('base64');
  return {
    'x-app-key': i.appKey,
    'x-timestamp': timestamp,
    'x-signature': signature,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-version': '1.0',
    'x-signature-nonce': nonce,
    'x-version': 'v3',
    Accept: 'application/json',
  };
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

export interface RawNewsItem {
  news_id?: string | number;
  title?: string;
  summary?: string;
  source?: string;
  url?: string;
  publish_time?: string;
  sentiment?: string;
  related_symbols?: string[];
}

export interface FeedNews {
  /** The provider's exact id (ids are ~1.6e16, above Number's exact range, so the string is the key for detail lookups). */
  ref: string;
  /** `Number(ref)`: fine for list keys, NOT exact. */
  id: number;
  headline: string;
  summary: string;
  source: string;
  url: string | null;
  /** ISO instant. */
  createdAt: string;
  symbols: string[];
}

/** '2026-11-20T01:10:56.000+0000' -> ISO instant ('' when unparseable). The offset has no colon, which not every parser accepts. */
export function normalizeInstant(s: string | undefined): string {
  if (!s) return '';
  const t = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

/** One list/detail item -> neutral shape; null when it has no usable id, headline or time. */
export function mapNews(raw: RawNewsItem): FeedNews | null {
  const ref = raw.news_id === undefined || raw.news_id === null ? '' : String(raw.news_id);
  // A headline is one line to the parsers; some arrive with a line break ("Conference call:\nWalmart Sees ...").
  const headline = (raw.title ?? '').replace(/\s+/g, ' ').trim();
  const createdAt = normalizeInstant(raw.publish_time);
  if (!ref || !headline || !createdAt) return null;
  return {
    ref,
    id: Number(ref),
    headline,
    summary: (raw.summary ?? '').trim(),
    source: (raw.source ?? '').trim(),
    url: raw.url ?? null,
    createdAt,
    symbols: Array.isArray(raw.related_symbols) ? raw.related_symbols.map(s => String(s).toUpperCase()) : [],
  };
}

// ---------------------------------------------------------------------------
// Earnings calendar rows (per symbol; the last ~6 quarters with estimate and actual)
// ---------------------------------------------------------------------------

export interface FeedEarningsRow {
  fiscalYear: number | null;
  fiscalPeriod: number | null;
  /** 'YYYY-MM-DD'. */
  expectedDate: string | null;
  /** ISO currency of the figures ('USD'); anything else must not be stored as dollars. */
  currency: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  salesActual: number | null;
  salesEstimate: number | null;
}

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The calendar response is a bare array. Anything else maps to []. */
export function mapEarningsRows(body: unknown): FeedEarningsRow[] {
  if (!Array.isArray(body)) return [];
  return body.map((r: any) => ({
    fiscalYear: toNum(r?.fiscal_year),
    fiscalPeriod: toNum(r?.fiscal_period),
    expectedDate: typeof r?.expected_publish_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.expected_publish_date) ? r.expected_publish_date : null,
    currency: typeof r?.currency === 'string' && r.currency ? r.currency.toUpperCase() : null,
    epsActual: toNum(r?.eps_actual),
    epsEstimate: toNum(r?.eps_est),
    salesActual: toNum(r?.rev_actual),
    salesEstimate: toNum(r?.rev_est),
  }));
}

// ---------------------------------------------------------------------------
// Fallback source: latest reported quarter (financials table `earning_reports_a_o_r`, `period_3m`)
// ---------------------------------------------------------------------------

export interface ReportedQuarter {
  /** Period end, 'YYYY-MM-DD' (not the announcement date). */
  asOf: string;
  epsBasic: number | null;
  epsDiluted: number | null;
}

/**
 * Latest 3-month EPS per symbol from the financials response (one entry per requested symbol; a single symbol may come
 * back as one object). The table repeats the same quarter in several rows, so the newest `as_of_date` wins.
 */
export function mapReportedQuarters(body: unknown): Map<string, ReportedQuarter> {
  const out = new Map<string, ReportedQuarter>();
  const entries: any[] = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : [];
  for (const e of entries) {
    const symbol = typeof e?.request === 'string' ? e.request.toUpperCase() : '';
    if (!symbol) continue;
    let best: ReportedQuarter | null = null;
    for (const r of Array.isArray(e.results) ? e.results : []) {
      const rows = r?.tables?.earning_reports_a_o_r;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const q = row?.period_3m;
        const asOf = typeof q?.as_of_date === 'string' ? q.as_of_date : '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) continue;
        if (!best || asOf > best.asOf) best = { asOf, epsBasic: toNum(q.basic_e_p_s), epsDiluted: toNum(q.diluted_e_p_s) };
      }
    }
    if (best) out.set(symbol, best);
  }
  return out;
}
