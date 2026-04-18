import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { normalizeBenchmarkScaleByTarget } from "../../../../../lib/admin-service";

const schema = z.object({
  benchmarkId: z.number().int().positive(),
  targetScale: z.union([z.literal(1), z.literal(100)])
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
    const result = await normalizeBenchmarkScaleByTarget(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "量纲同化失败";
    const status = message.includes("无需同化") || message.includes("not found") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
