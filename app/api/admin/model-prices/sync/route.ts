import { NextResponse } from "next/server";
import { logApiError, logApiEvent, withApiLogging } from "@/lib/api-logging";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { syncModelsDevPricing } from "../../../../../lib/model-pricing";

export function POST(request: Request) {
  return withApiLogging(request, "api.admin.model-prices.sync", () => handlePOST(request));
}

async function handlePOST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const result = await syncModelsDevPricing();
    logApiEvent(request, "info", "admin.model_prices.sync.completed", {
      providerCount: result.providerCount,
      sourceModelCount: result.sourceModelCount,
      matchedCount: result.matchedCount,
      unmatchedCount: result.unmatchedCount,
      skippedManualCount: result.skippedManualCount,
      changedCount: result.changedCount
    });
    return NextResponse.json(result);
  } catch (error) {
    logApiError(request, "admin.model_prices.sync.failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "同步 models.dev 价格失败" },
      { status: 400 }
    );
  }
}
