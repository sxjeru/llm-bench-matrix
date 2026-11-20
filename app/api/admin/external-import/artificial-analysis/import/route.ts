import { NextResponse } from "next/server";
import { logApiError, logApiEvent, withApiLogging } from "@/lib/api-logging";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { runArtificialAnalysisImport } from "@/lib/external-providers/artificial-analysis-service";

const schema = z.object({
  dryRun: z.boolean().optional(),
  createExternalModelIds: z.array(z.string().trim().min(1)).max(1000).optional()
});

export function POST(request: Request) {
  return withApiLogging(request, "api.admin.external-import.artificial-analysis.import", () => handlePOST(request));
}

async function handlePOST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await runArtificialAnalysisImport(parsed.data);
    logApiEvent(request, "info", "admin.import.artificial_analysis.completed", {
      recordCount: result.inserted,
      changedModelCount: result.createdModels.length,
      sourceModelCount: result.metricCount,
      matchedCount: result.matchedModelCount,
      skippedCount: result.skipped,
      dryRun: result.dryRun
    });
    return NextResponse.json(result);
  } catch (error) {
    logApiError(request, "admin.import.artificial_analysis.failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导入 Artificial Analysis 数据失败" },
      { status: 400 }
    );
  }
}
