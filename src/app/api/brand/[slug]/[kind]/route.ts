import { publicBrandImage } from '@/server/brand';
import { boot } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Serves an organisation's uploaded logo/emblem. The URL carries a content hash (?v=), so it can be cached hard. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await ctx.params;
  await boot();
  const img = await publicBrandImage(slug, kind);
  if (!img) return new Response('Not found', { status: 404 });
  const etag = `"${img.sha}"`;
  const headers = { 'Content-Type': img.mime, ETag: etag, 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff' };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(img.bytes), { headers });
}
