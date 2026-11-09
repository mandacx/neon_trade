/**
 * Trade Ideas Desk: shared vocabulary and pure plan maths (docs/trade-ideas.md). Dependency-free, so it is
 * safe in client components, routes and Node fixture scripts (`node scripts/test-idea-scoring.mjs`).
 *
 * "No enums" (brief rule 3): every domain below is a catalog with display metadata, not a TypeScript union
 * baked into the UI. The DB stores the keys as text; the UI reads label/tone from here.
 */

export interface CatalogEntry { key: string; label: string; tone: 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'violet'; description: string }

/** Horizon -> term. The term is what plans gate (ideas_short_term / ideas_long_term). */
export type IdeaTerm = 'short' | 'long';
export const IDEA_HORIZONS: Array<CatalogEntry & { term: IdeaTerm }> = [
  { key: 'intraday', label: 'Intraday', tone: 'amber', term: 'short', description: 'Opened and closed within a day or two. Scored on daily bars, so treat the result as approximate.' },
  { key: 'swing', label: 'Swing', tone: 'blue', term: 'short', description: 'Days to a few weeks.' },
  { key: 'positional', label: 'Positional', tone: 'violet', term: 'long', description: 'Weeks to a few months.' },
  { key: 'long_term', label: 'Long term', tone: 'green', term: 'long', description: 'Months to years.' },
];

/** Lifecycle. Terminal statuses are set by the tracker (target_hit, stopped, expired) or by the publisher (closed_by_publisher, cancelled). */
export const IDEA_STATUSES: CatalogEntry[] = [
  { key: 'draft', label: 'Draft', tone: 'gray', description: 'Not visible to subscribers.' },
  { key: 'scheduled', label: 'Scheduled', tone: 'amber', description: 'Will be published automatically at the chosen time. Not visible to subscribers yet; still editable.' },
  { key: 'live', label: 'Live', tone: 'blue', description: 'Published, waiting for price to reach the entry zone.' },
  { key: 'triggered', label: 'In trade', tone: 'violet', description: 'Price reached the entry zone; the idea is being tracked against its targets and stop.' },
  { key: 'target_hit', label: 'All targets hit', tone: 'green', description: 'Every target in the ladder was reached before the stop.' },
  { key: 'stopped', label: 'Stopped', tone: 'red', description: 'The stop was reached (after any targets that were hit first).' },
  { key: 'expired', label: 'Expired', tone: 'gray', description: 'The valid-until date passed. If it had entered, it is marked to the last close; if not, it counts as not triggered.' },
  { key: 'closed_by_publisher', label: 'Closed early', tone: 'amber', description: 'The publisher closed it early; scored at that session\'s close.' },
  { key: 'cancelled', label: 'Cancelled', tone: 'gray', description: 'The publisher withdrew it before it entered.' },
];

export const IDEA_UPDATE_TYPES: CatalogEntry[] = [
  { key: 'note', label: 'Note', tone: 'gray', description: 'Added commentary or rationale.' },
  { key: 'stop_moved', label: 'Stop moved', tone: 'blue', description: 'The publisher moved their stop (for example to breakeven). The original stop is still what is scored.' },
  { key: 'partial_booked', label: 'Partial booked', tone: 'green', description: 'The publisher booked part of the position. Scoring still follows the original ladder.' },
  { key: 'closed', label: 'Closed early', tone: 'amber', description: 'The publisher closed the idea. Scored at that session\'s close.' },
  { key: 'cancelled', label: 'Cancelled', tone: 'gray', description: 'The publisher withdrew the idea.' },
];
/** Updates that change an idea's status (and so its scoring); the rest are commentary. */
export const CLOSING_UPDATE_TYPES = ['closed', 'cancelled'] as const;

/** Mechanical result of an idea (derived, nt_idea_outcomes). `pending` = published, not yet entered; `open` = in trade. */
export const IDEA_OUTCOMES: CatalogEntry[] = [
  { key: 'pending', label: 'Awaiting entry', tone: 'blue', description: 'Not yet entered.' },
  { key: 'open', label: 'Open', tone: 'violet', description: 'Entered and still running; the R shown is unrealised.' },
  { key: 'target_hit', label: 'All targets hit', tone: 'green', description: '' },
  { key: 'stopped', label: 'Stopped', tone: 'red', description: '' },
  { key: 'expired', label: 'Expired', tone: 'gray', description: '' },
  { key: 'closed_by_publisher', label: 'Closed early', tone: 'amber', description: '' },
  { key: 'not_triggered', label: 'Not triggered', tone: 'gray', description: 'Never entered its zone (or ran to a target / the stop without entering). Not a win and not a loss.' },
  { key: 'cancelled', label: 'Cancelled', tone: 'gray', description: 'Withdrawn before entry.' },
];

export const RISK_RATINGS: CatalogEntry[] = [
  { key: 'low', label: 'Low risk', tone: 'green', description: '' },
  { key: 'medium', label: 'Medium risk', tone: 'amber', description: '' },
  { key: 'high', label: 'High risk', tone: 'red', description: '' },
];

export const IDEA_DIRECTIONS: CatalogEntry[] = [
  { key: 'long', label: 'Long', tone: 'green', description: 'Profits if the price rises.' },
  { key: 'short', label: 'Short', tone: 'red', description: 'Profits if the price falls.' },
];

const byKey = (list: CatalogEntry[]) => (key: string): CatalogEntry => list.find(e => e.key === key) ?? { key, label: key, tone: 'gray', description: '' };
export const statusMeta = byKey(IDEA_STATUSES);
export const outcomeMeta = byKey(IDEA_OUTCOMES);
export const updateTypeMeta = byKey(IDEA_UPDATE_TYPES);
export const riskMeta = byKey(RISK_RATINGS);
export const horizonMeta = byKey(IDEA_HORIZONS);

export const horizonTerm = (horizon: string): IdeaTerm => (IDEA_HORIZONS.find(h => h.key === horizon)?.term ?? 'long');
export const horizonsOfTerm = (term: IdeaTerm): string[] => IDEA_HORIZONS.filter(h => h.term === term).map(h => h.key);

/** Statuses a subscriber sees on the board: tab "Open" = live + in trade, "Closed" = the rest of the non-draft ones. */
export const OPEN_STATUSES = ['live', 'triggered'];
export const CLOSED_STATUSES = ['target_hit', 'stopped', 'expired', 'closed_by_publisher', 'cancelled'];

export interface IdeaTarget { price: number; label?: string }

/** An optional option strategy attached to an idea (descriptive; the idea is scored on the underlying). */
export interface IdeaOptionLeg { side: 'buy' | 'sell'; type: 'call' | 'put'; strike: number; qty: number }
export interface IdeaOptionStrategy { name: string; expiry: string | null; legs: IdeaOptionLeg[]; note: string | null }

export interface IdeaPlanInput {
  symbol: string;
  direction: string;
  horizon: string;
  title: string;
  rationale: string;
  entryLow: number;
  entryHigh: number;
  targets: IdeaTarget[];
  stop: number;
  validUntil: string;
  riskRating: string;
  optionStrategy: IdeaOptionStrategy | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export const MAX_TARGETS = 5;
export const MAX_OPTION_LEGS = 4;
export const MAX_RATIONALE = 8000;

/** Reference entry price used for risk and R: the worst fill in the zone for the trader (conservative). */
export const entryPriceOf = (direction: string, entryLow: number, entryHigh: number) => (direction === 'short' ? entryLow : entryHigh);

/** Risk per share/unit against the (conservative) entry price. */
export function riskPerUnit(p: Pick<IdeaPlanInput, 'direction' | 'entryLow' | 'entryHigh' | 'stop'>): number {
  return Math.abs(entryPriceOf(p.direction, p.entryLow, p.entryHigh) - p.stop);
}

/** Reward:risk of each target and of the whole ladder (equal split across targets), from the conservative entry. */
export function riskReward(p: Pick<IdeaPlanInput, 'direction' | 'entryLow' | 'entryHigh' | 'stop' | 'targets'>): { risk: number; perTarget: number[]; blended: number | null } {
  const risk = riskPerUnit(p);
  const entry = entryPriceOf(p.direction, p.entryLow, p.entryHigh);
  const perTarget = p.targets.map(t => (risk > 0 ? Math.abs(t.price - entry) / risk : 0));
  const blended = perTarget.length && risk > 0 ? perTarget.reduce((a, b) => a + b, 0) / perTarget.length : null;
  return { risk, perTarget, blended };
}

/**
 * Validate and normalise a plan from untrusted input. Returns the normalised plan or a list of problems.
 * Rules: entry zone ordered; stop beyond the zone on the losing side; targets beyond the zone on the winning side,
 * strictly progressing; valid-until a real date (not before `today`); at most MAX_TARGETS targets.
 */
export function validatePlan(raw: any, today: string): { ok: true; plan: IdeaPlanInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const symbol = String(raw?.symbol ?? '').trim().toUpperCase();
  if (!SYMBOL.test(symbol)) errors.push('Symbol is required (letters, digits, "." or "-").');
  const direction = String(raw?.direction ?? '');
  if (!IDEA_DIRECTIONS.some(d => d.key === direction)) errors.push('Direction must be long or short.');
  const horizon = String(raw?.horizon ?? '');
  if (!IDEA_HORIZONS.some(h => h.key === horizon)) errors.push('Pick a horizon.');
  const title = String(raw?.title ?? '').trim();
  if (title.length < 3 || title.length > 140) errors.push('Title must be 3 to 140 characters.');
  const rationale = String(raw?.rationale ?? '').trim();
  if (rationale.length > MAX_RATIONALE) errors.push(`Rationale is limited to ${MAX_RATIONALE} characters.`);
  const riskRating = String(raw?.riskRating ?? 'medium');
  if (!RISK_RATINGS.some(r => r.key === riskRating)) errors.push('Risk rating must be low, medium or high.');

  const entryLow = num(raw?.entryLow);
  const entryHigh = num(raw?.entryHigh);
  const stop = num(raw?.stop);
  if (entryLow == null || entryHigh == null || entryLow <= 0 || entryHigh <= 0) errors.push('Entry zone low and high are required and must be above 0.');
  else if (entryLow > entryHigh) errors.push('Entry zone low must not be above entry zone high.');
  if (stop == null || stop <= 0) errors.push('Stop is required and must be above 0.');

  const targets: IdeaTarget[] = [];
  const rawTargets = Array.isArray(raw?.targets) ? raw.targets : [];
  if (rawTargets.length < 1) errors.push('Add at least one target.');
  if (rawTargets.length > MAX_TARGETS) errors.push(`At most ${MAX_TARGETS} targets.`);
  for (const t of rawTargets.slice(0, MAX_TARGETS)) {
    const price = num(typeof t === 'object' && t ? t.price : t);
    if (price == null || price <= 0) { errors.push('Every target needs a price above 0.'); break; }
    const label = typeof t === 'object' && t && typeof t.label === 'string' ? t.label.trim().slice(0, 40) : '';
    targets.push(label ? { price: round6(price), label } : { price: round6(price) });
  }

  if (entryLow != null && entryHigh != null && stop != null && (direction === 'long' || direction === 'short')) {
    if (direction === 'long') {
      if (stop >= entryLow) errors.push('For a long idea the stop must be below the entry zone.');
      let prev = entryHigh;
      for (const t of targets) { if (t.price <= prev) { errors.push('For a long idea each target must be above the entry zone and above the previous target.'); break; } prev = t.price; }
    } else {
      if (stop <= entryHigh) errors.push('For a short idea the stop must be above the entry zone.');
      let prev = entryLow;
      for (const t of targets) { if (t.price >= prev) { errors.push('For a short idea each target must be below the entry zone and below the previous target.'); break; } prev = t.price; }
    }
  }

  const validUntil = String(raw?.validUntil ?? '');
  if (!YMD.test(validUntil) || Number.isNaN(Date.parse(`${validUntil}T12:00:00Z`))) errors.push('Valid until must be a date (YYYY-MM-DD).');
  else if (validUntil < today) errors.push('Valid until cannot be in the past.');

  let optionStrategy: IdeaOptionStrategy | null = null;
  if (raw?.optionStrategy) {
    const o = raw.optionStrategy;
    const name = String(o?.name ?? '').trim().slice(0, 80);
    const expiry = o?.expiry ? String(o.expiry) : null;
    const note = o?.note ? String(o.note).trim().slice(0, 1000) : null;
    const legs: IdeaOptionLeg[] = [];
    const rawLegs = Array.isArray(o?.legs) ? o.legs : [];
    if (!name) errors.push('Give the option strategy a name.');
    if (expiry && !YMD.test(expiry)) errors.push('Option expiry must be YYYY-MM-DD.');
    if (rawLegs.length > MAX_OPTION_LEGS) errors.push(`At most ${MAX_OPTION_LEGS} option legs.`);
    for (const l of rawLegs.slice(0, MAX_OPTION_LEGS)) {
      const strike = num(l?.strike);
      const qty = num(l?.qty);
      if ((l?.side !== 'buy' && l?.side !== 'sell') || (l?.type !== 'call' && l?.type !== 'put') || strike == null || strike <= 0 || qty == null || qty < 1 || !Number.isInteger(qty)) {
        errors.push('Every option leg needs buy/sell, call/put, a strike and a whole quantity.');
        break;
      }
      legs.push({ side: l.side, type: l.type, strike: round6(strike), qty });
    }
    optionStrategy = { name, expiry, legs, note };
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      symbol, direction, horizon, title, rationale, entryLow: round6(entryLow!), entryHigh: round6(entryHigh!),
      targets, stop: round6(stop!), validUntil, riskRating, optionStrategy,
    },
  };
}

export const MIN_SCHEDULE_MS = 2 * 60_000;
export const MAX_SCHEDULE_MS = 90 * 86_400_000;

/** A scheduled publish time: an ISO instant between 2 minutes and 90 days from now. The tracker publishes it on its next tick. */
export function validateScheduleTime(raw: unknown, nowMs: number): { ok: true; at: Date } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) return { ok: false, error: 'Pick a date and time.' };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { ok: false, error: 'Pick a valid date and time.' };
  if (ms < nowMs + MIN_SCHEDULE_MS) return { ok: false, error: 'Schedule at least a few minutes ahead.' };
  if (ms > nowMs + MAX_SCHEDULE_MS) return { ok: false, error: 'Schedule within the next 90 days.' };
  return { ok: true, at: new Date(ms) };
}
