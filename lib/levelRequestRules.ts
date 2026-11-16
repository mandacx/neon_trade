// Pure rules for level-symbol requests (docs/level-symbols.md). Dependency-free so scripts/test-level-requests.mjs can import it.

/** strike_size given to a newly approved symbol unless the admin changes it (user decision 2026-11-16). */
export const DEFAULT_STRIKE_SIZE = 5;
/** Open (pending) requests one user may hold at a time. */
export const MAX_PENDING_PER_USER = 20;
export const MAX_NOTE_LENGTH = 300;
export const MAX_COMPANY_NAME_LENGTH = 120;

/**
 * A US ticker as the stock page accepts it: 1-6 letters, optional `.X` / `-X` class suffix (BRK.B).
 * Returns the upper-cased symbol, or null.
 */
export function normalizeLevelSymbol(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toUpperCase().replace(/\//g, '.');
  return /^[A-Z]{1,6}([.-][A-Z]{1,2})?$/.test(s) ? s : null;
}

/** Strike increment: a positive number up to 1000, at most 3 decimals. Empty / undefined = the default. */
export function parseStrikeSize(input: unknown): number | null {
  if (input === undefined || input === null || input === '') return DEFAULT_STRIKE_SIZE;
  const n = typeof input === 'number' ? input : Number(String(input).trim());
  if (!Number.isFinite(n) || n <= 0 || n > 1000) return null;
  return Math.round(n * 1000) / 1000;
}

export function cleanText(input: unknown, max: number): string | null {
  if (typeof input !== 'string') return null;
  const s = input.replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
}
