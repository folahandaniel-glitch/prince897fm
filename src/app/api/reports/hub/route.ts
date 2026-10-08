import { cookies } from 'next/headers';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';
import { runAs, UserError } from '@/server/ctx';
import { ForbiddenError } from '@/domain/policy';
import { hubCsv, hubReport, type HubKind } from '@/server/reporthub';
import { boot } from '@/server/session';

export const dynamic = 'force-dynamic';

/** CSV of one management report for the signed-in person's scope. */
export async function GET(req: Request) {
  await boot();
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return new Response('Please sign in.', { status: 401 });
  const u = new URL(req.url);
  const kind = u.searchParams.get('k') as HubKind;
  if (!['attendance', 'leave', 'payroll', 'tasks'].includes(kind)) return new Response('Unknown report.', { status: 400 });
  const period = u.searchParams.get('period') ?? new Date().toISOString().slice(0, 7);
  try {
    const t = await runAs(s.org_id, s.user_id, (c) => hubReport(c, kind, period));
    return new Response(hubCsv(t), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${kind}-${period}.csv"`, 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response('Not permitted.', { status: 403 });
    if (e instanceof UserError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
