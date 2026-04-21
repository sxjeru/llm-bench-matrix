import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { previewBenchmarkTextImport } from "../../../../../lib/admin-service";

const schema = z.object({
  csvText: z.string().min(1),
  htmlText: z.string().optional(),
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

  const result = await previewBenchmarkTextImport(parsed.data.csvText, parsed.data.source, parsed.data.htmlText);
  return NextResponse.json(result);
}
