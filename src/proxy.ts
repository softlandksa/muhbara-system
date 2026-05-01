import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  console.log("MIDDLEWARE_PATH", pathname);

  // Belt-and-suspenders: always let NextAuth handle its own routes.
  // The matcher below already excludes /api/*, but this guard ensures
  // we never accidentally interfere even if the matcher changes.
  if (pathname.startsWith("/api/auth")) {
    console.log("MIDDLEWARE_ALLOW_AUTH_ROUTE", pathname);
    return NextResponse.next();
  }

  // getToken reads the JWT cookie directly — no HTTP call, no loop risk.
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  console.log("MIDDLEWARE_TOKEN_EXISTS", !!token);

  const isLoginPage = pathname === "/login";

  // Authenticated user on the login page → send to app
  if (isLoginPage && token) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Unauthenticated user on a protected page → send to login
  if (!isLoginPage && !token) {
    console.log("MIDDLEWARE_REDIRECT_LOGIN", pathname);
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Run proxy on all paths EXCEPT:
     * - /api/*          — API routes handle their own auth; /api/auth/* must never be blocked
     * - /_next/static   — static assets
     * - /_next/image    — image optimisation
     * - /favicon.ico    — favicon
     * - /public         — public folder
     */
    "/((?!api|_next/static|_next/image|favicon\\.ico|public).*)",
  ],
};
