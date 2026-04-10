import { beforeAll, describe, expect, test, vi } from "vitest";

type MergeEntityFn = (input: {
  entityType: "model" | "benchmark";
  sourceId: number;
  targetId: number;
  targetBenchmarkName?: string;
}) => Promise<void>;

let mergeEntityForTest: MergeEntityFn;
let dbForTest: {
  transaction: (callback: (tx: any) => Promise<unknown>) => Promise<unknown>;
};

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const adminServiceModule = await import("@/lib/admin-service");
  mergeEntityForTest = adminServiceModule.mergeEntity as MergeEntityFn;

  const dbClientModule = await import("@/lib/db/client");
  dbForTest = dbClientModule.db as typeof dbForTest;
});

describe("mergeEntity benchmark source meta migration", () => {
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

  test("benchmark 合并时会迁移 benchmark_source_meta 到 target benchmark", async () => {
    const sourceMetaRows = [
      {
        source: "text:legacy-source",
        benchmarkType: "STEM",
        modalities: ["Vision"]
      }
    ];

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));

    const selectWhere = createSelectWhereMock([
      [{ benchmarkType: "STEM", modalities: ["Vision"] }],
      [{ source: "text:legacy-source" }],
      sourceMetaRows
    ]);
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));

    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn(() => ({ where: deleteWhere }));

    const tx = {
      update,
      select,
      insert,
      delete: deleteFn
    } as any;

    const transactionSpy = vi
      .spyOn(dbForTest, "transaction")
      .mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(tx));

    await mergeEntityForTest({
      entityType: "benchmark",
      sourceId: 101,
      targetId: 202
    });

    expect(values).toHaveBeenCalledWith([
      {
        benchmarkId: 202,
        source: "text:legacy-source",
        benchmarkType: "STEM",
        modalities: ["Vision"]
      }
    ]);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(deleteFn).toHaveBeenCalledTimes(1);

    transactionSpy.mockRestore();
  });

  test("当 source benchmark 没有 source meta 但有 source value 时，会按 source benchmark 回填 meta", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));

    const selectWhere = createSelectWhereMock([
      [{ benchmarkType: "Document & Chart Understanding", modalities: ["Vision"] }],
      [{ source: "text:Seed2.0" }],
      []
    ]);
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));

    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn(() => ({ where: deleteWhere }));

    const tx = {
      update,
      select,
      insert,
      delete: deleteFn
    } as any;

    const transactionSpy = vi
      .spyOn(dbForTest, "transaction")
      .mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(tx));

    await mergeEntityForTest({
      entityType: "benchmark",
      sourceId: 301,
      targetId: 302
    });

    expect(values).toHaveBeenCalledWith([
      {
        benchmarkId: 302,
        source: "text:Seed2.0",
        benchmarkType: "Document & Chart Understanding",
        modalities: ["Vision"]
      }
    ]);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(deleteFn).not.toHaveBeenCalled();

    transactionSpy.mockRestore();
  });

  test("当 source benchmark 没有 source value 且没有 source meta 时，不会执行 meta 迁移写入", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));

    const selectWhere = createSelectWhereMock([
      [{ benchmarkType: "General", modalities: ["Text"] }],
      [],
      []
    ]);
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));

    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn(() => ({ where: deleteWhere }));

    const tx = {
      update,
      select,
      insert,
      delete: deleteFn
    } as any;

    const transactionSpy = vi
      .spyOn(dbForTest, "transaction")
      .mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(tx));

    await mergeEntityForTest({
      entityType: "benchmark",
      sourceId: 401,
      targetId: 402
    });

    expect(values).not.toHaveBeenCalled();
    expect(onConflictDoNothing).not.toHaveBeenCalled();
    expect(deleteFn).not.toHaveBeenCalled();

    transactionSpy.mockRestore();
  });

  test("benchmark 改名命中 source canonical 冲突时，会先给 source 临时避让再更新 target", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));

    const selectWhere = createSelectWhereMock([
      [{ benchmarkName: "Tau²-Bench", benchmarkType: "GeneralAgent" }],
      [{ id: 101 }],
      [],
      [{ benchmarkName: "TAU2-Bench", canonicalKey: "tau2bench:generalagent" }],
      [{ benchmarkType: "GeneralAgent", modalities: ["Text"] }],
      [],
      []
    ]);
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));

    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn(() => ({ where: deleteWhere }));

    const tx = {
      update,
      select,
      insert,
      delete: deleteFn
    } as any;

    const transactionSpy = vi
      .spyOn(dbForTest, "transaction")
      .mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(tx));

    await mergeEntityForTest({
      entityType: "benchmark",
      sourceId: 101,
      targetId: 202,
      targetBenchmarkName: "TAU2-Bench"
    });

    const benchmarkRenameCalls = updateSet.mock.calls
      .map((call) => call[0])
      .filter((payload) => payload && typeof payload === "object" && "benchmarkName" in payload);

    expect(
      benchmarkRenameCalls.some((payload) =>
        typeof payload.benchmarkName === "string"
        && payload.benchmarkName === "TAU2-Bench"
        && payload.canonicalKey === "tau2bench:generalagent"
      )
    ).toBe(true);

    expect(
      benchmarkRenameCalls.some((payload) =>
        typeof payload.benchmarkName === "string"
        && payload.benchmarkName.includes("#merged-101-")
        && typeof payload.canonicalKey === "string"
        && payload.canonicalKey.includes("#merged-101-")
      )
    ).toBe(true);

    transactionSpy.mockRestore();
  });
});
