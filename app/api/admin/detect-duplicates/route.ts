import { withApiLogging } from "@/lib/api-logging";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-auth";
import { detectDuplicateEntityCandidates } from "../../../../lib/admin-service";

export function POST(request: Request) {
  return withApiLogging(request, "api.admin.detect-duplicates", () => handlePOST(request));
}

async function handlePOST(request: Request) {
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
