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
