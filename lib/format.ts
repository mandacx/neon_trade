// Compact number formatting for the OI tracker (B / M / K). Dependency-free.

/** $1.23B, -$45.6M, $789K, $12 — compact dollars. */
export function fmtMoneyCompact(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(digits > 1 ? 1 : digits)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

/** 1.2M, 45.6K, 789 — compact counts. */
export function fmtCount(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

/** +1,234 / -567 with thousands separators. */
export function fmtSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString('en-US')}`;
}

/** "1.5m" -> 1500000, "2b" -> 2e9, "750k" -> 750000, "12.5" -> 12.5; null when not a number. */
export function parseHumanNumber(s: string): number | null {
  const m = /^\s*(-?[\d,]*\.?\d+)\s*([kmbt])?\s*$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'b' | 't'] ?? 1;
  return Number.isFinite(n) ? n * mult : null;
}
