// API Response types

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Stock search response
export interface StockSearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

// Stock details response
export interface StockDetailsResponse {
  symbol: string;
  close: number;
  tradeDate: string;
  expiryDate: string;
  levels: Array<{
    name: string;
    value: number;
    price: number;
    distance: number;
  }>;
  closestLevel: {
    name: string;
    value: number;
    price: number;
  };
}

// OHLC response from Tradier
export interface TradierOHLCResponse {
  symbol: string;
  interval: string;
  data: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

// Levels response
export interface LevelsResponse {
  symbol: string;
  date: string;
  close: number;
  levels: {
    put_low: number;
    put_int: number;
    put_call_int: number;
    call_int: number;
    call_high: number;
  };
  calculated: Array<{
    name: string;
    percentage: number;
    distance: number;
  }>;
  closestLevel: string;
}

// Quadrant data response
export interface QuadrantDataResponse {
  date: string;
  count: number;
  stocks: Array<{
    symbol: string;
    close: number;
    levels: Array<{
      name: string;
      value: number;
    }>;
    closestLevel: string;
    closestValue: number;
  }>;
}
