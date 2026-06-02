import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { getBenchmarkPreviewValueOverlapStats } from "../../../../../lib/admin-service";

const schema = z.object({
  items: z.array(
    z.object({
      previewBenchmarkKey: z.string().min(1).max(500),
      candidateBenchmarkIds: z.array(z.number().int().positive()).max(30),
      cells: z.array(
        z.object({
          modelName: z.string().min(1).max(300),
          rawValue: z.string().min(1).max(500)
        })
      ).max(200)
    })
  ).max(200)
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
    const result = await getBenchmarkPreviewValueOverlapStats(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "benchmark 预览重复率统计失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
