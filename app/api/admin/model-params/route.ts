import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { applyModelParamsSuggestions, getAdminModelParamsRows, updateModelParams } from "../../../../lib/model-params";
import { invalidateAllCaches } from "../../../../lib/db/queries";

const applySchema = z.object({
  modelIds: z.array(z.number().int().positive()).optional()
});

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const params = await getAdminModelParamsRows();
  return NextResponse.json({ params });
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  try {
    const result = await updateModelParams(body);
    await invalidateAllCaches();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新模型参数量失败" },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const parsed = applySchema.safeParse(body ?? {});

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await applyModelParamsSuggestions(parsed.data.modelIds);
    await invalidateAllCaches();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "采纳参数量建议失败" },
      { status: 400 }
    );
  }
}
