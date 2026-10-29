/**
 * Market-data facade: the ONLY entry point for quotes, bars, the exchange calendar, news and symbol
 * search. Server-only. (US listings come from lib/referenceData/listings.ts.)
 *
 * Masking rule: data vendors are named only inside lib/marketdata/provider/* (and in server-side
 * env var names and DB table names). Never in client code, route paths, response bodies, UI text
 * or error messages sent to the browser. Client components import `lib/marketdata/intervals.ts`,
 * never this file.
 *
 *  - primary  : stock/option bars and snapshots, calendar, news
 *  - fallback : symbol search, and daily/intraday bars for symbols the primary has none for
 *               (indices such as SPX; no volume)
 */
export type { Bar, Snapshot, OptionSnapshot, CalendarRow, NewsArticle } from './types';
export type { ChartInterval } from './intervals';
export { isIntradayInterval } from './intervals';

export {
  hasKeys,
  getHistoricalBars,
  getSnapshotsMulti,
  getSnapshotsChunked,
  getDailyBarsMulti,
  getDailyBarsChunk,
  getDailyBarsPaced,
  getDailyBarsRevalidated,
  BULK_MAX_PER_MINUTE,
  convertIntervalToTimeframe,
  buildOccOptionSymbol,
  getOptionBars,
  getOptionTodaySnapshotBar,
  getOptionBarsMulti,
  getOptionSnapshotsMulti,
  getOptionChainSnapshots,
  fetchCalendar,
  fetchNewsPage,
} from './provider/primary';
export type { DailyClose, PacedBarsResult } from './provider/primary';

export {
  getBarsForChart as getFallbackBars,
  getQuote as getFallbackQuote,
  easternMidnightIso,
  searchCompanies,
  searchSymbols,
} from './provider/fallback';
