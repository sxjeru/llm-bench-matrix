import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { deleteBenchmarkAndAllValues } from "../../../../../lib/admin-service";

const schema = z.object({
  benchmarkId: z.number().int().positive()
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
    const result = await deleteBenchmarkAndAllValues(parsed.data.benchmarkId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除 benchmark 失败";
    const status = message.toLowerCase().includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
