import { wallboardData } from '@/server/dashboards';
import { boot } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Data for a paired TV screen. Authenticated only by its private token; read-only; wallboard-safe widgets only. */
export async function GET(req: Request) {
  await boot();
  const t = new URL(req.url).searchParams.get('t') ?? '';
  const d = await wallboardData(t);
  if (!d) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  return Response.json(d, { headers: { 'cache-control': 'no-store' } });
}
