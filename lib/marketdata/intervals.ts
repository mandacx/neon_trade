/** Chart intervals. Client-safe: no data-source code or names here, so components can import it. */

export type ChartInterval = '1min' | '5min' | '15min' | '30min' | '1hour' | 'daily' | 'weekly' | 'monthly';

/** Is this interval finer than one day (i.e. multiple bars per trading day)? */
export function isIntradayInterval(interval: ChartInterval): boolean {
  return interval === '1min' || interval === '5min' || interval === '15min' || interval === '30min' || interval === '1hour';
}
