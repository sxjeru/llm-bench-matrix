import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { parseWorkbookBuffer } from "../../../../../lib/import/xlsm";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const formData = await request.formData();
  const file = formData.get("file");
  const sheetNameInput = formData.get("sheetName");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const sheetName = typeof sheetNameInput === "string" && sheetNameInput.trim() ? sheetNameInput.trim() : undefined;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseWorkbookBuffer(buffer, sheetName);

    return NextResponse.json({
      sheetNames: parsed.sheetNames,
      selectedSheet: parsed.selectedSheet,
      benchmarkColumn: parsed.benchmarkColumn,
      categoryColumn: parsed.categoryColumn,
      modelColumns: parsed.modelColumns,
      previewRows: parsed.records,
      warnings: parsed.warnings.slice(0, 200),
      warningCount: parsed.warnings.length,
      parsedCount: parsed.records.length
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to parse workbook"
      },
      { status: 400 }
    );
  }
}
