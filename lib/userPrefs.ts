/**
 * Per-user UI preferences (nt_user_prefs). Each key has a validator, so the
 * table only ever holds values the app understands; unknown keys are rejected.
 * Every statement filters on user_id inside the SQL, so one user can never read
 * or write another's preferences.
 *
 * Keys: `cols.<tableId>` = the hidden column ids, order and widths of one table
 * (ColumnPrefs, lib/tableColumns.ts). `chart.settings` = the stock chart's toggles, interval,
 * expiry, period and height (ChartPrefs, lib/chartPrefs.ts). Add another kind of preference by extending validatorFor().
 */
import { sql } from '@/lib/db';
import { CHART_PREF_KEY, normalizeChartPrefs } from '@/lib/chartPrefs';
import { normalizeColumnPrefs, TABLE_IDS } from '@/lib/tableColumns';

type Validator = (v: unknown) => unknown | null;

/** Hidden ids, order and widths for one table (an older bare list of hidden ids is upgraded). */
const columnPrefs: Validator = v => normalizeColumnPrefs(v);

function validatorFor(key: string): Validator | null {
  if (key === CHART_PREF_KEY) return normalizeChartPrefs;
  const m = /^cols\.([A-Za-z0-9]+)$/.exec(key);
  if (m && (TABLE_IDS as readonly string[]).includes(m[1])) return columnPrefs;
  return null;
}

export const isPrefKey = (key: string): boolean => validatorFor(key) !== null;

/** The validated value for `key`, or undefined when the user hasn't saved one (or it no longer validates). */
export async function getPref(userId: string, key: string): Promise<unknown | undefined> {
  const validate = validatorFor(key);
  if (!validate) return undefined;
  const rows = await sql`SELECT value FROM public.nt_user_prefs WHERE user_id = ${userId} AND key = ${key}`;
  if (!rows[0]) return undefined;
  const checked = validate(rows[0].value);
  return checked === null ? undefined : checked;
}

/** Validate and save. Returns the stored value, or null when `value` is invalid for `key`. */
export async function setPref(userId: string, key: string, value: unknown): Promise<unknown | null> {
  const validate = validatorFor(key);
  if (!validate) return null;
  const checked = validate(value);
  if (checked === null) return null;
  await sql`
    INSERT INTO public.nt_user_prefs (user_id, key, value) VALUES (${userId}, ${key}, ${JSON.stringify(checked)}::jsonb)
    ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return checked;
}

/** Forget a saved preference (the page falls back to its default). */
export async function deletePref(userId: string, key: string): Promise<void> {
  await sql`DELETE FROM public.nt_user_prefs WHERE user_id = ${userId} AND key = ${key}`;
}
