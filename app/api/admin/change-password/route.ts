import { NextResponse } from "next/server";
import { z } from "zod";
import { persistAdminPassword, requireAdmin, verifyLoginPassword } from "../../../../lib/admin-auth";
import { ADMIN_COOKIE_NAME, ADMIN_SESSION_MAX_AGE_SECONDS } from "../../../../lib/admin-constants";

const schema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.oldPassword === parsed.data.newPassword) {
    return NextResponse.json({ error: "新密码不能与旧密码相同" }, { status: 400 });
  }

  const verify = await verifyLoginPassword(parsed.data.oldPassword);
  if (!verify.ok) {
    return NextResponse.json({ error: "旧密码错误" }, { status: 401 });
  }

  const newHash = await persistAdminPassword(parsed.data.newPassword, "admin");

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: newHash,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS
  });

  return response;
}
