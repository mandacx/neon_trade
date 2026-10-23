// Dry run of the US Market Scanner's data path: for 10 symbols, compare the history the engine loads
// (nt_daily_bars, lib/scanner/run.ts loadHistory) with consolidated daily bars fetched independently
// straight from the feed's HTTP API, and compute the same indicators from both. Read-only.
//
//   node --env-file=.env.local railway/node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/scanner-dry-run.mts [SYM,SYM,...]
//
// (tsx resolves the @/ paths; it is installed under railway/.)

import { loadHistory } from '@/lib/scanner/run';
import { streak, volumeRatio, sma, roc, atrPct } from '@/lib/scanner/indicators';
import { todayET } from '@/lib/earnings';

const SYMBOLS = (process.argv[2] ?? 'AAPL,MSFT,NVDA,BRK.B,JPM,XOM,TSM,SPY,QQQ,SOXL').split(',').map(s => s.trim().toUpperCase());
const today = todayET();

// Independent fetch: raw HTTP, consolidated feed, end capped 16 min ago (same plan rule, own code).
async function independent(symbols: string[]): Promise<Record<string, Array<{ date: string; o: number; h: number; l: number; c: number; v: number }>>> {
  const start = new Date(Date.parse(`${today}T12:00:00Z`) - 400 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(Date.parse(`${today}T04:00:00Z`)).toISOString(); // before today's session (ET midnight, EDT)
  const out: Record<string, any[]> = {};
  let token: string | null = null;
  do {
    const q = new URLSearchParams({ symbols: symbols.join(','), timeframe: '1Day', adjustment: 'split', feed: 'sip', limit: '10000', start, end });
    if (token) q.set('page_token', token);
    const res = await fetch(`${process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets'}/v2/stocks/bars?${q}`, {
      headers: { 'APCA-API-KEY-ID': process.env.ALPACA_API_KEY ?? '', 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY ?? '' },
    });
    if (!res.ok) throw new Error(`independent fetch HTTP ${res.status}: ${await res.text()}`);
    const body = await res.json() as { bars: Record<string, any[]>; next_page_token: string | null };
    for (const [s, list] of Object.entries(body.bars ?? {})) {
      (out[s] ??= []).push(...list.map(b => ({
        date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(b.t)),
        o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
      })));
    }
    token = body.next_page_token;
  } while (token);
  return out;
}

const [hist, indep] = await Promise.all([loadHistory(SYMBOLS, today), independent(SYMBOLS)]);
const round = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
let problems = 0;
const rows: Record<string, unknown>[] = [];
for (const sym of SYMBOLS) {
  const e = hist.series.get(sym);
  const i = (indep[sym] ?? []).filter(b => b.date < today).slice(-260);
  if (!e) { rows.push({ sym, error: 'no stored history' }); problems++; continue; }
  // Bar-by-bar over the engine's last 60 bars.
  const iByDate = new Map(i.map(b => [b.date, b]));
  let mismatched = 0, missing = 0;
  for (const b of e.bars) {
    const x = iByDate.get(b.date);
    if (!x) { missing++; continue; }
    if (Math.abs(x.c - b.c) > 0.005 || Math.abs(x.v - b.v) > 0.5 || Math.abs(x.h - b.h) > 0.005 || Math.abs(x.l - b.l) > 0.005) mismatched++;
  }
  const ib = i.slice(-60);
  const ic = i.map(b => b.c);
  const engine = { streak: streak(e.bars, 1).len - streak(e.bars, -1).len, vol5: round(volumeRatio(e.bars, 5)), sma200: round(sma(e.closes, 200)), roc63: round(roc(e.closes, 63)), atr: round(atrPct(e.bars, 14)) };
  const fresh = { streak: streak(ib, 1).len - streak(ib, -1).len, vol5: round(volumeRatio(ib, 5)), sma200: round(sma(ic, 200)), roc63: round(roc(ic, 63)), atr: round(atrPct(ib, 14)) };
  const same = JSON.stringify(engine) === JSON.stringify(fresh) && mismatched === 0 && missing === 0 && e.closes.length === ic.length;
  if (!same) problems++;
  rows.push({ sym, bars: `${e.closes.length}/${ic.length}`, last: e.bars[e.bars.length - 1]?.date, mismatched, missing, ...Object.fromEntries(Object.entries(engine).map(([k, v]) => [k, v === (fresh as any)[k] ? v : `${v} ≠ ${(fresh as any)[k]}`])), ok: same });
}
console.table(rows);
console.log(problems === 0 ? `dry run OK: ${SYMBOLS.length} symbols identical (bars and indicators)` : `dry run: ${problems} symbol(s) differ`);
process.exit(problems === 0 ? 0 : 1);
