import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { getSettings, saveSetting } from "../../../../lib/db/queries";

const schema = z.object({
  key: z.string().min(1),
  valueJson: z.unknown(),
  note: z.string().optional(),
  updatedBy: z.string().optional()
});

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const settings = await getSettings();
  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await saveSetting(parsed.data);
  return NextResponse.json({ ok: true });
}
