import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { importBenchmarkCsv } from "../../../../lib/admin-service";

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

  try {
    const result = await importBenchmarkCsv(parsed.data.csvText, parsed.data.source, parsed.data.htmlText);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "文本导入失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
