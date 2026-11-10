import { beforeAll, describe, expect, test, vi } from "vitest";

const dbClientMock = vi.hoisted(() => ({ db: {} as unknown }));

vi.mock("@/lib/db/client", () => ({
  get db() {
    return dbClientMock.db;
  }
}));

type AdminService = typeof import("@/lib/admin-service");
let service: AdminService;

beforeAll(async () => {
  service = await import("@/lib/admin-service");
});

function makeExecutor(selectResults: unknown[]) {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const select = vi.fn();

  for (const rows of selectResults) {
    select.mockReturnValueOnce({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(rows) }))
    });
  }

  return {
    select,
    update: vi.fn(() => ({ set: updateSet })),
    delete: vi.fn(() => ({ where: deleteWhere })),
    updateSet,
    deleteWhere
  };
}

describe("resolveMergedModelTargets", () => {
  test("多跳合并一律解析到最终活跃模型", () => {
    const targets = service.resolveMergedModelTargets([
      { id: 184, mergedIntoModelId: 414 },
      { id: 300, mergedIntoModelId: 184 }
    ]);

    expect([...targets.entries()]).toEqual([
      [184, 414],
      [300, 414]
    ]);
  });

  test("合并链成环时跳过，避免把数据迁到错误模型", () => {
    expect(
      service.resolveMergedModelTargets([
        { id: 1, mergedIntoModelId: 2 },
        { id: 2, mergedIntoModelId: 1 }
      ]).size
    ).toBe(0);
  });
});

describe("migrateExternalModelMappingsOnMerge", () => {
  test("目标模型尚无绑定时把来源映射改挂到目标", async () => {
    const executor = makeExecutor([
      [{ id: 150, source: "artificial-analysis" }],
      []
    ]);

    const count = await service.migrateExternalModelMappingsOnMerge(executor as never, 184, 414);

    expect(count).toBe(1);
    expect(executor.updateSet).toHaveBeenCalledWith(expect.objectContaining({ modelId: 414 }));
    expect(executor.deleteWhere).not.toHaveBeenCalled();
  });

  test("目标模型已有绑定时删除来源映射，避免撞唯一索引", async () => {
    const executor = makeExecutor([
      [{ id: 150, source: "artificial-analysis" }],
      [{ id: 151 }]
    ]);

    const count = await service.migrateExternalModelMappingsOnMerge(executor as never, 184, 414);

    expect(count).toBe(1);
    expect(executor.deleteWhere).toHaveBeenCalledTimes(1);
    expect(executor.updateSet).not.toHaveBeenCalled();
  });

  test("来源模型没有映射时不产生任何写操作", async () => {
    const executor = makeExecutor([[]]);

    const count = await service.migrateExternalModelMappingsOnMerge(executor as never, 184, 414);

    expect(count).toBe(0);
    expect(executor.select).toHaveBeenCalledTimes(1);
    expect(executor.updateSet).not.toHaveBeenCalled();
    expect(executor.deleteWhere).not.toHaveBeenCalled();
  });
});
