/**
 * OCC option symbols (ROOT + YYMMDD + C/P + strike×1000, 8 digits). Pure, so client
 * components and server routes share it.
 */
import type { OptType } from '../types/oiTracker';

const OCC_RE = /^([A-Z][A-Z0-9.]{0,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export function parseOcc(contract: string): { root: string; expiry: string; optType: OptType; strike: number } | null {
  const m = OCC_RE.exec(contract);
  if (!m) return null;
  return { root: m[1], expiry: `20${m[2]}-${m[3]}-${m[4]}`, optType: m[5] === 'C' ? 'call' : 'put', strike: Number(m[6]) / 1000 };
}
