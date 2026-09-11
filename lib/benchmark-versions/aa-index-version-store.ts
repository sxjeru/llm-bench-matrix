import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { benchmarks, benchmarkValues, models, settings } from "@/lib/db/schema";
import { saveSetting } from "@/lib/db/queries";
import { buildSourceLookupCandidates } from "@/lib/source-utils";
import { ARTIFICIAL_ANALYSIS_SOURCE_LABEL } from "@/lib/external-providers/artificial-analysis";
import {
  BENCHMARK_VERSIONS_SETTINGS_KEY,
  parseVersionTrackingState,
  syncVersionTrackingEntityChange,
  type AaVersionTrackingState,
  type VersionTrackingEntityChangeEvent
} from "./aa-index-version";
export { BENCHMARK_VERSIONS_SETTINGS_KEY };

function shouldFallbackToDefaultVersionTracking(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const fallbackHints = [
    "ECONNREFUSED",
    "connect ECONNREFUSED",
    "Failed query: select \"value_json\" from \"settings\""
  ];

  return fallbackHints.some((hint) => error.message.includes(hint));
}

export async function getAaVersionTrackingState(): Promise<AaVersionTrackingState> {
  try {
    const [row] = await db
      .select({ valueJson: settings.valueJson })
      .from(settings)
      .where(eq(settings.key, BENCHMARK_VERSIONS_SETTINGS_KEY))
      .limit(1);

    return parseVersionTrackingState(row?.valueJson);
  } catch (error) {
    if (shouldFallbackToDefaultVersionTracking(error)) {
      return { enabled: false, forceNewVersionMetricKeys: [], benchmarks: {} };
    }
    throw error;
  }
}

export async function saveAaVersionTrackingState(state: AaVersionTrackingState): Promise<void> {
  await saveSetting({
    key: BENCHMARK_VERSIONS_SETTINGS_KEY,
    valueJson: state,
    updatedBy: "admin",
    note: "AA Index Version Tracking State"
  });
}

export { syncVersionTrackingEntityChange, type VersionTrackingEntityChangeEvent };

export async function applyAaVersionTrackingEntityChange(
  event: VersionTrackingEntityChangeEvent
): Promise<boolean> {
  try {
    const current = await getAaVersionTrackingState();
    if (!current.enabled || !current.benchmarks || Object.keys(current.benchmarks).length === 0) {
      return false;
    }

  const resolvedEvent = { ...event };
  if (
    resolvedEvent.type === "model-merged" &&
    (!resolvedEvent.sourceName || !resolvedEvent.targetName) &&
    typeof resolvedEvent.sourceId === "number" &&
    typeof resolvedEvent.targetId === "number"
  ) {
    const [sourceModel] = await db
      .select({ modelName: models.modelName })
      .from(models)
      .where(eq(models.id, resolvedEvent.sourceId))
      .limit(1);
    const [targetModel] = await db
      .select({ modelName: models.modelName })
      .from(models)
      .where(eq(models.id, resolvedEvent.targetId))
      .limit(1);

    if (sourceModel?.modelName) {
      resolvedEvent.sourceName = sourceModel.modelName;
    }
    if (targetModel?.modelName) {
      resolvedEvent.targetName = targetModel.modelName;
    }
  }

  if (
    resolvedEvent.type === "benchmark-merged" &&
    (!resolvedEvent.sourceName || !resolvedEvent.targetName) &&
    typeof resolvedEvent.sourceId === "number" &&
    typeof resolvedEvent.targetId === "number"
  ) {
    const [sourceBm] = await db
      .select({ benchmarkName: benchmarks.benchmarkName, benchmarkType: benchmarks.benchmarkType })
      .from(benchmarks)
      .where(eq(benchmarks.id, resolvedEvent.sourceId))
      .limit(1);
    const [targetBm] = await db
      .select({ benchmarkName: benchmarks.benchmarkName, benchmarkType: benchmarks.benchmarkType })
      .from(benchmarks)
      .where(eq(benchmarks.id, resolvedEvent.targetId))
      .limit(1);

    if (sourceBm?.benchmarkName) {
      resolvedEvent.sourceName = sourceBm.benchmarkName;
      resolvedEvent.sourceType = sourceBm.benchmarkType;
    }
    if (targetBm?.benchmarkName) {
      resolvedEvent.targetName = targetBm.benchmarkName;
      resolvedEvent.targetType = targetBm.benchmarkType;
    }
  }

    const { state: next, changed } = syncVersionTrackingEntityChange(current, resolvedEvent);
    if (changed) {
      await saveAaVersionTrackingState(next);
      return true;
    }
    return false;
  } catch (error) {
    if (shouldFallbackToDefaultVersionTracking(error)) {
      return false;
    }
    throw error;
  }
}

export type BaselineScoreTarget = {
  benchmarkName: string;
  benchmarkType: string;
};

/**
 * 读取导入前基线。
 *
 * 必须带齐过滤条件：
 * - isNull(models.mergedIntoModelId)、isNull(benchmarks.mergedIntoBenchmarkId)
 * - eq(benchmarks.benchmarkName, name) 且 eq(benchmarks.benchmarkType, type)
 * - inArray(benchmarkValues.source, buildSourceLookupCandidates(AA_LABEL))
 * - 按 (benchTime desc, id desc) 每个模型取最新一条有效分值
 */
export async function loadAaBaselineScores(
  target: BaselineScoreTarget
): Promise<Map<string, number>> {
  const candidates = buildSourceLookupCandidates(ARTIFICIAL_ANALYSIS_SOURCE_LABEL);

  const rows = await db
    .select({
      modelName: models.modelName,
      valueNum: benchmarkValues.valueNum,
      benchTime: benchmarkValues.benchTime,
      id: benchmarkValues.id
    })
    .from(benchmarkValues)
    .innerJoin(models, eq(benchmarkValues.modelId, models.id))
    .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
    .where(
      and(
        isNull(models.mergedIntoModelId),
        isNull(benchmarks.mergedIntoBenchmarkId),
        eq(benchmarks.benchmarkName, target.benchmarkName),
        eq(benchmarks.benchmarkType, target.benchmarkType),
        inArray(benchmarkValues.source, candidates)
      )
    )
    .orderBy(desc(benchmarkValues.benchTime), desc(benchmarkValues.id));

  const result = new Map<string, number>();
  for (const row of rows) {
    if (row.valueNum !== null && Number.isFinite(row.valueNum) && !result.has(row.modelName)) {
      result.set(row.modelName, Number(row.valueNum));
    }
  }

  return result;
}

/**
 * 统计各被追踪指标当前在库内已隐藏的历史模型数（后台展示用）
 */
export async function countHiddenModels(
  state: AaVersionTrackingState
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  if (!state.enabled || !state.benchmarks) return result;

  const candidates = buildSourceLookupCandidates(ARTIFICIAL_ANALYSIS_SOURCE_LABEL);

  for (const [metricKey, tracked] of Object.entries(state.benchmarks)) {
    const rows = await db
      .select({
        modelName: models.modelName
      })
      .from(benchmarkValues)
      .innerJoin(models, eq(benchmarkValues.modelId, models.id))
      .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
      .where(
        and(
          isNull(models.mergedIntoModelId),
          isNull(benchmarks.mergedIntoBenchmarkId),
          eq(benchmarks.benchmarkName, tracked.benchmarkName),
          eq(benchmarks.benchmarkType, tracked.benchmarkType),
          inArray(benchmarkValues.source, candidates)
        )
      );

    const activeSet = new Set(tracked.activeModelNames);
    const hiddenModels = new Set<string>();
    for (const row of rows) {
      if (!activeSet.has(row.modelName)) {
        hiddenModels.add(row.modelName);
      }
    }
    result[metricKey] = hiddenModels.size;
  }

  return result;
}

