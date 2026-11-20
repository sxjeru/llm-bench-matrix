import { withApiLogging } from "@/lib/api-logging";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getArtificialAnalysisAdminSnapshot } from "@/lib/external-providers/artificial-analysis-service";

export function GET(request: Request) {
  return withApiLogging(request, "api.admin.external-import.artificial-analysis.snapshot", () => handleGET(request));
}

async function handleGET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";

  try {
    const snapshot = await getArtificialAnalysisAdminSnapshot({ forceRefresh });
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "拉取 Artificial Analysis 数据失败" },
      { status: 400 }
    );
  }
}
