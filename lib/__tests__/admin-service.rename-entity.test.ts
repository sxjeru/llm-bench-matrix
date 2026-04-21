import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

type RenameEntityFn = (input: {
  entityType: "model" | "benchmark";
  entityId: number;
  nextName: string;
  nextBenchmarkType?: string;
  mergeOnConflict?: boolean;
}) => Promise<{
  ok: true;
  entityType: "model" | "benchmark";
  entityId: number;
  previousName: string;
  nextName: string;
  previousBenchmarkType?: string;
  nextBenchmarkType?: string;
  action: "renamed" | "merged-and-renamed" | "unchanged";
  mergedSourceId?: number;
  mergedSourceName?: string;
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
});
