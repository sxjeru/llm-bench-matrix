import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

type RenameEntityFn = (input: {
  entityType: "model" | "benchmark" | "source";
  entityId?: number;
  sourceName?: string;
  nextName: string;
  nextBenchmarkType?: string;
  mergeOnConflict?: boolean;
}) => Promise<{
  ok: true;
  entityType: "model" | "benchmark" | "source";
  entityId?: number;
  previousName: string;
  nextName: string;
  previousBenchmarkType?: string;
  nextBenchmarkType?: string;
  action: "renamed" | "merged-and-renamed" | "unchanged";
  mergedSourceId?: number;
  mergedSourceName?: string;
  renamedValueCount?: number;
  renamedSourceMetaCount?: number;
  mergedSourceMetaCount?: number;
}>;

type TransactionCallback = (tx: unknown) => Promise<unknown>;

let renameEntityForTest: RenameEntityFn;
let dbForTest: {
  select: (...args: unknown[]) => unknown;
  update: (...args: unknown[]) => unknown;
  transaction: (callback: TransactionCallback) => Promise<unknown>;
};

function createSelectWhereMock(results: unknown[]) {
  const queue = [...results];

  return vi.fn().mockImplementation(() => {
    const nextResult = queue.shift() ?? [];
    const queryPromise = Promise.resolve(nextResult) as Promise<unknown> & {
      limit: (value: number) => Promise<unknown>;
    };

    queryPromise.limit = vi.fn().mockResolvedValue(nextResult);
    return queryPromise;
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const adminServiceModule = await import("@/lib/admin-service");
  renameEntityForTest = adminServiceModule.renameEntity as RenameEntityFn;

  const dbClientModule = await import("@/lib/db/client");
  dbForTest = dbClientModule.db as typeof dbForTest;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renameEntity", () => {
  test("model 改名命中重名时会合并冲突实体并完成改名", async () => {
    const dbSelectWhere = createSelectWhereMock([[]]);
    const dbSelectFrom = vi.fn(() => ({ where: dbSelectWhere }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: dbSelectFrom }));

    const txSelectWhere = createSelectWhereMock([
      [
        {
          id: 101,
          providerId: 1,
          modelName: "Model A",
          canonicalKey: "modela",
          mergedIntoModelId: null
        }
      ],
      [
        {
          id: 202,
          modelName: "Model-B",
          canonicalKey: "modelb",
          mergedIntoModelId: null
        }
      ]
    ]);
    const txSelectFrom = vi.fn(() => ({ where: txSelectWhere }));
    const txSelect = vi.fn(() => ({ from: txSelectFrom }));

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn<(payload: Record<string, unknown>) => { where: typeof updateWhere }>(
      () => ({ where: updateWhere })
    );
    const update = vi.fn(() => ({ set: updateSet }));

    const tx = {
      select: txSelect,
      update
    };

    vi
      .spyOn(dbForTest, "transaction")
      .mockImplementation(async (callback: TransactionCallback) => callback(tx));

    const result = await renameEntityForTest({
      entityType: "model",
      entityId: 101,
      nextName: "Model B",
      mergeOnConflict: true
    });

    expect(result.action).toBe("merged-and-renamed");
    expect(result.entityId).toBe(101);
    expect(result.mergedSourceId).toBe(202);
    expect(result.nextName).toBe("Model B");

    const updatePayloads = updateSet.mock.calls.map(([payload]) => payload);

    expect(updatePayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelId: 101 }),
        expect.objectContaining({ mergedIntoModelId: 101 }),
        expect.objectContaining({ modelName: "Model B", canonicalKey: "modelb" })
      ])
    );

    expect(
      updatePayloads.some((payload) =>
        typeof payload.modelName === "string"
        && payload.modelName.includes("#merged-202-")
        && typeof payload.canonicalKey === "string"
        && payload.canonicalKey.includes("#merged-202-")
      )
    ).toBe(true);
  });

  test("benchmark 无冲突改名会直接入库更新名称与 canonical", async () => {
    const dbSelectWhere = createSelectWhereMock([
      [],
      [
        {
          id: 301,
          benchmarkName: "Bench-Old",
          benchmarkType: "Type-A",
          canonicalKey: "benchold:typea",
          mergedIntoBenchmarkId: null
        }
      ],
      []
    ]);
    const dbSelectFrom = vi.fn(() => ({ where: dbSelectWhere }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: dbSelectFrom }));

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn<(payload: Record<string, unknown>) => { where: typeof updateWhere }>(
      () => ({ where: updateWhere })
    );
    vi.spyOn(dbForTest, "update").mockImplementation(() => ({ set: updateSet }));

    const result = await renameEntityForTest({
      entityType: "benchmark",
      entityId: 301,
      nextName: "Bench New"
    });

    expect(result.action).toBe("renamed");
    expect(result.entityId).toBe(301);
    expect(result.nextName).toBe("Bench New");

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        benchmarkName: "Bench New",
        canonicalKey: "benchnew:typea"
      })
    );
  });

  test("benchmark 可在改名时同步修改 type", async () => {
    const dbSelectWhere = createSelectWhereMock([
      [],
      [
        {
          id: 302,
          benchmarkName: "Bench-Old",
          benchmarkType: "Type-A",
          canonicalKey: "benchold:typea",
          mergedIntoBenchmarkId: null
        }
      ],
      []
    ]);
    const dbSelectFrom = vi.fn(() => ({ where: dbSelectWhere }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: dbSelectFrom }));

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn<(payload: Record<string, unknown>) => { where: typeof updateWhere }>(
      () => ({ where: updateWhere })
    );
    vi.spyOn(dbForTest, "update").mockImplementation(() => ({ set: updateSet }));

    const result = await renameEntityForTest({
      entityType: "benchmark",
      entityId: 302,
      nextName: "Bench New",
      nextBenchmarkType: "Type-Z"
    });

    expect(result.action).toBe("renamed");
    expect(result.entityId).toBe(302);
    expect(result.nextName).toBe("Bench New");
    expect(result.nextBenchmarkType).toBe("Type-Z");

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        benchmarkName: "Bench New",
        benchmarkType: "Type-Z",
        canonicalKey: "benchnew:typez"
      })
    );
  });

  test("benchmark 改名命中冲突且允许自动合并时，会走合并+改名路径", async () => {
    const dbSelectWhere = createSelectWhereMock([
      [],
      [
        {
          id: 401,
          benchmarkName: "Bench-Alpha",
          benchmarkType: "Type-A",
          canonicalKey: "benchalpha:typea",
          mergedIntoBenchmarkId: null
        }
      ],
      [
        {
          id: 499,
          benchmarkName: "Bench Beta",
          mergedIntoBenchmarkId: null
        }
      ]
    ]);
    const dbSelectFrom = vi.fn(() => ({ where: dbSelectWhere }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: dbSelectFrom }));

    const txSelectWhere = createSelectWhereMock([
      [{ benchmarkName: "Bench-Alpha", benchmarkType: "Type-A" }],
      [],
      [],
      [{ benchmarkType: "Type-B", modalities: ["Text"] }],
      [],
      []
    ]);
    const txSelectFrom = vi.fn(() => ({ where: txSelectWhere }));
    const txSelect = vi.fn(() => ({ from: txSelectFrom }));

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn<(payload: Record<string, unknown>) => { where: typeof updateWhere }>(
      () => ({ where: updateWhere })
    );
    const update = vi.fn(() => ({ set: updateSet }));

    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const insertValues = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values: insertValues }));

    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn(() => ({ where: deleteWhere }));

    const tx = {
      select: txSelect,
      update,
      insert,
      delete: deleteFn
    };

    const transactionSpy = vi
      .spyOn(dbForTest, "transaction")
      .mockImplementation(async (callback: TransactionCallback) => callback(tx));

    const result = await renameEntityForTest({
      entityType: "benchmark",
      entityId: 401,
      nextName: "Bench Beta",
      mergeOnConflict: true
    });

    expect(result.action).toBe("merged-and-renamed");
    expect(result.mergedSourceId).toBe(499);
    expect(result.nextName).toBe("Bench Beta");
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ benchmarkName: "Bench Beta", canonicalKey: "benchbeta:typea" })
    );
  });

  test("source 改名目标已存在时会更新 values 并合并 source meta", async () => {
    const txSelectWhere = createSelectWhereMock([
      [{ id: 1 }],
      [
        { id: 10, benchmarkId: 101 },
        { id: 11, benchmarkId: 102 }
      ],
      [{ id: 2 }],
      [{ id: 20, benchmarkId: 102 }]
    ]);
    const txSelectFrom = vi.fn(() => ({ where: txSelectWhere }));
    const txSelect = vi.fn(() => ({ from: txSelectFrom }));

    const updateReturning = vi.fn().mockResolvedValue([{ id: 1 }, { id: 3 }]);
    const updateWhere = vi.fn(() => ({ returning: updateReturning }));
    const updateSet = vi.fn<(payload: Record<string, unknown>) => { where: typeof updateWhere }>(
      () => ({ where: updateWhere })
    );
    const update = vi.fn(() => ({ set: updateSet }));

    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn(() => ({ where: deleteWhere }));

    const tx = {
      select: txSelect,
      update,
      delete: deleteFn
    };

    const transactionSpy = vi
      .spyOn(dbForTest, "transaction")
      .mockImplementation(async (callback: TransactionCallback) => callback(tx));

    const result = await renameEntityForTest({
      entityType: "source",
      sourceName: "text:old-source",
      nextName: "text:new-source",
      mergeOnConflict: true
    });

    expect(result).toMatchObject({
      action: "merged-and-renamed",
      entityType: "source",
      previousName: "text:old-source",
      nextName: "text:new-source",
      renamedValueCount: 2,
      renamedSourceMetaCount: 1,
      mergedSourceMetaCount: 1
    });

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ source: "text:new-source", updatedAt: expect.any(Date) })
    );
    expect(updateSet).toHaveBeenCalledWith({ source: "text:new-source" });
    expect(deleteFn).toHaveBeenCalledTimes(1);
  });

  test("model 改名会调用 applyAaVersionTrackingEntityChange 级联更新版本追踪状态", async () => {
    const aaStoreModule = await import("@/lib/benchmark-versions/aa-index-version-store");
    const syncSpy = vi.spyOn(aaStoreModule, "applyAaVersionTrackingEntityChange").mockResolvedValue(true);

    const dbSelectWhere = createSelectWhereMock([[]]);
    const dbSelectFrom = vi.fn(() => ({ where: dbSelectWhere }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: dbSelectFrom }));

    const txSelectWhere = createSelectWhereMock([
      [
        {
          id: 88,
          providerId: 1,
          modelName: "Model Old",
          canonicalKey: "modelold",
          mergedIntoModelId: null
        }
      ],
      [] // 无冲突
    ]);
    const txSelectFrom = vi.fn(() => ({ where: txSelectWhere }));
    const txSelect = vi.fn(() => ({ from: txSelectFrom }));

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));

    const tx = { select: txSelect, update };

    vi.spyOn(dbForTest, "transaction").mockImplementation(async (callback: TransactionCallback) => callback(tx));

    const result = await renameEntityForTest({
      entityType: "model",
      entityId: 88,
      nextName: "Model New"
    });

    expect(result.action).toBe("renamed");
    expect(syncSpy).toHaveBeenCalledWith({
      type: "model-renamed",
      modelId: 88,
      previousName: "Model Old",
      nextName: "Model New"
    });
  });

  test("benchmark 直接改名与冲突合并改名均会调用 applyAaVersionTrackingEntityChange 级联更新版本追踪状态", async () => {
    const aaStoreModule = await import("@/lib/benchmark-versions/aa-index-version-store");
    const syncSpy = vi.spyOn(aaStoreModule, "applyAaVersionTrackingEntityChange").mockResolvedValue(true);

    // 1. 测试 benchmark 直接改名
    const dbSelectWhere1 = createSelectWhereMock([
      [], // dedupe rule
      [
        {
          id: 301,
          benchmarkName: "Bench-Old",
          benchmarkType: "Type-A",
          canonicalKey: "benchold:typea",
          mergedIntoBenchmarkId: null
        }
      ],
      [] // 无冲突
    ]);
    const dbSelectFrom1 = vi.fn(() => ({ where: dbSelectWhere1 }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: dbSelectFrom1 }));

    const updateWhere1 = vi.fn().mockResolvedValue(undefined);
    const updateSet1 = vi.fn(() => ({ where: updateWhere1 }));
    vi.spyOn(dbForTest, "update").mockImplementation(() => ({ set: updateSet1 }));

    const directResult = await renameEntityForTest({
      entityType: "benchmark",
      entityId: 301,
      nextName: "Bench New"
    });

    expect(directResult.action).toBe("renamed");
    expect(syncSpy).toHaveBeenCalledWith({
      type: "benchmark-renamed",
      benchmarkId: 301,
      previousName: "Bench-Old",
      previousType: "Type-A",
      nextName: "Bench New",
      nextType: "Type-A"
    });

    syncSpy.mockClear();

    // 2. 测试 benchmark 冲突合并改名
    const dbSelectWhere2 = createSelectWhereMock([
      [], // dedupe rule
      [
        {
          id: 401,
          benchmarkName: "Bench-Alpha",
          benchmarkType: "Type-A",
          canonicalKey: "benchalpha:typea",
          mergedIntoBenchmarkId: null
        }
      ],
      [
        {
          id: 499,
          benchmarkName: "Bench Beta",
          benchmarkType: "Type-A",
          mergedIntoBenchmarkId: null
        }
      ]
    ]);
    const dbSelectFrom2 = vi.fn(() => ({ where: dbSelectWhere2 }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: dbSelectFrom2 }));

    const txSelectWhere2 = createSelectWhereMock([
      [{ benchmarkName: "Bench-Alpha", benchmarkType: "Type-A" }],
      [],
      [],
      [{ benchmarkType: "Type-B", modalities: ["Text"] }],
      [],
      []
    ]);
    const txSelectFrom2 = vi.fn(() => ({ where: txSelectWhere2 }));
    const txSelect2 = vi.fn(() => ({ from: txSelectFrom2 }));

    const updateWhere2 = vi.fn().mockResolvedValue(undefined);
    const updateSet2 = vi.fn(() => ({ where: updateWhere2 }));
    const update2 = vi.fn(() => ({ set: updateSet2 }));

    const onConflictDoNothing2 = vi.fn().mockResolvedValue(undefined);
    const insertValues2 = vi.fn(() => ({ onConflictDoNothing: onConflictDoNothing2 }));
    const insert2 = vi.fn(() => ({ values: insertValues2 }));

    const deleteWhere2 = vi.fn().mockResolvedValue(undefined);
    const deleteFn2 = vi.fn(() => ({ where: deleteWhere2 }));

    const tx2 = {
      select: txSelect2,
      update: update2,
      insert: insert2,
      delete: deleteFn2
    };

    vi.spyOn(dbForTest, "transaction").mockImplementation(async (callback: TransactionCallback) => callback(tx2));

    const mergeResult = await renameEntityForTest({
      entityType: "benchmark",
      entityId: 401,
      nextName: "Bench Beta",
      mergeOnConflict: true
    });

    expect(mergeResult.action).toBe("merged-and-renamed");
    // 验证既触发了被合并冲突项的 benchmark-merged，又触发了幸存主体改名的 benchmark-renamed
    expect(syncSpy).toHaveBeenCalledWith({
      type: "benchmark-merged",
      sourceId: 499,
      targetId: 401,
      targetName: "Bench Beta",
      targetType: "Type-A"
    });
    expect(syncSpy).toHaveBeenCalledWith({
      type: "benchmark-renamed",
      benchmarkId: 401,
      previousName: "Bench-Alpha",
      previousType: "Type-A",
      nextName: "Bench Beta",
      nextType: "Type-A"
    });
  });
});
