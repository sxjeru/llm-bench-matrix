import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createAdminSessionToken,
  checkLoginAllowed,
  getLoginClientKey,
  persistAdminPassword,
  registerLoginFailure,
  resetLoginFailures,
  verifyLoginPassword
} from "../../../../lib/admin-auth";
import { ADMIN_COOKIE_NAME, ADMIN_SESSION_MAX_AGE_SECONDS } from "../../../../lib/admin-constants";

const loginSchema = z.object({
  password: z.string().min(1)
});

export async function POST(request: Request) {
  const clientKey = getLoginClientKey(request);
  const guard = await checkLoginAllowed(clientKey);
  if (!guard.allowed) {
    const message = guard.ipBlocked ? "该 IP 已被锁定，请稍后再试" : "登录失败次数过多，请稍后再试";
    return NextResponse.json(
      {
        error: message,
        ipBlocked: guard.ipBlocked,
        retryAfterSeconds: guard.retryAfterSeconds ?? 0
      },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await verifyLoginPassword(parsed.data.password);
  if (!result.ok) {
    const failure = await registerLoginFailure(clientKey);

    if (failure.ipBlocked) {
      return NextResponse.json(
        {
          error: "该 IP 已被锁定，请稍后再试",
          ipBlocked: true,
          retryAfterSeconds: failure.retryAfterSeconds ?? 0
        },
        { status: 429 }
      );
    }

    if (failure.locked) {
      return NextResponse.json(
        {
          error: "登录失败次数过多，请稍后再试",
          ipBlocked: false,
          retryAfterSeconds: failure.retryAfterSeconds ?? 0
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      {
        error: `Invalid password（剩余尝试 ${failure.remainingAttempts} 次）`
      },
      { status: 401 }
    );
  }

  await resetLoginFailures(clientKey);

  if (result.source === "env" && !result.defaultPasswordInUse) {
    await persistAdminPassword(parsed.data.password, "admin-auto-bootstrap");
  }

  const sessionToken = await createAdminSessionToken();

  const response = NextResponse.json({
    ok: true,
    mustChangePassword: result.mustChangePassword
  });
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: sessionToken,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS
  });

  return response;
}
