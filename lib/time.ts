/**
 * Central Time (America/Chicago: CST in winter, CDT in summer, DST-aware)
 * helpers. Safe to import from both server and client code. Use these for every
 * REAL instant shown in reports (created / last-seen / expiry times) and for
 * report "day" boundaries; never for trade dates ('YYYY-MM-DD' strings) or
 * exchange-time chart axes.
 */
export const CT_TZ = 'America/Chicago';

/** Parse a JS Date, ISO string, or a Postgres `::text` timestamp ("2026-10-09 19:51:17.9+00"). */
export function toDate(v: string | Date | null | undefined): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  let s = v.trim().replace(' ', 'T');
  // Postgres prints offsets as "+00" / "+05:30"; ISO parsers (Safari) need "+HH:MM".
  s = s.replace(/([+-]\d{2})$/, '$1:00');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: CT_TZ, month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
});
const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: CT_TZ, month: 'short', day: 'numeric', year: 'numeric' });
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: CT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: CT_TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});

/** "Oct 9, 2026, 3:21 PM CDT" */
export function formatCT(v: string | Date | null | undefined): string {
  const d = toDate(v);
  return d ? dateTimeFmt.format(d) : '—';
}

/** "Oct 9, 2026" (the Central calendar date of the instant) */
export function formatCTDate(v: string | Date | null | undefined): string {
  const d = toDate(v);
  return d ? dateFmt.format(d) : '—';
}

/** The Central calendar date of an instant, as 'YYYY-MM-DD'. */
export function ctDateString(v: Date | string = new Date()): string {
  const d = toDate(v) ?? new Date();
  return ymdFmt.format(d);
}

/** 'YYYY-MM-DD' (a calendar day) shifted by n days. */
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Offset of Central Time from UTC at an instant, in ms (negative; -5h in CDT, -6h in CST). */
function ctOffsetMs(instantMs: number): number {
  const p: Record<string, number> = {};
  for (const part of partsFmt.formatToParts(new Date(instantMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The instant (UTC ISO string) at which the given Central calendar day starts (DST-aware). */
export function ctDayStartISO(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, 0, 0);
  let guess = wall - ctOffsetMs(wall);
  guess = wall - ctOffsetMs(guess); // re-evaluate at the candidate in case the offset changed
  return new Date(guess).toISOString();
}

/** Start of the current Central day as a UTC ISO string — what "today" means in reports. */
export function ctTodayStartISO(): string {
  return ctDayStartISO(ctDateString());
}

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
