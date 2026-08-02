import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { saveArtificialAnalysisMappings } from "@/lib/external-providers/artificial-analysis-service";

export async function PATCH(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const updates = (body as { updates?: unknown } | null)?.updates;

  try {
    const { updatedCount } = await saveArtificialAnalysisMappings(updates);
    return NextResponse.json({ ok: true, updatedCount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存模型匹配关系失败" },
      { status: 400 }
    );
  }
}
