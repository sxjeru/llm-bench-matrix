import { NextResponse } from "next/server";
import { logApiError, logApiEvent, withApiLogging } from "@/lib/api-logging";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { invalidateAllCaches } from "../../../../../lib/db/queries";
import { rebuildAndPersistPublicDashboardSnapshotRecord } from "../../../../../lib/dashboard-snapshot-store";

export function POST(request: Request) {
  return withApiLogging(request, "api.admin.cache.refresh", () => handlePOST(request));
}

async function handlePOST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    await invalidateAllCaches();
    const snapshot = await rebuildAndPersistPublicDashboardSnapshotRecord();
    logApiEvent(request, "info", "admin.cache.refresh.completed", {
      payloadBytes: snapshot.payloadBr?.byteLength
    });
    return NextResponse.json({
      ok: true,
      message: "缓存已更新"
    });
  } catch (error) {
    logApiError(request, "admin.cache.refresh.failed", error);
    const message = error instanceof Error ? error.message : "更新缓存失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
