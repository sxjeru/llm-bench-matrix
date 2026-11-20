import { withApiLogging } from "@/lib/api-logging";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { detectBenchmarkScaleConsistencyIssues } from "../../../../../lib/admin-service";

export function POST(request: Request) {
  return withApiLogging(request, "api.admin.data-maintenance.consistency-check", () => handlePOST(request));
}

async function handlePOST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const result = await detectBenchmarkScaleConsistencyIssues();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "数据一致性检测失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
