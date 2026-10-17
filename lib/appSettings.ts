/**
 * Admin-editable settings (nt_app_settings: key -> JSON). Callers own validation of their key's
 * value (see lib/rateLimitConfig.ts); this module only stores and reads.
 */
import { sql } from '@/lib/db';

export interface StoredSetting<T> { value: T; updatedAt: string; updatedBy: string | null }

export async function getSetting<T = unknown>(key: string): Promise<StoredSetting<T> | null> {
  const rows = await sql`SELECT value, updated_at, updated_by FROM public.nt_app_settings WHERE key = ${key}`;
  const r = rows[0] as { value: T; updated_at: string; updated_by: string | null } | undefined;
  return r ? { value: r.value, updatedAt: new Date(r.updated_at).toISOString(), updatedBy: r.updated_by } : null;
}

export async function setSetting(key: string, value: unknown, updatedBy: string | null): Promise<void> {
  await sql`
    INSERT INTO public.nt_app_settings (key, value, updated_by) VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${updatedBy})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
  `;
}

export async function deleteSetting(key: string): Promise<void> {
  await sql`DELETE FROM public.nt_app_settings WHERE key = ${key}`;
}
