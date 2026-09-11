import { compareMatrixCellEntryRecency, parseTimestampMs } from "@/components/benchmark-matrix/utils";
import { isArtificialAnalysisSource } from "@/lib/source-utils";
import { AA_SUMMARY_INDEX_LABEL_REGEX } from "@/components/model-scatter/constants";
import type { MatrixCellEntry } from "@/components/benchmark-matrix/types";

/** 4 小时批次聚类窗口 */
export const SNAPSHOT_CLUSTER_WINDOW_MS = 4 * 60 * 60 * 1000;

/** AA 三大指数显式白名单 */
export const AA_MAJOR_INDEX_NAMES = new Set([
  "AA Intelligence Index",
  "AA Coding Index",
  "AA Agentic Index",
  "AA Math Index"
]);

/**
 * 判断是否属于 AA 三大指数（或 AA 官方复合指数）。
 * 排除如 "AA Intelligence Index Cost per Task" 等成本指标。
 */
export function isAaMajorIndexBenchmark(
  benchmarkName: string | null | undefined,
  source?: string | null
): boolean {
  if (!benchmarkName) return false;
  const trimmed = benchmarkName.trim();

  if (AA_MAJOR_INDEX_NAMES.has(trimmed)) {
    return true;
  }

  if (AA_SUMMARY_INDEX_LABEL_REGEX.test(trimmed)) {
    return source ? isArtificialAnalysisSource(source) : true;
  }

  return false;
}

export type RevisionBatch<T> = {
  timestamp: number;
  modelNames: Set<string>;
  entries: T[];
  modelCount: number;
};

/**
 * 将散落的指标记录按时间聚类为时间批次（4 小时窗口）。
 * 聚类后按时间由旧到新（升序）排列。
 */
export function clusterEntriesByTime<
  T extends { benchTime?: string | null; modelName?: string }
>(
  entries: readonly T[],
  windowMs = SNAPSHOT_CLUSTER_WINDOW_MS
): RevisionBatch<T>[] {
  type RawItem = {
    timestamp: number;
    modelName: string;
    entry: T;
  };

  const rawItems: RawItem[] = [];

  entries.forEach((entry) => {
    const timeMs = parseTimestampMs(entry.benchTime);
    if (timeMs === null) return;
    const modelName = entry.modelName ?? "";
    rawItems.push({ timestamp: timeMs, modelName, entry });
  });

  if (rawItems.length === 0) return [];

  // 按时间升序排序
  rawItems.sort((a, b) => a.timestamp - b.timestamp);

  const batches: RevisionBatch<T>[] = [];

  rawItems.forEach((item) => {
    const existing = batches.find((batch) => {
      return Math.abs(item.timestamp - batch.timestamp) <= windowMs;
    });

    if (existing) {
      existing.entries.push(item.entry);
      if (item.modelName) existing.modelNames.add(item.modelName);
      existing.timestamp = Math.max(existing.timestamp, item.timestamp);
      existing.modelCount = existing.modelNames.size;
    } else {
      const modelNames = new Set<string>();
      if (item.modelName) modelNames.add(item.modelName);
      batches.push({
        timestamp: item.timestamp,
        modelNames,
        entries: [item.entry],
        modelCount: modelNames.size
      });
    }
  });

  // 按代表时间升序重排
  batches.sort((a, b) => a.timestamp - b.timestamp);
  return batches;
}

/**
 * 自适应计算主要变动的模型数阈值。
 *
 * 算法原理：
 * 1. 若批次只有 0 或 1 个，无需划分；
 * 2. 齐次性检验：若 minCount / maxCount >= 0.6 或 maxCount <= 3，
 *    说明各批次规模相近，不存在局部小补丁，所有批次均视为主要变动（返回 minCount）；
 * 3. 一维方差极小化聚类（Otsu / 1D 2-means）：
 *    遍历有序唯一计数的所有分割点，找到使组内平方差和（WSS）极小化的割点 T；
 * 4. 判定割点是否具备显著区分度（较大组均值 >= 较小组均值 1.5 倍）；
 *    满足则返回割点 (u_k + u_{k+1}) / 2，否则回落到齐次判定。
 *
 * 示例：[111, 130, 120, 20, 110] -> 割点位于 20 与 110 之间，返回 65。20 < 65 被视为小变动。
 */
export function detectAdaptiveMajorThreshold(counts: readonly number[]): number {
  if (counts.length <= 1) {
    return counts[0] ?? 0;
  }

  const validCounts = counts.filter((count) => Number.isFinite(count) && count > 0);
  if (validCounts.length <= 1) {
    return validCounts[0] ?? 0;
  }

  const minCount = Math.min(...validCounts);
  const maxCount = Math.max(...validCounts);

  if (maxCount <= 3 || minCount / maxCount >= 0.6) {
    return minCount;
  }

  const uniqueSorted = Array.from(new Set(validCounts)).sort((a, b) => a - b);
  if (uniqueSorted.length <= 1) {
    return minCount;
  }

  let bestSplitIndex = -1;
  let minWss = Number.POSITIVE_INFINITY;

  for (let i = 0; i < uniqueSorted.length - 1; i += 1) {
    const splitVal = uniqueSorted[i]!;
    const groupLeft = validCounts.filter((c) => c <= splitVal);
    const groupRight = validCounts.filter((c) => c > splitVal);

    if (groupLeft.length === 0 || groupRight.length === 0) continue;

    const meanLeft = groupLeft.reduce((acc, v) => acc + v, 0) / groupLeft.length;
    const meanRight = groupRight.reduce((acc, v) => acc + v, 0) / groupRight.length;

    const wssLeft = groupLeft.reduce((acc, v) => acc + (v - meanLeft) ** 2, 0);
    const wssRight = groupRight.reduce((acc, v) => acc + (v - meanRight) ** 2, 0);
    const totalWss = wssLeft + wssRight;

    if (totalWss < minWss) {
      minWss = totalWss;
      bestSplitIndex = i;
    }
  }

  if (bestSplitIndex >= 0) {
    const leftVal = uniqueSorted[bestSplitIndex]!;
    const rightVal = uniqueSorted[bestSplitIndex + 1]!;
    const threshold = (leftVal + rightVal) / 2;

    const groupLeft = validCounts.filter((c) => c < threshold);
    const groupRight = validCounts.filter((c) => c >= threshold);
    const meanLeft = groupLeft.reduce((acc, v) => acc + v, 0) / (groupLeft.length || 1);
    const meanRight = groupRight.reduce((acc, v) => acc + v, 0) / (groupRight.length || 1);

    // 较大组应显著大于较小组
    if (meanRight >= meanLeft * 1.5) {
      return threshold;
    }
  }

  return minCount;
}

export type MajorRevisionGroup<T> = {
  /** 该版本桶的代表时间戳（取该版本内最新时间） */
  timestamp: number;
  /** 是否为主要变动批次开启的组 */
  isMajorRevision: boolean;
  /** 合并进该版本的所有批次 */
  batches: RevisionBatch<T>[];
  /** 该版本内各模型的最新条目映射（若有重复值，取最新时间的一条） */
  entryByModel: Map<string, T>;
};

/**
 * 将时间批次按主要变动自适应分组，小变动自动合并进前一次主要变动。
 *
 * 合并规则：
 * 1. 按时间由旧到新扫描；
 * 2. 模型数 >= adaptiveThreshold 视为主要变动，开启新版本桶；
 * 3. 模型数 < adaptiveThreshold 视为小变动，合并进前一个主要变动桶；
 * 4. 若小变动与主要变动（或之前批次）存在相同模型，后发生的覆盖先发生的（显示最新值）。
 */
export function groupBatchesIntoMajorRevisions<
  T extends { benchTime?: string | null; modelName?: string; recordId?: number | null }
>(
  batches: readonly RevisionBatch<T>[],
  adaptiveThreshold?: number
): MajorRevisionGroup<T>[] {
  if (batches.length === 0) return [];

  const counts = batches.map((b) => b.modelCount);
  const threshold =
    adaptiveThreshold !== undefined ? adaptiveThreshold : detectAdaptiveMajorThreshold(counts);

  const groups: MajorRevisionGroup<T>[] = [];

  [...batches].sort((a, b) => a.timestamp - b.timestamp).forEach((batch) => {
    const isMajor = batch.modelCount >= threshold;

    if (isMajor || groups.length === 0) {
      groups.push({
        timestamp: batch.timestamp,
        isMajorRevision: isMajor,
        batches: [batch],
        entryByModel: new Map<string, T>()
      });
    } else {
      // 小变动合并进前一次主要变动桶
      const lastGroup = groups[groups.length - 1]!;
      lastGroup.batches.push(batch);
      lastGroup.timestamp = Math.max(lastGroup.timestamp, batch.timestamp);

    }

    const latestGroup = groups[groups.length - 1]!;
    batch.entries.forEach((entry) => {
      const model = entry.modelName;
      if (!model) return;
      const previous = latestGroup.entryByModel.get(model);
      // 同一时间的记录按 ID 取新值，不依赖接口返回顺序或批次内的遍历顺序。
      if (!previous || compareMatrixCellEntryRecency(entry, previous) > 0) {
        latestGroup.entryByModel.set(model, entry);
      }
    });
  });

  return groups;
}
export type LatestAaRevisionResolution = {
  /** 最新主要变动（及合并其后续小变动后）的模型与最新记录映射 */
  latestEntriesByModel: Map<string, MatrixCellEntry>;
  /** 识别出的所有批次（升序） */
  batches: RevisionBatch<MatrixCellEntry & { modelName: string }>[];
  /** 该指标检测到的所有主要变动组（按时间升序） */
  groups: MajorRevisionGroup<MatrixCellEntry & { modelName: string }>[];
  /** 自适应主要变动阈值 */
  adaptiveThreshold: number;
};

/**
 * 汇总一行 AA 复合指数的所有单元格历史记录，计算出最新主要变动版本及模型映射。
 */
export function resolveLatestAaRevisionValues(
  entries: readonly (MatrixCellEntry & { modelName: string })[]
): LatestAaRevisionResolution {
  const batches = clusterEntriesByTime(entries);
  const counts = batches.map((b) => b.modelCount);
  const adaptiveThreshold = detectAdaptiveMajorThreshold(counts);
  const groups = groupBatchesIntoMajorRevisions(batches, adaptiveThreshold);

  if (groups.length === 0) {
    return {
      latestEntriesByModel: new Map(),
      batches: [],
      groups: [],
      adaptiveThreshold
    };
  }

  // 最新一次主要变动即为最后一个 group
  const latestGroup = groups[groups.length - 1]!;

  return {
    latestEntriesByModel: latestGroup.entryByModel,
    batches,
    groups,
    adaptiveThreshold
  };
}
