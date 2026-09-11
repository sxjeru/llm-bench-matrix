import { z } from "zod";
import { isArtificialAnalysisSource } from "@/lib/source-utils";

export const AA_VERSIONED_METRIC_KEYS = [
  "evaluations.artificial_analysis_intelligence_index",
  "evaluations.artificial_analysis_agentic_index"
] as const;

export type AaVersionedMetricKey = (typeof AA_VERSIONED_METRIC_KEYS)[number];

export const BENCHMARK_VERSIONS_SETTINGS_KEY = "benchmark_versions:artificial-analysis";

export const AA_VERSION_THRESHOLDS = {
  MIN_OVERLAP_COUNT: 8,
  MIN_CHANGED_COUNT: 5,
  MIN_CHANGED_RATIO: 0.3,
  MIN_MEAN_ABS_DELTA: 1.5,
  SCORE_DIFF_THRESHOLD: 2.0
} as const;

export type TrackedVersionStats = {
  overlapCount: number;
  changedCount: number;
  changedRatio: number;
  meanDelta: number;
};

export type TrackedVersionState = {
  benchmarkName: string; // 已应用 metricOverrides 的最终落库名
  benchmarkType: string; // 与 benchmarkName 合成 benchmarks 表唯一键
  versionNumber: number;
  startedAt: string;
  triggerReason: string;
  activeModelNames: string[];
  upstreamIndexVersion?: number | null; // 仅 Intelligence Index，纯展示
  lastStats?: TrackedVersionStats | null;
  previous?: Omit<TrackedVersionState, "previous"> | null; // 供「撤销上次判定」，只留一层
};

export type AaVersionTrackingState = {
  enabled: boolean;
  forceNewVersionMetricKeys: string[]; // 「下次导入强制新版本」的待消费标记
  benchmarks: Record<string /* metricKey */, TrackedVersionState>;
};

export type VersionDecisionType = "initial" | "new_version" | "intra_version";

export type VersionDecision = {
  type: VersionDecisionType;
  reason: string;
  detectedVersionNumber: number;
  activeModelCount: number;
  nextState: TrackedVersionState;
  stats?: TrackedVersionStats | null;
};

// ---------------------------------------------------------------------------
// Zod 验证与解析
// ---------------------------------------------------------------------------

const trackedVersionStatsSchema = z.object({
  overlapCount: z.number(),
  changedCount: z.number(),
  changedRatio: z.number(),
  meanDelta: z.number()
});

const baseTrackedVersionStateSchema = z.object({
  benchmarkName: z.string().min(1),
  benchmarkType: z.string().min(1),
  versionNumber: z.number().int().positive(),
  startedAt: z.string(),
  triggerReason: z.string(),
  activeModelNames: z.array(z.string()),
  upstreamIndexVersion: z.number().nullable().optional(),
  lastStats: trackedVersionStatsSchema.nullable().optional()
});

const trackedVersionStateSchema: z.ZodType<TrackedVersionState> = baseTrackedVersionStateSchema.extend({
  previous: baseTrackedVersionStateSchema.nullable().optional()
});

export const aaVersionTrackingStateSchema = z.object({
  enabled: z.boolean().default(false),
  forceNewVersionMetricKeys: z.array(z.string()).default([]),
  benchmarks: z.record(z.string(), trackedVersionStateSchema).default({})
});

export function parseVersionTrackingState(raw: unknown): AaVersionTrackingState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      enabled: false,
      forceNewVersionMetricKeys: [],
      benchmarks: {}
    };
  }

  const result = aaVersionTrackingStateSchema.safeParse(raw);
  if (!result.success) {
    return {
      enabled: false,
      forceNewVersionMetricKeys: [],
      benchmarks: {}
    };
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// 版本判定逻辑
// ---------------------------------------------------------------------------

export type ModelScoreInput = {
  modelName: string;
  score: number;
};

export type EvaluateVersionChangeInput = {
  benchmarkName: string;
  benchmarkType: string;
  currentState: TrackedVersionState | null;
  incoming: ModelScoreInput[] | Map<string, number> | Record<string, number>;
  baseline: ModelScoreInput[] | Map<string, number> | Record<string, number>;
  forceNewVersion?: boolean;
  thresholds?: Partial<typeof AA_VERSION_THRESHOLDS>;
  upstreamIndexVersion?: number | null;
  startedAt?: string;
};

function normalizeScoreMap(
  input: ModelScoreInput[] | Map<string, number> | Record<string, number>
): Map<string, number> {
  const map = new Map<string, number>();
  if (input instanceof Map) {
    for (const [key, value] of input.entries()) {
      if (typeof key === "string" && typeof value === "number" && Number.isFinite(value)) {
        map.set(key, value);
      }
    }
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (
        item &&
        typeof item.modelName === "string" &&
        typeof item.score === "number" &&
        Number.isFinite(item.score)
      ) {
        map.set(item.modelName, item.score);
      }
    }
  } else if (input && typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        map.set(key, value);
      }
    }
  }
  return map;
}

export function evaluateVersionChange(input: EvaluateVersionChangeInput): VersionDecision {
  const incomingMap = normalizeScoreMap(input.incoming);
  const baselineMap = normalizeScoreMap(input.baseline);

  const incomingModels = Array.from(incomingMap.keys());
  const baselineModels = Array.from(baselineMap.keys());

  const thresholds = {
    ...AA_VERSION_THRESHOLDS,
    ...input.thresholds
  };

  const now = input.startedAt ?? new Date().toISOString();

  // 1. 初始建立版本：不隐藏任何模型，取 baseline ∪ incoming
  if (!input.currentState) {
    const initialActive = Array.from(new Set([...baselineModels, ...incomingModels])).sort();
    const reason = `初始基准版本建立（收录 ${initialActive.length} 个模型）`;

    const nextState: TrackedVersionState = {
      benchmarkName: input.benchmarkName,
      benchmarkType: input.benchmarkType,
      versionNumber: 1,
      startedAt: now,
      triggerReason: reason,
      activeModelNames: initialActive,
      upstreamIndexVersion: input.upstreamIndexVersion ?? null,
      lastStats: null,
      previous: null
    };

    return {
      type: "initial",
      reason,
      detectedVersionNumber: 1,
      activeModelCount: initialActive.length,
      stats: null,
      nextState
    };
  }

  const current = input.currentState;
  const currentActiveSet = new Set(current.activeModelNames);

  // 2. 统计判定：在 overlap = current.activeModelNames ∩ baseline ∩ incoming 上计算
  const overlapModels = incomingModels.filter(
    (modelName) => currentActiveSet.has(modelName) && baselineMap.has(modelName)
  );
  const overlapCount = overlapModels.length;

  let changedCount = 0;
  let sumAbsDelta = 0;

  for (const modelName of overlapModels) {
    const newScore = incomingMap.get(modelName)!;
    const baseScore = baselineMap.get(modelName)!;
    const delta = Math.abs(newScore - baseScore);
    sumAbsDelta += delta;
    if (delta >= thresholds.SCORE_DIFF_THRESHOLD) {
      changedCount += 1;
    }
  }

  const changedRatio = overlapCount > 0 ? changedCount / overlapCount : 0;
  const meanAbsDelta = overlapCount > 0 ? sumAbsDelta / overlapCount : 0;

  const stats: TrackedVersionStats = {
    overlapCount,
    changedCount,
    changedRatio,
    meanDelta: Number(meanAbsDelta.toFixed(2))
  };

  const statisticalShift =
    overlapCount >= thresholds.MIN_OVERLAP_COUNT &&
    changedCount >= thresholds.MIN_CHANGED_COUNT &&
    changedRatio >= thresholds.MIN_CHANGED_RATIO &&
    meanAbsDelta >= thresholds.MIN_MEAN_ABS_DELTA;

  const isNewVersion = Boolean(input.forceNewVersion) || statisticalShift;

  if (isNewVersion) {
    const nextVersionNumber = current.versionNumber + 1;
    const nextActiveModelNames = incomingModels.slice().sort();

    // 快照上一版状态（只保留一层）
    const { previous: _, ...previousSnapshot } = current;

    const triggerReason = input.forceNewVersion
      ? "管理员手动触发新版本"
      : `检测到新版本（${changedCount}/${overlapCount} 模型大幅变动，平均 ${meanAbsDelta.toFixed(1)} 分）`;

    const nextState: TrackedVersionState = {
      benchmarkName: input.benchmarkName,
      benchmarkType: input.benchmarkType,
      versionNumber: nextVersionNumber,
      startedAt: now,
      triggerReason,
      activeModelNames: nextActiveModelNames,
      upstreamIndexVersion: input.upstreamIndexVersion ?? null,
      lastStats: stats,
      previous: previousSnapshot
    };

    return {
      type: "new_version",
      reason: triggerReason,
      detectedVersionNumber: nextVersionNumber,
      activeModelCount: nextActiveModelNames.length,
      stats,
      nextState
    };
  }

  // 同版本增量更新：合并模型集，版本号不变，保留原有 previous 快照
  const mergedActive = Array.from(new Set([...current.activeModelNames, ...incomingModels])).sort();
  const triggerReason =
    overlapCount > 0
      ? `同版本小幅更新（仅 ${changedCount}/${overlapCount} 模型微调，平均变动 ${meanAbsDelta.toFixed(2)} 分）`
      : `同版本增量更新（收录 ${incomingModels.length} 个模型）`;

  const nextState: TrackedVersionState = {
    benchmarkName: input.benchmarkName,
    benchmarkType: input.benchmarkType,
    versionNumber: current.versionNumber,
    startedAt: current.startedAt,
    triggerReason,
    activeModelNames: mergedActive,
    upstreamIndexVersion: input.upstreamIndexVersion ?? current.upstreamIndexVersion ?? null,
    lastStats: stats,
    previous: current.previous ?? null
  };

  return {
    type: "intra_version",
    reason: triggerReason,
    detectedVersionNumber: current.versionNumber,
    activeModelCount: mergedActive.length,
    stats,
    nextState
  };
}

// ---------------------------------------------------------------------------
// 中性化改写
// ---------------------------------------------------------------------------

export function buildOutdatedNote(options: {
  versionNumber: number;
  previousValueRaw: string;
  existingNote?: string | null;
}): string {
  const base = `该模型未参与 AA 当前版本（第 ${options.versionNumber} 版）评测；旧版本得分 ${options.previousValueRaw}，与当前版本不可比，已从表格与排名中移除。`;
  const existing = options.existingNote?.trim();
  if (!existing) {
    return base;
  }
  return `${base}（原备注：${existing}）`;
}

type NeutralizableDashboardRow = {
  benchmarkName: string;
  benchmarkType: string;
  benchmarkTypeOverride?: string | null;
  modelName: string;
  valueRaw: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  source: string | null;
};

function normalizeBenchmarkKey(name: string, type: string): string {
  return `${name.trim().toLowerCase()}::${type.trim().toLowerCase()}`;
}

export function applyOutdatedAaScores<T extends NeutralizableDashboardRow>(
  rows: T[],
  state: AaVersionTrackingState
): { rows: T[]; hiddenModelCount: number } {
  if (!state.enabled || !state.benchmarks || Object.keys(state.benchmarks).length === 0) {
    return { rows, hiddenModelCount: 0 };
  }

  // 预先建立快速匹配查找表
  const trackedMap = new Map<
    string,
    {
      state: TrackedVersionState;
      activeSet: Set<string>;
    }
  >();

  for (const tracked of Object.values(state.benchmarks)) {
    const key = normalizeBenchmarkKey(tracked.benchmarkName, tracked.benchmarkType);
    trackedMap.set(key, {
      state: tracked,
      activeSet: new Set(tracked.activeModelNames)
    });
  }

  const hiddenModels = new Set<string>();

  const processedRows = rows.map((row) => {
    // 来源限定：只中性化 AA 来源的数据行
    if (!isArtificialAnalysisSource(row.source)) {
      return row;
    }

    const effectiveType = (row.benchmarkTypeOverride ?? row.benchmarkType).trim();
    const primaryKey = normalizeBenchmarkKey(row.benchmarkName, effectiveType);
    const fallbackKey = normalizeBenchmarkKey(row.benchmarkName, row.benchmarkType);

    const match = trackedMap.get(primaryKey) ?? trackedMap.get(fallbackKey);
    if (!match) {
      return row;
    }

    // 若该模型参与了当前版本，正常展示
    if (match.activeSet.has(row.modelName)) {
      return row;
    }

    // 该模型未参与当前版本评测：改写为无数值行
    hiddenModels.add(row.modelName);

    return {
      ...row,
      valueNum: null,
      valueNum2: null,
      valueRaw: "",
      valueNote: buildOutdatedNote({
        versionNumber: match.state.versionNumber,
        previousValueRaw: row.valueRaw,
        existingNote: row.valueNote
      })
    };
  });

  return {
    rows: processedRows,
    hiddenModelCount: hiddenModels.size
  };
}

