import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { invalidateAllCaches } from "../../../../../lib/db/queries";
import { syncModelsDevPricing } from "../../../../../lib/model-pricing";

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const result = await syncModelsDevPricing();
    invalidateAllCaches();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "同步 models.dev 价格失败" },
      { status: 400 }
    );
  }
}
