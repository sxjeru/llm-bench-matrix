import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-auth";
import { getAdminModelPricingRows, updateModelPricing, updateModelPricingBatch } from "../../../../lib/model-pricing";
import { invalidateAllCaches } from "../../../../lib/db/queries";

/** 批量保存走 { updates: [...] }，单条保存仍是裸对象，两种入参共用同一个 PATCH */
function readBatchUpdates(body: unknown): unknown[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const updates = (body as { updates?: unknown }).updates;
  return Array.isArray(updates) ? updates : null;
}

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
  const batchUpdates = readBatchUpdates(body);

  // updateModelPricing / updateModelPricingBatch 内部已经 bump 过 "pricing"，
  // 这里只补齐 dashboard / admin_entities 的失效和页面重新验证。
  try {
    if (batchUpdates) {
      const { updatedCount } = await updateModelPricingBatch(batchUpdates as Parameters<typeof updateModelPricingBatch>[0]);
      if (updatedCount > 0) {
        await invalidateAllCaches({ skipVersionBump: ["pricing"] });
      }
      return NextResponse.json({ ok: true, updatedCount });
    }

    await updateModelPricing(body);
    await invalidateAllCaches({ skipVersionBump: ["pricing"] });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新模型价格失败" },
      { status: 400 }
    );
  }
}
