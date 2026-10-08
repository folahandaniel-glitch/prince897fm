import crypto from 'node:crypto';
import { privileged } from '@/server/db';
import { boot } from '@/server/session';
import { withTenant } from '@/server/db';
import { autoCloseOverdue } from '@/server/attendance';

export const dynamic = 'force-dynamic';

/** Daily sweep: sessions still open after 18 hours become "missed clock-out" so supervisors see them and staff can correct them. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret ?? ''}`;
  const ok = !!secret && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return new Response('Unauthorized', { status: 401 });
  await boot();
  const rows = await (await privileged()).query<{ id: string }>(`update attendance_sessions set status = 'missed_clock_out' where status = 'open' and clock_in_at < now() - interval '18 hours' returning id`);
  const orgs = await (await privileged()).query<{ id: string }>(`select id from organizations where status = 'active'`);
  let autoClosed = 0;
  for (const o of orgs) autoClosed += (await withTenant(o.id, (q) => autoCloseOverdue(q, o.id))).length;
  return Response.json({ flagged: rows.length, autoClosed });
}
