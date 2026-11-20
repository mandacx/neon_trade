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
 *  - feed     : per-symbol news (read first for named symbols) and the per-symbol earnings calendar (newsFeed.ts)
 *  - fallback : symbol search, reported EPS (no news at this vendor), the live option chain (quotes, greeks, open interest) and its expiries,
 *               and daily/intraday bars and live quotes (getIndexSnapshots) for the indices the primary
 *               has none for (SPX, NDX; no volume)
 *  - crypto   : live quotes and candles for the crypto levels page (getCryptoTickers, getCryptoBars)
 */
export type { Bar, Snapshot, OptionSnapshot, OptionChainContract, CalendarRow, NewsArticle, NewsArticleFull, ReportedQuarter, EarningsFigures } from './types';
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

// News and earnings figures, with the source order decided in one place (see newsFeed.ts).
export { fetchLatestNews, fetchSymbolHeadlines, fetchEarningsFigures, hasEarningsFeed, FeedRateLimited } from './newsFeed';

export {
  getBarsForChart as getFallbackBars,
  getQuote as getFallbackQuote,
  getIndexSnapshots,
  INDEX_QUOTE_SYMBOLS,
  easternMidnightIso,
  searchCompanies,
  searchSymbols,
  getOptionChainContracts,
  getOptionExpirations,
  getExtendedHoursLast,
  getReportedQuarters,
} from './provider/fallback';

export { getCryptoTickers, getCryptoBars } from './provider/crypto';
export type { CryptoTicker } from './provider/crypto';
