import { cookies } from 'next/headers';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';
import { runAs } from '@/server/ctx';
import { photoFor } from '@/server/photo';
import { boot } from '@/server/session';

export const dynamic = 'force-dynamic';

/** A colleague's profile picture. Signed-in people of the same organisation only (the database enforces the organisation). */
export async function GET(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  const { userId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return new Response('Not found', { status: 404 });
  await boot();
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return new Response('Please sign in.', { status: 401 });
  const p = await runAs(s.org_id, s.user_id, (c) => photoFor(c, userId));
  if (!p) return new Response('Not found', { status: 404 });
  const etag = `"${p.sha}"`;
  const headers = { 'Content-Type': 'image/webp', ETag: etag, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(p.bytes), { headers });
}
