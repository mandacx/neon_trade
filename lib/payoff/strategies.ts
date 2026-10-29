/**
 * Predefined strategy templates for the Strategy Builder (docs/strategy-builder.md).
 * Leg recipes are the options-alert-lab universe (backend/app/engine/strategies.py).
 *
 * Strike rules: `atm` = listed strike nearest spot; `steps` shifts by that many
 * *listed strikes* (+ = higher); `level` anchors on one of this app's price levels
 * for the selected expiry (Call High / Put Low), falling back to spot ±10%, and moving toward the
 * money when the anchored option has no premium (chain.ts `minAnchorPremium`).
 * qty is signed (+ long, - short); stock qty is in lots of 100 shares. `far` legs
 * use the next listed expiry after the selected one.
 */
import type { Right } from './bs.ts';

export type View = 'bullish' | 'bearish' | 'neutral' | 'volatile';
export type Risk = 'debit' | 'credit' | 'undefined' | 'stock';
export type Group =
  | 'Basic' | 'Debit spreads' | 'Credit spreads' | 'Naked' | 'Income / covered'
  | 'Straddles / strangles' | 'Butterflies' | 'Condors' | 'Ratio / backspreads'
  | 'Synthetic' | 'Calendar / diagonal' | 'Lizards';

export type LevelAnchor = 'call_high' | 'put_low';

export interface StrikeRule { anchor: 'atm' | LevelAnchor; steps: number }

export interface TemplateLeg {
  kind: 'option' | 'stock';
  right?: Right;
  qty: number;
  strike?: StrikeRule;
  far?: boolean;
}

export interface StrategyTemplate {
  id: string;
  name: string;
  view: View;
  risk: Risk;
  group: Group;
  description: string;
  legs: TemplateLeg[];
}

const o = (right: Right, qty: number, steps = 0, anchor: StrikeRule['anchor'] = 'atm', far = false): TemplateLeg =>
  ({ kind: 'option', right, qty, strike: { anchor, steps }, far });
const stock = (qty = 1): TemplateLeg => ({ kind: 'stock', qty });

export const VIEWS: Array<{ id: View; label: string; hint: string }> = [
  { id: 'bullish', label: 'Bullish', hint: 'You expect the stock to rise.' },
  { id: 'bearish', label: 'Bearish', hint: 'You expect the stock to fall.' },
  { id: 'neutral', label: 'Neutral', hint: 'You expect the stock to stay in a range.' },
  { id: 'volatile', label: 'Volatile', hint: 'You expect a big move, direction unknown.' },
];

export const GROUP_ORDER: Group[] = [
  'Basic', 'Debit spreads', 'Credit spreads', 'Naked', 'Income / covered', 'Straddles / strangles',
  'Butterflies', 'Condors', 'Ratio / backspreads', 'Synthetic', 'Calendar / diagonal', 'Lizards',
];

export const RISK_LABEL: Record<Risk, string> = {
  debit: 'Debit, defined risk', credit: 'Credit, defined risk', undefined: 'Undefined risk', stock: 'Uses stock',
};

export const STRATEGIES: StrategyTemplate[] = [
  // Bullish
  { id: 'long_call', name: 'Long Call', view: 'bullish', risk: 'debit', group: 'Basic',
    description: 'Buy a call. Unlimited upside; the most you can lose is the premium paid.', legs: [o('C', 1)] },
  { id: 'bull_call_spread', name: 'Bull Call Spread', view: 'bullish', risk: 'debit', group: 'Debit spreads',
    description: 'Buy a call, sell a higher call. Cheaper than a long call; profit and loss both capped.', legs: [o('C', 1), o('C', -1, 1)] },
  { id: 'bull_put_spread', name: 'Bull Put Spread', view: 'bullish', risk: 'credit', group: 'Credit spreads',
    description: 'Sell a put, buy a lower put. Keep the credit if the stock stays above the short put.', legs: [o('P', -1), o('P', 1, -1)] },
  { id: 'covered_call', name: 'Covered Call', view: 'bullish', risk: 'stock', group: 'Income / covered',
    description: 'Own 100 shares and sell a call for income. Upside is capped at the call strike.', legs: [stock(), o('C', -1, 1)] },
  { id: 'married_put', name: 'Married Put', view: 'bullish', risk: 'stock', group: 'Income / covered',
    description: 'Own 100 shares and buy a put as insurance. Loss is limited below the put strike.', legs: [stock(), o('P', 1)] },
  { id: 'cash_secured_put', name: 'Cash-Secured Put', view: 'bullish', risk: 'undefined', group: 'Naked',
    description: 'Sell a put, backed by cash to buy the shares if assigned. Collect premium or buy lower.', legs: [o('P', -1)] },
  { id: 'put_ratio_spread', name: 'Put Ratio Spread', view: 'bullish', risk: 'undefined', group: 'Ratio / backspreads',
    description: 'Buy one put, sell two lower puts. Low cost or credit; losses grow if the stock falls far.', legs: [o('P', 1), o('P', -2, -1)] },
  { id: 'call_broken_wing', name: 'Call Broken Wing Butterfly', view: 'bullish', risk: 'debit', group: 'Butterflies',
    description: 'Call butterfly with a wider upper wing. Best if the stock rises to the short strike.', legs: [o('C', 1), o('C', -2, 1), o('C', 1, 3)] },
  { id: 'long_synthetic', name: 'Long Synthetic Future', view: 'bullish', risk: 'undefined', group: 'Synthetic',
    description: 'Buy a call and sell a put at the same strike. Behaves like owning 100 shares.', legs: [o('C', 1), o('P', -1)] },

  // Bearish
  { id: 'long_put', name: 'Long Put', view: 'bearish', risk: 'debit', group: 'Basic',
    description: 'Buy a put. Profits as the stock falls; the most you can lose is the premium paid.', legs: [o('P', 1)] },
  { id: 'bear_put_spread', name: 'Bear Put Spread', view: 'bearish', risk: 'debit', group: 'Debit spreads',
    description: 'Buy a put, sell a lower put. Cheaper than a long put; profit and loss both capped.', legs: [o('P', 1), o('P', -1, -1)] },
  { id: 'bear_call_spread', name: 'Bear Call Spread', view: 'bearish', risk: 'credit', group: 'Credit spreads',
    description: 'Sell a call, buy a higher call. Keep the credit if the stock stays below the short call.', legs: [o('C', -1), o('C', 1, 1)] },
  { id: 'call_ratio_spread', name: 'Call Ratio Spread', view: 'bearish', risk: 'undefined', group: 'Ratio / backspreads',
    description: 'Buy one call, sell two higher calls. Low cost or credit; losses grow if the stock rallies hard.', legs: [o('C', 1), o('C', -2, 1)] },
  { id: 'put_broken_wing', name: 'Put Broken Wing Butterfly', view: 'bearish', risk: 'debit', group: 'Butterflies',
    description: 'Put butterfly with a wider lower wing. Best if the stock falls to the short strike.', legs: [o('P', 1), o('P', -2, -1), o('P', 1, -3)] },
  { id: 'short_synthetic', name: 'Short Synthetic Future', view: 'bearish', risk: 'undefined', group: 'Synthetic',
    description: 'Sell a call and buy a put at the same strike. Behaves like shorting 100 shares.', legs: [o('C', -1), o('P', 1)] },

  // Neutral
  { id: 'collar', name: 'Collar', view: 'neutral', risk: 'stock', group: 'Income / covered',
    description: 'Own 100 shares, buy a lower put and sell a higher call. Gains and losses both capped.', legs: [stock(), o('P', 1, -1), o('C', -1, 1)] },
  { id: 'short_straddle', name: 'Short Straddle', view: 'neutral', risk: 'undefined', group: 'Straddles / strangles',
    description: 'Sell a call and a put at the same strike. Max profit if the stock pins the strike; unlimited risk.', legs: [o('C', -1), o('P', -1)] },
  { id: 'short_strangle', name: 'Short Strangle', view: 'neutral', risk: 'undefined', group: 'Straddles / strangles',
    description: 'Sell a call at Call High and a put at Put Low. Profits while the stock stays between them.', legs: [o('C', -1, 0, 'call_high'), o('P', -1, 0, 'put_low')] },
  { id: 'iron_condor', name: 'Iron Condor', view: 'neutral', risk: 'credit', group: 'Condors',
    description: 'Short strangle at Call High / Put Low with protective wings. Credit kept inside the short strikes.',
    legs: [o('P', 1, -1, 'put_low'), o('P', -1, 0, 'put_low'), o('C', -1, 0, 'call_high'), o('C', 1, 1, 'call_high')] },
  { id: 'calendar_spread', name: 'Calendar Spread', view: 'neutral', risk: 'debit', group: 'Calendar / diagonal',
    description: 'Sell a near-dated call, buy a later-dated call at the same strike. Profits from faster decay of the near one.', legs: [o('C', -1), o('C', 1, 0, 'atm', true)] },
  { id: 'covered_strangle', name: 'Covered Strangle', view: 'neutral', risk: 'stock', group: 'Income / covered',
    description: 'Own 100 shares, sell a call at Call High and a put at Put Low for extra income.', legs: [stock(), o('C', -1, 0, 'call_high'), o('P', -1, 0, 'put_low')] },
  { id: 'long_call_butterfly', name: 'Long Call Butterfly', view: 'neutral', risk: 'debit', group: 'Butterflies',
    description: 'Buy 1 lower call, sell 2 at the money, buy 1 higher. Max profit if the stock pins the middle strike.', legs: [o('C', 1, -1), o('C', -2), o('C', 1, 1)] },
  { id: 'iron_butterfly', name: 'Iron Butterfly', view: 'neutral', risk: 'credit', group: 'Butterflies',
    description: 'Short straddle with protective wings. Large credit, max profit if the stock pins the center strike.', legs: [o('C', -1), o('P', -1), o('C', 1, 1), o('P', 1, -1)] },
  { id: 'long_put_butterfly', name: 'Long Put Butterfly', view: 'neutral', risk: 'debit', group: 'Butterflies',
    description: 'Buy 1 higher put, sell 2 at the money, buy 1 lower. Max profit if the stock pins the middle strike.', legs: [o('P', 1, 1), o('P', -2), o('P', 1, -1)] },
  { id: 'long_call_condor', name: 'Long Call Condor', view: 'neutral', risk: 'debit', group: 'Condors',
    description: 'Four calls: a butterfly with a wider flat top. Profits while the stock stays between the middle strikes.', legs: [o('C', 1, -2), o('C', -1, -1), o('C', -1, 1), o('C', 1, 2)] },
  { id: 'long_put_condor', name: 'Long Put Condor', view: 'neutral', risk: 'debit', group: 'Condors',
    description: 'Four puts: a butterfly with a wider flat top. Profits while the stock stays between the middle strikes.', legs: [o('P', 1, 2), o('P', -1, 1), o('P', -1, -1), o('P', 1, -2)] },
  { id: 'jade_lizard', name: 'Jade Lizard', view: 'neutral', risk: 'undefined', group: 'Lizards',
    description: 'Sell a put plus a bear call spread. No upside risk when the credit exceeds the call spread width.', legs: [o('P', -1, -1), o('C', -1, 1), o('C', 1, 2)] },
  { id: 'reverse_jade_lizard', name: 'Reverse Jade Lizard', view: 'neutral', risk: 'undefined', group: 'Lizards',
    description: 'Sell a call plus a bull put spread. No downside risk when the credit exceeds the put spread width.', legs: [o('C', -1, 1), o('P', -1, -1), o('P', 1, -2)] },
  { id: 'short_guts', name: 'Short Guts', view: 'neutral', risk: 'undefined', group: 'Straddles / strangles',
    description: 'Sell an in-the-money call and an in-the-money put. Like a short strangle with a bigger credit.', legs: [o('C', -1, -1), o('P', -1, 1)] },
  { id: 'covered_short_straddle', name: 'Covered Short Straddle', view: 'neutral', risk: 'stock', group: 'Income / covered',
    description: 'Own 100 shares and sell an at-the-money call and put. High income, doubled downside.', legs: [stock(), o('C', -1), o('P', -1)] },
  { id: 'diagonal_call_spread', name: 'Diagonal Call Spread', view: 'neutral', risk: 'debit', group: 'Calendar / diagonal',
    description: 'Sell a near-dated call, buy a later-dated higher call. A calendar with a mild bullish tilt.', legs: [o('C', -1), o('C', 1, 1, 'atm', true)] },
  { id: 'diagonal_put_spread', name: 'Diagonal Put Spread', view: 'neutral', risk: 'debit', group: 'Calendar / diagonal',
    description: 'Sell a near-dated put, buy a later-dated lower put. A calendar with a mild bearish tilt.', legs: [o('P', -1), o('P', 1, -1, 'atm', true)] },

  // Volatile
  { id: 'long_straddle', name: 'Long Straddle', view: 'volatile', risk: 'debit', group: 'Straddles / strangles',
    description: 'Buy a call and a put at the same strike. Profits from a big move either way; risk is the premium.', legs: [o('C', 1), o('P', 1)] },
  { id: 'long_strangle', name: 'Long Strangle', view: 'volatile', risk: 'debit', group: 'Straddles / strangles',
    description: 'Buy a call at Call High and a put at Put Low. Cheaper than a straddle, needs a bigger move.', legs: [o('C', 1, 0, 'call_high'), o('P', 1, 0, 'put_low')] },
  { id: 'call_backspread', name: 'Call Backspread', view: 'volatile', risk: 'debit', group: 'Ratio / backspreads',
    description: 'Sell one call, buy two higher calls. Unlimited upside on a strong rally.', legs: [o('C', -1), o('C', 2, 1)] },
  { id: 'put_backspread', name: 'Put Backspread', view: 'volatile', risk: 'debit', group: 'Ratio / backspreads',
    description: 'Sell one put, buy two lower puts. Large profit on a sharp drop.', legs: [o('P', -1), o('P', 2, -1)] },
  { id: 'inverse_iron_butterfly', name: 'Inverse Iron Butterfly', view: 'volatile', risk: 'debit', group: 'Butterflies',
    description: 'Long straddle with short wings. Cheaper than a straddle; profit capped beyond the wings.', legs: [o('C', 1), o('P', 1), o('C', -1, 1), o('P', -1, -1)] },
  { id: 'inverse_iron_condor', name: 'Inverse Iron Condor', view: 'volatile', risk: 'debit', group: 'Condors',
    description: 'Long strangle with short wings. Profits from a move beyond either inner strike; profit capped.', legs: [o('C', 1, 1), o('P', 1, -1), o('C', -1, 2), o('P', -1, -2)] },
  { id: 'short_call_butterfly', name: 'Short Call Butterfly', view: 'volatile', risk: 'credit', group: 'Butterflies',
    description: 'Sell 1 lower call, buy 2 at the money, sell 1 higher. Small credit if the stock moves away from the middle.', legs: [o('C', -1, -1), o('C', 2), o('C', -1, 1)] },
  { id: 'short_put_butterfly', name: 'Short Put Butterfly', view: 'volatile', risk: 'credit', group: 'Butterflies',
    description: 'Sell 1 higher put, buy 2 at the money, sell 1 lower. Small credit if the stock moves away from the middle.', legs: [o('P', -1, 1), o('P', 2), o('P', -1, -1)] },
  { id: 'short_call_condor', name: 'Short Call Condor', view: 'volatile', risk: 'credit', group: 'Condors',
    description: 'Inverse of a long call condor. Credit kept if the stock leaves the middle range.', legs: [o('C', -1, -2), o('C', 1, -1), o('C', 1, 1), o('C', -1, 2)] },
  { id: 'short_put_condor', name: 'Short Put Condor', view: 'volatile', risk: 'credit', group: 'Condors',
    description: 'Inverse of a long put condor. Credit kept if the stock leaves the middle range.', legs: [o('P', -1, 2), o('P', 1, 1), o('P', 1, -1), o('P', -1, -2)] },
  { id: 'strip', name: 'Strip', view: 'volatile', risk: 'debit', group: 'Straddles / strangles',
    description: 'Buy one call and two puts. A straddle that profits more from a fall.', legs: [o('C', 1), o('P', 2)] },
  { id: 'strap', name: 'Strap', view: 'volatile', risk: 'debit', group: 'Straddles / strangles',
    description: 'Buy two calls and one put. A straddle that profits more from a rise.', legs: [o('C', 2), o('P', 1)] },
  { id: 'guts', name: 'Guts', view: 'volatile', risk: 'debit', group: 'Straddles / strangles',
    description: 'Buy an in-the-money call and an in-the-money put. A straddle variant with in-the-money legs.', legs: [o('C', 1, -1), o('P', 1, 1)] },
];

export const STRATEGY_BY_ID = new Map(STRATEGIES.map(s => [s.id, s]));
export const STRATEGY_IDS = STRATEGIES.map(s => s.id);
export const needsFarExpiry = (t: StrategyTemplate) => t.legs.some(l => l.far);
