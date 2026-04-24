import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { importBenchmarkCsv, importStructuredRows } from "../../../../lib/admin-service";

const schema = z.object({
  csvText: z.string().min(1).optional(),
  htmlText: z.string().optional(),
  source: z.string().optional(),
  rows: z.array(z.object({
    rowNumber: z.number().int().positive().optional(),
    providerName: z.string().optional(),
    modelName: z.string().min(1),
    benchmarkName: z.string().min(1),
    benchmarkType: z.string().optional(),
    benchmarkTypeProvided: z.boolean().optional(),
    higherIsBetter: z.boolean().optional(),
    modalities: z.array(z.string()).optional(),
    rawValue: z.string().min(1),
    valueNote: z.string().nullable().optional(),
    source: z.string().nullable().optional()
  })).optional()
}).refine((data) => Boolean(data.csvText?.trim()) || Boolean(data.rows?.length), {
  message: "csvText 或 rows 至少提供一种"
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
    const result = parsed.data.rows?.length
      ? await importStructuredRows(parsed.data.rows, { source: parsed.data.source })
      : await importBenchmarkCsv(parsed.data.csvText ?? "", parsed.data.source, parsed.data.htmlText);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "文本导入失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
