import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { publicDashboardSnapshots } from "@/lib/db/schema";
import {
  createPublicDashboardSnapshotEtag,
  encodePublicDashboardSnapshot,
  type PublicDashboardSnapshotVersions
} from "@/lib/dashboard-snapshot-cache";
import {
  getPublicDashboardSnapshotVersions,
  loadPublicDashboardSnapshot
} from "@/lib/dashboard-snapshot";
import { registerCacheInvalidator } from "@/lib/db/queries";

export const DEFAULT_SNAPSHOT_KEY = "default";

export type PublicDashboardSnapshotRecord = {
  key: string;
  etag: string;
  dashboardVersion: string;
  pricingVersion: string;
  settingsVersion: string;
  payloadJson: string;
  updatedAt: Date;
};

let inMemoryRecord: PublicDashboardSnapshotRecord | null = null;

registerCacheInvalidator(() => {
  inMemoryRecord = null;
});

export function _getInMemoryRecordForTest(): PublicDashboardSnapshotRecord | null {
  return inMemoryRecord;
}

export function _resetInMemoryRecordForTest(): void {
  inMemoryRecord = null;
}

export function isSnapshotVersionsMatch(
  record: Pick<PublicDashboardSnapshotRecord, "dashboardVersion" | "pricingVersion" | "settingsVersion">,
  versions: PublicDashboardSnapshotVersions
): boolean {
  return (
    record.dashboardVersion === versions.dashboard &&
    record.pricingVersion === versions.pricing &&
    record.settingsVersion === versions.settings
  );
}

/**
 * 重新构建快照并持久化到 public_dashboard_snapshots 表中。
 * 写时调用：仅在管理员写操作或版本失效时执行。
 */
export async function rebuildAndPersistPublicDashboardSnapshotRecord(
  versions?: PublicDashboardSnapshotVersions
): Promise<PublicDashboardSnapshotRecord> {
  const resolvedVersions = versions ?? (await getPublicDashboardSnapshotVersions());
  const snapshot = await loadPublicDashboardSnapshot(resolvedVersions);
  const wire = encodePublicDashboardSnapshot(snapshot);
  const payloadJson = JSON.stringify(wire);
  const etag = createPublicDashboardSnapshotEtag(resolvedVersions);
  const now = new Date();

  const record: PublicDashboardSnapshotRecord = {
    key: DEFAULT_SNAPSHOT_KEY,
    etag,
    dashboardVersion: resolvedVersions.dashboard,
    pricingVersion: resolvedVersions.pricing,
    settingsVersion: resolvedVersions.settings,
    payloadJson,
    updatedAt: now
  };

  inMemoryRecord = record;

  try {
    if (typeof (db as unknown as { insert?: unknown }).insert === "function") {
      await db
        .insert(publicDashboardSnapshots)
        .values({
          key: DEFAULT_SNAPSHOT_KEY,
          etag,
          dashboardVersion: resolvedVersions.dashboard,
          pricingVersion: resolvedVersions.pricing,
          settingsVersion: resolvedVersions.settings,
          payloadJson,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: publicDashboardSnapshots.key,
          set: {
            etag,
            dashboardVersion: resolvedVersions.dashboard,
            pricingVersion: resolvedVersions.pricing,
            settingsVersion: resolvedVersions.settings,
            payloadJson,
            updatedAt: now
          }
        });
    }
  } catch (persistError) {
    console.warn("[dashboard-snapshot-store] Failed to persist snapshot to table:", persistError);
  }

  return record;
}

/**
 * 获取公开快照：
 * 1. 优先命中本进程内存中匹配当前版本的快照（0 数据库 IO）
 * 2. 其次查询 public_dashboard_snapshots 表（仅 1 行、~320 KB，避免 2 万行多表关联）
 * 3. 若快照缺失或版本不匹配，回退重新构建并持久化
 */
export async function getOrBuildPublicDashboardSnapshotRecord(
  versions: PublicDashboardSnapshotVersions
): Promise<PublicDashboardSnapshotRecord> {
  // 1. 检查本进程内存缓存
  if (inMemoryRecord && isSnapshotVersionsMatch(inMemoryRecord, versions)) {
    return inMemoryRecord;
  }

  // 2. 查询持久化快照表
  try {
    if (typeof (db as unknown as { select?: unknown }).select === "function") {
      const [row] = await db
        .select()
        .from(publicDashboardSnapshots)
        .where(eq(publicDashboardSnapshots.key, DEFAULT_SNAPSHOT_KEY))
        .limit(1);

      if (row && isSnapshotVersionsMatch(row, versions)) {
        inMemoryRecord = {
          key: row.key,
          etag: row.etag,
          dashboardVersion: row.dashboardVersion,
          pricingVersion: row.pricingVersion,
          settingsVersion: row.settingsVersion,
          payloadJson: row.payloadJson,
          updatedAt: row.updatedAt
        };
        return inMemoryRecord;
      }
    }
  } catch (queryError) {
    console.warn("[dashboard-snapshot-store] Failed to read from snapshot table, falling back to build:", queryError);
  }

  // 3. 缺失或版本过期，重新构建并持久化
  return await rebuildAndPersistPublicDashboardSnapshotRecord(versions);
}
