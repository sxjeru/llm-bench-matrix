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
 * 排除如 "AA Intelligence Index Cost per Task" 等成本指标，以及 AA-Omniscience 等单项评测 benchmark。
 */
export function isAaMajorIndexBenchmark(
  benchmarkName: string | null | undefined,
  source?: string | null
): boolean {
  if (!benchmarkName) return false;
  const trimmed = benchmarkName.trim();

  // 显式排除 Omniscience 系列等单项评测 benchmark，避免误伤
  if (/omniscience/i.test(trimmed)) {
    return false;
  }

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

export type AaVersionCutoff = {
  version: string | number;
  timestampMs: number;
  benchmarkName?: string;
  note?: string;
};

/** 内置 AA 指标主要版本断代切分点（供历史数据回溯） */
export const DEFAULT_AA_INDEX_VERSION_CUTOFFS: AaVersionCutoff[] = [
  {
    version: "v5",
    timestampMs: new Date("2026-10-28T00:00:00.000Z").getTime(),
    benchmarkName: "AA Intelligence Index",
    note: "Artificial Analysis Intelligence Index v5"
  }
];

/**
 * 从 valueNote 中提取形如 v5, v4.1, Intelligence Index v5 等版本号。
 */
export function extractAaVersionFromNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const trimmed = note.trim();
  const match = trimmed.match(/(?:^|\b)(?:Intelligence\s+Index\s+|Index\s+)?v?([0-9]+(?:\.[0-9]+)*)(?:\b|$)/i);
  return match ? `v${match[1]}` : null;
}

/**
 * 确定一个时间批次所属的评估版本。
 * 优先级：
 * 1. 批次内 entries 自带的 valueNote 版本标注；
 * 2. 匹配外部传入或内置的 versionCutoffs 时间切分点。
 */
export function resolveBatchVersion<T extends { valueNote?: string | null }>(
  batch: RevisionBatch<T>,
  benchmarkName?: string,
  customCutoffs?: readonly AaVersionCutoff[]
): string | null {
  const noteVersionCounts = new Map<string, number>();
  batch.entries.forEach((entry) => {
    const v = extractAaVersionFromNote(entry.valueNote);
    if (v) {
      noteVersionCounts.set(v, (noteVersionCounts.get(v) ?? 0) + 1);
    }
  });

  if (noteVersionCounts.size > 0) {
    let topVersion: string | null = null;
    let maxCount = -1;
    noteVersionCounts.forEach((count, version) => {
      if (count > maxCount) {
        maxCount = count;
        topVersion = version;
      }
    });
    if (topVersion) return topVersion;
  }

  const cutoffs = customCutoffs && customCutoffs.length > 0
    ? customCutoffs
    : DEFAULT_AA_INDEX_VERSION_CUTOFFS;

  const relevant = cutoffs.filter((c) => {
    if (!c.benchmarkName) return true;
    if (!benchmarkName) return true;
    return c.benchmarkName.trim().toLowerCase() === benchmarkName.trim().toLowerCase();
  });

  let matchedCutoff: AaVersionCutoff | null = null;
  for (const c of relevant) {
    if (c.timestampMs <= batch.timestamp + SNAPSHOT_CLUSTER_WINDOW_MS) {
      if (!matchedCutoff || c.timestampMs > matchedCutoff.timestampMs) {
        matchedCutoff = c;
      }
    }
  }

  if (matchedCutoff) {
    const vStr = String(matchedCutoff.version);
    return vStr.startsWith("v") ? vStr : `v${vStr}`;
  }

  return null;
}

export type MajorRevisionGroup<T> = {
  /** 该版本桶的代表时间戳（取该版本内最新时间） */
  timestamp: number;
  /** 是否为主要变动批次开启的组 */
  isMajorRevision: boolean;
  /** 该版本桶的版本标识（如 v5, v4.1 或 null） */
  version: string | null;
  /** 合并进该版本的所有批次 */
  batches: RevisionBatch<T>[];
  /** 该版本内各模型的最新条目映射（若有重复值，取最新时间的一条） */
  entryByModel: Map<string, T>;
};

export type GroupBatchesOptions = {
  benchmarkName?: string;
  versionCutoffs?: readonly AaVersionCutoff[];
};

/**
 * 将时间批次按主要变动自适应分组，小变动自动合并进前一次主要变动。
 *
 * 合并规则：
 * 1. 按时间由旧到新扫描；
 * 2. 外部版本跃迁优先：若批次版本发生变更（如 v4 -> v5），不论数量多少均开启新主要变动桶；
 * 3. 同版本内：模型数 >= adaptiveThreshold 视为主要变动，开启新版本桶；
 * 4. 模型数 < adaptiveThreshold 视为小变动，合并进前一个主要变动桶；
 * 5. 若小变动与主要变动（或之前批次）存在相同模型，后发生的覆盖先发生的（显示最新值）。
 */
export function groupBatchesIntoMajorRevisions<
  T extends { benchTime?: string | null; modelName?: string; recordId?: number | null; valueNote?: string | null }
>(
  batches: readonly RevisionBatch<T>[],
  adaptiveThreshold?: number,
  options?: GroupBatchesOptions
): MajorRevisionGroup<T>[] {
  if (batches.length === 0) return [];

  const counts = batches.map((b) => b.modelCount);
  const threshold =
    adaptiveThreshold !== undefined ? adaptiveThreshold : detectAdaptiveMajorThreshold(counts);

  const groups: MajorRevisionGroup<T>[] = [];

  [...batches].sort((a, b) => a.timestamp - b.timestamp).forEach((batch) => {
    const batchVersion = resolveBatchVersion(batch, options?.benchmarkName, options?.versionCutoffs);
    const lastGroup = groups[groups.length - 1];

    // 检测是否为新版本断代：
    // 1) 当前批次有明确版本 batchVersion
    // 2) 且上一个组存在，但上一个组版本不同
    const isNewVersionCutoff = Boolean(
      batchVersion && lastGroup && lastGroup.version !== batchVersion
    );

    const isMajor = isNewVersionCutoff || batch.modelCount >= threshold;

    if (isMajor || groups.length === 0) {
      groups.push({
        timestamp: batch.timestamp,
        isMajorRevision: isMajor,
        version: batchVersion,
        batches: [batch],
        entryByModel: new Map<string, T>()
      });
    } else {
      // 小变动合并进前一次主要变动桶
      lastGroup.batches.push(batch);
      lastGroup.timestamp = Math.max(lastGroup.timestamp, batch.timestamp);
      if (!lastGroup.version && batchVersion) {
        lastGroup.version = batchVersion;
      }
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
  /** 最新主要变动的版本标识（如 v5） */
  latestVersion?: string | null;
};

/**
 * 汇总一行 AA 复合指数的所有单元格历史记录，计算出最新主要变动版本及模型映射。
 */
export function resolveLatestAaRevisionValues(
  entries: readonly (MatrixCellEntry & { modelName: string })[],
  options?: GroupBatchesOptions
): LatestAaRevisionResolution {
  const batches = clusterEntriesByTime(entries);
  const counts = batches.map((b) => b.modelCount);
  const adaptiveThreshold = detectAdaptiveMajorThreshold(counts);
  const groups = groupBatchesIntoMajorRevisions(batches, adaptiveThreshold, options);

  if (groups.length === 0) {
    return {
      latestEntriesByModel: new Map(),
      batches: [],
      groups: [],
      adaptiveThreshold,
      latestVersion: null
    };
  }

  // 最新一次主要变动即为最后一个 group
  const latestGroup = groups[groups.length - 1]!;

  return {
    latestEntriesByModel: latestGroup.entryByModel,
    batches,
    groups,
    adaptiveThreshold,
    latestVersion: latestGroup.version ?? null
  };
}
