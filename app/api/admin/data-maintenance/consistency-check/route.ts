import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { detectBenchmarkScaleConsistencyIssues } from "../../../../../lib/admin-service";

export async function POST(request: Request) {
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
