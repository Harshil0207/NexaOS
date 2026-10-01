import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = ['/login', '/register', '/forgot-password', '/reset-password'];
const COOKIES = ['nexa_session', '__Host-nexa_session'];

/** Fast redirect for signed-out visitors. The API remains the authority on every request. */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`)))
    return NextResponse.next();
  const hasSession = COOKIES.some((c) => req.cookies.has(c));
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico|icon.svg|robots.txt).*)'],
};
