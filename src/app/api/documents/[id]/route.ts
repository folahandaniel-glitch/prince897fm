import { cookies } from 'next/headers';
import { resolveSession, SESSION_COOKIE } from '@/server/auth';
import { runAs, UserError } from '@/server/ctx';
import { downloadVersion } from '@/server/documents';
import { ForbiddenError } from '@/domain/policy';
import { boot } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Permission-checked, integrity-verified, audited download. Always served as an attachment with nosniff. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await boot();
  const { id } = await params;
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return new Response('Unauthorized', { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const v = Number(new URL(req.url).searchParams.get('v')) || undefined;
  try {
    const f = await runAs(s.org_id, s.user_id, (c) => downloadVersion(c, id, v));
    if (!f) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(f.data), { headers: { 'content-type': f.mime, 'content-disposition': `attachment; filename="${f.filename.replace(/"/g, '')}"`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store', 'content-security-policy': "default-src 'none'; sandbox" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response('Forbidden', { status: 403 });
    if (e instanceof UserError) return new Response(e.message, { status: 409 });
    throw e;
  }
}
