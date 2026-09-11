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
  benchmarkId?: number | null; // 数据库自增 ID，辅助重命名/合并后跨版本精确定位
  versionNumber: number;
  startedAt: string;
  triggerReason: string;
  activeModelNames: string[];
  activeModelIds?: number[]; // 数据库自增 ID 列表，辅助模型改名后精确定位
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
  benchmarkId: z.number().int().positive().nullable().optional(),
  versionNumber: z.number().int().positive(),
  startedAt: z.string(),
  triggerReason: z.string(),
  activeModelNames: z.array(z.string()),
  activeModelIds: z.array(z.number().int().positive()).optional(),
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
  modelId?: number;
};

export type EvaluateVersionChangeInput = {
  benchmarkName: string;
  benchmarkType: string;
  benchmarkId?: number | null;
  currentState: TrackedVersionState | null;
  incoming: ModelScoreInput[] | Map<string, number> | Record<string, number>;
  baseline: ModelScoreInput[] | Map<string, number> | Record<string, number>;
  forceNewVersion?: boolean;
  thresholds?: Partial<typeof AA_VERSION_THRESHOLDS>;
  upstreamIndexVersion?: number | null;
  startedAt?: string;
};

function extractModelIds(input: ModelScoreInput[] | Map<string, number> | Record<string, number>): number[] {
  if (Array.isArray(input)) {
    return input
      .map((item) => item.modelId)
      .filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0);
  }
  return [];
}

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

  const incomingModelIds = extractModelIds(input.incoming);
  const baselineModelIds = extractModelIds(input.baseline);

  const thresholds = {
    ...AA_VERSION_THRESHOLDS,
    ...input.thresholds
  };

  const now = input.startedAt ?? new Date().toISOString();

  // 1. 初始建立版本：不隐藏任何模型，取 baseline ∪ incoming
  if (!input.currentState) {
    const initialActive = Array.from(new Set([...baselineModels, ...incomingModels])).sort();
    const initialActiveIds = Array.from(new Set([...baselineModelIds, ...incomingModelIds])).sort((a, b) => a - b);
    const reason = `初始基准版本建立（收录 ${initialActive.length} 个模型）`;

    const nextState: TrackedVersionState = {
      benchmarkName: input.benchmarkName,
      benchmarkType: input.benchmarkType,
      benchmarkId: input.benchmarkId ?? null,
      versionNumber: 1,
      startedAt: now,
      triggerReason: reason,
      activeModelNames: initialActive,
      activeModelIds: initialActiveIds.length > 0 ? initialActiveIds : undefined,
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
    const nextActiveModelIds = Array.from(new Set(incomingModelIds)).sort((a, b) => a - b);

    // 快照上一版状态（只保留一层）
    const { previous: _, ...previousSnapshot } = current;

    const triggerReason = input.forceNewVersion
      ? "管理员手动触发新版本"
      : `检测到新版本（${changedCount}/${overlapCount} 模型大幅变动，平均 ${meanAbsDelta.toFixed(1)} 分）`;

    const nextState: TrackedVersionState = {
      benchmarkName: input.benchmarkName,
      benchmarkType: input.benchmarkType,
      benchmarkId: input.benchmarkId ?? current.benchmarkId ?? null,
      versionNumber: nextVersionNumber,
      startedAt: now,
      triggerReason,
      activeModelNames: nextActiveModelNames,
      activeModelIds: nextActiveModelIds.length > 0 ? nextActiveModelIds : (current.activeModelIds ? [] : undefined),
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
  const currentActiveIds = current.activeModelIds ?? [];
  const mergedActiveIds = Array.from(new Set([...currentActiveIds, ...incomingModelIds])).sort((a, b) => a - b);
  const triggerReason =
    overlapCount > 0
      ? `同版本小幅更新（仅 ${changedCount}/${overlapCount} 模型微调，平均变动 ${meanAbsDelta.toFixed(2)} 分）`
      : `同版本增量更新（收录 ${incomingModels.length} 个模型）`;

  const nextState: TrackedVersionState = {
    benchmarkName: input.benchmarkName,
    benchmarkType: input.benchmarkType,
    benchmarkId: input.benchmarkId ?? current.benchmarkId ?? null,
    versionNumber: current.versionNumber,
    startedAt: current.startedAt,
    triggerReason,
    activeModelNames: mergedActive,
    activeModelIds: mergedActiveIds.length > 0 ? mergedActiveIds : (current.activeModelIds ? current.activeModelIds : undefined),
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
  modelId?: number;
  modelName: string;
  benchmarkId?: number;
  benchmarkName: string;
  benchmarkType: string;
  sourceBenchmarkType?: string | null;
  benchmarkTypeOverride?: string | null;
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

  // 预先建立快速匹配查找表（支持 ID 匹配与 Key 匹配）
  const trackedMap = new Map<
    string,
    {
      state: TrackedVersionState;
      activeNameSet: Set<string>;
      activeIdSet: Set<number> | null;
    }
  >();
  const trackedByIdMap = new Map<
    number,
    {
      state: TrackedVersionState;
      activeNameSet: Set<string>;
      activeIdSet: Set<number> | null;
    }
  >();

  for (const tracked of Object.values(state.benchmarks)) {
    const key = normalizeBenchmarkKey(tracked.benchmarkName, tracked.benchmarkType);
    const entry = {
      state: tracked,
      activeNameSet: new Set(tracked.activeModelNames),
      activeIdSet:
        tracked.activeModelIds && tracked.activeModelIds.length > 0
          ? new Set(tracked.activeModelIds)
          : null
    };
    trackedMap.set(key, entry);
    if (typeof tracked.benchmarkId === "number" && tracked.benchmarkId > 0) {
      trackedByIdMap.set(tracked.benchmarkId, entry);
    }
  }

  const hiddenModels = new Set<string>();

  const processedRows = rows.map((row) => {
    // 来源限定：只中性化 AA 来源的数据行
    if (!isArtificialAnalysisSource(row.source)) {
      return row;
    }

    const effectiveType = (
      row.sourceBenchmarkType ??
      row.benchmarkTypeOverride ??
      row.benchmarkType
    ).trim();
    const primaryKey = normalizeBenchmarkKey(row.benchmarkName, effectiveType);
    const fallbackKey = normalizeBenchmarkKey(row.benchmarkName, row.benchmarkType);

    const match =
      (typeof row.benchmarkId === "number" ? trackedByIdMap.get(row.benchmarkId) : undefined) ??
      trackedMap.get(primaryKey) ??
      trackedMap.get(fallbackKey);
    if (!match) {
      return row;
    }

    // 若该模型参与了当前版本，正常展示
    // 优先通过 modelId 判定；当且仅当行未提供 modelId 或追踪未记录 activeModelIds 时，才回退到 modelName 判定（防借壳）
    const isActive =
      match.activeIdSet && typeof row.modelId === "number"
        ? match.activeIdSet.has(row.modelId)
        : match.activeNameSet.has(row.modelName);

    if (isActive) {
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

// ---------------------------------------------------------------------------
// 实体重命名与合并级联更新（纯函数，无 DB 依赖）
// ---------------------------------------------------------------------------

export type VersionTrackingEntityChangeEvent =
  | {
      type: "model-renamed";
      modelId?: number;
      previousName: string;
      nextName: string;
    }
  | {
      type: "model-merged";
      sourceId?: number;
      sourceName?: string;
      targetId?: number;
      targetName?: string;
    }
  | {
      type: "benchmark-renamed";
      benchmarkId?: number;
      previousName: string;
      previousType?: string;
      nextName: string;
      nextType?: string;
    }
  | {
      type: "benchmark-merged";
      sourceId?: number;
      sourceName?: string;
      sourceType?: string;
      targetId?: number;
      targetName?: string;
      targetType?: string;
    };

function replaceStringInList(list: string[], target: string, replacement: string): { list: string[]; changed: boolean } {
  const targetLower = target.trim().toLowerCase();
  const index = list.findIndex((item) => item.trim().toLowerCase() === targetLower);
  if (index === -1) {
    return { list, changed: false };
  }
  const nextSet = new Set(list);
  nextSet.delete(list[index]);
  nextSet.add(replacement.trim());
  return {
    list: Array.from(nextSet).sort(),
    changed: true
  };
}

function replaceIdInList(list: number[], targetId: number, replacementId: number): { list: number[]; changed: boolean } {
  if (!list.includes(targetId)) {
    return { list, changed: false };
  }
  const nextSet = new Set(list);
  nextSet.delete(targetId);
  nextSet.add(replacementId);
  return {
    list: Array.from(nextSet).sort((a, b) => a - b),
    changed: true
  };
}

export function syncVersionTrackingEntityChange(
  state: AaVersionTrackingState,
  event: VersionTrackingEntityChangeEvent
): { state: AaVersionTrackingState; changed: boolean } {
  if (!state.benchmarks || Object.keys(state.benchmarks).length === 0) {
    return { state, changed: false };
  }

  let stateChanged = false;
  const nextBenchmarks: Record<string, (typeof state.benchmarks)[string]> = {};

  for (const [metricKey, tracked] of Object.entries(state.benchmarks)) {
    let trackedChanged = false;
    let nextTracked = { ...tracked };

    if (event.type === "model-renamed") {
      const { list: nextActive, changed } = replaceStringInList(
        nextTracked.activeModelNames,
        event.previousName,
        event.nextName
      );
      if (changed) {
        nextTracked.activeModelNames = nextActive;
        trackedChanged = true;
      }

      if (nextTracked.previous) {
        const { list: nextPrevActive, changed: prevChanged } = replaceStringInList(
          nextTracked.previous.activeModelNames,
          event.previousName,
          event.nextName
        );
        if (prevChanged) {
          nextTracked = {
            ...nextTracked,
            previous: {
              ...nextTracked.previous,
              activeModelNames: nextPrevActive
            }
          };
          trackedChanged = true;
        }
      }
    } else if (event.type === "model-merged") {
      if (event.sourceName && event.targetName) {
        const { list: nextActive, changed } = replaceStringInList(
          nextTracked.activeModelNames,
          event.sourceName,
          event.targetName
        );
        if (changed) {
          nextTracked.activeModelNames = nextActive;
          trackedChanged = true;
        }
      }

      if (
        typeof event.sourceId === "number" &&
        typeof event.targetId === "number" &&
        nextTracked.activeModelIds
      ) {
        const { list: nextActiveIds, changed: idChanged } = replaceIdInList(
          nextTracked.activeModelIds,
          event.sourceId,
          event.targetId
        );
        if (idChanged) {
          nextTracked.activeModelIds = nextActiveIds;
          trackedChanged = true;
        }
      }

      if (nextTracked.previous) {
        let nextPrevActive = nextTracked.previous.activeModelNames;
        let prevChanged = false;
        if (event.sourceName && event.targetName) {
          const res = replaceStringInList(
            nextTracked.previous.activeModelNames,
            event.sourceName,
            event.targetName
          );
          nextPrevActive = res.list;
          prevChanged = res.changed;
        }

        let nextPrevActiveIds = nextTracked.previous.activeModelIds;
        let prevIdChanged = false;

        if (
          typeof event.sourceId === "number" &&
          typeof event.targetId === "number" &&
          nextPrevActiveIds
        ) {
          const res = replaceIdInList(nextPrevActiveIds, event.sourceId, event.targetId);
          nextPrevActiveIds = res.list;
          prevIdChanged = res.changed;
        }

        if (prevChanged || prevIdChanged) {
          nextTracked = {
            ...nextTracked,
            previous: {
              ...nextTracked.previous,
              activeModelNames: nextPrevActive,
              activeModelIds: nextPrevActiveIds
            }
          };
          trackedChanged = true;
        }
      }
    } else if (event.type === "benchmark-renamed") {
      const isMatch =
        (typeof event.benchmarkId === "number" && nextTracked.benchmarkId === event.benchmarkId) ||
        (nextTracked.benchmarkName.trim().toLowerCase() === event.previousName.trim().toLowerCase() &&
          (!event.previousType ||
            nextTracked.benchmarkType.trim().toLowerCase() === event.previousType.trim().toLowerCase()));

      if (isMatch) {
        nextTracked.benchmarkName = event.nextName.trim();
        if (event.nextType?.trim()) {
          nextTracked.benchmarkType = event.nextType.trim();
        }
        if (typeof event.benchmarkId === "number") {
          nextTracked.benchmarkId = event.benchmarkId;
        }
        trackedChanged = true;
      }

      if (nextTracked.previous) {
        const prevMatch =
          (typeof event.benchmarkId === "number" && nextTracked.previous.benchmarkId === event.benchmarkId) ||
          (nextTracked.previous.benchmarkName.trim().toLowerCase() === event.previousName.trim().toLowerCase() &&
            (!event.previousType ||
              nextTracked.previous.benchmarkType.trim().toLowerCase() === event.previousType.trim().toLowerCase()));

        if (prevMatch) {
          nextTracked = {
            ...nextTracked,
            previous: {
              ...nextTracked.previous,
              benchmarkName: event.nextName.trim(),
              benchmarkType: event.nextType?.trim() ?? nextTracked.previous.benchmarkType,
              benchmarkId: typeof event.benchmarkId === "number" ? event.benchmarkId : nextTracked.previous.benchmarkId
            }
          };
          trackedChanged = true;
        }
      }
    } else if (event.type === "benchmark-merged") {
      const isMatch =
        (typeof event.sourceId === "number" && nextTracked.benchmarkId === event.sourceId) ||
        (Boolean(event.sourceName) &&
          nextTracked.benchmarkName.trim().toLowerCase() === event.sourceName!.trim().toLowerCase() &&
          (!event.sourceType ||
            nextTracked.benchmarkType.trim().toLowerCase() === event.sourceType.trim().toLowerCase()));

      if (isMatch) {
        if (event.targetName?.trim()) {
          nextTracked.benchmarkName = event.targetName.trim();
        }
        if (event.targetType?.trim()) {
          nextTracked.benchmarkType = event.targetType.trim();
        }
        if (typeof event.targetId === "number") {
          nextTracked.benchmarkId = event.targetId;
        }
        trackedChanged = true;
      }

      if (nextTracked.previous) {
        const prevMatch =
          (typeof event.sourceId === "number" && nextTracked.previous.benchmarkId === event.sourceId) ||
          (Boolean(event.sourceName) &&
            nextTracked.previous.benchmarkName.trim().toLowerCase() === event.sourceName!.trim().toLowerCase() &&
            (!event.sourceType ||
              nextTracked.previous.benchmarkType.trim().toLowerCase() === event.sourceType.trim().toLowerCase()));

        if (prevMatch) {
          nextTracked = {
            ...nextTracked,
            previous: {
              ...nextTracked.previous,
              benchmarkName: event.targetName?.trim() ?? nextTracked.previous.benchmarkName,
              benchmarkType: event.targetType?.trim() ?? nextTracked.previous.benchmarkType,
              benchmarkId: typeof event.targetId === "number" ? event.targetId : nextTracked.previous.benchmarkId
            }
          };
          trackedChanged = true;
        }
      }
    }

    if (trackedChanged) {
      stateChanged = true;
    }
    nextBenchmarks[metricKey] = nextTracked;
  }

  return {
    state: stateChanged ? { ...state, benchmarks: nextBenchmarks } : state,
    changed: stateChanged
  };
}

