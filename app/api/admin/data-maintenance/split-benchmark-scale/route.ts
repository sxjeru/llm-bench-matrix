import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { splitBenchmarkScaleByMode } from "../../../../../lib/admin-service";

const CLIENT_ERROR_MESSAGE_PATTERNS = ["无需拆分", "not found", "不能为空", "不能指向同一实体"];

const schema = z.object({
  benchmarkId: z.number().int().positive(),
  splitMode: z.literal("hundred-vs-elo"),
  baseBenchmarkName: z.string().trim().min(1),
  eloBenchmarkName: z.string().trim().min(1)
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
    const result = await splitBenchmarkScaleByMode(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "benchmark 拆分失败";
    const status = CLIENT_ERROR_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
