import { withApiLogging } from "@/lib/api-logging";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { deleteImportBatch, listImportBatches } from "@/lib/import-batch-service";

const deleteBatchSchema = z.object({
  batchTime: z.string().min(1, "batchTime 不能为空"),
  source: z.string().nullable().optional(),
  matchAllSources: z.boolean().optional()
});

export function GET(request: Request) {
  return withApiLogging(request, "api.admin.data-maintenance.import-batches", () => handleGET(request));
}

async function handleGET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const limit = typeof parsedLimit === "number" && Number.isFinite(parsedLimit) ? parsedLimit : 50;

  try {
    const batches = await listImportBatches({ limit });
    return NextResponse.json({ ok: true, batches });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取导入批次列表失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export function POST(request: Request) {
  return withApiLogging(request, "api.admin.data-maintenance.import-batches", () => handlePOST(request));
}

async function handlePOST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = deleteBatchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await deleteImportBatch({
      batchTime: parsed.data.batchTime,
      source: parsed.data.source,
      matchAllSources: parsed.data.matchAllSources
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "按导入时间删除批次失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

