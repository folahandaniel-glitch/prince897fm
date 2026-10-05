import { cookies } from 'next/headers';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';
import { runAs } from '@/server/ctx';
import { exportConfig } from '@/server/backend';
import { ForbiddenError } from '@/domain/policy';
import { boot } from '@/server/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  await boot();
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return new Response('Unauthorized', { status: 401 });
  try {
    const b = await runAs(s.org_id, s.user_id, (c) => exportConfig(c));
    return new Response(JSON.stringify(b, null, 2), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${s.org_slug}-config.json"`, 'cache-control': 'private, no-store' } });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response('Forbidden', { status: 403 });
    throw e;
  }
}
