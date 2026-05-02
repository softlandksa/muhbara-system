import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  console.log("MIDDLEWARE_PATH", pathname);

  // Always let NextAuth handle its own routes — belt-and-suspenders guard
  // even though the matcher below already excludes /api/*
  if (pathname.startsWith("/api/auth")) {
    console.log("MIDDLEWARE_ALLOW_AUTH_ROUTE", pathname);
    return NextResponse.next();
  }

  // Read JWT directly — no HTTP call, no redirect loop risk
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
     * Run on all paths EXCEPT:
     * - /api/*          — API routes (including /api/auth/*) handle their own auth
     * - /_next/static   — static assets
     * - /_next/image    — image optimisation
     * - /favicon.ico
     * - /public
     */
    "/((?!api|_next/static|_next/image|favicon\\.ico|public).*)",
  ],
};
