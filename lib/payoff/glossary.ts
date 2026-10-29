/**
 * Plain-English hover text for option terms and builder metrics, shown via
 * <Term k="..."> (components/ui/Term.tsx). One place so every table and panel
 * explains a symbol the same way.
 */
export const GLOSSARY = {
  delta: 'Delta (Δ): how much the option or position gains or loses for a $1 rise in the stock. Position delta 50 ≈ owning 50 shares.',
  gamma: 'Gamma (Γ): how fast delta changes for a $1 move in the stock.',
  theta: 'Theta (Θ): value gained or lost per day from time passing, all else equal. Negative means time decay costs you.',
  vega: 'Vega (V): value gained or lost when implied volatility rises by 1 percentage point.',
  rho: 'Rho (ρ): value change for a 1 percentage point rise in interest rates.',
  iv: 'IV (implied volatility): the yearly move the option price implies. Higher IV means pricier options.',
  ivShift: 'IV shift: add or remove volatility points from every leg to see how a change in IV (for example the drop after earnings) affects P&L.',
  pop: 'POP (probability of profit): chance the position makes money at expiry, from a lognormal model using the at-the-money IV. A model estimate, not a forecast.',
  breakeven: 'B/E (breakeven): stock price at expiry where the position neither makes nor loses money.',
  rewardRisk: 'R/R (reward / risk): max profit divided by max loss. Shown only when both are limited.',
  maxProfit: 'Max profit: the most the position can make at expiry (∞ when unlimited).',
  maxLoss: 'Max loss: the most the position can lose at expiry (∞ when unlimited).',
  margin: 'Est. capital: rough capital needed: the max loss, or the debit paid. "≥" means risk is unlimited and your broker will require more.',
  netDebit: 'Net debit: premium you pay to open the position.',
  netCredit: 'Net credit: premium you receive to open the position.',
  t0: 'T+0: profit/loss today if the stock moved instantly to each price (Black-76 model).',
  expiryLine: 'Expiry: profit/loss at the nearest expiry.',
  dateLine: 'Selected date: profit/loss on the date chosen with the slider.',
  atm: 'ATM (at the money): strike closest to the current stock price.',
  itm: 'ITM (in the money): a call below the stock price, or a put above it.',
  otm: 'OTM (out of the money): a call above the stock price, or a put below it.',
  oi: 'OI (open interest): number of contracts open at the end of the day.',
  oiChg: 'ΔOI (OI change): contracts opened (+) or closed (−) in the session.',
  pcr: 'PCR (put/call ratio): put open interest divided by call open interest. Above 1 = more puts open than calls.',
  mid: 'Mid: halfway between bid and ask. Positions are priced at the mid.',
  bid: 'Bid: the highest price a buyer is offering. Click to sell at this row.',
  ask: 'Ask: the lowest price a seller is asking. Click to buy at this row.',
  last: 'Last: the most recent trade price.',
  vol: 'Vol (volume): contracts traded today.',
  dte: 'DTE (days to expiry): calendar days until the contract expires.',
  unbounded: '∞: unlimited. The profit or loss keeps growing as the stock moves further.',
  strike: 'Strike: price at which the option can be exercised. Click to open its price and OI chart.',
  qty: 'Qty: number of contracts (each covers 100 shares); stock is in lots of 100 shares. Negative = sold.',
  premium: 'Premium: price per share of the option (×100 per contract).',
  callHigh: 'Call High: this app’s upper price level from call open interest for the selected expiry.',
  putLow: 'Put Low: this app’s lower price level from put open interest for the selected expiry.',
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
