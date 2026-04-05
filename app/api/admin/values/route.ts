import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { createBenchmarkValue } from "../../../../lib/admin-service";

const schema = z.object({
  modelId: z.number().int().positive(),
  benchmarkId: z.number().int().positive(),
  benchTime: z.string().min(1),
  valueRaw: z.string().min(1),
  source: z.string().optional()
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const benchTime = new Date(parsed.data.benchTime);
  if (Number.isNaN(benchTime.getTime())) {
    return NextResponse.json({ error: "Invalid benchTime" }, { status: 400 });
  }

  const value = await createBenchmarkValue({
    modelId: parsed.data.modelId,
    benchmarkId: parsed.data.benchmarkId,
    benchTime,
    valueRaw: parsed.data.valueRaw,
    source: parsed.data.source
  });

  return NextResponse.json({ value });
}
