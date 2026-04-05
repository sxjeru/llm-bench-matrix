import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { mergeEntity } from "../../../../lib/admin-service";

const schema = z.object({
  entityType: z.enum(["model", "benchmark"]),
  sourceId: z.number().int().positive(),
  targetId: z.number().int().positive()
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await mergeEntity(parsed.data);
  return NextResponse.json({ ok: true });
}
