import { withApiLogging } from "@/lib/api-logging";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import {
  applyModelParamsSuggestions,
  getAdminModelParamsRows,
  updateModelParams,
  updateModelParamsBatch
} from "../../../../lib/model-params";

const applySchema = z.object({
  modelIds: z.array(z.number().int().positive()).optional()
});

/** 批量保存走 { updates: [...] }，单条保存仍是裸对象，两种入参共用同一个 PATCH */
function readBatchUpdates(body: unknown): unknown[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const updates = (body as { updates?: unknown }).updates;
  return Array.isArray(updates) ? updates : null;
}

export function GET(request: Request) {
  return withApiLogging(request, "api.admin.model-params", () => handleGET(request));
}

async function handleGET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const params = await getAdminModelParamsRows();
  return NextResponse.json({ params });
}

export function PATCH(request: Request) {
  return withApiLogging(request, "api.admin.model-params", () => handlePATCH(request));
}

async function handlePATCH(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const batchUpdates = readBatchUpdates(body);

  try {
    if (batchUpdates) {
      const result = await updateModelParamsBatch(batchUpdates as Parameters<typeof updateModelParamsBatch>[0]);
      return NextResponse.json(result);
    }

    const result = await updateModelParams(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新模型参数量失败" },
      { status: 400 }
    );
  }
}

export function POST(request: Request) {
  return withApiLogging(request, "api.admin.model-params", () => handlePOST(request));
}

async function handlePOST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const parsed = applySchema.safeParse(body ?? {});

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await applyModelParamsSuggestions(parsed.data.modelIds);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "采纳参数量建议失败" },
      { status: 400 }
    );
  }
}
