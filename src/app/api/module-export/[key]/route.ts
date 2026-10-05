import { cookies } from 'next/headers';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';
import { runAs, UserError } from '@/server/ctx';
import { recordsCsv } from '@/server/builders';
import { ForbiddenError } from '@/domain/policy';
import { boot } from '@/server/session';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  await boot();
  const { key } = await params;
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return new Response('Unauthorized', { status: 401 });
  if (!/^[a-z][a-z0-9_]{1,29}$/.test(key)) return new Response('Not found', { status: 404 });
  try {
    const csv = await runAs(s.org_id, s.user_id, (c) => recordsCsv(c, key));
    return new Response('\uFEFF' + csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${key}.csv"`, 'cache-control': 'private, no-store' } });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response('Forbidden', { status: 403 });
    if (e instanceof UserError) return new Response(e.message, { status: 404 });
    throw e;
  }
}
