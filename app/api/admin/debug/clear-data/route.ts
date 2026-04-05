import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { clearNonSettingsData } from "../../../../../lib/admin-service";

const schema = z.object({
  confirm: z.literal("CLEAR_NON_SETTINGS_DATA")
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await clearNonSettingsData();
  return NextResponse.json({
    ok: true,
    message: "已清空除 settings 外的所有表"
  });
}
