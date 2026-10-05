import { cookies } from 'next/headers';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';
import { runAs } from '@/server/ctx';
import { search } from '@/server/search';
import { boot } from '@/server/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  await boot();
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return new Response('Unauthorized', { status: 401 });
  const q = new URL(req.url).searchParams.get('q') ?? '';
  const hits = await runAs(s.org_id, s.user_id, (c) => search(c, q.slice(0, 80)));
  return Response.json({ hits }, { headers: { 'cache-control': 'private, no-store' } });
}
