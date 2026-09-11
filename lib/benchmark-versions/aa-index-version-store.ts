import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { benchmarks, benchmarkValues, models, settings } from "@/lib/db/schema";
import { saveSetting } from "@/lib/db/queries";
import { buildSourceLookupCandidates } from "@/lib/source-utils";
import { ARTIFICIAL_ANALYSIS_SOURCE_LABEL } from "@/lib/external-providers/artificial-analysis";
import {
  BENCHMARK_VERSIONS_SETTINGS_KEY,
  parseVersionTrackingState,
  type AaVersionTrackingState
} from "./aa-index-version";

export { BENCHMARK_VERSIONS_SETTINGS_KEY };

export async function getAaVersionTrackingState(): Promise<AaVersionTrackingState> {
  const [row] = await db
    .select({ valueJson: settings.valueJson })
    .from(settings)
    .where(eq(settings.key, BENCHMARK_VERSIONS_SETTINGS_KEY))
    .limit(1);

  return parseVersionTrackingState(row?.valueJson);
}

export async function saveAaVersionTrackingState(state: AaVersionTrackingState): Promise<void> {
  await saveSetting({
    key: BENCHMARK_VERSIONS_SETTINGS_KEY,
    valueJson: state,
    updatedBy: "admin",
    note: "AA Index Version Tracking State"
  });
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

