# Architecture overview (concise, current)

Authoritative detail lives in `CLAUDE.md` (stack, data, services, rules), `docs/CHANGES.md` (change log) and the per-area
docs (`docs/trade-ideas.md`, `docs/earnings.md`, `docs/us-scanner.md`, `docs/oi-tracker.md`, `docs/crypto.md`,
`docs/strategy-builder.md`). This file is the map and the standing rules; it does not repeat those docs.

## Components (high level)

- **Next.js 15 App Router on Vercel**, Neon Postgres via `lib/db.ts`, Railway curl crons for background jobs.
- **Market data** only through the server-only facade `lib/marketdata/index.ts` (vendors named only in `lib/marketdata/provider/*`).
  Quotes are session-aware: `lib/marketSession.ts` (`getMarketState`) + `lib/quote.ts` (`buildQuote`), client polling cadence
  from `lib/pollDelay.ts`.
- **Plan gating** is done in SQL (a gated row is absent from the result), routes answer 401/403/404 consistently.
- **Rate limits**: `lib/rateLimit.ts` + limiters declared in `lib/rateLimitConfig.ts` (admin-editable).
- **Pure modules** (dependency-free, explicit `.ts` import extensions) are fixture-tested by `scripts/test-*.mjs`.

## Trade Ideas Desk (see `docs/trade-ideas.md`)

```
 publish (immutable plan) --> nt_trade_ideas
 tracker (cron / manual)  --> scoreIdea() on COMPLETE daily bars (asOf = yesterday ET) --> nt_idea_outcomes (official)
 reader: GET /api/ideas/[id] (gated read, plan + official outcome)
 reader: GET /api/ideas/[id]/live  and  GET /api/ideas/live      (NEW: provisional live mark, never stored)
            gated read -> facade snapshot -> buildQuote/getMarketState -> lib/ideaLiveMath.ts (pure) -> JSON
```

### Live mark of an open idea (decision record, 2026-11-10)

- **What it is:** a provisional *price mark* of the idea's own published plan at the current price: where price is versus
  the entry zone, stop and targets, and (only once the idea has entered, per the official tracker) the R and % if marked at
  that price. It is computed on request, never persisted, never fed to `scoreIdea`, never counted in desk statistics, never
  sends alerts, and is independent of `nt_idea_taken`.
- **What it is not:** the official result. The official result stays "daily bars through yesterday, stop first". A live
  price crossing a level is shown as a state, not a decision. A "today's range touched ..." hint (from the snapshot's day
  high/low) warns when the official scorer will probably differ; it never changes R.
- **Computation:** `lib/ideaLiveMath.ts` (pure) reuses the scorer's conventions (entry = worst fill in the zone,
  risk = |entry - stop|, equal-split ladder). Targets already booked per the stored outcome are kept; targets the live price
  is at or beyond are counted as reached for the mark. No clamping at the stop (a gap would be worse than the stop, so
  clamping would flatter).
- **Why not re-run `scoreIdea` with a partial "today" bar** (rejected): it contradicts the "a partial bar never decides"
  rule, is empty on the publish day (rule 1), can flip later (stop-first on a half-formed bar) and fires `expired` early.
- **Why not client-only last candle** (rejected): no plan-relative numbers, no R, and would invite the client to hold plan
  logic that must stay gated.
- **Gating:** the live routes call the same gated SQL read as `getIdea`/`listIdeas` first; plan-relative numbers of a gated
  idea never leave the server. The board route takes no ids from the client.
- **Cost control:** idea page = one symbol, one snapshot call (5 s per-instance cache in the provider); board = one batched
  snapshot call for all open symbols; both behind a dedicated limiter `ideas_live`.

## Do's and Don'ts

Do
- Read through the facade on the server; send the client only neutral, vendor-free JSON.
- Keep plan-gating in SQL and call the gated read before touching any market data for an idea.
- Put maths in a pure `.ts` module with explicit `.ts` import extensions and fixtures in `scripts/`.
- Label provisional numbers as provisional, name their basis (live vs last close) and keep the risk disclaimer visible.
- Batch symbols for list views (one `getSnapshotsMulti`), never one request per card/row.
- Use `lib/pollDelay.ts` for any poller; pause when the tab is hidden; stop on 401/403/404; back off on 429.
- Degrade to "price unavailable" instead of inventing or reusing stale numbers silently.
- Record every change in `docs/CHANGES.md` (verified vs not verified).

Don't
- Don't import `@/lib/marketdata` (or provider code) from client components; don't name vendors in routes, responses, UI text.
- Don't write live marks to `nt_idea_outcomes`, statuses, events, alerts or desk stats; don't feed partial bars to `scoreIdea`.
- Don't accept idea ids or symbols from the client on a batch route; derive them from the gated SQL read.
- Don't show money P&L or per-user quantities in the idea's live mark (R and % only).
- Don't poll faster than `pollDelayMs` allows or in a hidden tab; don't add timers that outlive the component.
- Don't change the immutability of published plans or the official scoring rules as part of display work.
