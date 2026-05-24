import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { getBenchmarkValueOverlapStats } from "../../../../../lib/admin-service";

const schema = z.object({
  sourceId: z.coerce.number().int().positive(),
  targetId: z.coerce.number().int().positive()
});

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const parsed = schema.safeParse({
    sourceId: searchParams.get("sourceId"),
    targetId: searchParams.get("targetId")
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.sourceId === parsed.data.targetId) {
    return NextResponse.json({ error: "sourceId and targetId cannot be the same" }, { status: 400 });
  }

  try {
    const result = await getBenchmarkValueOverlapStats(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "benchmark 值重合统计失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
