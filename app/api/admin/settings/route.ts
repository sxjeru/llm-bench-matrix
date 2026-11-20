import { withApiLogging } from "@/lib/api-logging";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { updateAdminSetting } from "@/lib/admin-settings-service";
import { getSettings } from "../../../../lib/db/queries";

const SENSITIVE_SETTING_KEYS = new Set([
  "admin_password_hash",
  "admin_login_guard",
  "admin_sessions"
]);

const schema = z.object({
  key: z.string().min(1),
  valueJson: z.unknown(),
  note: z.string().optional(),
  updatedBy: z.string().optional()
});

export function GET(request: Request) {
  return withApiLogging(request, "api.admin.settings", () => handleGET(request));
}

async function handleGET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const settings = await getSettings();
  const safeSettings = Object.fromEntries(
    Object.entries(settings).filter(([key]) => !SENSITIVE_SETTING_KEYS.has(key))
  );

  return NextResponse.json({ settings: safeSettings });
}

export function POST(request: Request) {
  return withApiLogging(request, "api.admin.settings", () => handlePOST(request));
}

async function handlePOST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    return NextResponse.json(await updateAdminSetting(parsed.data));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存设置失败" }, { status: 400 });
  }
}
