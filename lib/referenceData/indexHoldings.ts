/**
 * Index membership from ETF issuer holdings files (public, no key). Server-only.
 *
 *   S&P 500    SPY daily holdings (xlsx)
 *   Dow 30     DIA daily holdings (xlsx)
 *   Nasdaq-100 Nasdaq's own list API (JSON); QQQ holdings (JSON) as a second source
 *              (that API answered 406 to repeated scripted requests on 2026-10-23)
 *
 * Russell 1000 has no working public file from here (the issuer's site serves an HTML page to
 * scripted requests), so the scanner approximates it as the top 1000 US stocks by market cap
 * (lib/usUniverse.ts). Every fetch is checked for plausibility (row counts); a failed or implausible
 * file throws, and the caller then leaves that index's previous flags in place.
 */
import { inflateRawSync } from 'node:zlib';

export type IndexCode = 'SP500' | 'NDX100' | 'DOW30';

const SOURCES: Record<IndexCode, { url: string; min: number; max: number }> = {
  SP500: { url: 'https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx', min: 480, max: 520 },
  DOW30: { url: 'https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-dia.xlsx', min: 29, max: 31 },
  NDX100: { url: 'https://api.nasdaq.com/api/quote/list-type/nasdaq100', min: 95, max: 110 },
};
const NDX_SECOND_URL = 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/QQQ/holdings/fund?idType=ticker&interval=monthly&productType=ETF';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Minimal xlsx reader: just enough zip (central directory + deflate) and sheet XML to read cells.
// ---------------------------------------------------------------------------

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** First worksheet as rows of cell text keyed by column letter. */
export function readXlsxRows(buf: Buffer): Array<Record<string, string>> {
  const files = unzip(buf);
  const shared = (files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '')
    .match(/<si>[\s\S]*?<\/si>/g)?.map(si => decodeXml((si.match(/<t[^>]*>([^<]*)<\/t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join(''))) ?? [];
  const sheetName = [...files.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error('no worksheet');
  const xml = files.get(sheetName)!.toString('utf8');
  const rows: Array<Record<string, string>> = [];
  for (const rowXml of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const row: Record<string, string> = {};
    for (const m of rowXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col, attrs, inner = ''] = m;
      let v = inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? inner.match(/<t[^>]*>([^<]*)<\/t>/)?.[1] ?? '';
      if (/t="s"/.test(attrs) && v !== '') v = shared[Number(v)] ?? '';
      row[col] = decodeXml(v).trim();
    }
    rows.push(row);
  }
  return rows;
}

/** Tickers from an issuer holdings sheet: the rows under the header row that has a "Ticker" column. */
export function tickersFromHoldingsRows(rows: Array<Record<string, string>>): { tickers: string[]; asOf: string | null } {
  const asOfRow = rows.find(r => /^holdings:?$/i.test(r.A ?? ''));
  const asOf = asOfRow?.B?.replace(/^as of\s*/i, '') ?? null;
  const headerIdx = rows.findIndex(r => Object.values(r).some(v => /^ticker$/i.test(v)));
  if (headerIdx < 0) throw new Error('no Ticker header');
  const col = Object.entries(rows[headerIdx]).find(([, v]) => /^ticker$/i.test(v))![0];
  const tickers: string[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const t = normalizeTicker(r[col] ?? '');
    if (t) tickers.push(t);
  }
  return { tickers, asOf };
}

/** Issuer spellings → ours: 'BRK.B', 'BRK/B', 'BRK-B' → 'BRK.B'. Cash lines, futures and blanks → null. */
export function normalizeTicker(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/[/\-\s]/g, '.');
  return /^[A-Z]{1,6}(\.[A-Z])?$/.test(t) ? t : null;
}

async function fetchBuffer(url: string, accept = '*/*'): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`holdings HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface IndexMembers { code: IndexCode; tickers: string[]; asOf: string | null }

export async function fetchIndexMembers(code: IndexCode): Promise<IndexMembers> {
  const src = SOURCES[code];
  let tickers: string[];
  let asOf: string | null = null;
  if (code === 'NDX100') {
    try {
      const body = JSON.parse((await fetchBuffer(src.url, 'application/json')).toString('utf8')) as { data?: { data?: { asOf?: string; rows?: Array<{ symbol?: string }> } } };
      tickers = (body.data?.data?.rows ?? []).map(r => normalizeTicker(r.symbol ?? '')).filter((t): t is string => !!t);
      asOf = body.data?.data?.asOf ?? null;
      if (tickers.length < src.min) throw new Error(`only ${tickers.length} rows`);
    } catch (first) {
      console.error('[indexHoldings] Nasdaq-100 list failed, trying holdings file:', first instanceof Error ? first.message : first);
      const body = JSON.parse((await fetchBuffer(NDX_SECOND_URL)).toString('utf8')) as { effectiveDate?: string; holdings?: Array<{ ticker?: string }> };
      tickers = (body.holdings ?? []).map(h => normalizeTicker(h.ticker ?? '')).filter((t): t is string => !!t);
      asOf = body.effectiveDate ?? null;
    }
  } else {
    ({ tickers, asOf } = tickersFromHoldingsRows(readXlsxRows(await fetchBuffer(src.url))));
  }
  tickers = [...new Set(tickers)];
  if (tickers.length < src.min || tickers.length > src.max) {
    throw new Error(`${code} holdings look wrong (${tickers.length} tickers, expected ${src.min}-${src.max})`);
  }
  return { code, tickers, asOf };
}
