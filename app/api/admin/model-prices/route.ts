import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-auth";
import { getAdminModelPricingRows, updateModelPricing } from "../../../../lib/model-pricing";
import { invalidateAllCaches } from "../../../../lib/db/queries";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const prices = await getAdminModelPricingRows();
  return NextResponse.json({ prices });
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  try {
    await updateModelPricing(body);
    await invalidateAllCaches();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新模型价格失败" },
      { status: 400 }
    );
  }
}
