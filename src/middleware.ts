import { NextResponse, type NextRequest } from 'next/server';

/** Edge-cheap routing: no database work. Real session validation happens on the protected pages. */
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === '/') {
    const target = req.cookies.has('ws_session') ? '/dashboard' : '/login';
    return NextResponse.redirect(new URL(target, req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/'] };
