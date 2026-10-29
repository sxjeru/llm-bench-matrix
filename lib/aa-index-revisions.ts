import { compareMatrixCellEntryRecency, parseTimestampMs } from "@/components/benchmark-matrix/utils";
import {
  compareAaVersions,
  extractAaVersionFromNote,
  normalizeAaVersion
} from "@/lib/aa-index-version";
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

// 版本解析放在 lib/aa-index-version，服务端导入流程也要用，这里保持对外导出不变
export { extractAaVersionFromNote };

/**
 * 合并自定义与内置切分点。
 *
 * 自定义切分点不能覆盖内置兜底：settings 里记录的是「首次观测到该版本的时间」，
 * 可能晚于该版本真实生效的数据批次（如 v5 的历史数据早于首次记录时间）。
 * 合并后由 resolveBatchVersion 取最近一次命中的切分点，既保留人工回溯点，
 * 也保留内置兜底。
 */
function mergeVersionCutoffs(customCutoffs?: readonly AaVersionCutoff[]): AaVersionCutoff[] {
  const merged: AaVersionCutoff[] = [];
  const seen = new Set<string>();

  const push = (cutoff: AaVersionCutoff) => {
    if (!Number.isFinite(cutoff.timestampMs)) return;
    const key = `${String(cutoff.version)}@${cutoff.timestampMs}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(cutoff);
  };

  customCutoffs?.forEach(push);
  DEFAULT_AA_INDEX_VERSION_CUTOFFS.forEach(push);
  return merged;
}

/** 批次版本判定的证据来源 */
export type AaBatchVersionSource = "cutoff" | "note" | null;

export type AaBatchVersionResolution = {
  /** 判定出的批次版本；证据不足时为 null */
  version: string | null;
  source: AaBatchVersionSource;
  /**
   * high：足以据此切分版本代际（时间切分点命中，或注释在批次内占多数）；
   * low：证据不足（如整批只有个别条目带版本注释），只能拒绝判定，不能切代。
   */
  confidence: "high" | "low";
  /** 批次内各版本注释的条目数，无论是否被采纳，便于排查数据问题 */
  noteVersionCounts: Record<string, number>;
};

/**
 * 注释要成为批次身份的「多数证据」，至少覆盖这么多比例的条目。
 *
 * 不能是「见一条就定整批」：81 个模型的批次里混进 1 条被误改的 v5 注释，
 * 整批就会被盖成 v5，进而吞掉后续真实的版本跃迁。
 */
const NOTE_VERSION_MAJORITY_SHARE = 0.5;

/** 匹配最近一次命中的断代切分点；无 benchmark 名时不套用任何切分点 */
function resolveCutoffVersion<T>(
  batch: RevisionBatch<T>,
  benchmarkName?: string,
  customCutoffs?: readonly AaVersionCutoff[]
): string | null {
  // 没有 benchmark 名时无法判断这批切分点是否适用于当前指标。
  // 此前这里直接放行，导致所有指标都套用 AA Intelligence Index 的切分点。
  if (!benchmarkName) return null;

  const cutoffs = mergeVersionCutoffs(customCutoffs);

  const relevant = cutoffs.filter((c) => {
    if (!c.benchmarkName) return true;
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

  if (!matchedCutoff) return null;

  const rawVersion = String(matchedCutoff.version);
  return normalizeAaVersion(rawVersion) ?? (rawVersion.startsWith("v") ? rawVersion : `v${rawVersion}`);
}

/**
 * 确定一个时间批次所属的评估版本，并给出该判定的置信度。
 *
 * 优先级（与行级注释相比，时间切分点是权威证据）：
 * 1. 外部传入或内置的 versionCutoffs 时间切分点；
 * 2. 批次内 entries 自带的 valueNote 版本标注 —— 只有在同一批次内占据多数
 *    （>= 50% 条目）时才被采纳；只有当它比切分点更新时才允许推翻切分点。
 *
 * 两种证据都不足以定性时返回 `version: null` + `confidence: "low"`，
 * 由调用方决定「拒绝切代」，而不是硬给一个可能错误的版本。
 */
export function resolveBatchVersionDetail<T extends { valueNote?: string | null }>(
  batch: RevisionBatch<T>,
  benchmarkName?: string,
  customCutoffs?: readonly AaVersionCutoff[]
): AaBatchVersionResolution {
  const counts = new Map<string, number>();
  batch.entries.forEach((entry) => {
    const v = extractAaVersionFromNote(entry.valueNote);
    if (v) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  });

  const noteVersionCounts: Record<string, number> = {};
  let dominantVersion: string | null = null;
  let dominantCount = 0;
  counts.forEach((count, version) => {
    noteVersionCounts[version] = count;
    if (count > dominantCount) {
      dominantCount = count;
      dominantVersion = version;
    }
  });

  const totalEntries = batch.entries.length;
  const dominantShare = totalEntries > 0 ? dominantCount / totalEntries : 0;
  const hasMajorityNote = Boolean(dominantVersion) && dominantShare >= NOTE_VERSION_MAJORITY_SHARE;

  const cutoffVersion = resolveCutoffVersion(batch, benchmarkName, customCutoffs);

  if (cutoffVersion) {
    // 注释只有在「多数条目一致标注了更新的版本」时才推翻切分点，
    // 用于尚未写入配置的新版本（如 v6 首次出现）。
    if (
      hasMajorityNote
      && dominantVersion
      && (compareAaVersions(dominantVersion, cutoffVersion) ?? 0) > 0
    ) {
      return { version: dominantVersion, source: "note", confidence: "high", noteVersionCounts };
    }
    return { version: cutoffVersion, source: "cutoff", confidence: "high", noteVersionCounts };
  }

  if (hasMajorityNote && dominantVersion) {
    return { version: dominantVersion, source: "note", confidence: "high", noteVersionCounts };
  }

  return { version: null, source: null, confidence: "low", noteVersionCounts };
}

/** 只要版本号，不看置信度；需要判断「能不能据此切代」时用 resolveBatchVersionDetail */
export function resolveBatchVersion<T extends { valueNote?: string | null }>(
  batch: RevisionBatch<T>,
  benchmarkName?: string,
  customCutoffs?: readonly AaVersionCutoff[]
): string | null {
  return resolveBatchVersionDetail(batch, benchmarkName, customCutoffs).version;
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
    const batchResolution = resolveBatchVersionDetail(
      batch,
      options?.benchmarkName,
      options?.versionCutoffs
    );
    const batchVersion = batchResolution.version;
    const lastGroup = groups[groups.length - 1];

    // 检测是否为新版本断代：
    // 1) 当前批次版本有高置信证据（切分点命中，或注释在批次内占多数）
    // 2) 且上一个组存在，但上一个组版本不同
    // 低置信的批次（例如整批只有一条被误改的注释）永远是 null 版本，
    // 既不给自己贴版本，也不允许开启新桶吞掉后续真实跃迁。
    const isNewVersionCutoff = Boolean(
      batchVersion
      && batchResolution.confidence === "high"
      && lastGroup
      && lastGroup.version !== batchVersion
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
      // 小变动合并进前一次主要变动桶。
      // 这里刻意不回填 lastGroup.version：合并进来的批次版本要么与桶一致，
      // 要么不足以定性（null），让低置信度的小批次去改写桶的身份正是 P1-1 的扩散路径。
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
