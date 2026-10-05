import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge-cheap routing and abuse protection: no database work. Real session validation happens on the protected pages.
 * Rate limit: a per-instance sliding window on state-changing requests (POST, which includes server actions) per client IP.
 * It is a best-effort brake against floods and scripted abuse; the login and password-reset limits in the database are the strict ones.
 */
const WINDOW_MS = 60_000;
const LIMIT = 240;
const hits = new Map<string, { n: number; t: number }>();

function limited(ip: string): boolean {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now - e.t > WINDOW_MS) { hits.set(ip, { n: 1, t: now }); if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > WINDOW_MS) hits.delete(k); return false; }
  e.n++;
  return e.n > LIMIT;
}

function cspFor(nonce: string) {
  const dev = process.env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function middleware(req: NextRequest) {
  if (req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (limited(ip)) return new NextResponse('Too many requests. Please slow down and try again in a minute.', { status: 429, headers: { 'Retry-After': '60' } });
    return NextResponse.next();
  }
  if (req.nextUrl.pathname === '/') {
    const target = req.cookies.has('ws_session') ? '/dashboard' : '/login';
    return NextResponse.redirect(new URL(target, req.url));
  }
  // A fresh nonce per request: Next.js reads it from the request's CSP header and stamps it on its own scripts.
  const nonce = btoa(crypto.randomUUID());
  const csp = cspFor(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|brand/|icons/|sw.js|favicon.ico|manifest.webmanifest).*)'] };
