import { withApiLogging } from "@/lib/api-logging";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { saveArtificialAnalysisConfig } from "@/lib/external-providers/artificial-analysis-service";

export function PATCH(request: Request) {
  return withApiLogging(request, "api.admin.external-import.artificial-analysis.config", () => handlePATCH(request));
}

async function handlePATCH(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const config = (body as { config?: unknown } | null)?.config;

  try {
    const saved = await saveArtificialAnalysisConfig(config);
    return NextResponse.json({ ok: true, config: saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存导入配置失败" },
      { status: 400 }
    );
  }
}
