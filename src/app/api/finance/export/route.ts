import { cookies } from 'next/headers';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';
import { runAs, UserError } from '@/server/ctx';
import { registerCsv } from '@/server/finance';
import { ForbiddenError } from '@/domain/policy';
import { boot } from '@/server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  await boot();
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return new Response('Unauthorized', { status: 401 });
  const u = new URL(req.url);
  const from = u.searchParams.get('from') ?? '', to = u.searchParams.get('to') ?? '';
  try {
    const csv = await runAs(s.org_id, s.user_id, (c) => registerCsv(c, from, to));
    return new Response('\uFEFF' + csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="transactions-${from}-to-${to}.csv"`, 'cache-control': 'private, no-store' } });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response('Forbidden', { status: 403 });
    if (e instanceof UserError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
