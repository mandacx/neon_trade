// Shared Trade Ideas alert fixtures (used by scripts/test-idea-alerts.mjs and scripts/render-idea-alert-samples.mjs).
import assert from 'node:assert/strict';
import { toAlertIdea } from '../../lib/ideaAlertModel.ts';

export const TODAY = '2026-11-10';
export const LONG_ROW = { id: 42, symbol: 'AAPL', direction: 'long', horizon: 'swing', title: 'Breakout above 100', rationale: 'Base building for six weeks with rising volume into the breakout.', entry_low: 100, entry_high: 102, stop: 95, targets: [{ price: 110 }, { price: 120 }], valid_until: '2026-12-12', risk_rating: 'medium', option_strategy: { name: 'Bull call spread' } };
export const SHORT_ROW = { ...LONG_ROW, direction: 'short', title: 'Rejection at 102', entry_low: 100, entry_high: 102, stop: 107, targets: [{ price: 95 }, { price: 90 }], option_strategy: null };
export const LONG = toAlertIdea(LONG_ROW);
export const SHORT = toAlertIdea(SHORT_ROW);
assert.ok(LONG && SHORT);

export const D = '2026-11-09';
// [name, event_type, event_key, facts]
export const SPECS = (side) => {
  const shortSide = side === 'short';
  const px = shortSide ? { t1: 95, t2: 90, stop: 107, gap: 109.5 } : { t1: 110, t2: 120, stop: 95, gap: 93.4 };
  return [
    ['published', 'published', 'published', { v: 1 }],
    ['triggered', 'triggered', 'triggered', { v: 1, date: D, price: shortSide ? 100 : 102 }],
    ['target T1', 'target_hit', 'target:T1', { v: 1, target: 'T1', date: D, price: px.t1, targetsHit: 1, targetsTotal: 2 }],
    ['target T2', 'target_hit', 'target:T2', { v: 1, target: 'T2', date: D, price: px.t2, targetsHit: 2, targetsTotal: 2 }],
    ['all_targets', 'target_hit', 'all_targets', { v: 1, date: D, price: px.t2, targetsHit: 2, targetsTotal: 2, r: 1.8571 }],
    ['stopped', 'stopped', 'stopped', { v: 1, date: D, price: px.stop, targetsHit: 0, targetsTotal: 2, r: -1 }],
    ['stopped gap', 'stopped', 'stopped', { v: 1, date: D, price: px.gap, gapped: true, targetsHit: 1, targetsTotal: 2, r: -1.21 }],
    ['expired', 'expired', 'expired', { v: 1, date: D, price: 101, targetsHit: 1, targetsTotal: 2, r: 0.57 }],
    ['not_triggered', 'not_triggered', 'not_triggered', { v: 1, date: D }],
    ['note', 'note', 'update:5', { v: 1, note: 'Holding above the 20-day average; volume is picking up into the close.' }],
    ['stop_moved', 'stop_moved', 'update:6', { v: 1, newStop: shortSide ? 100 : 102, note: 'Moving to breakeven.' }],
    ['partial_booked', 'partial_booked', 'update:7', { v: 1, pct: 50, price: shortSide ? 95.4 : 110.4 }],
    ['closed', 'closed', 'update:8', { v: 1, note: 'Taking the risk off ahead of earnings.' }],
    ['cancelled', 'cancelled', 'update:9', { v: 1, note: 'Thesis changed.' }],
  ];
};
let eid = 100;
export const mk = (idea, type, key, facts, extra = {}) => ({ eventId: ++eid, ideaId: 42, eventType: type, eventKey: key, summary: 'Stopped: AAPL long, Breakout above 100.', idea, facts, today: TODAY, ...extra });
export const ALL = [];
for (const idea of [LONG, SHORT]) for (const [name, type, key, facts] of SPECS(idea.direction)) ALL.push({ name: `${name} ${idea.direction}`, kind: name.split(' ')[0], input: mk(idea, type, key, facts) });

