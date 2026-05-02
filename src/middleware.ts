import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /login is always public — never redirect it to itself
  if (pathname === "/login") {
    return NextResponse.next();
  }

  // Derive the session cookie name from the *actual* request protocol.
  // getToken's built-in auto-detection reads NEXTAUTH_URL, which may be
  // unset or set to http:// on Vercel while the request arrives over https://.
  // Bypassing that avoids a null token on every protected page load.
  const secure = req.url.startsWith("https://");
  const cookieName = secure
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";

  let token = null;
  try {
    token = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName,
    });
  } catch (e) {
    console.error("MIDDLEWARE_TOKEN_ERROR", e);
  }

  console.log("MIDDLEWARE_CHECK", pathname, "token:", !!token, "cookie:", cookieName);

  if (!token) {
    console.log("MIDDLEWARE_REDIRECT_LOGIN", pathname);
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run only on page routes.
  // Excludes /api/* (covers all /api/auth/*), /_next/*, /favicon.ico, /public/*
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico|public).*)" ],
};
