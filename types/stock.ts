// Stock data from Neon DB - eod_usmkts_price table
export interface StockData {
  SYMBOL: string;
  EXPIRY_DT: string;
  TRADE_DATE: string;
  OPEN: number;
  HIGH: number;
  LOW: number;
  CLOSE: number;
  PUT_INT: number;
  CALL_INT: number;
  PUT_CALL_INT: number;
  call_low: number;
  put_HIGH: number;
  call_HIGH: number;
  put_LOW: number;
  UNUSED_PC: number;
  UNUSED_PC_REV: number;
  CALL_OI: number;
  PUT_OI: number;
  OI_DIFF: number;
}

// Level calculation result
export interface LevelCalculation {
  name: 'put_low' | 'put_int' | 'put_call_int' | 'call_int' | 'call_high';
  value: number;      // Percentage distance from close (e.g., 0.0294 for 2.94%)
  price: number;      // Actual price level
  distance: number;   // Absolute distance from close
}

// Stock with calculated levels
export interface StockWithLevels {
  symbol: string;
  close: number;
  tradeDate: string;
  expiryDate?: string;
  levels: LevelCalculation[];
  closestLevel: LevelCalculation;
}

// OHLC data from Tradier API
export interface OHLCData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Quadrant stock data point
export interface QuadrantStock {
  symbol: string;
  name?: string | null;
  close: number;
  tradeDate: string;
  expiryDate?: string;
  levels: LevelCalculation[];
  closestLevel: string;
  closestValue: number;
  sector?: string | null;
  industry?: string | null;
  marketCapTier?: string | null;
  marketCap?: number | null;
  indices?: string[];
}

// Quadrant filters
export interface QuadrantFilters {
  sector?: string;
  dateRange?: { from: string; to: string };
  threshold?: number;
  search?: string;
}

// Chart data for lightweight-charts
export interface CandlestickData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface VolumeData {
  time: string;
  value: number;
  color?: string;
}

// Level line for chart
export interface LevelLine {
  level: LevelCalculation;
  isClosest: boolean;
}
