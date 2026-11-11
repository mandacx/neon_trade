import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const base = (await sql`SELECT updated_at FROM public.nt_idea_outcomes WHERE idea_id=1`)[0].updated_at;
const deadline = Date.now() + 22 * 60_000;
while (Date.now() < deadline) {
  const r = (await sql`SELECT (SELECT updated_at FROM public.nt_idea_outcomes WHERE idea_id=1) AS upd, (SELECT count(*) FROM public.nt_idea_option_marks) AS marks`)[0];
  if (String(r.upd) !== String(base)) {
    await new Promise(res => setTimeout(res, 20000)); // let the option step finish after the evaluate step
    console.log('TICK SEEN, outcome updated', r.upd);
    console.log(JSON.stringify(await sql`SELECT event_key, kind, at, underlying, legs, basis, note FROM public.nt_idea_option_marks ORDER BY id`, null, 1));
    console.log(JSON.stringify(await sql`SELECT outcome, r_multiple, status FROM public.nt_idea_outcomes o JOIN public.nt_trade_ideas i ON i.id=o.idea_id WHERE o.idea_id=1`));
    process.exit(0);
  }
  await new Promise(res => setTimeout(res, 20000));
}
console.log('NO TICK SEEN within 22 minutes');
