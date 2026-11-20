import { withApiLogging } from "@/lib/api-logging";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { ensureBenchmark } from "../../../../lib/admin-service";

const schema = z.object({
  benchmarkName: z.string().min(1),
  benchmarkType: z.string().min(1),
  unit: z.string().optional(),
  higherIsBetter: z.boolean().optional(),
  modalities: z.array(z.string()).optional(),
  sourceBenchmarkId: z.string().optional()
});

export function POST(request: Request) {
  return withApiLogging(request, "api.admin.benchmarks", () => handlePOST(request));
}

async function handlePOST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const benchmark = await ensureBenchmark(parsed.data);
  return NextResponse.json({ benchmark });
}
