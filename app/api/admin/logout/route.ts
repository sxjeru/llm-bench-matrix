import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-constants";
import { invalidateAdminSessionToken } from "@/lib/admin-auth";

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce<Record<string, string>>((acc, pair) => {
    const [rawKey, ...rawValue] = pair.trim().split("=");
    if (!rawKey) return acc;

    const joined = rawValue.join("=");
    try {
      acc[rawKey] = decodeURIComponent(joined);
    } catch {
      acc[rawKey] = joined;
    }
    return acc;
  }, {});
}

export async function POST(request: Request) {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const sessionToken = cookies[ADMIN_COOKIE_NAME];
  await invalidateAdminSessionToken(sessionToken);

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
  return response;
}
