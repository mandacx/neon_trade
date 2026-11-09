/**
 * "I took this" (docs/trade-ideas.md): a subscriber's own, private journal of the ideas they chose to take. Server-only.
 * Nothing is sent to a broker. The quantity and the price are the subscriber's own (validated, never defaulted), a
 * preview is shown before saving, and every query filters on user_id inside the SQL, so another user's row behaves
 * exactly like a missing one.
 */
import { sql } from '@/lib/db';
import { getSnapshotsMulti } from '@/lib/marketdata';
import { getIdea, IdeaError, type IdeaAccess, type IdeaView } from '@/lib/ideas';
import { OPEN_STATUSES, horizonsOfTerm } from '@/lib/ideaTypes';
import { compareFollowed, previewTaken, tradeResult, validateTaken, type CompareRow, type Followed, type TakenPreview } from '@/lib/ideaTakenMath';
import { COUNTED_OUTCOMES } from '@/lib/ideaStats';

export interface TakenView {
  id: string;
  ideaId: string;
  symbol: string;
  direction: string;
  horizon: string;
  title: string;
  ideaStatus: string;
  ideaOutcome: string | null;
  ideaR: number | null;
  ideaPct: number | null;
  qty: number;
  entryPrice: number;
  takenAt: string;
  note: string | null;
  exitPrice: number | null;
  closedAt: string | null;
  /** Realised once closed; otherwise marked to the latest price when one is available. */
  mark: number | null;
  profit: number | null;
  pct: number | null;
  open: boolean;
}

export interface TakenPreviewResult { idea: Pick<IdeaView, 'id' | 'symbol' | 'direction' | 'entryLow' | 'entryHigh' | 'stop'>; qty: number; entryPrice: number; preview: TakenPreview }

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function openIdeaFor(access: IdeaAccess, ideaId: string): Promise<IdeaView> {
  const idea = await getIdea(access, ideaId);
  if (!idea || idea.status === 'draft' || idea.status === 'scheduled') throw new IdeaError('Idea not found', 404);
  if (!OPEN_STATUSES.includes(idea.status)) throw new IdeaError('This idea has already ended, so it can no longer be taken.', 409);
  return idea;
}

/** What the trade would look like at the subscriber's own numbers. Saves nothing. */
export async function previewTake(access: IdeaAccess, ideaId: string, raw: unknown): Promise<TakenPreviewResult> {
  const idea = await openIdeaFor(access, ideaId);
  const v = validateTaken(raw);
  if (!v.ok) throw new IdeaError('Fix these first', 422, v.errors);
  const preview = previewTaken({ direction: idea.direction, entryLow: idea.entryLow, entryHigh: idea.entryHigh, stop: idea.stop, targets: idea.targets.map(t => t.price) }, v.input);
  return { idea: { id: idea.id, symbol: idea.symbol, direction: idea.direction, entryLow: idea.entryLow, entryHigh: idea.entryHigh, stop: idea.stop }, ...v.input, preview };
}

export async function takeIdea(access: IdeaAccess, ideaId: string, raw: unknown): Promise<string> {
  await openIdeaFor(access, ideaId);
  const v = validateTaken(raw);
  if (!v.ok) throw new IdeaError('Fix these first', 422, v.errors);
  const rows = await sql(
    `INSERT INTO public.nt_idea_taken (user_id, idea_id, qty, entry_price, note) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, idea_id) DO NOTHING RETURNING id`,
    [access.userId, ideaId, v.input.qty, v.input.entryPrice, v.note],
  );
  if (!rows.length) throw new IdeaError('You have already recorded this idea. Edit or delete that record from My trades.', 409);
  return String(rows[0].id);
}

/** Close one of my trades at my own exit price. */
export async function closeTaken(userId: string, takenId: string, exitPrice: unknown, note?: unknown): Promise<void> {
  if (!/^\d{1,18}$/.test(takenId)) throw new IdeaError('Trade not found', 404);
  const px = typeof exitPrice === 'number' ? exitPrice : Number(exitPrice);
  if (!Number.isFinite(px) || px <= 0) throw new IdeaError('Enter the price you exited at.', 422);
  const n = typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null;
  const rows = await sql(
    `UPDATE public.nt_idea_taken SET exit_price = $3, closed_at = now(), note = COALESCE($4, note) WHERE id = $1 AND user_id = $2 AND closed_at IS NULL RETURNING id`,
    [takenId, userId, px, n],
  );
  if (!rows.length) throw new IdeaError('Open trade not found', 404);
}

export async function deleteTaken(userId: string, takenId: string): Promise<boolean> {
  if (!/^\d{1,18}$/.test(takenId)) return false;
  const rows = await sql(`DELETE FROM public.nt_idea_taken WHERE id = $1 AND user_id = $2 RETURNING id`, [takenId, userId]);
  return rows.length > 0;
}

/** Which of these ideas the viewer has recorded (for the "You took this" marker on the idea page). */
export async function takenForIdea(userId: string, ideaId: string): Promise<{ id: string; qty: number; entryPrice: number; closed: boolean } | null> {
  if (!/^\d{1,18}$/.test(ideaId)) return null;
  const rows = await sql(`SELECT id, qty::float8 AS qty, entry_price::float8 AS entry_price, closed_at FROM public.nt_idea_taken WHERE user_id = $1 AND idea_id = $2`, [userId, ideaId]);
  const r: any = rows[0];
  return r ? { id: String(r.id), qty: r.qty, entryPrice: r.entry_price, closed: !!r.closed_at } : null;
}

/**
 * My trades with their idea, marked to the latest price while open, plus followed vs not followed. Only ideas in
 * the viewer's current plan terms are shown (a plan that no longer includes a term hides those ideas' details but
 * the user's own record is theirs, so it is still listed with the idea's headline).
 */
export async function listTaken(access: IdeaAccess): Promise<{ trades: TakenView[]; comparison: Followed; notes: string[] }> {
  const rows = await sql(
    `SELECT t.id, t.idea_id, t.qty::float8 AS qty, t.entry_price::float8 AS entry_price, t.taken_at, t.note, t.exit_price::float8 AS exit_price, t.closed_at,
            i.symbol, i.direction, i.horizon, i.title, i.status, o.outcome, o.r_multiple::float8 AS r, o.pct_return::float8 AS pct
     FROM public.nt_idea_taken t JOIN public.nt_trade_ideas i ON i.id = t.idea_id LEFT JOIN public.nt_idea_outcomes o ON o.idea_id = i.id
     WHERE t.user_id = $1 ORDER BY (t.closed_at IS NULL) DESC, t.taken_at DESC LIMIT 300`,
    [access.userId],
  );
  const openSymbols = [...new Set((rows as any[]).filter(r => !r.closed_at).map(r => r.symbol as string))].slice(0, 100);
  let marks: Record<string, number> = {};
  if (openSymbols.length) {
    try {
      const snaps = await getSnapshotsMulti(openSymbols);
      for (const [sym, s] of Object.entries(snaps)) {
        const px = s.latestTrade?.p ?? s.dailyBar?.c ?? s.prevDailyBar?.c;
        if (typeof px === 'number' && px > 0) marks[sym.toUpperCase()] = px;
      }
    } catch { marks = {}; }
  }
  const trades: TakenView[] = (rows as any[]).map(r => {
    const open = !r.closed_at;
    const px = open ? marks[r.symbol] ?? null : r.exit_price;
    const res = px != null ? tradeResult(r.direction, { qty: r.qty, entryPrice: r.entry_price }, px) : null;
    return {
      id: String(r.id), ideaId: String(r.idea_id), symbol: r.symbol, direction: r.direction, horizon: r.horizon, title: r.title,
      ideaStatus: r.status, ideaOutcome: r.outcome ?? null, ideaR: num(r.r), ideaPct: num(r.pct), qty: r.qty, entryPrice: r.entry_price,
      takenAt: iso(r.taken_at) as string, note: r.note, exitPrice: num(r.exit_price), closedAt: iso(r.closed_at), mark: px,
      profit: res?.profit ?? null, pct: res?.pct ?? null, open,
    };
  });

  // Followed vs not followed: every finished, counted idea the viewer can read, flagged taken or not.
  const horizons = access.terms.flatMap(horizonsOfTerm);
  const base = horizons.length
    ? await sql(
        `SELECT i.id, o.pct_return::float8 AS pct, (t.id IS NOT NULL) AS taken, t.entry_price::float8 AS my_entry, t.qty::float8 AS qty, t.exit_price::float8 AS my_exit, i.direction
         FROM public.nt_trade_ideas i JOIN public.nt_idea_outcomes o ON o.idea_id = i.id
         LEFT JOIN public.nt_idea_taken t ON t.idea_id = i.id AND t.user_id = $1
         WHERE i.horizon = ANY($2) AND o.outcome = ANY($3)`,
        [access.userId, horizons, COUNTED_OUTCOMES],
      )
    : [];
  const compareRows: CompareRow[] = (base as any[]).map(r => ({
    ideaId: Number(r.id), taken: !!r.taken, ideaPct: num(r.pct),
    myPct: r.taken && r.my_exit != null ? tradeResult(r.direction, { qty: r.qty, entryPrice: r.my_entry }, r.my_exit).pct : null,
  }));
  const stillOpenForMe = trades.filter(t => t.open && t.ideaOutcome != null && COUNTED_OUTCOMES.includes(t.ideaOutcome)).length;
  const ideaNotFinished = trades.filter(t => t.open && !(t.ideaOutcome != null && COUNTED_OUTCOMES.includes(t.ideaOutcome))).length;
  const comparison = compareFollowed(compareRows, { stillOpenForMe, ideaNotFinished });
  const notes = [
    'Your numbers are your own: price and quantity you entered. Nothing is sent to a broker.',
    'The comparison uses only ideas that entered their zone and finished, and only trades you have closed. Your % is from your own entry and exit price, the desk\'s from its tracked result, so the two can differ for good reasons (your fill, your exit).',
  ];
  return { trades, comparison, notes };
}
