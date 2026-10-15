/**
 * Single-row leases in nt_job_lease, so cron runs of the same job never
 * overlap. pg advisory locks can't be used: the Neon HTTP driver gives every
 * statement its own session.
 */
import { sql } from '@/lib/db';

/** Take the lease named `name` for `seconds`; false if another run holds it. */
export async function acquireLease(name: string, seconds: number): Promise<boolean> {
  await sql`INSERT INTO public.nt_job_lease (name) VALUES (${name}) ON CONFLICT (name) DO NOTHING`;
  const rows = await sql`
    UPDATE public.nt_job_lease SET locked_until = now() + make_interval(secs => ${seconds})
    WHERE name = ${name} AND locked_until < now()
    RETURNING 1
  `;
  return rows.length > 0;
}

export async function releaseLease(name: string): Promise<void> {
  await sql`UPDATE public.nt_job_lease SET locked_until = 'epoch' WHERE name = ${name}`;
}
