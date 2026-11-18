/**
 * Parser for earnings-result headlines (delivered through the market-data
 * News API), e.g.
 *
 *   "IBM Q2 Adj. EPS $2.93 Beats $2.86 Estimate, Sales $17.162B Beat $16.860B Estimate"
 *   "Hilton Worldwide Holdings Q2 Adj. EPS $2.29, Inline, Sales $3.341B Beat $3.327B Estimate"
 *   "Lemonade Q2 EPS $(0.56), Inline, Sales $294.400M Beat $290.876M Estimate"
 *   "Mitsui & Co Q1 EPS $13.00 Up From $9.22 YoY, Sales $27.280B Up From $22.829B YoY"
 *
 * Guidance headlines share the "Q3 Adj EPS $…" shape ("Sees Q3 Adj EPS
 * $3.95-$4.05 vs $3.99 Est", "Raises FY2026 Adj EPS Guidance …") and must
 * never be read as results, so they're rejected up front.
 *
 * Deliberately dependency-free with no path-alias imports: the one-time
 * backfill script (scripts/backfill-earnings-news.mjs) imports this file
 * directly through Node's built-in TypeScript type stripping.
 */

export type EarningsOutcome = 'beat' | 'miss' | 'inline';

export interface ParsedEarningsHeadline {
  /** 'Q1'..'Q4', 'H1'/'H2', or 'FY'. */
  period: string;
  epsActual: number;
  /** Consensus estimate; equals epsActual for "Inline", null when the headline compares YoY instead. */
  epsEstimate: number | null;
  epsOutcome: EarningsOutcome | null;
  /** "Adj." / non-GAAP EPS (vs GAAP or unlabelled). */
  epsAdjusted: boolean;
  /** Absolute currency amounts (B/M/K expanded). */
  salesActual: number | null;
  salesEstimate: number | null;
  salesOutcome: EarningsOutcome | null;
  /** "CORRECTION:" prefix — supersedes an earlier headline for the same report. */
  correction: boolean;
}

const GUIDANCE_WORDS = /\b(sees|guidance|raises|lowers|affirms|reaffirms|narrows|expects?|expected|outlook|forecasts?|prelim(?:inary)?)\b/i;

// "$1.39", "$(1.22)", "-$0.05", "$-0.05", "$1,234.5" with an optional B/M/K scale.
const NUM = String.raw`-?\$\(?-?[\d,]*\.?\d+\)?[BMK]?`;

const HEAD = new RegExp(
  String.raw`\b(Q[1-4]|H[12]|FY(?:\d{2,4})?)\s+(Adj\.?\s+|Adjusted\s+|GAAP\s+|Core\s+)?EPS\s+(${NUM})(.*)$`,
  'i'
);
const EPS_VS_ESTIMATE = new RegExp(String.raw`^\s+(Beats?|Miss(?:es)?)\s+(${NUM})\s+Estimate`, 'i');
const EPS_INLINE = /^\s*,\s*In-?line\b/i;
const SALES = new RegExp(
  String.raw`\bSales\s+(${NUM})(?:\s*,\s*(In-?line)\b|\s+(Beats?|Miss(?:es)?)\s+(${NUM})\s+Estimate)?`,
  'i'
);

/** Parse "$(1.22)" → -1.22, "$17.162B" → 17162000000. Null if not a finite number. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  let negative = false;
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  s = s.replace(/^\$/, '');
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (s.startsWith('(') ) { negative = true; s = s.replace(/[()]/g, ''); }
  let scale = 1;
  const unit = s.slice(-1).toUpperCase();
  if (unit === 'B') scale = 1e9;
  else if (unit === 'M') scale = 1e6;
  else if (unit === 'K') scale = 1e3;
  if (scale !== 1) s = s.slice(0, -1);
  s = s.replace(/[(),]/g, '');
  const n = Number(s);
  if (!Number.isFinite(n) || s === '') return null;
  return (negative ? -n : n) * scale;
}

function outcomeWord(word: string | undefined): EarningsOutcome | null {
  if (!word) return null;
  const w = word.toLowerCase();
  if (w.startsWith('beat')) return 'beat';
  if (w.startsWith('miss')) return 'miss';
  if (w.startsWith('in')) return 'inline';
  return null;
}

export function parseEarningsHeadline(headline: string): ParsedEarningsHeadline | null {
  let h = headline.trim();
  const correction = /^correction\s*:/i.test(h);
  h = h.replace(/^correction\s*:\s*/i, '').replace(/^reported earlier\s*,\s*/i, '');
  if (GUIDANCE_WORDS.test(h)) return null;

  const m = h.match(HEAD);
  if (!m) return null;
  const [, rawPeriod, adjWord, epsRaw, rest] = m;
  // A range ("$3.95-$4.05") is a forecast, never a reported figure.
  if (/^\s*-\s*\$/.test(rest)) return null;

  const epsActual = parseAmount(epsRaw);
  if (epsActual === null) return null;

  let epsEstimate: number | null = null;
  let epsOutcome: EarningsOutcome | null = null;
  const vs = rest.match(EPS_VS_ESTIMATE);
  if (vs) {
    epsOutcome = outcomeWord(vs[1]);
    epsEstimate = parseAmount(vs[2]);
  } else if (EPS_INLINE.test(rest)) {
    epsOutcome = 'inline';
    epsEstimate = epsActual;
  }

  let salesActual: number | null = null;
  let salesEstimate: number | null = null;
  let salesOutcome: EarningsOutcome | null = null;
  const sales = rest.match(SALES);
  if (sales) {
    salesActual = parseAmount(sales[1]);
    if (sales[2]) {
      salesOutcome = 'inline';
      salesEstimate = salesActual;
    } else if (sales[3]) {
      salesOutcome = outcomeWord(sales[3]);
      salesEstimate = parseAmount(sales[4]);
      // The headline source occasionally publishes a placeholder "$0.00" estimate.
      if (salesEstimate === 0) { salesEstimate = null; salesOutcome = null; }
    }
  }

  const period = rawPeriod.toUpperCase().startsWith('FY') ? 'FY' : rawPeriod.toUpperCase();
  return {
    period,
    epsActual,
    epsEstimate,
    epsOutcome,
    epsAdjusted: !!adjWord && /^adj/i.test(adjWord.trim()),
    salesActual,
    salesEstimate,
    salesOutcome,
    correction,
  };
}

/**
 * Article → the symbol it reports for. The headline source tags extra tickers on some
 * results headlines (peers, ETFs); accept it only when exactly one tracked
 * symbol is tagged, or when every tracked tag is a share class of the same
 * company (GOOG/GOOGL, FOX/FOXA, NWS/NWSA).
 */
export function symbolsForResult(tagged: string[], tracked: Set<string>): string[] {
  const mine = Array.from(new Set(tagged.map(s => s.toUpperCase()).filter(s => tracked.has(s))));
  if (mine.length <= 1) return mine;
  const stem = (s: string) => s.replace(/[.\-/].*$/, '').slice(0, 3);
  return mine.every(s => stem(s) === stem(mine[0])) ? mine : [];
}

/** US/Eastern calendar date and session for an ISO timestamp. */
export function easternDateAndSession(iso: string): { date: string; session: 'pre-market' | 'during-market' | 'post-market' } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const minutes = (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10);
  const session = minutes < 9 * 60 + 30 ? 'pre-market' : minutes >= 16 * 60 ? 'post-market' : 'during-market';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, session };
}

// ---------------------------------------------------------------------------
// Fallback: short AI-written summaries of a results press release
// ---------------------------------------------------------------------------
//
// When the results-headline source is missing from the news feed, the feed's other source (`fiscal.ai`)
// still publishes one short summary per release, e.g.
//   headline "Tyson Foods Reports Fourth Quarter 2026 Financial Results"
//   content  "... net loss of $74 million, or $0.22 per share ... Adjusted net income per share was $0.61 ...
//             Quarterly sales reached $14.585 billion, compared to $13.860 billion ..."
// It is free text: no consensus estimate (almost always), mixed GAAP/adjusted wording, prior-year figures in the same
// sentences, and sometimes a foreign currency. So this parser is deliberately conservative and extracts ACTUALS only
// (EPS and sales, USD only); anything ambiguous stays null. Estimates, surprise and beat/miss are never derived here.

export interface ParsedFiscalSummary {
  /** 'Q1'..'Q4', 'H1'/'H2', 'FY', or null when the text names no period. */
  period: string | null;
  epsActual: number | null;
  /** true = adjusted / non-GAAP figure, false = GAAP, null = no EPS found. */
  epsAdjusted: boolean | null;
  /** Absolute USD amount. */
  salesActual: number | null;
}

const FISCAL_RESULT_HEAD = /\b(reports?|reported|announces?|announced|releases?|posts?|delivers?)\b.*\b(results?|earnings|quarter|Q[1-4]|first half|second half|full[\s-]?year|fiscal year)\b/i;
// Not a results release: analyst notes, dates and calls, meetings, trials, and so on.
const FISCAL_REJECT = /\b(price targets?|analysts?|downgrades?|upgrades?|ratings?|preview|to (?:report|announce|release|host|present)|schedules?|conference call|webcast|voting|annual (?:general )?meeting|shareholders?|stockholders?|clinical|trials?|study|survey|poll)\b/i;
// Any non-USD currency makes the whole summary unusable (the page assumes dollars).
const FOREIGN_CURRENCY = /\b(RMB|CNY|renminbi|yuan|euros?|EUR|GBP|sterling|yen|JPY|CAD|AUD|HKD|TWD|NT\$|HK\$|C\$|A\$|S\$|R\$|rupees?|INR|KRW|SEK|NOK|DKK|CHF|francs?|shekels?|NIS|BRL|reais|pesos?|MXN|ZAR|SGD|NZD|PLN|zlotys?|kroner|krona|rupiah|baht|ringgit)\b|[€£¥₹]/i;
const PER_ADS = /\bper\s+(?:ADS|ADR|American depositary)/i;

const PER_SHARE = /\$\s?(\d[\d,]*(?:\.\d+)?)\s+(?:per|a)\s+(?:(?:diluted|basic|fully diluted|common)\s+)*share/gi;
const EPS_OF = /\b(?:EPS|earnings[\s-]per[\s-](?:diluted\s+|basic\s+)?share|income per (?:diluted\s+)?share)(?:\s*\([^)]*\))?\s*(?:of|was|were|at|came in at|reached|reaching)?\s*\$\s?(\d[\d,]*(?:\.\d+)?)/gi;
// "GAAP and non-GAAP EPS of $2.70 and $2.68, respectively": which is which is not worth guessing.
const PAIRED = /^\s*and\s+\$\s?\d[\d,]*(?:\.\d+)?,?\s*respectively/i;
// Per-share amounts that are not earnings.
const NOT_EARNINGS = /\b(dividends?|repurchase|buyback|distribution|payable|declared)\b/i;
const SALES_OF = /\b(?:total\s+|net\s+|quarterly\s+)?(?:sales|revenues?)\s+(?:of|reached|were|was|totaled|totalled|came in at|rose to|grew to|increased to|hit|at)\s+(?:about\s+|approximately\s+|roughly\s+|nearly\s+)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|mn|[BMK])\b/gi;

const PRIOR_CUE = /\b(from|compared (?:to|with)|versus|vs\.?|prior|year-ago|last year|previous|a year (?:ago|earlier))\b/i;
// Year totals in a quarterly release ("record annual revenue of $34.45 billion") are not the quarter's figure.
const ANNUAL_CUE = /\b(annual|full[\s-]?year|fiscal year|year-to-date|ytd|twelve months|12 months)\b/i;
const FORWARD_CUE = /\b(project(?:s|ed|ing)?|expect(?:s|ed|ing)?|anticipat\w*|forecast\w*|guid\w*|outlook|target\w*|sees)\b/i;

/** Text of the sentence a match sits in, up to the match, and the whole sentence (periods inside numbers do not split). */
function sentenceAround(text: string, index: number, length: number): { before: string; whole: string } {
  const start = Math.max(0, text.lastIndexOf('. ', index) + 1);
  const endAt = text.indexOf('. ', index + length);
  const end = endAt === -1 ? text.length : endAt;
  return { before: text.slice(start, index), whole: text.slice(start, end) };
}

function fiscalPeriod(...texts: string[]): string | null {
  const ord: Record<string, string> = { first: '1', second: '2', third: '3', fourth: '4' };
  for (const t of texts) {
    const q = t.match(/\b(first|second|third|fourth)[\s-]+quarter\b/i);
    if (q) return `Q${ord[q[1].toLowerCase()]}`;
    const qn = t.match(/\bQ([1-4])\b/);
    if (qn) return `Q${qn[1]}`;
    const half = t.match(/\b(first|second)[\s-]+half\b/i);
    if (half) return half[1].toLowerCase() === 'first' ? 'H1' : 'H2';
    if (/\bfull[\s-]?year\b|\bfiscal year\b|\bannual results\b/i.test(t)) return 'FY';
  }
  return null;
}

const UNIT: Record<string, number> = { billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, mn: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };

/**
 * Results summary → actuals, or null when the headline is not a results release. A release with no usable figure still
 * returns a value (nulls) so the report can be marked as reported. USD only; GAAP vs adjusted EPS is recorded.
 */
export function parseFiscalSummary(headline: string, content: string): ParsedFiscalSummary | null {
  const head = headline.trim();
  if (!FISCAL_RESULT_HEAD.test(head) || FISCAL_REJECT.test(head)) return null;
  const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const period = fiscalPeriod(head, text);
  const blank: ParsedFiscalSummary = { period, epsActual: null, epsAdjusted: null, salesActual: null };
  if (FOREIGN_CURRENCY.test(head) || FOREIGN_CURRENCY.test(text)) return blank;

  // A figure counts only when it is not a prior-period comparison and not in a forward-looking sentence.
  const quarterly = period !== null && period !== 'FY';
  const usable = (index: number, length: number) => {
    const { before, whole } = sentenceAround(text, index, length);
    return !PRIOR_CUE.test(before.slice(-60)) && !FORWARD_CUE.test(whole) && !(quarterly && ANNUAL_CUE.test(before.slice(-40)));
  };

  let epsActual: number | null = null;
  let epsAdjusted: boolean | null = null;
  if (!PER_ADS.test(text)) {
    const found: Array<{ value: number; adjusted: boolean; index: number }> = [];
    for (const re of [PER_SHARE, EPS_OF]) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const index = m.index ?? 0;
        if (!usable(index, m[0].length)) continue;
        const { before, whole } = sentenceAround(text, index, m[0].length);
        if (NOT_EARNINGS.test(whole) || PAIRED.test(text.slice(index + m[0].length))) continue;
        const raw = Number(m[1].replace(/,/g, ''));
        if (!Number.isFinite(raw)) continue;
        const loss = /\bloss(?:es)?\b|\blost\b/i.test(before.slice(-80));
        found.push({ value: loss ? -raw : raw, adjusted: /\b(adjusted|non-GAAP|core)\b/i.test(before.slice(-80)), index });
      }
    }
    found.sort((a, b) => a.index - b.index);
    const pick = found.find(f => f.adjusted) ?? found[0];
    if (pick) { epsActual = pick.value; epsAdjusted = pick.adjusted; }
  }

  // The largest current-period revenue figure is the total (a segment's revenue is never larger).
  let salesActual: number | null = null;
  SALES_OF.lastIndex = 0;
  for (const m of text.matchAll(SALES_OF)) {
    const index = m.index ?? 0;
    if (!usable(index, m[0].length)) continue;
    const n = Number(m[1].replace(/,/g, ''));
    const scale = UNIT[m[2].toLowerCase()];
    if (Number.isFinite(n) && scale && (salesActual === null || n * scale > salesActual)) salesActual = n * scale;
  }

  return { period, epsActual, epsAdjusted, salesActual };
}
