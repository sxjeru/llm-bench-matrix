import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-auth";
import { detectDuplicateEntityCandidates } from "../../../../lib/admin-service";

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const result = await detectDuplicateEntityCandidates();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "重复检测失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
