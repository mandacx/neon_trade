/**
 * Trade Ideas Desk data layer (docs/trade-ideas.md). Server-only.
 *
 * - An idea is a published thesis plus a plan. It is not the publisher's position and not a subscriber's fill.
 * - Reading is plan-gated per term (ideas_short_term / ideas_long_term). Gating is enforced in the SQL: an
 *   idea outside the viewer's terms is never selected, so it is absent from the JSON, not hidden by the UI.
 * - Publishing is an entitlement (publish_ideas) or admin, never a role check on its own.
 * - A published idea's plan is immutable (DB trigger); later changes are append-only `nt_idea_updates`.
 * - Outcomes are derived by lib/ideaScoring.ts from daily bars and stored in `nt_idea_outcomes` (rebuildable).
 */
import { sql } from '@/lib/db';
import type { CurrentUserContext } from '@/lib/appUsers';
import {
  FEATURE_IDEAS_LONG_TERM, FEATURE_IDEAS_SHORT_TERM, FEATURE_PUBLISH_IDEAS, hasFeature,
} from '@/lib/features';
import {
  CLOSED_STATUSES, CLOSING_UPDATE_TYPES, OPEN_STATUSES, horizonTerm, horizonsOfTerm, riskReward, validatePlan, validateScheduleTime,
  type IdeaOptionStrategy, type IdeaPlanInput, type IdeaTarget, type IdeaTerm,
} from '@/lib/ideaTypes';
import { scoreIdea, type ScoreBar, type ScoreClosure, type ScoreResult } from '@/lib/ideaScoring';
import { computeStats, breakdownBy, type StatRow } from '@/lib/ideaStats';
import { IDEA_DISCLAIMER, DISCLAIMER_VERSION, disclaimerText } from '@/lib/ideaDisclaimer';
import type { LiveOfficial, LivePlan } from '@/lib/ideaLiveMath';
import { etDateOf } from '@/lib/marketSession';
import { getDailyBars } from '@/lib/dailyBars';

// ---------------------------------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------------------------------

export interface IdeaAccess {
  userId: string;
  /** Terms the viewer may read. */
  terms: IdeaTerm[];
  canPublish: boolean;
  /** Publishers and admins see every term and drafts of their own. */
  isStaff: boolean;
}

export function ideaAccess(ctx: CurrentUserContext): IdeaAccess {
  const canPublish = !!ctx.userId && (ctx.isAdmin || hasFeature(ctx.features, FEATURE_PUBLISH_IDEAS));
  const terms: IdeaTerm[] = [];
  if (canPublish || hasFeature(ctx.features, FEATURE_IDEAS_SHORT_TERM)) terms.push('short');
  if (canPublish || hasFeature(ctx.features, FEATURE_IDEAS_LONG_TERM)) terms.push('long');
  return { userId: ctx.userId ?? '', terms, canPublish, isStaff: canPublish };
}

/**
 * Hook for the later "options for long term" entitlement (not part of any plan yet, by decision). Today every
 * reader of an idea sees its option strategy. When that feature exists, return false here and the field is
 * dropped from the JSON in `toView`.
 */
export function canSeeOptionStrategy(_access: IdeaAccess): boolean { return true; }

const horizonsFor = (access: IdeaAccess): string[] => access.terms.flatMap(horizonsOfTerm);
export const todayET = () => etDateOf(Date.now());
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------

export interface IdeaOutcomeView {
  outcome: string;
  enteredOn: string | null;
  entryPrice: number | null;
  exitOn: string | null;
  exitPrice: number | null;
  targetsHit: number;
  targetsTotal: number;
  r: number | null;
  pctReturn: number | null;
  maePct: number | null;
  mfePct: number | null;
  daysToT1: number | null;
  daysHeld: number | null;
  evaluatedThrough: string | null;
  basis: string;
}

export interface IdeaUpdateView { id: string; type: string; body: string; payload: Record<string, unknown>; createdAt: string; effectiveOn: string }

export interface IdeaView {
  id: string;
  symbol: string;
  direction: string;
  horizon: string;
  term: IdeaTerm;
  status: string;
  title: string;
  rationale: string;
  entryLow: number;
  entryHigh: number;
  targets: IdeaTarget[];
  stop: number;
  validUntil: string;
  riskRating: string;
  riskReward: { risk: number; perTarget: number[]; blended: number | null };
  optionStrategy?: IdeaOptionStrategy | null;
  refPrice: number | null;
  publishedAt: string | null;
  createdAt: string;
  /** Present for staff only (the publisher's own list). */
  publisherId?: string;
  /** Staff only: when a scheduled idea will be published, and why a scheduled publish failed. */
  scheduledFor?: string | null;
  scheduleError?: string | null;
  outcome: IdeaOutcomeView | null;
  updates?: IdeaUpdateView[];
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

const IDEA_COLS = `i.id, i.publisher_id, i.symbol, i.direction, i.horizon, i.status, i.title, i.rationale,
  i.entry_low::float8 AS entry_low, i.entry_high::float8 AS entry_high, i.targets, i.stop::float8 AS stop,
  i.valid_until::text AS valid_until, i.risk_rating, i.option_strategy, i.ref_price::float8 AS ref_price,
  i.published_at, i.created_at, i.scheduled_for, i.schedule_error,
  o.outcome AS o_outcome, o.entered_on::text AS o_entered_on, o.entry_price::float8 AS o_entry_price,
  o.exit_on::text AS o_exit_on, o.exit_price::float8 AS o_exit_price, o.targets_hit AS o_targets_hit,
  o.targets_total AS o_targets_total, o.r_multiple::float8 AS o_r, o.pct_return::float8 AS o_pct,
  o.mae_pct::float8 AS o_mae, o.mfe_pct::float8 AS o_mfe, o.days_to_t1 AS o_dt1, o.days_held AS o_held,
  o.evaluated_through::text AS o_through, o.basis AS o_basis`;
const IDEA_FROM = `public.nt_trade_ideas i LEFT JOIN public.nt_idea_outcomes o ON o.idea_id = i.id`;

function toView(r: any, access: IdeaAccess): IdeaView {
  const targets: IdeaTarget[] = Array.isArray(r.targets) ? r.targets : [];
  const plan = { direction: r.direction, entryLow: r.entry_low, entryHigh: r.entry_high, stop: r.stop, targets };
  const view: IdeaView = {
    id: String(r.id),
    symbol: r.symbol,
    direction: r.direction,
    horizon: r.horizon,
    term: horizonTerm(r.horizon),
    status: r.status,
    title: r.title,
    rationale: r.rationale,
    entryLow: r.entry_low,
    entryHigh: r.entry_high,
    targets,
    stop: r.stop,
    validUntil: r.valid_until,
    riskRating: r.risk_rating,
    riskReward: riskReward(plan),
    refPrice: num(r.ref_price),
    publishedAt: iso(r.published_at),
    createdAt: iso(r.created_at) as string,
    outcome: r.o_outcome
      ? {
          outcome: r.o_outcome, enteredOn: r.o_entered_on, entryPrice: num(r.o_entry_price), exitOn: r.o_exit_on,
          exitPrice: num(r.o_exit_price), targetsHit: r.o_targets_hit, targetsTotal: r.o_targets_total, r: num(r.o_r),
          pctReturn: num(r.o_pct), maePct: num(r.o_mae), mfePct: num(r.o_mfe), daysToT1: r.o_dt1, daysHeld: r.o_held,
          evaluatedThrough: r.o_through, basis: r.o_basis,
        }
      : null,
  };
  if (canSeeOptionStrategy(access)) view.optionStrategy = r.option_strategy ?? null;
  if (access.isStaff) {
    view.publisherId = r.publisher_id;
    view.scheduledFor = iso(r.scheduled_for);
    view.scheduleError = r.schedule_error ?? null;
  }
  return view;
}

// ---------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------

export interface ListParams {
  tab: 'open' | 'closed' | 'all';
  horizon?: string | null;
  direction?: string | null;
  symbol?: string | null;
  limit?: number;
  offset?: number;
}

export interface IdeaList { items: IdeaView[]; total: number; counts: { open: number; closed: number }; locked: Array<{ term: IdeaTerm; open: number }> }

/** Published ideas the viewer may read (never drafts here). */
export async function listIdeas(access: IdeaAccess, p: ListParams): Promise<IdeaList> {
  const horizons = horizonsFor(access);
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const offset = Math.max(p.offset ?? 0, 0);
  const statuses = p.tab === 'open' ? OPEN_STATUSES : p.tab === 'closed' ? CLOSED_STATUSES : [...OPEN_STATUSES, ...CLOSED_STATUSES];
  const args: unknown[] = [horizons, statuses];
  let where = `i.horizon = ANY($1) AND i.status = ANY($2)`;
  if (p.horizon) { args.push(p.horizon); where += ` AND i.horizon = $${args.length}`; }
  if (p.direction) { args.push(p.direction); where += ` AND i.direction = $${args.length}`; }
  if (p.symbol) { args.push(p.symbol.toUpperCase()); where += ` AND i.symbol = $${args.length}`; }
  const order = p.tab === 'closed' ? `COALESCE(o.exit_on, i.published_at::date) DESC, i.id DESC` : `i.published_at DESC, i.id DESC`;

  const allTerms: IdeaTerm[] = ['short', 'long'];
  const lockedTerms = allTerms.filter(t => !access.terms.includes(t));
  const [rows, counts, lockedRows] = await Promise.all([
    sql(`SELECT ${IDEA_COLS}, count(*) OVER () AS total FROM ${IDEA_FROM} WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, args),
    sql(
      `SELECT count(*) FILTER (WHERE i.status = ANY($2)) AS open, count(*) FILTER (WHERE i.status = ANY($3)) AS closed
       FROM public.nt_trade_ideas i WHERE i.horizon = ANY($1)`,
      [horizons, OPEN_STATUSES, CLOSED_STATUSES],
    ),
    lockedTerms.length
      ? sql(`SELECT i.horizon, count(*) AS open FROM public.nt_trade_ideas i WHERE i.horizon = ANY($1) AND i.status = ANY($2) GROUP BY i.horizon`, [lockedTerms.flatMap(horizonsOfTerm), OPEN_STATUSES])
      : Promise.resolve([] as any[]),
  ]);
  // Locked terms expose only a count, never the ideas.
  const lockedByTerm = new Map<IdeaTerm, number>();
  for (const r of lockedRows as any[]) lockedByTerm.set(horizonTerm(r.horizon), (lockedByTerm.get(horizonTerm(r.horizon)) ?? 0) + Number(r.open));
  return {
    items: (rows as any[]).map(r => toView(r, access)),
    total: rows.length ? Number((rows[0] as any).total) : 0,
    counts: { open: Number((counts[0] as any)?.open ?? 0), closed: Number((counts[0] as any)?.closed ?? 0) },
    locked: lockedTerms.map(term => ({ term, open: lockedByTerm.get(term) ?? 0 })),
  };
}

/** One idea with its update timeline. Null when missing or outside the viewer's terms (indistinguishable). */
export async function getIdea(access: IdeaAccess, id: string): Promise<IdeaView | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  const rows = await sql(
    `SELECT ${IDEA_COLS} FROM ${IDEA_FROM}
     WHERE i.id = $1 AND i.horizon = ANY($2) AND (i.status NOT IN ('draft','scheduled') OR (i.publisher_id = $3 AND $4::boolean))`,
    [id, horizonsFor(access), access.userId, access.canPublish],
  );
  if (!rows.length) return null;
  const view = toView(rows[0], access);
  const ups = await sql(`SELECT id, update_type, body, payload, created_at, effective_on::text AS effective_on FROM public.nt_idea_updates WHERE idea_id = $1 ORDER BY created_at, id`, [id]);
  view.updates = (ups as any[]).map(u => ({ id: String(u.id), type: u.update_type, body: u.body, payload: u.payload ?? {}, createdAt: iso(u.created_at) as string, effectiveOn: u.effective_on }));
  return view;
}

/**
 * Just what the provisional live mark needs (plan + stored official outcome), same gate as `getIdea`:
 * null when missing or outside the viewer's terms (indistinguishable). Status is returned so the caller can
 * refuse to mark a closed idea. No updates query.
 */
export interface LiveIdeaRow { id: string; symbol: string; status: string; plan: LivePlan; official: LiveOfficial | null }
export async function getIdeaForLive(access: IdeaAccess, id: string): Promise<LiveIdeaRow | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  const rows = await sql(
    `SELECT i.id, i.symbol, i.direction, i.status, i.entry_low::float8 AS entry_low, i.entry_high::float8 AS entry_high, i.targets,
            i.stop::float8 AS stop, i.published_on::text AS published_on,
            o.outcome AS o_outcome, o.entered_on::text AS o_entered_on, o.entry_price::float8 AS o_entry_price,
            o.targets_hit AS o_targets_hit, o.evaluated_through::text AS o_through
     FROM ${IDEA_FROM}
     WHERE i.id = $1 AND i.horizon = ANY($2) AND i.status NOT IN ('draft','scheduled')`,
    [id, horizonsFor(access)],
  );
  if (!rows.length) return null;
  const r = rows[0] as any;
  const targets: IdeaTarget[] = Array.isArray(r.targets) ? r.targets : [];
  return {
    id: String(r.id),
    symbol: r.symbol,
    status: r.status,
    plan: { direction: r.direction, entryLow: r.entry_low, entryHigh: r.entry_high, targets: targets.map(t => Number(t.price)), stop: r.stop, publishedOn: r.published_on ?? '' },
    official: r.o_outcome
      ? { outcome: r.o_outcome, enteredOn: r.o_entered_on, entryPrice: num(r.o_entry_price), targetsHit: Number(r.o_targets_hit ?? 0), evaluatedThrough: r.o_through }
      : null,
  };
}

/** The publisher's own ideas (drafts included); admins see everyone's. */
export async function listManaged(access: IdeaAccess): Promise<IdeaView[]> {
  if (!access.canPublish) return [];
  const rows = await sql(
    `SELECT ${IDEA_COLS} FROM ${IDEA_FROM} WHERE ($1::boolean OR i.publisher_id = $2) ORDER BY (i.status IN ('draft','scheduled')) DESC, i.scheduled_for NULLS LAST, i.created_at DESC LIMIT 200`,
    [access.isStaff, access.userId],
  );
  return (rows as any[]).map(r => toView(r, access));
}

// ---------------------------------------------------------------------------------------------------
// Writing (publishers)
// ---------------------------------------------------------------------------------------------------

export class IdeaError extends Error {
  constructor(message: string, public status = 400, public details?: string[]) { super(message); }
}

function assertPublisher(access: IdeaAccess) {
  if (!access.canPublish) throw new IdeaError('Publishing ideas is not enabled for your account', 403);
}

const planParams = (p: IdeaPlanInput) => [
  p.symbol, p.direction, p.horizon, p.title, p.rationale, p.entryLow, p.entryHigh, JSON.stringify(p.targets), p.stop,
  p.validUntil, p.riskRating, p.optionStrategy ? JSON.stringify(p.optionStrategy) : null,
];

/** Draft plans skip the "valid until in the past" rule only at publish time, which re-validates. */
export async function saveDraft(access: IdeaAccess, raw: unknown, id?: string): Promise<string> {
  assertPublisher(access);
  const v = validatePlan(raw, todayET());
  if (!v.ok) throw new IdeaError('Fix these before saving', 422, v.errors);
  const p = planParams(v.plan);
  if (id) {
    const rows = await sql(
      `UPDATE public.nt_trade_ideas SET symbol=$1, direction=$2, horizon=$3, title=$4, rationale=$5, entry_low=$6, entry_high=$7,
         targets=$8::jsonb, stop=$9, valid_until=$10::date, risk_rating=$11, option_strategy=$12::jsonb, updated_at=now()
       WHERE id=$13 AND status IN ('draft','scheduled') AND published_at IS NULL AND ($14::boolean OR publisher_id=$15) RETURNING id`,
      [...p, id, access.isStaff, access.userId],
    );
    if (!rows.length) throw new IdeaError('Draft not found (published ideas cannot be edited; add an update instead)', 404);
    return String(rows[0].id);
  }
  const rows = await sql(
    `INSERT INTO public.nt_trade_ideas (symbol, direction, horizon, title, rationale, entry_low, entry_high, targets, stop, valid_until, risk_rating, option_strategy, publisher_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::date,$11,$12::jsonb,$13,'draft') RETURNING id`,
    [...p, access.userId],
  );
  return String(rows[0].id);
}

export async function deleteDraft(access: IdeaAccess, id: string): Promise<boolean> {
  assertPublisher(access);
  if (!/^\d{1,18}$/.test(id)) return false;
  const rows = await sql(
    `DELETE FROM public.nt_trade_ideas WHERE id=$1 AND status IN ('draft','scheduled') AND published_at IS NULL AND ($2::boolean OR publisher_id=$3) RETURNING id`,
    [id, access.isStaff, access.userId],
  );
  return rows.length > 0;
}

/** Last close for the symbol (live bar included), or null. Used for the reference price and sanity warnings. */
async function referencePrice(symbol: string): Promise<number | null> {
  try {
    const today = todayET();
    const { bars } = await getDailyBars(symbol, addDays(today, -10), today);
    return bars.length ? bars[bars.length - 1].close : null;
  } catch { return null; }
}

export interface PreviewTier { tier: string; label: string; features: string[]; sees: boolean; reason: string | null }
export interface IdeaPreview {
  plan: IdeaPlanInput;
  riskReward: ReturnType<typeof riskReward>;
  refPrice: number | null;
  warnings: string[];
  tiers: PreviewTier[];
  /** Exactly what the alert on publish will say. */
  alert: { subject: string; summary: string; disclaimer: typeof IDEA_DISCLAIMER; email: { text: string } };
}

/** What each audience will receive, without publishing anything (brief rule 8, "dry run"). */
export async function previewIdea(access: IdeaAccess, raw: unknown): Promise<IdeaPreview> {
  assertPublisher(access);
  const v = validatePlan(raw, todayET());
  if (!v.ok) throw new IdeaError('Fix these before previewing', 422, v.errors);
  const plan = v.plan;
  const term = horizonTerm(plan.horizon);
  const refPrice = await referencePrice(plan.symbol);
  const warnings: string[] = [];
  if (refPrice == null) warnings.push(`No price data was found for ${plan.symbol}; check the symbol. Publishing needs price data to track the idea.`);
  else {
    const mid = (plan.entryLow + plan.entryHigh) / 2;
    const away = Math.abs(mid - refPrice) / refPrice;
    if (away > 0.25) warnings.push(`The entry zone is ${(away * 100).toFixed(0)}% away from the last close (${refPrice}). Check the prices.`);
  }
  const wantFeature = term === 'short' ? FEATURE_IDEAS_SHORT_TERM : FEATURE_IDEAS_LONG_TERM;
  const tiers: PreviewTier[] = [
    { tier: 'SHORT_TERM', label: 'Short term plan', features: [FEATURE_IDEAS_SHORT_TERM], sees: term === 'short', reason: term === 'short' ? null : 'Long-term ideas are not part of this plan' },
    { tier: 'LONG_TERM', label: 'Long term plan', features: [FEATURE_IDEAS_LONG_TERM], sees: term === 'long', reason: term === 'long' ? null : 'Short-term ideas are not part of this plan' },
    { tier: 'PLATINUM', label: 'Platinum plan', features: [FEATURE_IDEAS_SHORT_TERM, FEATURE_IDEAS_LONG_TERM], sees: true, reason: null },
    { tier: 'OTHER', label: 'Any other plan (without the ' + wantFeature + ' gate)', features: [], sees: false, reason: 'Not entitled: the idea is absent from their feed and API' },
  ];
  const rr = riskReward(plan);
  const summary = ideaSummary(plan.symbol, plan.direction, plan.title, 'published', plan);
  return {
    plan, riskReward: rr, refPrice, warnings, tiers,
    alert: { subject: `New ${plan.direction} idea: ${plan.symbol}`, summary, disclaimer: IDEA_DISCLAIMER, email: { text: `${summary}\n\n${disclaimerText()}` } },
  };
}

function ideaSummary(symbol: string, direction: string, title: string, event: string, p?: Pick<IdeaPlanInput, 'entryLow' | 'entryHigh' | 'stop' | 'targets'>): string {
  const zone = p ? ` Entry ${p.entryLow}-${p.entryHigh}, stop ${p.stop}, ${p.targets.length} target${p.targets.length === 1 ? '' : 's'} (${p.targets.map(t => t.price).join(' / ')}).` : '';
  const verb: Record<string, string> = {
    published: 'New idea', triggered: 'Entered its zone', stopped: 'Stopped', target_hit: 'All targets hit', expired: 'Expired',
    closed: 'Closed early', cancelled: 'Cancelled', not_triggered: 'Never triggered',
  };
  return `${verb[event] ?? event}: ${symbol} ${direction}, ${title}.${event === 'published' ? zone : ''}`;
}

/** Publish a draft (or a scheduled idea now): revalidate, stamp the publish date and a reference price, record the event. */
export async function publishIdea(access: IdeaAccess, id: string): Promise<string> {
  assertPublisher(access);
  return publishCore(id, access);
}

/** `who` = null is the scheduler (no user): it may publish any scheduled idea that is due. */
async function publishCore(id: string, who: IdeaAccess | null): Promise<string> {
  if (!/^\d{1,18}$/.test(id)) throw new IdeaError('Idea not found', 404);
  const rows = await sql(
    `SELECT ${IDEA_COLS} FROM ${IDEA_FROM} WHERE i.id=$1 AND i.status IN ('draft','scheduled') AND ($2::boolean OR i.publisher_id=$3)`,
    [id, who ? who.isStaff : true, who ? who.userId : ''],
  );
  if (!rows.length) throw new IdeaError('Draft not found', 404);
  const r: any = rows[0];
  const v = validatePlan({
    symbol: r.symbol, direction: r.direction, horizon: r.horizon, title: r.title, rationale: r.rationale, entryLow: r.entry_low,
    entryHigh: r.entry_high, targets: r.targets, stop: r.stop, validUntil: r.valid_until, riskRating: r.risk_rating, optionStrategy: r.option_strategy,
  }, todayET());
  if (!v.ok) throw new IdeaError('Fix these before publishing', 422, v.errors);
  const ref = await referencePrice(v.plan.symbol);
  if (ref == null) throw new IdeaError(`No price data found for ${v.plan.symbol}; it could not be tracked.`, 422);
  const today = todayET();
  const done = await sql(
    `UPDATE public.nt_trade_ideas SET status='live', published_at=now(), published_on=$2::date, ref_price=$3, scheduled_for=NULL, schedule_error=NULL, updated_at=now()
     WHERE id=$1 AND status IN ('draft','scheduled') RETURNING id`,
    [id, today, ref],
  );
  if (!done.length) throw new IdeaError('Idea was already published', 409);
  await recordEvent(Number(id), 'published', 'published', v.plan.horizon, ideaSummary(v.plan.symbol, v.plan.direction, v.plan.title, 'published', v.plan));
  return id;
}

/**
 * Schedule a draft to publish automatically at `atIso`. The idea stays a private, editable draft ('scheduled') until the
 * tracker's next tick after that time (every 30 minutes on Railway), so the actual publish can be up to one tick late.
 * The plan is validated now and again at publish time.
 */
export async function scheduleIdea(access: IdeaAccess, id: string, atIso: unknown): Promise<{ scheduledFor: string }> {
  assertPublisher(access);
  if (!/^\d{1,18}$/.test(id)) throw new IdeaError('Idea not found', 404);
  const t = validateScheduleTime(atIso, Date.now());
  if (!t.ok) throw new IdeaError(t.error, 422);
  const rows = await sql(
    `SELECT ${IDEA_COLS} FROM ${IDEA_FROM} WHERE i.id=$1 AND i.status IN ('draft','scheduled') AND ($2::boolean OR i.publisher_id=$3)`,
    [id, access.isStaff, access.userId],
  );
  if (!rows.length) throw new IdeaError('Draft not found', 404);
  const r: any = rows[0];
  const v = validatePlan({
    symbol: r.symbol, direction: r.direction, horizon: r.horizon, title: r.title, rationale: r.rationale, entryLow: r.entry_low,
    entryHigh: r.entry_high, targets: r.targets, stop: r.stop, validUntil: r.valid_until, riskRating: r.risk_rating, optionStrategy: r.option_strategy,
  }, todayET());
  if (!v.ok) throw new IdeaError('Fix these before scheduling', 422, v.errors);
  if (r.valid_until < etDateOf(t.at.getTime())) throw new IdeaError('Valid until is before the scheduled publish date.', 422);
  const done = await sql(
    `UPDATE public.nt_trade_ideas SET status='scheduled', scheduled_for=$2::timestamptz, schedule_error=NULL, updated_at=now()
     WHERE id=$1 AND status IN ('draft','scheduled') RETURNING scheduled_for`,
    [id, t.at.toISOString()],
  );
  if (!done.length) throw new IdeaError('Draft not found', 404);
  return { scheduledFor: new Date(done[0].scheduled_for).toISOString() };
}

/** Take a scheduled idea back to a plain draft. */
export async function unscheduleIdea(access: IdeaAccess, id: string): Promise<boolean> {
  assertPublisher(access);
  if (!/^\d{1,18}$/.test(id)) return false;
  const rows = await sql(
    `UPDATE public.nt_trade_ideas SET status='draft', scheduled_for=NULL, updated_at=now()
     WHERE id=$1 AND status='scheduled' AND published_at IS NULL AND ($2::boolean OR publisher_id=$3) RETURNING id`,
    [id, access.isStaff, access.userId],
  );
  return rows.length > 0;
}

export interface DueResult { due: number; published: number; failed: number }

/**
 * Publish every scheduled idea whose time has come (called first on each tracker tick). A failure (bad plan by
 * now, no price data) returns that idea to 'draft' with the reason in schedule_error so it is not retried forever
 * and the publisher sees why. Each idea is independent and non-fatal.
 */
export async function publishDueIdeas(deadline?: number): Promise<DueResult> {
  const res: DueResult = { due: 0, published: 0, failed: 0 };
  const due = await sql(`SELECT id FROM public.nt_trade_ideas WHERE status='scheduled' AND scheduled_for <= now() ORDER BY scheduled_for, id LIMIT 50`);
  res.due = due.length;
  for (const d of due as any[]) {
    if (deadline && Date.now() > deadline) break;
    try {
      await publishCore(String(d.id), null);
      res.published++;
    } catch (error) {
      res.failed++;
      const msg = error instanceof IdeaError ? [error.message, ...(error.details ?? [])].join(' ') : 'Unexpected error while publishing';
      if (!(error instanceof IdeaError)) console.error('[ideas] scheduled publish failed', d.id, error);
      await sql(`UPDATE public.nt_trade_ideas SET status='draft', scheduled_for=NULL, schedule_error=$2, updated_at=now() WHERE id=$1 AND status='scheduled'`, [d.id, msg.slice(0, 500)]).catch(() => {});
    }
  }
  return res;
}

export interface NewUpdate { type: string; body?: string; stop?: number; price?: number; pct?: number }

/** Append a timeline entry. Closing updates end the idea early; none of them rewrite the plan. */
export async function addUpdate(access: IdeaAccess, id: string, input: NewUpdate): Promise<string> {
  assertPublisher(access);
  const types = ['note', 'stop_moved', 'partial_booked', 'closed', 'cancelled'];
  if (!types.includes(input.type)) throw new IdeaError('Unknown update type');
  const body = String(input.body ?? '').trim().slice(0, 2000);
  const payload: Record<string, number> = {};
  if (input.type === 'stop_moved') {
    if (!(typeof input.stop === 'number' && input.stop > 0)) throw new IdeaError('A stop price is required');
    payload.stop = input.stop;
  }
  if (input.type === 'partial_booked') {
    if (typeof input.price === 'number' && input.price > 0) payload.price = input.price;
    if (typeof input.pct === 'number' && input.pct > 0 && input.pct <= 100) payload.pct = input.pct;
  }
  if (input.type === 'note' && !body) throw new IdeaError('Write a note');
  const rows = await sql(`SELECT status, symbol, direction, title, horizon FROM public.nt_trade_ideas WHERE id=$1 AND status NOT IN ('draft','scheduled') AND ($2::boolean OR publisher_id=$3)`, [id, access.isStaff, access.userId]);
  if (!rows.length) throw new IdeaError('Idea not found', 404);
  const idea: any = rows[0];
  const closing = (CLOSING_UPDATE_TYPES as readonly string[]).includes(input.type);
  if (closing && !OPEN_STATUSES.includes(idea.status)) throw new IdeaError('This idea has already ended', 409);
  if (!closing && !OPEN_STATUSES.includes(idea.status) && input.type !== 'note') throw new IdeaError('This idea has already ended; you can still add a note', 409);
  const ins = await sql(
    `INSERT INTO public.nt_idea_updates (idea_id, update_type, body, payload, created_by, effective_on) VALUES ($1,$2,$3,$4::jsonb,$5,$6::date) RETURNING id`,
    [id, input.type, body, JSON.stringify(payload), access.userId, todayET()],
  );
  const updateId = String(ins[0].id);
  if (closing) {
    await sql(`UPDATE public.nt_trade_ideas SET status=$2, updated_at=now() WHERE id=$1`, [id, input.type === 'closed' ? 'closed_by_publisher' : 'cancelled']);
  }
  const label: Record<string, string> = { note: 'Update', stop_moved: `Stop moved to ${payload.stop}`, partial_booked: 'Partial booked', closed: 'Closed early', cancelled: 'Cancelled' };
  await recordEvent(Number(id), `update:${updateId}`, input.type, idea.horizon, `${label[input.type]}: ${idea.symbol} ${idea.direction}, ${idea.title}.${body ? ` ${body.slice(0, 200)}` : ''}`);
  return updateId;
}

// ---------------------------------------------------------------------------------------------------
// Events, feed and alerts
// ---------------------------------------------------------------------------------------------------

/** Append an event once per (idea, key): re-running the tracker never duplicates it. */
async function recordEvent(ideaId: number, eventKey: string, eventType: string, horizon: string, summary: string): Promise<void> {
  await sql(
    `INSERT INTO public.nt_idea_events (idea_id, event_key, event_type, horizon, summary) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idea_id, event_key) DO NOTHING`,
    [ideaId, eventKey, eventType, horizon, summary],
  );
}

export interface FeedItem { id: string; ideaId: string; type: string; summary: string; createdAt: string; unread: boolean }

/** The in-app alert feed: events on ideas the viewer may read. No per-user fan-out rows are needed. */
export async function listFeed(access: IdeaAccess, limit = 30): Promise<{ items: FeedItem[]; unread: number }> {
  const horizons = horizonsFor(access);
  if (!horizons.length) return { items: [], unread: 0 };
  const [rows, prefs] = await Promise.all([
    sql(
      `SELECT e.id, e.idea_id, e.event_type, e.summary, e.created_at FROM public.nt_idea_events e
       WHERE e.horizon = ANY($1) AND e.created_at > now() - interval '30 days' ORDER BY e.id DESC LIMIT ${Math.min(limit, 100)}`,
      [horizons],
    ),
    sql(`SELECT feed_seen_at FROM public.nt_idea_prefs WHERE user_id = $1`, [access.userId]),
  ]);
  const seen = prefs[0]?.feed_seen_at ? new Date(prefs[0].feed_seen_at).getTime() : 0;
  const items = (rows as any[]).map(r => ({
    id: String(r.id), ideaId: String(r.idea_id), type: r.event_type, summary: r.summary,
    createdAt: iso(r.created_at) as string, unread: new Date(r.created_at).getTime() > seen,
  }));
  return { items, unread: items.filter(i => i.unread).length };
}

export async function markFeedSeen(userId: string): Promise<void> {
  await sql(
    `INSERT INTO public.nt_idea_prefs (user_id, feed_seen_at) VALUES ($1, now()) ON CONFLICT (user_id) DO UPDATE SET feed_seen_at = now(), updated_at = now()`,
    [userId],
  );
}

export interface IdeaPrefs { emailAlerts: boolean; telegramAlerts: boolean; pushAlerts: boolean }

export async function getPrefs(userId: string): Promise<IdeaPrefs> {
  const rows = await sql(`SELECT email_alerts, telegram_alerts, push_alerts FROM public.nt_idea_prefs WHERE user_id = $1`, [userId]);
  return { emailAlerts: !!rows[0]?.email_alerts, telegramAlerts: !!rows[0]?.telegram_alerts, pushAlerts: !!rows[0]?.push_alerts };
}

/** Set any of the channel opt-ins (omitted ones keep their value). In-app alerts are always on. */
export async function setPrefs(userId: string, patch: Partial<IdeaPrefs>): Promise<IdeaPrefs> {
  const cur = await getPrefs(userId);
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === 'boolean')) } as IdeaPrefs;
  await sql(
    `INSERT INTO public.nt_idea_prefs (user_id, email_alerts, telegram_alerts, push_alerts) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO UPDATE SET email_alerts=$2, telegram_alerts=$3, push_alerts=$4, updated_at=now()`,
    [userId, next.emailAlerts, next.telegramAlerts, next.pushAlerts],
  );
  return next;
}

export async function getAck(userId: string): Promise<{ acknowledged: boolean; ackedAt: string | null }> {
  const rows = await sql(`SELECT version, acked_at FROM public.nt_idea_disclaimer_acks WHERE user_id = $1`, [userId]);
  const r = rows[0];
  return { acknowledged: !!r && r.version === DISCLAIMER_VERSION, ackedAt: r ? iso(r.acked_at) : null };
}

export async function acknowledgeDisclaimer(userId: string): Promise<void> {
  await sql(
    `INSERT INTO public.nt_idea_disclaimer_acks (user_id, version) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET version = $2, acked_at = now()`,
    [userId, DISCLAIMER_VERSION],
  );
}

// ---------------------------------------------------------------------------------------------------
// Tracking (cron)
// ---------------------------------------------------------------------------------------------------

const STATUS_OF_OUTCOME: Record<string, string> = {
  pending: 'live', open: 'triggered', target_hit: 'target_hit', stopped: 'stopped', expired: 'expired',
  closed_by_publisher: 'closed_by_publisher', cancelled: 'cancelled', not_triggered: 'expired',
};

const EVENT_KEY: Record<string, string> = { triggered: 'triggered', stopped: 'stopped', expired: 'expired', closed_by_publisher: 'closed', not_triggered: 'not_triggered', cancelled: 'cancelled' };

export interface EvaluateResult { evaluated: number; finished: number; events: number; skipped: number; errors: number }

/**
 * Re-score ideas against daily bars and store the outcome (derived and rebuildable: pass `all` to rebuild every
 * published idea, finished ones included). Non-fatal per idea. `asOf` is yesterday (US/Eastern): the last
 * complete session, so a partial bar never decides anything.
 */
export async function evaluateIdeas(opts: { all?: boolean; ideaId?: string; deadline?: number } = {}): Promise<EvaluateResult> {
  const res: EvaluateResult = { evaluated: 0, finished: 0, events: 0, skipped: 0, errors: 0 };
  const asOf = addDays(todayET(), -1);
  const args: unknown[] = [];
  let where = `i.status NOT IN ('draft','scheduled') AND i.published_on IS NOT NULL`;
  if (opts.ideaId) { args.push(opts.ideaId); where += ` AND i.id = $1`; }
  else if (!opts.all) where += ` AND i.status IN ('live','triggered')`;
  const ideas = await sql(`SELECT i.id, i.symbol, i.direction, i.horizon, i.title, i.status, i.entry_low::float8 AS entry_low, i.entry_high::float8 AS entry_high,
    i.targets, i.stop::float8 AS stop, i.published_on::text AS published_on, i.valid_until::text AS valid_until FROM public.nt_trade_ideas i WHERE ${where} ORDER BY i.id`, args);

  for (const idea of ideas as any[]) {
    if (opts.deadline && Date.now() > opts.deadline) { res.skipped++; continue; }
    try {
      const closeRows = await sql(`SELECT update_type, effective_on::text AS effective_on FROM public.nt_idea_updates WHERE idea_id=$1 AND update_type IN ('closed','cancelled') ORDER BY id LIMIT 1`, [idea.id]);
      const closure: ScoreClosure | null = closeRows[0] ? { kind: closeRows[0].update_type, effectiveOn: closeRows[0].effective_on } : null;
      const to = idea.valid_until < asOf ? idea.valid_until : asOf;
      let bars: ScoreBar[] = [];
      if (to > idea.published_on) {
        const got = await getDailyBars(idea.symbol, addDays(idea.published_on, 1), to);
        if (got.bars.length === 0 && got.error) { res.errors++; continue; }
        bars = got.bars.filter(b => b.date <= asOf);
      }
      const targets = (Array.isArray(idea.targets) ? idea.targets : []).map((t: IdeaTarget) => Number(t.price));
      const score = scoreIdea(
        { direction: idea.direction, entryLow: idea.entry_low, entryHigh: idea.entry_high, targets, stop: idea.stop, publishedOn: idea.published_on, validUntil: idea.valid_until },
        bars, closure, asOf,
      );
      await storeOutcome(idea, score, closure);
      res.evaluated++;
      if (score.final) res.finished++;
      res.events += await emitScoreEvents(idea, score);
    } catch (error) {
      res.errors++;
      console.error('[ideas] evaluate failed', idea.id, error instanceof Error ? error.message : error);
    }
  }
  return res;
}

async function storeOutcome(idea: any, s: ScoreResult, closure: ScoreClosure | null): Promise<void> {
  await sql(
    `INSERT INTO public.nt_idea_outcomes (idea_id, outcome, entered_on, entry_price, exit_on, exit_price, targets_hit, targets_total, r_multiple, pct_return, mae_pct, mfe_pct, days_to_t1, days_held, events, evaluated_through, updated_at)
     VALUES ($1,$2,$3::date,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::date,now())
     ON CONFLICT (idea_id) DO UPDATE SET outcome=EXCLUDED.outcome, entered_on=EXCLUDED.entered_on, entry_price=EXCLUDED.entry_price, exit_on=EXCLUDED.exit_on,
       exit_price=EXCLUDED.exit_price, targets_hit=EXCLUDED.targets_hit, targets_total=EXCLUDED.targets_total, r_multiple=EXCLUDED.r_multiple,
       pct_return=EXCLUDED.pct_return, mae_pct=EXCLUDED.mae_pct, mfe_pct=EXCLUDED.mfe_pct, days_to_t1=EXCLUDED.days_to_t1, days_held=EXCLUDED.days_held,
       events=EXCLUDED.events, evaluated_through=EXCLUDED.evaluated_through, updated_at=now()`,
    [idea.id, s.outcome, s.enteredOn, s.entryPrice, s.exitOn, s.exitPrice, s.targetsHit, s.targetsTotal, s.r, s.pctReturn, s.maePct, s.mfePct, s.daysToT1, s.daysHeld, JSON.stringify(s.events), s.evaluatedThrough],
  );
  // A publisher's early close is shown at once; the result replaces it when the session completes.
  const status = closure && !s.final ? (closure.kind === 'closed' ? 'closed_by_publisher' : 'cancelled') : STATUS_OF_OUTCOME[s.outcome] ?? idea.status;
  if (status !== idea.status) await sql(`UPDATE public.nt_trade_ideas SET status=$2, updated_at=now() WHERE id=$1`, [idea.id, status]);
}

async function emitScoreEvents(idea: any, s: ScoreResult): Promise<number> {
  let n = 0;
  for (const e of s.events) {
    let key: string;
    let type: string;
    if (e.type === 'target_hit') { key = `target:${e.detail}`; type = 'target_hit'; }
    else { key = EVENT_KEY[e.type] ?? e.type; type = e.type === 'closed_by_publisher' ? 'closed' : e.type; }
    // The publisher's own close/cancel already has an `update:<id>` event; the tracker does not announce it twice.
    if (e.type === 'closed_by_publisher' || e.type === 'cancelled') continue;
    const summary = e.type === 'target_hit'
      ? `${e.detail} reached: ${idea.symbol} ${idea.direction}, ${idea.title}.`
      : ideaSummary(idea.symbol, idea.direction, idea.title, type === 'target_hit' ? 'target_hit' : e.type);
    await recordEvent(Number(idea.id), key, type, idea.horizon, summary);
    n++;
  }
  // Every target hit is announced per target; the ladder completing also ends the idea.
  if (s.outcome === 'target_hit') await recordEvent(Number(idea.id), 'all_targets', 'target_hit', idea.horizon, ideaSummary(idea.symbol, idea.direction, idea.title, 'target_hit'));
  return n;
}

// ---------------------------------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------------------------------

export interface PerformanceFilters { horizon?: string | null; direction?: string | null; from?: string | null; to?: string | null }

export async function loadStatRows(access: IdeaAccess, f: PerformanceFilters = {}): Promise<{ rows: StatRow[]; closedList: IdeaView[] }> {
  const args: unknown[] = [horizonsFor(access)];
  let where = `i.horizon = ANY($1) AND i.status NOT IN ('draft','scheduled') AND o.idea_id IS NOT NULL`;
  if (f.horizon) { args.push(f.horizon); where += ` AND i.horizon = $${args.length}`; }
  if (f.direction) { args.push(f.direction); where += ` AND i.direction = $${args.length}`; }
  if (f.from) { args.push(f.from); where += ` AND i.published_on >= $${args.length}::date`; }
  if (f.to) { args.push(f.to); where += ` AND i.published_on <= $${args.length}::date`; }
  const rows = await sql(
    `SELECT i.id, i.symbol, i.horizon, i.direction, i.publisher_id, (i.option_strategy IS NOT NULL) AS has_option,
       o.outcome, o.r_multiple::float8 AS r, o.pct_return::float8 AS pct, o.exit_on::text AS exit_on, o.days_to_t1, o.mae_pct::float8 AS mae, o.targets_hit
     FROM public.nt_trade_ideas i JOIN public.nt_idea_outcomes o ON o.idea_id = i.id WHERE ${where} ORDER BY i.id`,
    args,
  );
  const statRows: StatRow[] = (rows as any[]).map(r => ({
    id: Number(r.id), symbol: r.symbol, horizon: r.horizon, direction: r.direction, publisherId: r.publisher_id, hasOption: !!r.has_option,
    outcome: r.outcome, r: num(r.r), pctReturn: num(r.pct), exitOn: r.exit_on, daysToT1: r.days_to_t1, maePct: num(r.mae), targetsHit: r.targets_hit,
  }));
  const list = await sql(
    `SELECT ${IDEA_COLS} FROM ${IDEA_FROM} WHERE ${where.replace('o.idea_id IS NOT NULL', `o.outcome NOT IN ('pending','open')`)}
     ORDER BY COALESCE(o.exit_on, i.published_on) DESC, i.id DESC LIMIT 100`,
    args,
  );
  return { rows: statRows, closedList: (list as any[]).map(r => toView(r, access)) };
}

export async function desk(access: IdeaAccess, f: PerformanceFilters = {}) {
  const { rows, closedList } = await loadStatRows(access, f);
  return {
    stats: computeStats(rows),
    byHorizon: breakdownBy(rows, 'horizon'),
    byDirection: breakdownBy(rows, 'direction'),
    bySymbol: breakdownBy(rows, 'symbol').slice(0, 15),
    byOptions: breakdownBy(rows, 'hasOption'),
    results: closedList,
  };
}
