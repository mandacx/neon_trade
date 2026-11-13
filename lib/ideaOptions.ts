/**
 * Trade Ideas Desk: tracks an idea's OPTION STRATEGY against its option prices (docs/trade-ideas.md, "Option strategy
 * tracking"). Server-only. The maths is in lib/ideaOptionMath.ts (pure).
 *
 * The position opens when the UNDERLYING enters (the official outcome's `triggered` event), is marked at each target
 * the stock reaches (information only), and closes with the idea (stop, last target, valid-until, publisher close) or when
 * the options expire, whichever is first. Everything is an ESTIMATE and is labelled by how it was priced:
 *
 *   quote_mid          mid of the live bid/ask, read within ~20 minutes of the moment it describes
 *   quote_mid_late     mid of the live bid/ask read LATER the same day (the quote history of a past moment is not available)
 *   replay_last_trade  the last trade at or before that moment (past days only; option trades are sparse, so this can be stale)
 *   last_trade         live quote had no usable bid/ask: the last trade
 *   expiry_intrinsic   the options expired: intrinsic value at the stock's close on the expiry date
 *
 * A leg with no price at all leaves that moment unpriced (retried on the next run); nothing is invented. Entry, target
 * and exit rows are written once (never rewritten); the `latest` row is the current mark. Separate from the idea's score:
 * never fed to `scoreIdea` and never counted in desk statistics. If `nt_idea_option_marks` does not exist yet
 * (scripts/add-idea-option-marks.mjs) every function here degrades to "nothing tracked".
 */
import { sql } from '@/lib/db';
import { getOptionBarsMulti, getOptionSnapshotsMulti } from '@/lib/marketdata';
import { getDailyBars } from '@/lib/dailyBars';
import { etDateOf, etInstantMs, getMarketState } from '@/lib/marketSession';
import { intrinsicPrices, midOf, occSymbol, summarizeOption, type OptLeg, type OptPoint, type OptSummary } from '@/lib/ideaOptionMath';
import type { IdeaOptionStrategy } from '@/lib/ideaTypes';

const LIVE_WINDOW_MS = 20 * 60_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

interface Priced { prices: Array<number | null>; bases: string[]; /** replay only: true per leg when the price is a trade on the moment's own day */ sameDay?: boolean[] }
const labelOf = (bases: string[]) => (bases.length && bases.every(b => b === bases[0]) ? bases[0] : 'mixed');

/** Live quote mid per OCC symbol (last trade when there is no usable bid/ask). */
async function livePrices(occs: string[]): Promise<Priced> {
  const snaps = await getOptionSnapshotsMulti(occs);
  const prices: Array<number | null> = [];
  const bases: string[] = [];
  for (const occ of occs) {
    const s = snaps[occ];
    const mid = midOf(s?.latestQuote?.bp, s?.latestQuote?.ap);
    const last = typeof s?.latestTrade?.p === 'number' && s.latestTrade.p > 0 ? s.latestTrade.p : null;
    if (mid != null) { prices.push(mid); bases.push('quote_mid'); }
    else if (last != null) { prices.push(last); bases.push('last_trade'); }
    else { prices.push(null); bases.push('none'); }
  }
  return { prices, bases };
}

/**
 * The last trade at or before a PAST moment: the 15-minute bars of that ET date up to `atMs` (when given), else the most
 * recent daily close before it (carried forward, so it can be several days stale: option trades are sparse).
 * Never called for today: the data plan refuses same-day option bars.
 */
async function replayPrices(occs: string[], date: string, atMs: number | null): Promise<Priced> {
  // The plan refuses any range that includes the current trading day, so the end is capped at yesterday.
  const lastOk = addDays(etDateOf(Date.now()), -1);
  const end = addDays(date, 1) < lastOk ? addDays(date, 1) : lastOk;
  const [m15, d1] = await Promise.all([
    atMs != null ? getOptionBarsMulti(occs, date, end, '15Min') : Promise.resolve({ bars: {} as Record<string, any[]>, failed: [] as string[] }),
    getOptionBarsMulti(occs, addDays(date, -10), end, '1Day'),
  ]);
  const prices: Array<number | null> = [];
  const bases: string[] = [];
  const sameDay: boolean[] = [];
  for (const occ of occs) {
    const intraday = (m15.bars[occ] ?? []).filter(b => etDateOf(Date.parse(b.t)) === date && atMs != null && Date.parse(b.t) <= atMs);
    let px: number | null = intraday.length ? intraday[intraday.length - 1].c : null;
    if (px == null) {
      // No trade that day at or before the moment: the last daily close on that date (no exact time) or before it.
      const daily = (d1.bars[occ] ?? []).filter(b => { const d = etDateOf(Date.parse(b.t)); return atMs == null ? d <= date : d < date; });
      px = daily.length ? daily[daily.length - 1].c : null;
    }
    prices.push(px != null && px >= 0 ? px : null);
    bases.push(px != null ? 'replay_last_trade' : 'none');
    sameDay.push(intraday.length > 0);
  }
  return { prices, bases, sameDay };
}

/** Price the legs for the moment described by (date, atMs): live mid when it is now, else the best honest estimate. */
async function priceMoment(occs: string[], date: string, atMs: number | null, nowMs: number): Promise<Priced & { note: string | null }> {
  const today = etDateOf(nowMs);
  if (atMs != null && nowMs - atMs <= LIVE_WINDOW_MS) return { ...(await livePrices(occs)), note: null };
  if (date >= today) {
    const live = await livePrices(occs);
    const mins = atMs != null ? Math.max(0, Math.round((nowMs - atMs) / 60_000)) : null;
    return { prices: live.prices, bases: live.bases.map(b => (b === 'quote_mid' ? 'quote_mid_late' : b)), note: mins != null ? `quotes read ${mins} min after the moment` : 'quotes read later the same day' };
  }
  return { ...(await replayPrices(occs, date, atMs)), note: atMs == null ? 'time within the day unknown: last trade up to that day' : null };
}

interface EventLike { type: string; date: string; price: number | null; detail?: string; at?: string }
interface Row {
  id: string; symbol: string; outcome: string; entered_on: string | null; events: EventLike[] | null;
  option_strategy: IdeaOptionStrategy | null;
}

/** A same-day quote read long after its moment (quote_mid_late) is replaced once the day is past, when option trades of that day exist. */
async function repriceLate(r: Row, occs: string[], key: string, kind: OptPoint['kind'], e: EventLike, have: Map<string, { basis: string }>, nowMs: number, res: OptionTrackResult): Promise<void> {
  const h = have.get(key);
  if (!h || h.basis !== 'quote_mid_late' || e.date >= etDateOf(nowMs)) return;
  const at = eventAt(e);
  const p = await replayPrices(occs, e.date, at.ms);
  if (!complete(p) || !p.sameDay?.every(Boolean)) return; // a stale prior-day close is no better than the late quote
  await insertPoint(r.id, key, kind, at.iso, e.price, occs, p, 'replaced the late quote with the last trade of that day', true); res.written++;
  have.set(key, { basis: 'replay_last_trade' });
}

async function insertPoint(ideaId: string, key: string, kind: OptPoint['kind'], atIso: string, underlying: number | null, occs: string[], priced: Priced, note: string | null, replace: boolean): Promise<void> {
  const legs = occs.map((occ, i) => ({ occ, price: priced.prices[i], basis: priced.bases[i] }));
  await sql(
    `INSERT INTO public.nt_idea_option_marks (idea_id, event_key, kind, at, underlying, legs, basis, note)
     VALUES ($1,$2,$3,$4::timestamptz,$5,$6::jsonb,$7,$8)
     ON CONFLICT (idea_id, event_key) DO ${replace ? 'UPDATE SET at=EXCLUDED.at, captured_at=now(), underlying=EXCLUDED.underlying, legs=EXCLUDED.legs, basis=EXCLUDED.basis, note=EXCLUDED.note' : 'NOTHING'}`,
    [ideaId, key, kind, atIso, underlying, JSON.stringify(legs), labelOf(priced.bases), note],
  );
}

const complete = (p: Priced) => p.prices.length > 0 && p.prices.every(x => typeof x === 'number' && Number.isFinite(x));
/** When the event happened: the bar close if known, else the close of that session (the hit's time within the day is not recorded). */
const eventAt = (e: EventLike): { iso: string; ms: number | null } =>
  e.at ? { iso: new Date(e.at).toISOString(), ms: Date.parse(e.at) } : { iso: new Date(etInstantMs(e.date, '16:00')).toISOString(), ms: null };

export interface OptionTrackResult { ideas: number; written: number; skipped: number; errors: number; unavailable?: string }

/** Price the option strategies of every entered idea that still needs a point. Idempotent; safe to call every tracker run. */
export async function trackOptionStrategies(opts: { deadline?: number } = {}): Promise<OptionTrackResult> {
  const res: OptionTrackResult = { ideas: 0, written: 0, skipped: 0, errors: 0 };
  let rows: Row[];
  try {
    rows = (await sql(
      `SELECT i.id::text AS id, i.symbol, o.outcome, o.entered_on::text AS entered_on, o.events, i.option_strategy
       FROM public.nt_trade_ideas i JOIN public.nt_idea_outcomes o ON o.idea_id = i.id
       WHERE i.option_strategy IS NOT NULL AND i.status NOT IN ('draft','scheduled') AND o.entered_on IS NOT NULL
         AND (o.outcome = 'open' OR (o.updated_at > now() - interval '7 days'
              AND NOT EXISTS (SELECT 1 FROM public.nt_idea_option_marks m WHERE m.idea_id = i.id AND m.event_key = 'exit')))
       ORDER BY i.id`,
      [],
    )) as unknown as Row[];
  } catch (error) {
    res.unavailable = error instanceof Error ? error.message : 'query failed';
    return res; // table not created yet: nothing to track
  }

  const nowMs = Date.now();
  const today = etDateOf(nowMs);
  const session = rows.length ? (await getMarketState(new Date(nowMs))).session : 'closed';

  for (const r of rows) {
    if (opts.deadline && Date.now() > opts.deadline) { res.skipped++; continue; }
    const strat = r.option_strategy;
    if (!strat || !strat.expiry || !Array.isArray(strat.legs) || strat.legs.length === 0) { res.skipped++; continue; }
    res.ideas++;
    try {
      const legs: OptLeg[] = strat.legs;
      const occs = legs.map(l => occSymbol(r.symbol, strat.expiry!, l.type, l.strike));
      const have = new Map<string, { basis: string }>(((await sql(`SELECT event_key, basis FROM public.nt_idea_option_marks WHERE idea_id = $1`, [r.id])) as any[]).map(x => [x.event_key as string, { basis: String(x.basis) }]));
      const events = Array.isArray(r.events) ? r.events : [];
      const trig = events.find(e => e.type === 'triggered');
      if (!trig) { res.skipped++; continue; }

      // 1. Entry: the moment the stock entered.
      if (!have.has('entry')) {
        const at = eventAt(trig);
        const p = await priceMoment(occs, trig.date, at.ms, nowMs);
        if (!complete(p)) { res.skipped++; continue; } // no entry price, so nothing after it can be measured: retry next run
        await insertPoint(r.id, 'entry', 'entry', at.iso, trig.price, occs, p, p.note, false); res.written++;
        have.set('entry', { basis: labelOf(p.bases) });
      } else await repriceLate(r, occs, 'entry', 'entry', trig, have, nowMs, res);

      // 2. Targets reached: information only.
      for (const e of events.filter(x => x.type === 'target_hit' && x.detail)) {
        const key = `target:${e.detail}`;
        if (e.date >= strat.expiry) continue;
        if (have.has(key)) { await repriceLate(r, occs, key, 'target', e, have, nowMs, res); continue; }
        const at = eventAt(e);
        const p = await priceMoment(occs, e.date, at.ms, nowMs);
        if (!complete(p)) continue;
        await insertPoint(r.id, key, 'target', at.iso, e.price, occs, p, p.note, false); res.written++;
      }

      if (have.has('exit') && have.get('exit')!.basis === 'quote_mid_late') {
        const finishedEv = r.outcome === 'target_hit' ? [...events].reverse().find(e => e.type === 'target_hit') : events.find(e => e.type === (r.outcome === 'closed_by_publisher' ? 'closed_by_publisher' : r.outcome));
        if (finishedEv) await repriceLate(r, occs, 'exit', 'exit', finishedEv, have, nowMs, res);
      }

      // 3. Exit: with the idea, or when the options expire if that comes first.
      if (!have.has('exit')) {
        const finished = ['stopped', 'target_hit', 'expired', 'closed_by_publisher'].includes(r.outcome);
        const endEv = finished
          ? (r.outcome === 'target_hit' ? [...events].reverse().find(e => e.type === 'target_hit') : events.find(e => e.type === (r.outcome === 'closed_by_publisher' ? 'closed_by_publisher' : r.outcome)))
          : undefined;
        const expired = strat.expiry < today; // the expiry session is complete
        if (expired && (!endEv || endEv.date >= strat.expiry)) {
          const { bars } = await getDailyBars(r.symbol, strat.expiry, strat.expiry);
          const close = bars.find(b => b.date === strat.expiry)?.close;
          if (typeof close === 'number' && close > 0) {
            const prices = intrinsicPrices(legs, close);
            await insertPoint(r.id, 'exit', 'exit', new Date(etInstantMs(strat.expiry, '16:00')).toISOString(), close, occs,
              { prices, bases: prices.map(() => 'expiry_intrinsic') }, 'the options expired: intrinsic value at the stock close', false);
            res.written++; have.set('exit', { basis: 'expiry_intrinsic' });
          }
        } else if (endEv) {
          const at = eventAt(endEv);
          const p = await priceMoment(occs, endEv.date, at.ms, nowMs);
          if (complete(p)) { await insertPoint(r.id, 'exit', 'exit', at.iso, endEv.price, occs, p, p.note, false); res.written++; have.set('exit', { basis: labelOf(p.bases) }); }
        } 
      }

      // 4. Latest mark while open: refreshed during the regular session (once otherwise, so there is always one).
      if (!have.has('exit') && r.outcome === 'open' && strat.expiry >= today && (session === 'regular' || !have.has('latest'))) {
        const p = await livePrices(occs);
        if (complete(p)) { await insertPoint(r.id, 'latest', 'mark', new Date(nowMs).toISOString(), null, occs, p, null, true); res.written++; }
      }
    } catch (error) {
      res.errors++;
      console.error('[ideaOptions] failed', r.id, error instanceof Error ? error.message : error);
    }
  }
  return res;
}

export interface OptionTrack {
  /** false when the strategy cannot be tracked (no expiry given). */
  trackable: boolean;
  reason?: string;
  summary: OptSummary;
  /** Plain-language limits of the numbers, shown with them. */
  notes: string[];
}

export const OPTION_TRACK_NOTES = [
  'Estimates, not fills: prices are the mid of the live bid and ask (or the last trade), so real fills will differ by part of the spread.',
  'Opens when the stock enters; target marks are information only; closes with the idea or when the options expire.',
  'Return is on estimated capital (the larger of the max loss and the debit paid), not a broker margin requirement.',
  'Separate from the idea\'s R and not counted in desk statistics.',
];

/**
 * The tracked option P&L of one idea (callers have already read the idea through the gated SQL). null when the strategy
 * has no expiry or the table is missing.
 */
export async function getOptionTrack(ideaId: string, strategy: IdeaOptionStrategy | null, entered: boolean): Promise<OptionTrack | null> {
  if (!strategy || !Array.isArray(strategy.legs) || strategy.legs.length === 0) return null;
  if (!strategy.expiry) {
    return { trackable: false, reason: 'No expiry was given for this strategy, so its option prices cannot be tracked.', summary: summarizeOption([], [], entered), notes: OPTION_TRACK_NOTES };
  }
  let rows: any[] = [];
  try {
    rows = (await sql(`SELECT event_key, kind, at, captured_at, underlying::float8 AS underlying, legs, basis FROM public.nt_idea_option_marks WHERE idea_id = $1`, [ideaId])) as any[];
  } catch { return null; }
  const points: OptPoint[] = rows.map(x => ({
    kind: x.kind, key: x.event_key, at: new Date(x.at).toISOString(), underlying: x.underlying == null ? null : Number(x.underlying),
    prices: (Array.isArray(x.legs) ? x.legs : []).map((l: any) => (typeof l?.price === 'number' ? l.price : null)), basis: String(x.basis), capturedAt: new Date(x.captured_at).toISOString(),
  }));
  return { trackable: true, summary: summarizeOption(strategy.legs, points, entered), notes: OPTION_TRACK_NOTES };
}
