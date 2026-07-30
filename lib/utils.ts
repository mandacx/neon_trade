import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with proper precedence
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as currency
 */
export function formatCurrency(value: number, decimals: number = 2): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format a number as percentage
 */
export function formatPercentage(value: number, decimals: number = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format a date string
 */
export function formatDate(date: string | Date, format: 'short' | 'long' = 'short'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (format === 'long') {
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
  
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

/**
 * Get color for a level
 */
export function getLevelColor(levelName: string): string {
  const colors: Record<string, string> = {
    put_low: '#EF4444',      // Red
    call_low: '#F87171',     // Light Red
    put_int: '#F97316',      // Orange
    put_call_int: '#EAB308', // Yellow
    call_int: '#84CC16',     // Light Green
    put_high: '#4ADE80',     // Light Green
    call_high: '#22C55E',    // Green
  };
  
  return colors[levelName] || '#6B7280';
}

/**
 * Get level display name
 */
export function getLevelDisplayName(levelName: string): string {
  const names: Record<string, string> = {
    put_low: 'Put Low',
    call_low: 'Call Low',
    put_int: 'Put Int',
    put_call_int: 'Put/Call Int',
    call_int: 'Call Int',
    put_high: 'Put High',
    call_high: 'Call High',
  };

  return names[levelName] || levelName;
}

/**
 * Maps a public.intra_us_scanner_eod scan_code (e.g. "PUT CALL INT") onto the
 * same level keys used elsewhere in the app (e.g. "put_call_int"). Kept here
 * (not in lib/scanAlerts.ts) so client components can use it without pulling
 * in the server-only Neon db client.
 */
export const SCAN_CODE_TO_LEVEL: Record<string, string> = {
  'PUT LOW': 'put_low',
  'PUT INT': 'put_int',
  'PUT CALL INT': 'put_call_int',
  'CALL INT': 'call_int',
  'CALL HIGH': 'call_high',
};

/** Regular NYSE/Nasdaq session: 9:30–16:00 America/New_York, Mon–Fri. Holidays not accounted for. */
export function isUsMarketHours(date: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  if (get('weekday') === 'Sat' || get('weekday') === 'Sun') return false;
  const minutesSinceMidnight = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
  return minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight < 16 * 60;
}

/** Format a UTC epoch-seconds timestamp as the US trading-day it falls on ('YYYY-MM-DD' in America/New_York). */
export function usTradingDayKey(epochSeconds: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
