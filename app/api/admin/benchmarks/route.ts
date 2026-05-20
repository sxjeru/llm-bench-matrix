import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { ensureBenchmark } from "../../../../lib/admin-service";
import { invalidateAllCaches } from "../../../../lib/db/queries";

const schema = z.object({
  benchmarkName: z.string().min(1),
  benchmarkType: z.string().min(1),
  unit: z.string().optional(),
  higherIsBetter: z.boolean().optional(),
  modalities: z.array(z.string()).optional(),
  sourceBenchmarkId: z.string().optional()
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const benchmark = await ensureBenchmark(parsed.data);
  invalidateAllCaches();
  return NextResponse.json({ benchmark });
}
