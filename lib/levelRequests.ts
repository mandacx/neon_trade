import { sql } from '@/lib/db';
import { DEFAULT_STRIKE_SIZE, MAX_PENDING_PER_USER } from '@/lib/levelRequestRules';

// Level-symbol requests and the admin list over public.us_symbols (docs/level-symbols.md).
// us_symbols is read by the external loader: the app only upserts / soft-deletes rows (active, deleted_at, updated_at).
// Rows are never DELETEd.

export interface LevelRequest {
  id: number;
  symbol: string;
  requestedBy: string;
  requesterEmail: string | null;
  requestedAt: string;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface TrackedSymbol {
  symbol: string;
  companyName: string | null;
  strikeSize: number | null;
  active: boolean;
  deletedAt: string | null;
  updatedAt: string;
}

const mapRequest = (r: any): LevelRequest => ({
  id: Number(r.id), symbol: r.symbol, requestedBy: r.requested_by, requesterEmail: r.requester_email ?? null,
  requestedAt: r.requested_at, note: r.note, status: r.status, decidedAt: r.decided_at, decisionNote: r.decision_note,
});

export type RequestOutcome =
  | { ok: true; id: number }
  | { ok: false; code: 'tracked' | 'pending' | 'too_many'; message: string };

/** A signed-in user asks for a symbol. Refuses symbols already tracked (active) and symbols with an open request. */
export async function createRequest(userId: string, symbol: string, note: string | null): Promise<RequestOutcome> {
  const [tracked, mine] = await Promise.all([
    sql`SELECT 1 FROM public.us_symbols WHERE symbol = ${symbol} AND active = true`,
    sql`SELECT count(*)::int AS n FROM public.nt_level_requests WHERE requested_by = ${userId} AND status = 'pending'`,
  ]);
  if (tracked.length) return { ok: false, code: 'tracked', message: `${symbol} is already on the levels list. Its levels appear after the next data load.` };
  if (Number((mine[0] as { n: number }).n) >= MAX_PENDING_PER_USER) {
    return { ok: false, code: 'too_many', message: 'You have too many open requests. Wait for some to be reviewed.' };
  }
  // The partial unique index (one pending per symbol) makes this race-safe.
  const rows = await sql`
    INSERT INTO public.nt_level_requests (symbol, requested_by, note)
    VALUES (${symbol}, ${userId}, ${note})
    ON CONFLICT (symbol) WHERE status = 'pending' DO NOTHING
    RETURNING id
  `;
  if (!rows.length) return { ok: false, code: 'pending', message: `${symbol} has already been requested and is waiting for review.` };
  return { ok: true, id: Number((rows[0] as { id: string }).id) };
}

export async function listUserRequests(userId: string, limit = 50): Promise<LevelRequest[]> {
  const rows = await sql`
    SELECT id, symbol, requested_by, requested_at::text, note, status, decided_at::text, decision_note
    FROM public.nt_level_requests WHERE requested_by = ${userId}
    ORDER BY requested_at DESC LIMIT ${limit}
  `;
  return rows.map(mapRequest);
}

export async function listRequests(status: 'pending' | 'decided', limit = 200): Promise<LevelRequest[]> {
  const rows = status === 'pending'
    ? await sql`
        SELECT r.id, r.symbol, r.requested_by, u.email AS requester_email, r.requested_at::text, r.note, r.status, r.decided_at::text, r.decision_note
        FROM public.nt_level_requests r LEFT JOIN neon_auth."user" u ON u.id::text = r.requested_by
        WHERE r.status = 'pending' ORDER BY r.requested_at LIMIT ${limit}`
    : await sql`
        SELECT r.id, r.symbol, r.requested_by, u.email AS requester_email, r.requested_at::text, r.note, r.status, r.decided_at::text, r.decision_note
        FROM public.nt_level_requests r LEFT JOIN neon_auth."user" u ON u.id::text = r.requested_by
        WHERE r.status <> 'pending' ORDER BY r.decided_at DESC NULLS LAST LIMIT ${limit}`;
  return rows.map(mapRequest);
}

/** Badge on the admin nav. */
export async function countPendingRequests(): Promise<number> {
  try {
    const rows = await sql`SELECT count(*)::int AS n FROM public.nt_level_requests WHERE status = 'pending'`;
    return Number((rows[0] as { n: number }).n);
  } catch { return 0; } // table not created yet: no badge rather than a broken admin layout
}

/** Insert the symbol, or reactivate a soft-deleted one (the loader reads active = true). */
async function upsertActive(symbol: string, companyName: string | null, strikeSize: number): Promise<void> {
  await sql`
    INSERT INTO public.us_symbols (symbol, company_name, strike_size, active, deleted_at, updated_at)
    VALUES (${symbol}, ${companyName}, ${strikeSize}, true, NULL, now())
    ON CONFLICT (symbol) DO UPDATE SET
      active = true, deleted_at = NULL, updated_at = now(),
      strike_size = EXCLUDED.strike_size,
      company_name = COALESCE(EXCLUDED.company_name, public.us_symbols.company_name)
  `;
}

/** Approve a pending request: symbol goes into us_symbols (default strike size 5), request is closed. Returns false if it was not pending. */
export async function approveRequest(id: number, adminId: string, opts: { strikeSize?: number; companyName?: string | null; note?: string | null }): Promise<{ symbol: string } | null> {
  const claimed = await sql`
    UPDATE public.nt_level_requests SET status = 'approved', decided_by = ${adminId}, decided_at = now(), decision_note = ${opts.note ?? null}
    WHERE id = ${id} AND status = 'pending' RETURNING symbol
  `;
  if (!claimed.length) return null;
  const symbol = (claimed[0] as { symbol: string }).symbol;
  try {
    await upsertActive(symbol, opts.companyName ?? null, opts.strikeSize ?? DEFAULT_STRIKE_SIZE);
  } catch (err) {
    // Put the request back so the admin can retry; never leave it approved without the symbol written.
    await sql`UPDATE public.nt_level_requests SET status = 'pending', decided_by = NULL, decided_at = NULL, decision_note = NULL WHERE id = ${id}`;
    throw err;
  }
  return { symbol };
}

export async function rejectRequest(id: number, adminId: string, note: string | null): Promise<boolean> {
  const rows = await sql`
    UPDATE public.nt_level_requests SET status = 'rejected', decided_by = ${adminId}, decided_at = now(), decision_note = ${note}
    WHERE id = ${id} AND status = 'pending' RETURNING id
  `;
  return rows.length > 0;
}

/** Admin adds a symbol directly. Any open request for it is closed as approved. */
export async function addSymbolDirect(symbol: string, adminId: string, companyName: string | null, strikeSize: number): Promise<void> {
  await upsertActive(symbol, companyName, strikeSize);
  await sql`
    UPDATE public.nt_level_requests SET status = 'approved', decided_by = ${adminId}, decided_at = now(), decision_note = 'added by admin'
    WHERE symbol = ${symbol} AND status = 'pending'
  `;
}

export async function listTracked(opts: { search?: string | null; includeRemoved?: boolean; limit?: number; offset?: number }): Promise<{ rows: TrackedSymbol[]; total: number; active: number }> {
  const { search = null, includeRemoved = false, limit = 100, offset = 0 } = opts;
  const pattern = search ? `%${search}%` : null;
  const [rows, counts] = await Promise.all([
    sql`
      SELECT symbol, company_name, strike_size, active, deleted_at::text, updated_at::text
      FROM public.us_symbols
      WHERE (${includeRemoved} OR active = true)
        AND (${pattern}::text IS NULL OR symbol ILIKE ${pattern} OR company_name ILIKE ${pattern})
      ORDER BY symbol LIMIT ${limit} OFFSET ${offset}`,
    sql`
      SELECT count(*) FILTER (WHERE (${includeRemoved} OR active = true) AND (${pattern}::text IS NULL OR symbol ILIKE ${pattern} OR company_name ILIKE ${pattern}))::int AS total,
             count(*) FILTER (WHERE active = true)::int AS active
      FROM public.us_symbols`,
  ]);
  const c = counts[0] as { total: number; active: number };
  return {
    rows: rows.map((r: any) => ({
      symbol: r.symbol, companyName: r.company_name, strikeSize: r.strike_size == null ? null : Number(r.strike_size),
      active: r.active, deletedAt: r.deleted_at, updatedAt: r.updated_at,
    })),
    total: Number(c.total), active: Number(c.active),
  };
}

/** Soft delete: the loader stops computing levels; old levels stay in the levels tables. */
export async function removeSymbol(symbol: string): Promise<boolean> {
  const rows = await sql`
    UPDATE public.us_symbols SET active = false, deleted_at = now(), updated_at = now()
    WHERE symbol = ${symbol} AND active = true RETURNING symbol`;
  return rows.length > 0;
}

export async function restoreSymbol(symbol: string): Promise<boolean> {
  const rows = await sql`
    UPDATE public.us_symbols SET active = true, deleted_at = NULL, updated_at = now()
    WHERE symbol = ${symbol} AND active = false RETURNING symbol`;
  return rows.length > 0;
}

export async function updateStrikeSize(symbol: string, strikeSize: number): Promise<boolean> {
  const rows = await sql`UPDATE public.us_symbols SET strike_size = ${strikeSize}, updated_at = now() WHERE symbol = ${symbol} RETURNING symbol`;
  return rows.length > 0;
}
