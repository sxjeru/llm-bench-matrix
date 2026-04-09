/**
 * Next.js Proxy – Admin route protection
 *
 * Security model (layered):
 *   1. **Proxy (this file)** – Fast cookie-format check. Rejects requests
 *      without a valid-format session cookie and redirects to login. This is a
 *      UX convenience layer; it does NOT perform database validation.
 *   2. **Server Component** (`app/admin/page.tsx`) – Calls `isAdminAuthorized`
 *      which validates the session token against the database.
 *   3. **API Routes** – Each admin API handler calls `requireAdmin`, which
 *      performs full database-backed session validation.
 *
 * The middleware intentionally does NOT make database calls to avoid adding
 * latency to every admin page navigation. The actual security enforcement
 * happens at layers 2 and 3.
 */

import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, ADMIN_SESSION_MAX_AGE_SECONDS } from "@/lib/admin-constants";

const ADMIN_LOGIN_PATH = "/admin/login";

/**
 * Session tokens are 32-byte random values encoded as 64-character hex strings.
 * Reject cookies that don't match this format to prevent obviously forged tokens
 * from reaching the server component.
 */
const SESSION_TOKEN_FORMAT = /^[0-9a-f]{64}$/;

function hasValidSessionCookieFormat(request: NextRequest): boolean {
  const cookie = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!cookie) return false;
  return SESSION_TOKEN_FORMAT.test(cookie);
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  if (pathname === ADMIN_LOGIN_PATH) {
    return NextResponse.next();
  }

  if (hasValidSessionCookieFormat(request)) {
    const response = NextResponse.next();
    const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;

    if (token) {
      response.cookies.set({
        name: ADMIN_COOKIE_NAME,
        value: token,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: ADMIN_SESSION_MAX_AGE_SECONDS
      });
    }

    return response;
  }

  const loginUrl = new URL(ADMIN_LOGIN_PATH, request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*"]
};
