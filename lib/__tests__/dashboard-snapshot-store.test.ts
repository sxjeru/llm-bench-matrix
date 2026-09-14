import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_SNAPSHOT_KEY,
  getOrBuildPublicDashboardSnapshotRecord,
  isSnapshotVersionsMatch,
  rebuildAndPersistPublicDashboardSnapshotRecord,
  _getInMemoryRecordForTest,
  _resetInMemoryRecordForTest,
  type PublicDashboardSnapshotRecord
} from "@/lib/dashboard-snapshot-store";
import { invalidateAllCaches } from "@/lib/db/queries";
import * as snapshotModule from "@/lib/dashboard-snapshot";
import * as cacheModule from "@/lib/dashboard-snapshot-cache";
import type { PublicDashboardSnapshot } from "@/lib/dashboard-snapshot-cache";
import { db } from "@/lib/db/client";

vi.mock("@/lib/db/client", () => ({
  db: { select: vi.fn(), insert: vi.fn() }
}));

vi.mock("@/lib/dashboard-snapshot", () => ({
  getPublicDashboardSnapshotVersions: vi.fn(),
  loadPublicDashboardSnapshot: vi.fn()
}));

const VERSIONS = { dashboard: "d-v1", pricing: "p-v1", settings: "s-v1" };

function createSnapshot(versions = VERSIONS, value = 88): PublicDashboardSnapshot {
  return {
    versions,
    rows: [{
      providerName: "openai",
      modelName: "model",
      benchmarkName: "MMLU",
      benchmarkType: "General",
      benchTime: "2026-09-14T00:00:00.000Z",
      valueRaw: String(value),
      valueNum: value
    }],
    sourceOptions: [],
    stats: { providerCount: 1, modelCount: 1, benchmarkCount: 1, totalRecords: 1 },
    modelPrices: [],
    modelParams: [],
    exportFootnoteAlign: "center"
  };
}

function createRecord(overrides: Partial<PublicDashboardSnapshotRecord> = {}): PublicDashboardSnapshotRecord {
  return {
    key: DEFAULT_SNAPSHOT_KEY,
    etag: cacheModule.createPublicDashboardSnapshotEtag(VERSIONS),
    dashboardVersion: VERSIONS.dashboard,
    pricingVersion: VERSIONS.pricing,
    settingsVersion: VERSIONS.settings,
    payloadJson: JSON.stringify(cacheModule.encodePublicDashboardSnapshot(createSnapshot())),
    updatedAt: new Date(),
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function invalidateSnapshotCache() {
  await invalidateAllCaches({ skipVersionBump: ["dashboard", "pricing", "admin_entities", "settings"] });
}

const readRows = vi.fn<() => Promise<PublicDashboardSnapshotRecord[]>>();
const where = vi.fn<(condition: SQL | undefined) => { limit: typeof readRows }>();
const persist = vi.fn<() => Promise<void>>();
const values = vi.fn<(record: PublicDashboardSnapshotRecord) => { onConflictDoUpdate: typeof persist }>();

describe("dashboard-snapshot-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetInMemoryRecordForTest();
    readRows.mockReset().mockResolvedValue([]);
    where.mockReset().mockReturnValue({ limit: readRows });
    persist.mockReset().mockResolvedValue(undefined);
    values.mockReset().mockReturnValue({ onConflictDoUpdate: persist });
    vi.mocked(db.select).mockReset().mockReturnValue({ from: () => ({ where }) } as never);
    vi.mocked(db.insert).mockReset().mockReturnValue({ values } as never);
    vi.mocked(snapshotModule.getPublicDashboardSnapshotVersions).mockReset().mockResolvedValue(VERSIONS);
    vi.mocked(snapshotModule.loadPublicDashboardSnapshot).mockReset().mockImplementation(
      async (versions) => createSnapshot(versions)
    );
  });

  test("逐一校验三个数据版本域", () => {
    const record = createRecord();
    expect(isSnapshotVersionsMatch(record, VERSIONS)).toBe(true);
    for (const domain of ["dashboard", "pricing", "settings"] as const) {
      expect(isSnapshotVersionsMatch(record, { ...VERSIONS, [domain]: "changed" })).toBe(false);
    }
  });

  test("读取持久化快照后，后续请求命中内存且不重新构建", async () => {
    const saved = createRecord();
    readRows.mockResolvedValue([saved]);

    const first = await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    const second = await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);

    expect(first).toEqual(saved);
    expect(second).toBe(first);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(snapshotModule.loadPublicDashboardSnapshot).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  test("20 个同版本冷请求只读取、编码和持久化一次", async () => {
    const read = deferred<PublicDashboardSnapshotRecord[]>();
    readRows.mockReturnValue(read.promise);
    const encode = vi.spyOn(cacheModule, "encodePublicDashboardSnapshot");

    const requests = Array.from({ length: 20 }, () => getOrBuildPublicDashboardSnapshotRecord({ ...VERSIONS }));
    expect(db.select).toHaveBeenCalledTimes(1);
    read.resolve([]);
    const records = await Promise.all(requests);

    expect(snapshotModule.loadPublicDashboardSnapshot).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(records.every((record) => record === records[0])).toBe(true);
    expect(cacheModule.decodePublicDashboardSnapshot(JSON.parse(records[0].payloadJson))).toEqual(createSnapshot());
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      key: DEFAULT_SNAPSHOT_KEY,
      etag: cacheModule.createPublicDashboardSnapshotEtag(VERSIONS),
      payloadJson: records[0].payloadJson
    }));
  });

  test("并发读取已有快照也只查询一次数据库", async () => {
    const saved = createRecord();
    const read = deferred<PublicDashboardSnapshotRecord[]>();
    readRows.mockReturnValue(read.promise);
    const requests = Array.from({ length: 20 }, () => getOrBuildPublicDashboardSnapshotRecord(VERSIONS));

    read.resolve([saved]);
    const records = await Promise.all(requests);

    expect(records.every((record) => record.payloadJson === saved.payloadJson)).toBe(true);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(snapshotModule.loadPublicDashboardSnapshot).not.toHaveBeenCalled();
  });

  test("数据版本不匹配时重建快照", async () => {
    readRows.mockResolvedValue([createRecord({ dashboardVersion: "old" })]);

    const record = await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);

    expect(record.dashboardVersion).toBe(VERSIONS.dashboard);
    expect(snapshotModule.loadPublicDashboardSnapshot).toHaveBeenCalledWith(VERSIONS);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  test.each([
    "default",
    `default:v${cacheModule.PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION - 1}`
  ])("数据版本相同时也不会查询或覆盖旧格式命名空间 %s", async (oldKey) => {
    const oldRecord = createRecord({ key: oldKey, payloadJson: '{"oldFormat":true}' });
    const stored = new Map([[oldKey, oldRecord]]);
    where.mockImplementation((condition) => {
      if (!condition) throw new Error("Snapshot query must specify a key");
      const query = new PgDialect().sqlToQuery(condition);
      const row = stored.get(String(query.params[0]));
      readRows.mockResolvedValue(row ? [row] : []);
      return { limit: readRows };
    });

    const record = await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);

    expect(record.key).toBe(`default:v${cacheModule.PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION}`);
    expect(record.payloadJson).not.toBe(oldRecord.payloadJson);
    expect(snapshotModule.loadPublicDashboardSnapshot).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0][0].key).not.toBe(oldKey);
  });

  test("同一键下的旧格式 ETag 也不能命中", async () => {
    readRows.mockResolvedValue([createRecord({ etag: '"dashboard:d-v1:p-v1:s-v1"' })]);

    await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);

    expect(snapshotModule.loadPublicDashboardSnapshot).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  test("并发强制重建和公开读取共享同一个构建任务", async () => {
    const build = deferred<PublicDashboardSnapshot>();
    vi.mocked(snapshotModule.loadPublicDashboardSnapshot).mockReturnValue(build.promise);

    const first = rebuildAndPersistPublicDashboardSnapshotRecord(VERSIONS);
    const second = rebuildAndPersistPublicDashboardSnapshotRecord(VERSIONS);
    const read = getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    build.resolve(createSnapshot());
    const records = await Promise.all([first, second, read]);

    expect(records[0]).toBe(records[1]);
    expect(records[0]).toBe(records[2]);
    expect(snapshotModule.loadPublicDashboardSnapshot).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(db.select).not.toHaveBeenCalled();
  });

  test("查询期间发生强制重建时，读取复用新构建而非覆盖它", async () => {
    const saved = createRecord();
    const query = deferred<PublicDashboardSnapshotRecord[]>();
    const build = deferred<PublicDashboardSnapshot>();
    readRows.mockReturnValue(query.promise);
    vi.mocked(snapshotModule.loadPublicDashboardSnapshot).mockReturnValue(build.promise);

    const read = getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    const rebuild = rebuildAndPersistPublicDashboardSnapshotRecord(VERSIONS);
    query.resolve([saved]);
    build.resolve(createSnapshot(VERSIONS, 99));
    const [readRecord, rebuiltRecord] = await Promise.all([read, rebuild]);

    expect(readRecord).toBe(rebuiltRecord);
    expect(readRecord.payloadJson).not.toBe(saved.payloadJson);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  test("不同版本各自重建，较早启动的慢任务不能覆盖后来的版本", async () => {
    const newerVersions = { ...VERSIONS, dashboard: "d-v2" };
    const olderBuild = deferred<PublicDashboardSnapshot>();
    const newerBuild = deferred<PublicDashboardSnapshot>();
    const olderStarted = deferred<void>();
    const newerStarted = deferred<void>();
    vi.mocked(snapshotModule.loadPublicDashboardSnapshot).mockImplementation((versions) => {
      if (versions?.dashboard === VERSIONS.dashboard) {
        olderStarted.resolve();
        return olderBuild.promise;
      }
      newerStarted.resolve();
      return newerBuild.promise;
    });

    const olderRequest = getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    const newerRequest = getOrBuildPublicDashboardSnapshotRecord(newerVersions);
    await Promise.all([olderStarted.promise, newerStarted.promise]);
    newerBuild.resolve(createSnapshot(newerVersions, 99));
    const newerRecord = await newerRequest;
    olderBuild.resolve(createSnapshot());
    const olderRecord = await olderRequest;

    expect(olderRecord.dashboardVersion).toBe(VERSIONS.dashboard);
    expect(newerRecord.dashboardVersion).toBe(newerVersions.dashboard);
    expect(_getInMemoryRecordForTest()).toBe(newerRecord);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0][0].dashboardVersion).toBe(newerVersions.dashboard);
  });

  test("失效前的构建完成后不能回填缓存或清掉同版本的新任务", async () => {
    const oldBuild = deferred<PublicDashboardSnapshot>();
    const newBuild = deferred<PublicDashboardSnapshot>();
    const oldStarted = deferred<void>();
    const newStarted = deferred<void>();
    vi.mocked(snapshotModule.loadPublicDashboardSnapshot)
      .mockImplementationOnce(() => { oldStarted.resolve(); return oldBuild.promise; })
      .mockImplementationOnce(() => { newStarted.resolve(); return newBuild.promise; });

    const oldRequest = getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    await oldStarted.promise;
    await invalidateSnapshotCache();
    const newRequest = getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    await newStarted.promise;
    oldBuild.resolve(createSnapshot());
    await oldRequest;

    expect(_getInMemoryRecordForTest()).toBeNull();
    expect(persist).not.toHaveBeenCalled();
    const concurrentRequest = getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    newBuild.resolve(createSnapshot(VERSIONS, 99));
    const [fresh, concurrent] = await Promise.all([newRequest, concurrentRequest]);

    expect(concurrent).toBe(fresh);
    expect(_getInMemoryRecordForTest()).toBe(fresh);
    expect(snapshotModule.loadPublicDashboardSnapshot).toHaveBeenCalledTimes(2);
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  test("失效前的慢查询回退重建时仍属于旧代，不能覆盖已刷新的快照", async () => {
    const oldQuery = deferred<PublicDashboardSnapshotRecord[]>();
    readRows.mockReturnValueOnce(oldQuery.promise);
    vi.mocked(snapshotModule.loadPublicDashboardSnapshot)
      .mockResolvedValueOnce(createSnapshot(VERSIONS, 99))
      .mockResolvedValueOnce(createSnapshot());

    const oldRequest = getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    await invalidateSnapshotCache();
    const fresh = await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    oldQuery.resolve([]);
    const oldRecord = await oldRequest;

    expect(oldRecord.payloadJson).not.toBe(fresh.payloadJson);
    expect(_getInMemoryRecordForTest()).toBe(fresh);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await getOrBuildPublicDashboardSnapshotRecord(VERSIONS)).toBe(fresh);
  });

  test("已发出的旧写入结束后才持久化刷新结果，避免落库顺序反转", async () => {
    const oldWrite = deferred<void>();
    const oldWriteStarted = deferred<void>();
    const newBuildStarted = deferred<void>();
    const newBuild = deferred<PublicDashboardSnapshot>();
    persist.mockImplementationOnce(() => {
      oldWriteStarted.resolve();
      return oldWrite.promise;
    });
    const oldRequest = getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    await oldWriteStarted.promise;
    await invalidateSnapshotCache();
    vi.mocked(snapshotModule.loadPublicDashboardSnapshot).mockImplementationOnce(() => {
      newBuildStarted.resolve();
      return newBuild.promise;
    });
    const newRequest = getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    await newBuildStarted.promise;
    newBuild.resolve(createSnapshot(VERSIONS, 99));
    await newBuild.promise;

    expect(persist).toHaveBeenCalledTimes(1);
    oldWrite.resolve();
    const [oldRecord, newRecord] = await Promise.all([oldRequest, newRequest]);

    expect(values.mock.calls.map(([record]) => record.payloadJson)).toEqual([
      oldRecord.payloadJson,
      newRecord.payloadJson
    ]);
    expect(_getInMemoryRecordForTest()).toBe(newRecord);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  test("重建失败时并发请求共享错误，后续请求可以重试", async () => {
    const error = new Error("snapshot load failed");
    vi.mocked(snapshotModule.loadPublicDashboardSnapshot).mockRejectedValueOnce(error);

    const results = await Promise.allSettled([
      getOrBuildPublicDashboardSnapshotRecord(VERSIONS),
      getOrBuildPublicDashboardSnapshotRecord(VERSIONS)
    ]);

    expect(results).toEqual([
      { status: "rejected", reason: error },
      { status: "rejected", reason: error }
    ]);
    expect(snapshotModule.loadPublicDashboardSnapshot).toHaveBeenCalledTimes(1);
    expect(_getInMemoryRecordForTest()).toBeNull();

    const record = await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    expect(record.dashboardVersion).toBe(VERSIONS.dashboard);
    expect(snapshotModule.loadPublicDashboardSnapshot).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  test("快照表读写失败时仍返回构建结果并保留内存缓存", async () => {
    const error = new Error("relation public_dashboard_snapshots does not exist");
    readRows.mockRejectedValueOnce(error);
    persist.mockRejectedValueOnce(error);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const record = await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);

    expect(cacheModule.decodePublicDashboardSnapshot(JSON.parse(record.payloadJson))).toEqual(createSnapshot());
    expect(await getOrBuildPublicDashboardSnapshotRecord(VERSIONS)).toBe(record);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  test("强制重建跳过已有缓存，省略版本参数时主动读取版本", async () => {
    const saved = createRecord();
    readRows.mockResolvedValue([saved]);
    await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    vi.mocked(snapshotModule.loadPublicDashboardSnapshot).mockResolvedValue(createSnapshot(VERSIONS, 99));

    const record = await rebuildAndPersistPublicDashboardSnapshotRecord();

    expect(snapshotModule.getPublicDashboardSnapshotVersions).toHaveBeenCalledTimes(1);
    expect(snapshotModule.loadPublicDashboardSnapshot).toHaveBeenCalledWith(VERSIONS);
    expect(record.payloadJson).not.toBe(saved.payloadJson);
    expect(_getInMemoryRecordForTest()).toBe(record);
    expect(persist).toHaveBeenCalledTimes(1);
    await invalidateSnapshotCache();
    expect(_getInMemoryRecordForTest()).toBeNull();
  });
});
