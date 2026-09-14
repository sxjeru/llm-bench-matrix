import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  getOrBuildPublicDashboardSnapshotRecord,
  isSnapshotVersionsMatch,
  rebuildAndPersistPublicDashboardSnapshotRecord,
  _getInMemoryRecordForTest,
  _resetInMemoryRecordForTest
} from "@/lib/dashboard-snapshot-store";
import { invalidateAllCaches } from "@/lib/db/queries";
import * as dashboardSnapshotModule from "@/lib/dashboard-snapshot";
import * as dashboardSnapshotCacheModule from "@/lib/dashboard-snapshot-cache";
import { db } from "@/lib/db/client";

vi.mock("@/lib/db/client", () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn()
    }
  };
});

vi.mock("@/lib/dashboard-snapshot", () => ({
  getPublicDashboardSnapshotVersions: vi.fn(),
  loadPublicDashboardSnapshot: vi.fn()
}));

vi.mock("@/lib/dashboard-snapshot-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof dashboardSnapshotCacheModule>();
  return {
    ...actual,
    createPublicDashboardSnapshotEtag: vi.fn(),
    encodePublicDashboardSnapshot: vi.fn()
  };
});

describe("dashboard-snapshot-store", () => {
  const VERSIONS = {
    dashboard: "d-v1",
    pricing: "p-v1",
    settings: "s-v1"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetInMemoryRecordForTest();
  });

  test("isSnapshotVersionsMatch 正确校验三个域的版本一致性", () => {
    expect(isSnapshotVersionsMatch({
      dashboardVersion: "d-v1",
      pricingVersion: "p-v1",
      settingsVersion: "s-v1"
    }, VERSIONS)).toBe(true);

    expect(isSnapshotVersionsMatch({
      dashboardVersion: "d-v2",
      pricingVersion: "p-v1",
      settingsVersion: "s-v1"
    }, VERSIONS)).toBe(false);
  });

  test("当数据库已有匹配版本的快照时，优先读取该单行记录并填充内存缓存", async () => {
    const mockRow = {
      key: "default",
      etag: '"test-etag"',
      dashboardVersion: "d-v1",
      pricingVersion: "p-v1",
      settingsVersion: "s-v1",
      payloadJson: '{"test":true}',
      updatedAt: new Date()
    };

    const limitMock = vi.fn().mockResolvedValue([mockRow]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);

    const record = await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);

    expect(record.payloadJson).toBe('{"test":true}');
    expect(record.etag).toBe('"test-etag"');
    expect(dashboardSnapshotModule.loadPublicDashboardSnapshot).not.toHaveBeenCalled();

    // 第二次读取应直接命中内存缓存，不再调用数据库
    vi.mocked(db.select).mockClear();
    const secondRecord = await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    expect(secondRecord.payloadJson).toBe('{"test":true}');
    expect(db.select).not.toHaveBeenCalled();
  });

  test("当快照缺失或版本不匹配时，自动重新构建并尝试落库", async () => {
    // 模拟数据库返回空记录
    const limitMock = vi.fn().mockResolvedValue([]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);

    // 模拟重构逻辑
    vi.mocked(dashboardSnapshotModule.loadPublicDashboardSnapshot).mockResolvedValue({} as never);
    vi.mocked(dashboardSnapshotCacheModule.encodePublicDashboardSnapshot).mockReturnValue({ rowCount: 10 } as never);
    vi.mocked(dashboardSnapshotCacheModule.createPublicDashboardSnapshotEtag).mockReturnValue('"new-etag"');

    const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
    vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as never);

    const record = await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);

    expect(dashboardSnapshotModule.loadPublicDashboardSnapshot).toHaveBeenCalledWith(VERSIONS);
    expect(record.etag).toBe('"new-etag"');
    expect(record.payloadJson).toBe(JSON.stringify({ rowCount: 10 }));
    expect(db.insert).toHaveBeenCalled();
  });

  test("当快照表抛出异常（如未迁移）时优雅降级重新构建而不中断", async () => {
    vi.mocked(db.select).mockImplementation(() => {
      throw new Error("relation public_dashboard_snapshots does not exist");
    });

    vi.mocked(dashboardSnapshotModule.loadPublicDashboardSnapshot).mockResolvedValue({} as never);
    vi.mocked(dashboardSnapshotCacheModule.encodePublicDashboardSnapshot).mockReturnValue({ rowCount: 5 } as never);
    vi.mocked(dashboardSnapshotCacheModule.createPublicDashboardSnapshotEtag).mockReturnValue('"fallback-etag"');

    const record = await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);

    expect(record.etag).toBe('"fallback-etag"');
    expect(record.payloadJson).toBe(JSON.stringify({ rowCount: 5 }));
  });

  test("当全局缓存失效时，内存快照缓存自动清空", async () => {
    const mockRow = {
      key: "default",
      etag: '"test-etag"',
      dashboardVersion: "d-v1",
      pricingVersion: "p-v1",
      settingsVersion: "s-v1",
      payloadJson: '{"test":true}',
      updatedAt: new Date()
    };

    const limitMock = vi.fn().mockResolvedValue([mockRow]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);

    await getOrBuildPublicDashboardSnapshotRecord(VERSIONS);
    expect(_getInMemoryRecordForTest()).not.toBeNull();

    await invalidateAllCaches({ skipVersionBump: ["dashboard", "pricing", "admin_entities", "settings"] });
    expect(_getInMemoryRecordForTest()).toBeNull();
  });

  test("rebuildAndPersistPublicDashboardSnapshotRecord 能够强制重构并落库", async () => {
    vi.mocked(dashboardSnapshotModule.loadPublicDashboardSnapshot).mockResolvedValue({} as never);
    vi.mocked(dashboardSnapshotCacheModule.encodePublicDashboardSnapshot).mockReturnValue({ rebuilt: true } as never);
    vi.mocked(dashboardSnapshotCacheModule.createPublicDashboardSnapshotEtag).mockReturnValue('"rebuilt-etag"');

    const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
    vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as never);

    const record = await rebuildAndPersistPublicDashboardSnapshotRecord(VERSIONS);

    expect(record.etag).toBe('"rebuilt-etag"');
    expect(record.payloadJson).toBe(JSON.stringify({ rebuilt: true }));
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(_getInMemoryRecordForTest()).toEqual(record);
  });
});
