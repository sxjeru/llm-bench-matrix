import type { MatrixCellEntry } from "@/components/benchmark-matrix/types";
import type { LatestAaRevisionResolution } from "@/lib/aa-index-revisions";
import type { SerializedAaRevision } from "@/lib/dashboard-snapshot-cache";

/**
 * AA 版本划分的线上表示。
 *
 * 独立成一个不依赖 selectors 的小模块：服务端算好写进快照（serialize），
 * 客户端矩阵读它（deserialize）。放在 lib/dashboard-preview 里会把服务端的
 * 裁剪逻辑一起拖进浏览器包。
 */

export function serializeAaRevisions(
  revisions: ReadonlyMap<string, LatestAaRevisionResolution>
): Record<string, SerializedAaRevision> {
  const serialized: Record<string, SerializedAaRevision> = {};

  revisions.forEach((revision, rowKey) => {
    const latestEntriesByModel: Record<string, MatrixCellEntry> = {};
    revision.latestEntriesByModel.forEach((entry, modelName) => {
      latestEntriesByModel[modelName] = entry;
    });

    serialized[rowKey] = {
      latestVersion: revision.latestVersion ?? null,
      latestEntriesByModel
    };
  });

  return serialized;
}

/**
 * 还原成 `LatestAaRevisionResolution` 形状供 `buildMatrixRows` 复用。
 * 消费端只读 `latestEntriesByModel` 与 `latestVersion`（见 selectors 里的
 * buildMatrixRows / buildModelColumns），批次与分组只用于面板展示，这里给空数组。
 */
export function deserializeAaRevisions(
  serialized: Record<string, SerializedAaRevision> | undefined
): Map<string, LatestAaRevisionResolution> | null {
  if (!serialized) return null;

  const revisions = new Map<string, LatestAaRevisionResolution>();
  Object.entries(serialized).forEach(([rowKey, revision]) => {
    revisions.set(rowKey, {
      latestEntriesByModel: new Map(Object.entries(revision.latestEntriesByModel)),
      batches: [],
      groups: [],
      adaptiveThreshold: 0,
      latestVersion: revision.latestVersion
    });
  });

  return revisions;
}
