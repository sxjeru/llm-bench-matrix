import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { rebuildBenchmarkCanonicalKeysByRule, rebuildModelCanonicalKeysByRule } from "../../../../lib/admin-service";
import { getSettings, invalidateAllCaches, saveSetting } from "../../../../lib/db/queries";

const SENSITIVE_SETTING_KEYS = new Set([
  "admin_password_hash",
  "admin_login_guard",
  "admin_sessions"
]);

const schema = z.object({
  key: z.string().min(1),
  valueJson: z.unknown(),
  note: z.string().optional(),
  updatedBy: z.string().optional()
});

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const settings = await getSettings();
  const safeSettings = Object.fromEntries(
    Object.entries(settings).filter(([key]) => !SENSITIVE_SETTING_KEYS.has(key))
  );

  return NextResponse.json({ settings: safeSettings });
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await saveSetting(parsed.data);
  invalidateAllCaches();

  if (parsed.data.key === "model_dedupe_rule") {
    const [modelRebuildResult, benchmarkRebuildResult] = await Promise.all([
      rebuildModelCanonicalKeysByRule(parsed.data.valueJson),
      rebuildBenchmarkCanonicalKeysByRule(parsed.data.valueJson)
    ]);

    const rebuildResult = {
      model: modelRebuildResult,
      benchmark: benchmarkRebuildResult,
      mergedCount: modelRebuildResult.mergedCount,
      benchmarkMergedCount: benchmarkRebuildResult.mergedCount
    };

    return NextResponse.json({ ok: true, rebuildResult });
  }

  return NextResponse.json({ ok: true });
}
