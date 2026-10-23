import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { previewImportBatch } from "@/lib/import-batch-service";

const previewBatchSchema = z.object({
  batchTime: z.string().min(1, "batchTime 不能为空"),
  source: z.string().nullable().optional(),
  sampleLimit: z.coerce.number().int().min(1).max(2000).optional().default(1000)
});

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const parsed = previewBatchSchema.safeParse({
    batchTime: url.searchParams.get("batchTime"),
    source: url.searchParams.get("source"),
    sampleLimit: url.searchParams.get("sampleLimit") ?? undefined
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const preview = await previewImportBatch({
      batchTime: parsed.data.batchTime,
      source: parsed.data.source,
      sampleLimit: parsed.data.sampleLimit
    });
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取导入批次预览失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

