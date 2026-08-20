import { StockData, LevelCalculation, StockWithLevels } from '@/types/stock';

/**
 * Calculate all 5 levels for a stock
 * Formula: (CLOSE - LEVEL_PRICE) / CLOSE
 */
export function calculateLevels(data: StockData): LevelCalculation[] {
  const { CLOSE, put_LOW, PUT_INT, PUT_CALL_INT, CALL_INT, call_HIGH } = data;

  if (!CLOSE) return [];

  return [
    {
      name: 'put_low',
      value: (CLOSE - put_LOW) / CLOSE,
      price: put_LOW,
      distance: Math.abs(CLOSE - put_LOW),
    },
    {
      name: 'put_int',
      value: (CLOSE - PUT_INT) / CLOSE,
      price: PUT_INT,
      distance: Math.abs(CLOSE - PUT_INT),
    },
    {
      name: 'put_call_int',
      value: (CLOSE - PUT_CALL_INT) / CLOSE,
      price: PUT_CALL_INT,
      distance: Math.abs(CLOSE - PUT_CALL_INT),
    },
    {
      name: 'call_int',
      value: (CLOSE - CALL_INT) / CLOSE,
      price: CALL_INT,
      distance: Math.abs(CLOSE - CALL_INT),
    },
    {
      name: 'call_high',
      value: (CLOSE - call_HIGH) / CLOSE,
      price: call_HIGH,
      distance: Math.abs(CLOSE - call_HIGH),
    },
  ];
}

/**
 * Find the level closest to 0 (closest to current price)
 */
export function findClosestLevel(levels: LevelCalculation[]): LevelCalculation {
  if (levels.length === 0) {
    // calculateLevels() returns [] when CLOSE is missing/0 — no real price
    // data to find a "closest" level from. value: 1 matches the existing
    // "100% away" sentinel callers already use to mean "no data here".
    return { name: 'put_low', value: 1, price: 0, distance: 0 };
  }
  return levels.reduce((closest, current) => {
    return Math.abs(current.value) < Math.abs(closest.value) ? current : closest;
  });
}

/**
 * Process stock data and calculate levels
 */
export function processStockData(data: StockData): StockWithLevels {
  const levels = calculateLevels(data);
  const closestLevel = findClosestLevel(levels);

  return {
    symbol: data.SYMBOL,
    close: data.CLOSE,
    tradeDate: data.TRADE_DATE,
    expiryDate: data.EXPIRY_DT,
    levels,
    closestLevel,
  };
}

/**
 * Calculate percentage from decimal
 */
export function toPercentage(value: number): number {
  return value * 100;
}

/**
 * Determine if price is above or below level
 */
export function getPricePosition(close: number, levelPrice: number): 'above' | 'below' | 'at' {
  const diff = close - levelPrice;
  if (Math.abs(diff) < 0.01) return 'at';
  return diff > 0 ? 'above' : 'below';
}

/**
 * Get the strength of proximity to a level (0-100, higher is closer)
 */
export function getProximityStrength(levelValue: number): number {
  // Convert percentage distance to strength score
  // 0% distance = 100 strength, 50% distance = 0 strength
  const absValue = Math.abs(levelValue);
  return Math.max(0, Math.min(100, 100 - (absValue * 200)));
}
