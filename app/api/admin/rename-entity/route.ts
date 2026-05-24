import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { renameEntity } from "../../../../lib/admin-service";

const schema = z.object({
  entityType: z.enum(["model", "benchmark"]),
  entityId: z.number().int().positive(),
  nextName: z.string().trim().min(1),
  nextProviderId: z.number().int().positive().optional(),
  nextBenchmarkType: z.string().trim().min(1).optional(),
  mergeOnConflict: z.boolean().optional()
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await renameEntity(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "重命名失败";
    const lowerMessage = message.toLowerCase();
    const status = lowerMessage.includes("not found")
      ? 404
      : lowerMessage.includes("conflict")
        ? 409
        : 400;

    return NextResponse.json({ error: message }, { status });
  }
}
