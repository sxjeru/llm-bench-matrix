import { brotliCompress, brotliDecompressSync, constants as zlibConstants } from "node:zlib";
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
  /** Brotli 压缩后的 wire JSON：落库与下发都用这一份。 */
  payloadBr: Uint8Array<ArrayBuffer>;
  /** 未压缩 JSON。只有不接受 br 的客户端才会用到，首次访问时按需解压。 */
  readonly payloadJson: string;
  updatedAt: Date;
};

/**
 * Response 的 BodyInit 只接受普通 ArrayBuffer 支撑的视图（不接受 SharedArrayBuffer），
 * 而 pg/Node 返回的 Buffer 底层可能是池化内存。需要时复制一次，否则零拷贝。
 */
function toBodyBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  if (value.buffer instanceof ArrayBuffer
    && value.byteOffset === 0
    && value.byteLength === value.buffer.byteLength) {
    return value as Uint8Array<ArrayBuffer>;
  }
  return new Uint8Array(value);
}

/**
 * 快照约 3.5 MB，q11 压缩要 ~3 s CPU，而重建可能发生在公开请求路径上
 * （写库 bump 版本后第一个访客触发）。超过阈值时降到 q9：
 * 体积 +12%，耗时降到 1/15，重建请求不会被压缩拖成秒级。
 * P1 把载荷削到 2 MB 以下后会自动回到 q11。
 */
const SNAPSHOT_BROTLI_QUALITY = 11;
const SNAPSHOT_BROTLI_FAST_QUALITY = 9;
const SNAPSHOT_BROTLI_QUALITY_SWITCH_BYTES = 2 * 1024 * 1024;

function compressSnapshotPayload(payloadJson: string): Promise<Buffer> {
  const input = Buffer.from(payloadJson, "utf8");
  const quality = input.byteLength > SNAPSHOT_BROTLI_QUALITY_SWITCH_BYTES
    ? SNAPSHOT_BROTLI_FAST_QUALITY
    : SNAPSHOT_BROTLI_QUALITY;

  return new Promise((resolve, reject) => {
    brotliCompress(input, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: quality } }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

/**
 * 记录同时持压缩字节与（惰性）未压缩 JSON。
 * 从库里读回压缩字节时不再无谓解压 3.5 MB，只有兜底分支才付这份成本。
 */
function createSnapshotRecord(
  base: Omit<PublicDashboardSnapshotRecord, "payloadJson" | "payloadBr"> & { payloadBr: Uint8Array },
  payloadJson?: string
): PublicDashboardSnapshotRecord {
  const payloadBr = toBodyBytes(base.payloadBr);
  let uncompressed = payloadJson;

  return {
    ...base,
    payloadBr,
    get payloadJson() {
      uncompressed ??= brotliDecompressSync(payloadBr).toString("utf8");
      return uncompressed;
    }
  };
}

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
  record: Pick<PublicDashboardSnapshotRecord, "key" | "etag" | "dashboardVersion" | "pricingVersion" | "settingsVersion">,
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

/**
 * 落库时只写压缩字节，payload_json 置空——冷启动从库里读的是 ~390 KB 而不是 3.5 MB。
 * 已发出的写入无法取消；本进程按顺序落库，防止旧写入在刷新后晚于新写入完成。
 */
function persistSnapshotRecord(
  record: PublicDashboardSnapshotRecord,
  generation: number,
  versionsKey: string
): Promise<void> {
  const persistence = pendingPersistence.then(async () => {
    if (!canPublishRecord(generation, versionsKey)) return;
    await db
      .insert(publicDashboardSnapshots)
      .values({
        key: record.key,
        etag: record.etag,
        dashboardVersion: record.dashboardVersion,
        pricingVersion: record.pricingVersion,
        settingsVersion: record.settingsVersion,
        payloadBr: record.payloadBr,
        payloadJson: null,
        createdAt: record.updatedAt
      })
      .onConflictDoUpdate({
        target: publicDashboardSnapshots.key,
        set: {
          etag: record.etag,
          dashboardVersion: record.dashboardVersion,
          pricingVersion: record.pricingVersion,
          settingsVersion: record.settingsVersion,
          payloadBr: record.payloadBr,
          payloadJson: null,
          updatedAt: record.updatedAt
        }
      });
  });
  pendingPersistence = persistence.catch(() => undefined);
  return persistence;
}

async function buildAndPersistSnapshotRecord(
  versions: PublicDashboardSnapshotVersions,
  generation: number,
  versionsKey: string
): Promise<PublicDashboardSnapshotRecord> {
  const snapshot = await loadPublicDashboardSnapshot(versions);
  const wire = encodePublicDashboardSnapshot(snapshot);
  const payloadJson = JSON.stringify(wire);
  const payloadBr = await compressSnapshotPayload(payloadJson);
  const etag = createPublicDashboardSnapshotEtag(versions);
  const now = new Date();

  const record = createSnapshotRecord({
    key: DEFAULT_SNAPSHOT_KEY,
    etag,
    dashboardVersion: versions.dashboard,
    pricingVersion: versions.pricing,
    settingsVersion: versions.settings,
    payloadBr,
    updatedAt: now
  }, payloadJson);

  if (!canPublishRecord(generation, versionsKey)) return record;

  inMemoryRecord = record;
  try {
    await persistSnapshotRecord(record, generation, versionsKey);
  } catch (persistError) {
    console.warn("[dashboard-snapshot-store] Failed to persist snapshot to table:", persistError);
  }

  return record;
}

/**
 * 获取公开快照：
 * 1. 优先命中本进程内存中匹配当前版本的快照（0 数据库 IO）
 * 2. 其次查询 public_dashboard_snapshots 表（仅 1 行、压缩后 ~390 KB，
 *    避免 2 万行多表关联，也避免冷启动搬运 3.5 MB JSON 文本）
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
      const storedBr = row.payloadBr && row.payloadBr.byteLength > 0 ? row.payloadBr : null;
      // 升级前写入的旧行只有未压缩 JSON：就地压一次并回填，
      // 否则每次冷启动都要重新压缩 3.5 MB。
      const legacyJson = storedBr ? undefined : row.payloadJson ?? undefined;

      if (storedBr || legacyJson) {
        const payloadBr = storedBr ?? await compressSnapshotPayload(legacyJson as string);
        const record = createSnapshotRecord({
          key: row.key,
          etag: row.etag,
          dashboardVersion: row.dashboardVersion,
          pricingVersion: row.pricingVersion,
          settingsVersion: row.settingsVersion,
          payloadBr,
          updatedAt: row.updatedAt
        }, legacyJson);

        if (canPublishRecord(generation, versionsKey)) {
          inMemoryRecord = record;
          if (!storedBr) {
            try {
              await persistSnapshotRecord(record, generation, versionsKey);
            } catch (persistError) {
              console.warn("[dashboard-snapshot-store] Failed to backfill compressed snapshot:", persistError);
            }
          }
        }
        return record;
      }
    }
  } catch (queryError) {
    console.warn("[dashboard-snapshot-store] Failed to read from snapshot table, falling back to build:", queryError);
  }

  // 3. 缺失或版本过期，重新构建并持久化
  return rebuildSnapshotRecord(versions, generation);
}
