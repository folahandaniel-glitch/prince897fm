import crypto from 'node:crypto';
import { privileged, withTenant } from '@/server/db';
import { sendReportReminders } from '@/server/reports';
import { remindFollowUps } from '@/server/crm';
import { escalateOverdue } from '@/server/tickets';
import { expiryAlerts } from '@/server/documents';
import { boot } from '@/server/session';
import { trainingAlerts } from '@/server/training';
import { sealLegacy } from '@/server/sensitive';
import { assessmentReminders } from '@/server/assessment';
import { flushOutbox } from '@/server/messaging';

export const dynamic = 'force-dynamic';

/** Sends "due soon" and "overdue" report notices for every active organisation (de-duplicated per period). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret ?? ''}`;
  const ok = !!secret && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return new Response('Unauthorized', { status: 401 });
  await boot();
  const orgs = await (await privileged()).query<{ id: string }>(`select id from organizations where status = 'active'`);
  let sent = 0;
  for (const o of orgs) sent += await withTenant(o.id, async (q) => (await sendReportReminders(q, o.id)) + (await remindFollowUps(q, o.id)) + (await escalateOverdue(q, o.id)) + (await expiryAlerts(q, o.id)) + (await trainingAlerts(q, o.id)) + (await sealLegacy(q)) + (await assessmentReminders(q, o.id)));
  const mail = await flushOutbox(200);
  return Response.json({ organisations: orgs.length, notificationsSent: sent, outbox: mail });
}
