import { compareMatrixCellEntryRecency, parseTimestampMs } from "@/components/benchmark-matrix/utils";
import {
  clusterEntriesByTime,
  detectAdaptiveMajorThreshold,
  groupBatchesIntoMajorRevisions,
  type LatestAaRevisionResolution,
  type MajorRevisionGroup,
  type RevisionBatch
} from "@/lib/aa-index-revisions";
import type {
  ScatterHistorySample,
  ScatterMetricSnapshot
} from "./types";

/** 属于同一快照批次的最大允许时间差（4 小时） */
const SNAPSHOT_CLUSTER_WINDOW_MS = 4 * 60 * 60 * 1000;

/** 格式化日期为 YYYY-MM-DD */
export function formatSnapshotDateLabel(timestampMs: number): string {
  if (!Number.isFinite(timestampMs)) return "未知时间";
  const date = new Date(timestampMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 格式化日期为 YYYY-MM-DD HH:mm（供同一天多次导入区分） */
export function formatSnapshotDateTimeLabel(timestampMs: number): string {
  if (!Number.isFinite(timestampMs)) return "未知时间";
  const date = new Date(timestampMs);
  const datePart = formatSnapshotDateLabel(timestampMs);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${datePart} ${hours}:${minutes}`;
}

type SnapshotRevisionEntry = {
  modelName?: string;
  value?: number | null;
  valueNum?: number | null;
  benchTime?: string | null;
  recordId?: number | null;
};

function toScatterSample(entry: SnapshotRevisionEntry): ScatterHistorySample | null {
  const value = typeof entry.valueNum === "number" ? entry.valueNum : entry.value;
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return {
    value,
    benchTime: entry.benchTime ?? null,
    recordId: typeof entry.recordId === "number" ? entry.recordId : null
  };
}

function buildGroupSampleMap(
  entryByModel: ReadonlyMap<string, SnapshotRevisionEntry>
): Map<string, ScatterHistorySample> {
  const map = new Map<string, ScatterHistorySample>();
  entryByModel.forEach((entry, modelName) => {
    const sample = toScatterSample(entry);
    if (sample) map.set(modelName, sample);
  });
  return map;
}

function buildBatchSampleMap(
  entries: readonly SnapshotRevisionEntry[]
): Map<string, ScatterHistorySample> {
  const map = new Map<string, ScatterHistorySample>();
  entries.forEach((entry) => {
    const model = entry.modelName;
    if (!model) return;
    const sample = toScatterSample(entry);
    if (!sample) return;
    const prev = map.get(model);
    if (!prev || compareMatrixCellEntryRecency(sample, prev) > 0) {
      map.set(model, sample);
    }
  });
  return map;
}

/**
 * 从指标的历史记录中提取并聚类出历史时间快照（公共时间片段）。
 *
 * 算法：
 * 1. 优先复用全量划分的 aaRevision，或汇集样本按 4 小时批次聚类；
 * 2. 自适应识别主要变动阈值，并将小变动补丁合并进所属的主要变动桶；
 * 3. 主要变动快照的 sampleByModel 真正包含后续合并补丁更新的最新成绩与新增模型；
 * 4. 保持快照元数据与历史排序规则一致。
 */
export function extractMetricSnapshots(
  historyByModel: ReadonlyMap<string, readonly ScatterHistorySample[]>,
  aaRevision?: LatestAaRevisionResolution
): ScatterMetricSnapshot[] {
  let batches: RevisionBatch<SnapshotRevisionEntry>[];
  let majorGroups: MajorRevisionGroup<SnapshotRevisionEntry>[];

  if (aaRevision && aaRevision.batches.length > 0) {
    batches = aaRevision.batches;
    majorGroups = aaRevision.groups;
  } else {
    const rawEntries: (ScatterHistorySample & { modelName: string })[] = [];
    historyByModel.forEach((samples, modelName) => {
      samples.forEach((sample) => {
        const timeMs = parseTimestampMs(sample.benchTime);
        if (timeMs === null) return;
        rawEntries.push({ ...sample, modelName });
      });
    });

    if (rawEntries.length === 0) return [];

    batches = clusterEntriesByTime(rawEntries);
    if (batches.length <= 1) return [];

    const adaptiveThreshold = detectAdaptiveMajorThreshold(batches.map((b) => b.modelCount));
    majorGroups = groupBatchesIntoMajorRevisions(batches, adaptiveThreshold);
  }

  if (batches.length <= 1) {
    return [];
  }

  const totalModels = aaRevision ? aaRevision.latestEntriesByModel.size : historyByModel.size;

  // 检查是否有同日聚类需要附加时间
  const dayCounts = new Map<string, number>();
  batches.forEach((batch) => {
    const day = formatSnapshotDateLabel(batch.timestamp);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  });

  const maxTimestamp = Math.max(...batches.map((b) => b.timestamp));

  type BatchMeta = {
    batch: RevisionBatch<SnapshotRevisionEntry>;
    group: MajorRevisionGroup<SnapshotRevisionEntry>;
    isGroupLeader: boolean;
  };

  const batchMetas: BatchMeta[] = [];
  majorGroups.forEach((group) => {
    group.batches.forEach((batch, index) => {
      batchMetas.push({
        batch,
        group,
        isGroupLeader: index === 0
      });
    });
  });

  const snapshots: ScatterMetricSnapshot[] = batchMetas.map((meta) => {
    const repTime = meta.batch.timestamp;
    const day = formatSnapshotDateLabel(repTime);
    const hasMultipleInDay = (dayCounts.get(day) ?? 0) > 1;
    const label = hasMultipleInDay ? formatSnapshotDateTimeLabel(repTime) : day;
    const isLatest = repTime === maxTimestamp;
    const modelCount = meta.batch.modelCount;
    const isMajorRevision = meta.isGroupLeader && meta.group.isMajorRevision;

    const sampleByModel = isMajorRevision
      ? buildGroupSampleMap(meta.group.entryByModel)
      : buildBatchSampleMap(meta.batch.entries);

    return {
      id: new Date(repTime).toISOString(),
      timestamp: repTime,
      label,
      modelCount,
      isLatest,
      isBatchSnapshot: modelCount >= 3 || (totalModels > 0 && modelCount / totalModels >= 0.25),
      isMajorRevision,
      sampleByModel
    };
  });

  // 主要变动组提升到列表最前，组内按时间降序排列
  snapshots.sort((a, b) => {
    const aMajor = a.isMajorRevision ? 1 : 0;
    const bMajor = b.isMajorRevision ? 1 : 0;
    if (aMajor !== bMajor) return bMajor - aMajor;
    return b.timestamp - a.timestamp;
  });

  return snapshots;
}

/**
 * 根据快照 ID 或快照代表时间，在模型的样本中找到属于该快照的样本。
 */
export function resolveSampleForSnapshot(
  samples: readonly ScatterHistorySample[],
  targetTimestampMs: number,
  toleranceMs = SNAPSHOT_CLUSTER_WINDOW_MS
): ScatterHistorySample | null {
  if (samples.length === 0) return null;

  let best: ScatterHistorySample | null = null;
  let minDiff = Number.POSITIVE_INFINITY;

  samples.forEach((sample) => {
    const timeMs = parseTimestampMs(sample.benchTime);
    if (timeMs === null) return;
    const diff = Math.abs(timeMs - targetTimestampMs);
    if (diff <= toleranceMs && diff < minDiff) {
      minDiff = diff;
      best = sample;
    }
  });

  return best;
}

/**
 * 从一组样本中选择与目标时间最接近的样本（就近吸附）。
 * 若 targetTime 为 null，返回最新的样本。
 * 若存在两个时间差完全相同的样本，优先选取较早的一个（更保守的基准）。
 */
export function pickNearestSampleByTime(
  samples: readonly ScatterHistorySample[],
  targetTimeMs: number | null
): ScatterHistorySample | null {
  if (samples.length === 0) return null;

  if (targetTimeMs === null) {
    // 取最新
    let latest: ScatterHistorySample = samples[0]!;
    let latestTime = parseTimestampMs(latest.benchTime) ?? 0;

    for (let i = 1; i < samples.length; i += 1) {
      const sample = samples[i]!;
      const sampleTime = parseTimestampMs(sample.benchTime) ?? 0;
      if (sampleTime > latestTime) {
        latest = sample;
        latestTime = sampleTime;
      }
    }
    return latest;
  }

  let selected: ScatterHistorySample | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;

  samples.forEach((sample) => {
    const sampleTime = parseTimestampMs(sample.benchTime);
    if (sampleTime === null) return;

    const distance = Math.abs(sampleTime - targetTimeMs);
    if (!selected || distance < selectedDistance) {
      selected = sample;
      selectedDistance = distance;
      return;
    }

    if (distance === selectedDistance) {
      // 等距时选时间较早的
      const currentSelectedTime = parseTimestampMs(selected.benchTime) ?? 0;
      if (sampleTime < currentSelectedTime) {
        selected = sample;
      }
    }
  });

  return selected;
}

/**
 * 计算两个时间之间的友好天数差距描述。
 */
export function formatTimeDifferenceDays(fromTimeMs: number, toTimeMs: number): string {
  const diffHours = Math.round(Math.abs(fromTimeMs - toTimeMs) / (60 * 60 * 1000));
  if (diffHours < 24) {
    return diffHours === 0 ? "同批次" : `相差 ${diffHours} 小时`;
  }
  const days = Math.round(diffHours / 24);
  return `相差 ${days} 天`;
}

