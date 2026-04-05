import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { importParsedRecords } from "../../../../../lib/admin-service";
import { parseWorkbookBuffer } from "../../../../../lib/import/xlsm";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const formData = await request.formData();
  const file = formData.get("file");
  const sheetNameInput = formData.get("sheetName");
  const allowWarningsInput = formData.get("allowWarnings");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const sheetName = typeof sheetNameInput === "string" && sheetNameInput.trim() ? sheetNameInput.trim() : undefined;
  const allowWarnings = allowWarningsInput === "true";

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseWorkbookBuffer(buffer, sheetName);

    if (parsed.warnings.length > 0 && !allowWarnings) {
      return NextResponse.json(
        {
          error: "存在不合规值，请先处理或勾选“忽略警告继续导入”",
          warningCount: parsed.warnings.length,
          warnings: parsed.warnings.slice(0, 200)
        },
        { status: 400 }
      );
    }

    const validRecords = parsed.records.filter((item) => item.valid);
    const result = await importParsedRecords(validRecords, {
      source: `xlsm:${parsed.selectedSheet}`
    });

    return NextResponse.json({
      ...result,
      selectedSheet: parsed.selectedSheet,
      warningCount: parsed.warnings.length,
      warnings: parsed.warnings.slice(0, 200)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to import workbook"
      },
      { status: 400 }
    );
  }
}
