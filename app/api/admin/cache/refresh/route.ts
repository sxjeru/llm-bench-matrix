import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { invalidateAllCaches } from "../../../../../lib/db/queries";

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    await invalidateAllCaches();
    return NextResponse.json({
      ok: true,
      message: "缓存已更新"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新缓存失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
