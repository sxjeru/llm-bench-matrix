import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { publicDashboardSnapshots } from "@/lib/db/schema";
import {
  PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION,
  createPublicDashboardSnapshotEtag,
  encodePublicDashboardSnapshot,
  type PublicDashboardSnapshotVersions
} from "@/lib/dashboard-snapshot-cache";
import {
  getPublicDashboardSnapshotVersions,
  loadPublicDashboardSnapshot
} from "@/lib/dashboard-snapshot";
import { registerCacheInvalidator } from "@/lib/db/queries";

export const DEFAULT_SNAPSHOT_KEY = `default:v${PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION}`;

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
let cacheGeneration = 0;
let latestVersionsKey: string | null = null;
const inFlightReads = new Map<string, Promise<PublicDashboardSnapshotRecord>>();
const inFlightBuilds = new Map<string, Promise<PublicDashboardSnapshotRecord>>();
let pendingPersistence: Promise<void> = Promise.resolve();

function resetSnapshotCache() {
  cacheGeneration += 1;
  inMemoryRecord = null;
  latestVersionsKey = null;
  inFlightReads.clear();
  inFlightBuilds.clear();
}

registerCacheInvalidator(resetSnapshotCache);

export function _getInMemoryRecordForTest(): PublicDashboardSnapshotRecord | null {
  return inMemoryRecord;
}

export function _resetInMemoryRecordForTest(): void {
  resetSnapshotCache();
}

function getVersionsKey(versions: PublicDashboardSnapshotVersions): string {
  return JSON.stringify([versions.dashboard, versions.pricing, versions.settings]);
}

function canPublishRecord(generation: number, versionsKey: string): boolean {
  return generation === cacheGeneration && versionsKey === latestVersionsKey;
}

/** 按版本合并本进程内的任务；失败后允许重试，旧任务不能清掉失效后的新任务。 */
function withInFlightRecord(
  inFlight: Map<string, Promise<PublicDashboardSnapshotRecord>>,
  versionsKey: string,
  generation: number,
  loader: () => Promise<PublicDashboardSnapshotRecord>
): Promise<PublicDashboardSnapshotRecord> {
  // 已失效的读取仍可完成原请求，但不再加入当前代的任务或回填缓存。
  if (generation !== cacheGeneration) return loader();

  const pending = inFlight.get(versionsKey);
  if (pending) return pending;

  const promise = loader().finally(() => {
    if (inFlight.get(versionsKey) === promise) {
      inFlight.delete(versionsKey);
    }
  });
  inFlight.set(versionsKey, promise);
  return promise;
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

function isSnapshotRecordMatch(
  record: PublicDashboardSnapshotRecord,
  versions: PublicDashboardSnapshotVersions
): boolean {
  return record.key === DEFAULT_SNAPSHOT_KEY
    && record.etag === createPublicDashboardSnapshotEtag(versions)
    && isSnapshotVersionsMatch(record, versions);
}

/**
 * 重新构建快照并持久化到 public_dashboard_snapshots 表中。
 * 写时调用：仅在管理员写操作或版本失效时执行。
 */
export async function rebuildAndPersistPublicDashboardSnapshotRecord(
  versions?: PublicDashboardSnapshotVersions
): Promise<PublicDashboardSnapshotRecord> {
  const generation = cacheGeneration;
  const resolvedVersions = versions ?? (await getPublicDashboardSnapshotVersions());
  if (generation === cacheGeneration) {
    latestVersionsKey = getVersionsKey(resolvedVersions);
  }
  return rebuildSnapshotRecord(resolvedVersions, generation);
}

function rebuildSnapshotRecord(
  versions: PublicDashboardSnapshotVersions,
  generation: number
): Promise<PublicDashboardSnapshotRecord> {
  const versionsKey = getVersionsKey(versions);
  return withInFlightRecord(inFlightBuilds, versionsKey, generation, () => buildAndPersistSnapshotRecord(
    versions,
    generation,
    versionsKey
  ));
}

async function buildAndPersistSnapshotRecord(
  versions: PublicDashboardSnapshotVersions,
  generation: number,
  versionsKey: string
): Promise<PublicDashboardSnapshotRecord> {
  const snapshot = await loadPublicDashboardSnapshot(versions);
  const wire = encodePublicDashboardSnapshot(snapshot);
  const payloadJson = JSON.stringify(wire);
  const etag = createPublicDashboardSnapshotEtag(versions);
  const now = new Date();

  const record: PublicDashboardSnapshotRecord = {
    key: DEFAULT_SNAPSHOT_KEY,
    etag,
    dashboardVersion: versions.dashboard,
    pricingVersion: versions.pricing,
    settingsVersion: versions.settings,
    payloadJson,
    updatedAt: now
  };

  if (!canPublishRecord(generation, versionsKey)) return record;

  inMemoryRecord = record;
  // 已发出的写入无法取消；本进程按顺序落库，防止旧写入在刷新后晚于新写入完成。
  const persistence = pendingPersistence.then(async () => {
    if (!canPublishRecord(generation, versionsKey)) return;
    await db
      .insert(publicDashboardSnapshots)
      .values({ ...record, createdAt: now })
      .onConflictDoUpdate({
        target: publicDashboardSnapshots.key,
        set: {
          etag,
          dashboardVersion: versions.dashboard,
          pricingVersion: versions.pricing,
          settingsVersion: versions.settings,
          payloadJson,
          updatedAt: now
        }
      });
  });
  pendingPersistence = persistence.catch(() => undefined);
  try {
    await persistence;
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
  const generation = cacheGeneration;
  const versionsKey = getVersionsKey(versions);
  latestVersionsKey = versionsKey;

  const rebuilding = inFlightBuilds.get(versionsKey);
  if (rebuilding) return rebuilding;

  // 1. 检查本进程内存缓存
  if (inMemoryRecord && isSnapshotRecordMatch(inMemoryRecord, versions)) {
    return inMemoryRecord;
  }

  return withInFlightRecord(inFlightReads, versionsKey, generation, () => readOrBuildSnapshotRecord(
    versions,
    generation,
    versionsKey
  ));
}

async function readOrBuildSnapshotRecord(
  versions: PublicDashboardSnapshotVersions,
  generation: number,
  versionsKey: string
): Promise<PublicDashboardSnapshotRecord> {
  // 2. 查询持久化快照表
  try {
    const [row] = await db
      .select()
      .from(publicDashboardSnapshots)
      .where(eq(publicDashboardSnapshots.key, DEFAULT_SNAPSHOT_KEY))
      .limit(1);

    // 管理员可能在本次查询期间启动或完成了同版本的强制重建。
    if (generation === cacheGeneration) {
      const rebuilding = inFlightBuilds.get(versionsKey);
      if (rebuilding) return rebuilding;
      if (inMemoryRecord && isSnapshotRecordMatch(inMemoryRecord, versions)) {
        return inMemoryRecord;
      }
    }

    if (row && isSnapshotRecordMatch(row, versions)) {
      const record: PublicDashboardSnapshotRecord = {
        key: row.key,
        etag: row.etag,
        dashboardVersion: row.dashboardVersion,
        pricingVersion: row.pricingVersion,
        settingsVersion: row.settingsVersion,
        payloadJson: row.payloadJson,
        updatedAt: row.updatedAt
      };
      if (canPublishRecord(generation, versionsKey)) {
        inMemoryRecord = record;
      }
      return record;
    }
  } catch (queryError) {
    console.warn("[dashboard-snapshot-store] Failed to read from snapshot table, falling back to build:", queryError);
  }

  // 3. 缺失或版本过期，重新构建并持久化
  return rebuildSnapshotRecord(versions, generation);
}
