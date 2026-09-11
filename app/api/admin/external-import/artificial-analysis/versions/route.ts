import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { invalidateAllCaches } from "@/lib/db/queries";
import {
  getAaVersionTrackingState,
  saveAaVersionTrackingState
} from "@/lib/benchmark-versions/aa-index-version-store";
import type { TrackedVersionState } from "@/lib/benchmark-versions/aa-index-version";

const patchBodySchema = z.object({
  enabled: z.boolean()
});

const postBodySchema = z.object({
  action: z.enum(["force-new-version", "undo"]),
  metricKey: z.string().trim().min(1)
});

export async function PATCH(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "请求参数格式错误" }, { status: 400 });
  }

  try {
    const state = await getAaVersionTrackingState();
    state.enabled = parsed.data.enabled;
    await saveAaVersionTrackingState(state);
    await invalidateAllCaches();
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新版本追踪开关失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "请求参数格式错误" }, { status: 400 });
  }

  const { action, metricKey } = parsed.data;

  try {
    const state = await getAaVersionTrackingState();

    if (action === "force-new-version") {
      if (!state.forceNewVersionMetricKeys.includes(metricKey)) {
        state.forceNewVersionMetricKeys.push(metricKey);
        await saveAaVersionTrackingState(state);
      }
      return NextResponse.json({ ok: true, state });
    }

    if (action === "undo") {
      const current = state.benchmarks[metricKey];
      if (!current?.previous) {
        return NextResponse.json(
          { error: "该指标没有可撤销的上一版本记录" },
          { status: 400 }
        );
      }

      const restored: TrackedVersionState = {
        ...current.previous,
        previous: null
      };

      state.benchmarks[metricKey] = restored;
      await saveAaVersionTrackingState(state);
      await invalidateAllCaches();
      return NextResponse.json({ ok: true, state });
    }

    return NextResponse.json({ error: "不支持的操作类型" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "执行版本管理操作失败" },
      { status: 500 }
    );
  }
}

