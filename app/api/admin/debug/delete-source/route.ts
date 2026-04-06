import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { deleteBenchmarkValuesBySource } from "../../../../../lib/admin-service";

const schema = z.object({
  source: z.string().optional().default("")
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await deleteBenchmarkValuesBySource(parsed.data.source);
  return NextResponse.json(result);
}
