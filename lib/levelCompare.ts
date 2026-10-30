/**
 * Level comparison filters (Put/Call Int vs Put High / Call Low, Put High vs Call Int), shared by the quadrant page (client)
 * and route (server). Pure and dependency-free. A level of 0 means "no data" (see
 * CLAUDE.md), so a row with any needed level at 0 never matches.
 */

export type LevelCompare = '' | 'aboveBoth' | 'belowBoth' | 'belowPutHigh' | 'aboveCallLow' | 'putHighAboveCallInt';

export const LEVEL_COMPARE_OPTIONS: { value: LevelCompare; label: string }[] = [
  { value: '', label: 'Any' },
  { value: 'aboveBoth', label: 'Put/Call Int above Put High and Call Low' },
  { value: 'belowBoth', label: 'Put/Call Int below Put High and Call Low' },
  { value: 'belowPutHigh', label: 'Put/Call Int below Put High' },
  { value: 'aboveCallLow', label: 'Put/Call Int above Call Low' },
  { value: 'putHighAboveCallInt', label: 'Put High above Call Int' },
];

export function isLevelCompare(v: string | null): v is Exclude<LevelCompare, ''> {
  return LEVEL_COMPARE_OPTIONS.some(o => o.value && o.value === v);
}

export function levelCompareMatches(f: Exclude<LevelCompare, ''>, pci: number, putHigh: number, callLow: number, callInt: number): boolean {
  if (f === 'putHighAboveCallInt') return putHigh > 0 && callInt > 0 && putHigh > callInt;
  if (!(pci > 0)) return false;
  switch (f) {
    case 'aboveBoth': return putHigh > 0 && callLow > 0 && pci > putHigh && pci > callLow;
    case 'belowBoth': return putHigh > 0 && callLow > 0 && pci < putHigh && pci < callLow;
    case 'belowPutHigh': return putHigh > 0 && pci < putHigh;
    case 'aboveCallLow': return callLow > 0 && pci > callLow;
    default: return false;
  }
}

/**
 * Text colour for the Put High and Call Low values where they are shown: red when Put/Call Int is
 * above both, green when it is below both, none otherwise (or when a level has no data).
 */
export const ALT_LEVEL_RED = '#dc2626';
export const ALT_LEVEL_GREEN = '#16a34a';

export function altLevelColor(pci: number, putHigh: number, callLow: number): string | null {
  if (levelCompareMatches('aboveBoth', pci, putHigh, callLow, 0)) return ALT_LEVEL_RED;
  if (levelCompareMatches('belowBoth', pci, putHigh, callLow, 0)) return ALT_LEVEL_GREEN;
  return null;
}
