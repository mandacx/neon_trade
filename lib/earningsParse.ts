/**
 * Parser for Benzinga earnings-result headlines (delivered through the Alpaca
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
      // Benzinga occasionally publishes a placeholder "$0.00" estimate.
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
 * Article → the symbol it reports for. Benzinga tags extra tickers on some
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
