/**
 * Which Strategy Builder templates users can pick, editable by an admin at
 * /admin/settings (nt_app_settings key 'strategy_templates' = { disabled: id[] }).
 * Absent setting = every template enabled. Reads are cached per server instance
 * for CACHE_MS, like the rate limits (lib/rateLimitConfig.ts).
 */
import { getSetting, setSetting } from '@/lib/appSettings';
import { STRATEGY_IDS } from '@/lib/payoff/strategies';

export const STRATEGY_SETTINGS_KEY = 'strategy_templates';
const CACHE_MS = 30_000;

export interface StrategySettingsView {
  disabled: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Keep only known template ids (unknown ids, e.g. a removed template, are dropped). Returns null for bad input. */
export function validateDisabled(input: unknown): string[] | null {
  if (!Array.isArray(input) || !input.every(v => typeof v === 'string')) return null;
  const known = new Set(STRATEGY_IDS);
  return [...new Set(input as string[])].filter(id => known.has(id));
}

let cache: { at: number; disabled: string[] } | null = null;

async function loadDisabled(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.disabled;
  let disabled: string[] = [];
  try {
    const saved = await getSetting<{ disabled?: unknown }>(STRATEGY_SETTINGS_KEY);
    disabled = validateDisabled(saved?.value?.disabled) ?? [];
  } catch (err) {
    console.error('strategySettings: could not read the setting, enabling every template', err);
  }
  cache = { at: Date.now(), disabled };
  return disabled;
}

/** Template ids users may pick, in template order. */
export async function enabledStrategyIds(): Promise<string[]> {
  const off = new Set(await loadDisabled());
  return STRATEGY_IDS.filter(id => !off.has(id));
}

/** Fresh read for the admin page (bypasses the cache). */
export async function getStrategySettings(): Promise<StrategySettingsView> {
  cache = null;
  const saved = await getSetting<{ disabled?: unknown }>(STRATEGY_SETTINGS_KEY).catch(() => null);
  return {
    disabled: validateDisabled(saved?.value?.disabled) ?? [],
    updatedAt: saved?.updatedAt ?? null,
    updatedBy: saved?.updatedBy ?? null,
  };
}

export async function saveStrategySettings(disabled: string[], updatedBy: string | null): Promise<void> {
  await setSetting(STRATEGY_SETTINGS_KEY, { disabled }, updatedBy);
  cache = null;
}
