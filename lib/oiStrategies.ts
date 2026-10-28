/**
 * Multi-leg strategy candidates from OI-change records (docs/oi-tracker.md).
 *
 * Idea: when a large trade puts on several legs at once, each leg's OI changes
 * by about the same number of contracts. So within one underlying and one load
 * date, legs whose |OI change| agree within `tolerancePct` are paired and the
 * pattern (same expiry? same strike? call/put?) names the likely structure.
 *
 * Limits, stated in every label: OI change says opened (+) or closed (-),
 * never bought or sold, so debit vs credit (long vs short) is unknown; and a
 * match can be coincidence between unrelated trades. Hence "possible".
 *
 * Dependency-free (no db/Next imports) so scripts/test-oi-strategies.mjs can
 * import it under Node's type stripping.
 */
import type { OptType, SideHint, StrategyCandidate, StrategyKind, StrategyLeg } from '../types/oiTracker';

export interface StrategyInputRow {
  contract: string;
  underlying: string;
  loadDate: string;
  tradeDate?: string;
  expiry: string;
  optType: OptType;
  strike: number;
  oiChg: number;
  ltp: number;
  close: number;
  vol?: number | null;
}

/** Relative difference of two quantities, % of the larger. */
export function qtyDiffPct(a: number, b: number): number {
  const x = Math.abs(a);
  const y = Math.abs(b);
  const m = Math.max(x, y);
  return m === 0 ? 0 : (Math.abs(x - y) / m) * 100;
}

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const toLeg = (r: StrategyInputRow): StrategyLeg => ({
  contract: r.contract, optType: r.optType, strike: r.strike, expiry: r.expiry, oiChg: r.oiChg, ltp: r.ltp,
  chgValue: r.oiChg * 100 * r.ltp, vol: r.vol ?? null,
});
const legValue = (r: StrategyInputRow) => Math.abs(r.oiChg * 100 * r.ltp);
const fmtStrike = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ''));

function statusOf(rows: StrategyInputRow[]): StrategyCandidate['status'] {
  const s = new Set(rows.map(r => sign(r.oiChg)));
  if (s.size > 1) return 'rolled';
  return s.has(1) ? 'opened' : 'closed';
}

function confidenceOf(diffPct: number, tolerancePct: number, rows: StrategyInputRow[]): number {
  const closeness = tolerancePct > 0 ? Math.max(0, 1 - diffPct / tolerancePct) : 1;
  const minQty = Math.min(...rows.map(r => Math.abs(r.oiChg)));
  // 500 contracts -> ~0.67, 5,000 -> ~0.92, 10,000+ -> 1
  const size = Math.min(1, Math.log10(Math.max(minQty, 1)) / 4);
  return Math.round((0.6 * closeness + 0.4 * size) * 100) / 100;
}

const AMBIGUOUS = 'OI change shows opened/closed, not bought/sold: long vs short (debit vs credit) is unknown, and matching sizes can be coincidence.';

function makeCandidate(
  kind: StrategyKind, label: string, rows: StrategyInputRow[], diffPct: number, tolerancePct: number, note = AMBIGUOUS,
): StrategyCandidate {
  const sorted = [...rows].sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike || a.optType.localeCompare(b.optType));
  return {
    id: `${rows[0].underlying}|${rows[0].loadDate}|${sorted.map(r => r.contract).join('+')}`,
    underlying: rows[0].underlying,
    loadDate: rows[0].loadDate,
    tradeDate: rows[0].tradeDate,
    close: rows[0].close,
    kind,
    label,
    status: statusOf(rows),
    legs: sorted.map(toLeg),
    qtyDiffPct: Math.round(diffPct * 100) / 100,
    totalValue: rows.reduce((s, r) => s + legValue(r), 0),
    confidence: confidenceOf(diffPct, tolerancePct, rows),
    note,
  };
}

/** Classify a matched pair (quantities already within tolerance). */
function classifyPair(a: StrategyInputRow, b: StrategyInputRow): { kind: StrategyKind; label: string; note?: string } | null {
  const sameSign = sign(a.oiChg) === sign(b.oiChg);
  const sameExpiry = a.expiry === b.expiry;
  const sameType = a.optType === b.optType;
  const sameStrike = a.strike === b.strike;
  const typeName = a.optType === 'call' ? 'call' : 'put';

  if (sameType && sameExpiry && !sameStrike) {
    if (sameSign) return { kind: 'vertical', label: `Possible ${typeName} vertical spread` };
    const opened = a.oiChg > 0 ? a : b;
    const closed = a.oiChg > 0 ? b : a;
    return { kind: 'strike_roll', label: `Possible ${typeName} strike roll ${opened.strike > closed.strike ? 'up' : 'down'} (${fmtStrike(closed.strike)} → ${fmtStrike(opened.strike)})`, note: `One strike closed and another opened in about the same size. ${AMBIGUOUS}` };
  }
  if (!sameType && sameExpiry) {
    if (!sameSign) return { kind: 'type_switch', label: 'Possible call ↔ put switch', note: `A call and a put on the same expiry moved by the same size in opposite directions. ${AMBIGUOUS}` };
    if (sameStrike) return { kind: 'straddle', label: 'Possible straddle (or synthetic stock)', note: `Call and put at one strike: a straddle if both legs were bought or both sold; a synthetic long/short stock if one was bought and one sold. ${AMBIGUOUS}` };
    const put = a.optType === 'put' ? a : b;
    const call = a.optType === 'call' ? a : b;
    return put.strike < call.strike
      ? { kind: 'strangle', label: 'Possible strangle / risk reversal / collar', note: `Out-of-the-money put below the call: a strangle if both bought or both sold, a risk reversal or collar if one bought and one sold. ${AMBIGUOUS}` }
      : { kind: 'strangle', label: 'Possible strangle (in-the-money, "guts")' };
  }
  if (sameType && !sameExpiry) {
    if (sameStrike) {
      if (sameSign) return { kind: 'calendar', label: `Possible ${typeName} calendar spread` };
      const opened = a.oiChg > 0 ? a : b;
      const closed = a.oiChg > 0 ? b : a;
      return { kind: 'expiry_roll', label: `Possible ${typeName} roll ${opened.expiry > closed.expiry ? 'out' : 'in'} (${closed.expiry} → ${opened.expiry})`, note: `Same strike closed in one expiry and opened in another. ${AMBIGUOUS}` };
    }
    if (sameSign) return { kind: 'diagonal', label: `Possible ${typeName} diagonal spread` };
    const opened = a.oiChg > 0 ? a : b;
    const closed = a.oiChg > 0 ? b : a;
    return { kind: 'expiry_roll', label: `Possible ${typeName} diagonal roll (${closed.expiry} ${fmtStrike(closed.strike)} → ${opened.expiry} ${fmtStrike(opened.strike)})`, note: `Closed one contract and opened another expiry and strike in about the same size. ${AMBIGUOUS}` };
  }
  return null; // call + put on different expiries: too loose to name
}

/**
 * Detect candidates. `tolerancePct` (default 3) is the max relative gap between
 * quantities that should match; `minLeg` (default 500) drops small legs. Each
 * contract appears in at most one candidate, chosen in order: iron condors /
 * butterflies, butterflies, pairs, ratio spreads; within a pass, closest
 * quantities first.
 */
export function detectStrategies(rows: StrategyInputRow[], tolerancePct = 3, minLeg = 500, maxLegsPerGroup = 160): StrategyCandidate[] {
  const groups = new Map<string, StrategyInputRow[]>();
  for (const r of rows) {
    if (Math.abs(r.oiChg) < minLeg) continue;
    const k = `${r.underlying}|${r.loadDate}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }

  const out: StrategyCandidate[] = [];
  for (const groupRows of groups.values()) {
    const legs = [...groupRows].sort((a, b) => Math.abs(b.oiChg) - Math.abs(a.oiChg)).slice(0, maxLegsPerGroup);
    const used = new Set<string>();
    const free = (...rs: StrategyInputRow[]) => rs.every(r => !used.has(r.contract));
    const take = (...rs: StrategyInputRow[]) => rs.forEach(r => used.add(r.contract));

    // Same-type, same-expiry, same-sign pairs within tolerance = vertical building blocks.
    const verticals: Array<{ lo: StrategyInputRow; hi: StrategyInputRow; diff: number }> = [];
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        const a = legs[i], b = legs[j];
        if (a.optType !== b.optType || a.expiry !== b.expiry || a.strike === b.strike || sign(a.oiChg) !== sign(b.oiChg)) continue;
        const diff = qtyDiffPct(a.oiChg, b.oiChg);
        if (diff <= tolerancePct) verticals.push({ lo: a.strike < b.strike ? a : b, hi: a.strike < b.strike ? b : a, diff });
      }
    }

    // 1. Iron condor / iron butterfly: a put vertical below a call vertical, same expiry, sign and size.
    const condors: Array<{ rows: StrategyInputRow[]; diff: number; fly: boolean }> = [];
    for (const p of verticals) {
      if (p.lo.optType !== 'put') continue;
      for (const c of verticals) {
        if (c.lo.optType !== 'call' || c.lo.expiry !== p.lo.expiry || sign(c.lo.oiChg) !== sign(p.lo.oiChg)) continue;
        if (p.hi.strike > c.lo.strike) continue;
        const four = [p.lo, p.hi, c.lo, c.hi];
        const qs = four.map(r => Math.abs(r.oiChg));
        const diff = qtyDiffPct(Math.max(...qs), Math.min(...qs));
        if (diff <= tolerancePct) condors.push({ rows: four, diff, fly: p.hi.strike === c.lo.strike });
      }
    }
    condors.sort((x, y) => x.diff - y.diff);
    for (const c of condors) {
      if (!free(...c.rows)) continue;
      take(...c.rows);
      const [pl, ph, cl, ch] = c.rows;
      out.push(makeCandidate(
        c.fly ? 'iron_butterfly' : 'iron_condor',
        `Possible ${c.fly ? 'iron butterfly' : 'iron condor'} ${fmtStrike(pl.strike)}/${fmtStrike(ph.strike)}P – ${fmtStrike(cl.strike)}/${fmtStrike(ch.strike)}C`,
        c.rows, c.diff, tolerancePct,
        `Put spread below a call spread, same expiry and size. Short (credit) if the inner strikes were sold, long if bought. ${AMBIGUOUS}`,
      ));
    }

    // 2. Butterfly: wings K1 < K2 < K3 of one type/expiry, body ≈ 2 x wing.
    const flies: Array<{ rows: StrategyInputRow[]; diff: number; broken: boolean }> = [];
    for (const v of verticals) {
      for (const body of legs) {
        if (body.optType !== v.lo.optType || body.expiry !== v.lo.expiry || sign(body.oiChg) !== sign(v.lo.oiChg)) continue;
        if (!(body.strike > v.lo.strike && body.strike < v.hi.strike)) continue;
        const wing = (Math.abs(v.lo.oiChg) + Math.abs(v.hi.oiChg)) / 2;
        const diff = Math.max(v.diff, qtyDiffPct(Math.abs(body.oiChg), 2 * wing));
        if (diff <= tolerancePct) {
          const broken = Math.abs((body.strike - v.lo.strike) - (v.hi.strike - body.strike)) > 1e-9;
          flies.push({ rows: [v.lo, body, v.hi], diff, broken });
        }
      }
    }
    flies.sort((x, y) => x.diff - y.diff);
    for (const f of flies) {
      if (!free(...f.rows)) continue;
      take(...f.rows);
      const [lo, mid, hi] = f.rows;
      out.push(makeCandidate(
        'butterfly',
        `Possible ${f.broken ? 'broken-wing ' : ''}${lo.optType} butterfly ${fmtStrike(lo.strike)}/${fmtStrike(mid.strike)}/${fmtStrike(hi.strike)} (1:2:1)`,
        f.rows, f.diff, tolerancePct,
      ));
    }

    // 3. Pairs.
    const pairs: Array<{ a: StrategyInputRow; b: StrategyInputRow; diff: number }> = [];
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        const diff = qtyDiffPct(legs[i].oiChg, legs[j].oiChg);
        if (diff <= tolerancePct) pairs.push({ a: legs[i], b: legs[j], diff });
      }
    }
    // Same expiry first (tighter structures), then closest quantities, then size.
    pairs.sort((x, y) =>
      Number(x.a.expiry !== x.b.expiry) - Number(y.a.expiry !== y.b.expiry)
      || x.diff - y.diff
      || Math.abs(y.a.oiChg) - Math.abs(x.a.oiChg));
    for (const p of pairs) {
      if (!free(p.a, p.b)) continue;
      const cls = classifyPair(p.a, p.b);
      if (!cls) continue;
      take(p.a, p.b);
      out.push(makeCandidate(cls.kind, cls.label, [p.a, p.b], p.diff, tolerancePct, cls.note ?? AMBIGUOUS));
    }

    // 4. Ratio spreads (1x2): same type/expiry, one leg ≈ 2x the other.
    const ratios: Array<{ a: StrategyInputRow; b: StrategyInputRow; diff: number }> = [];
    for (let i = 0; i < legs.length; i++) {
      for (let j = 0; j < legs.length; j++) {
        const big = legs[i], small = legs[j];
        if (i === j || big.optType !== small.optType || big.expiry !== small.expiry || big.strike === small.strike) continue;
        if (sign(big.oiChg) !== sign(small.oiChg)) continue;
        const diff = qtyDiffPct(Math.abs(big.oiChg), 2 * Math.abs(small.oiChg));
        if (diff <= tolerancePct) ratios.push({ a: small, b: big, diff });
      }
    }
    ratios.sort((x, y) => x.diff - y.diff);
    for (const r of ratios) {
      if (!free(r.a, r.b)) continue;
      take(r.a, r.b);
      out.push(makeCandidate(
        'ratio',
        `Possible ${r.a.optType} 1x2 ratio spread ${fmtStrike(r.a.strike)}/${fmtStrike(r.b.strike)}`,
        [r.a, r.b], r.diff, tolerancePct,
      ));
    }
  }

  return out.sort((a, b) => b.confidence - a.confidence || b.totalValue - a.totalValue);
}

/**
 * Side hint for a contract from the session that produced its OI change
 * (open -> close of that session's option bar). Only a hint: the user always
 * picks BTO/STO.
 */
export function suggestSide(oiChg: number, sessOpen: number | null, sessClose: number | null): SideHint | null {
  if (oiChg < 0) return { side: null, reason: 'OI fell: existing positions were closed, not opened.' };
  if (sessOpen == null || sessClose == null || sessOpen <= 0) return null;
  const movePct = ((sessClose - sessOpen) / sessOpen) * 100;
  if (movePct >= 3) return { side: 'BTO', reason: `OI rose while the premium rose ${movePct.toFixed(0)}% in that session: buyers were likely paying up (buy to open).` };
  if (movePct <= -3) return { side: 'STO', reason: `OI rose while the premium fell ${Math.abs(movePct).toFixed(0)}% in that session: sellers were likely writing (sell to open).` };
  return { side: null, reason: `OI rose with the premium roughly flat (${movePct >= 0 ? '+' : ''}${movePct.toFixed(1)}%): no clear side.` };
}

/** Weekly / monthly (3rd Friday) / quarterly (3rd Friday of Mar/Jun/Sep/Dec); same rule as the stock page. */
export function expiryKind(dateStr: string): 'weekly' | 'monthly' | 'quarterly' {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  if (d.getUTCDay() !== 5 || day < 15 || day > 21) return 'weekly';
  return d.getUTCMonth() % 3 === 2 ? 'quarterly' : 'monthly';
}
