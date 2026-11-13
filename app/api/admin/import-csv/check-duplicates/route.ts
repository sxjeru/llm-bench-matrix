import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { checkTextImportPreviewDuplicates } from "../../../../../lib/admin-service";

const schema = z.object({
  source: z.string().optional(),
  rows: z.array(
    z.object({
      modelName: z.string(),
      benchmarkName: z.string(),
      rawValue: z.string()
    })
  ).max(50000)
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await checkTextImportPreviewDuplicates(parsed.data.rows, parsed.data.source);

  return NextResponse.json({
    checked: result.checked,
    rows: result.rows,
    duplicateCount: result.rows.filter((row) => row.isDuplicate).length,
    warnings: result.warnings
  });
}
