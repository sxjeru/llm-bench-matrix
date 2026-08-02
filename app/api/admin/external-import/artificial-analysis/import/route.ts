import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { invalidateAllCaches } from "@/lib/db/queries";
import { runArtificialAnalysisImport } from "@/lib/external-providers/artificial-analysis-service";

const schema = z.object({
  dryRun: z.boolean().optional(),
  createExternalModelIds: z.array(z.string().trim().min(1)).max(1000).optional()
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await runArtificialAnalysisImport(parsed.data);
    // 真正落库的那次，importExternalBenchmarkRows 内部已经失效过一轮缓存，
    // 这里补一次是为了把 lastImportedAt 的 settings 写入也带上。
    if (!result.dryRun) {
      await invalidateAllCaches();
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导入 Artificial Analysis 数据失败" },
      { status: 400 }
    );
  }
}
