import { withApiLogging } from "@/lib/api-logging";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { previewBenchmarkTextImport } from "../../../../../lib/admin-service";

const schema = z.object({
  csvText: z.string().min(1),
  htmlText: z.string().optional(),
  source: z.string().optional(),
  checkDuplicates: z.boolean().optional()
});

export function POST(request: Request) {
  return withApiLogging(request, "api.admin.import-csv.preview", () => handlePOST(request));
}

async function handlePOST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const checkDuplicates = parsed.data.checkDuplicates ?? true;
  const result = await previewBenchmarkTextImport(
    parsed.data.csvText,
    parsed.data.source,
    parsed.data.htmlText,
    { checkDuplicates }
  );
  return NextResponse.json(result);
}
