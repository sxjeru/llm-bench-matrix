import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

type ImportBenchmarkCsvFn = (inputText: string, sourceInput?: string | null, htmlInput?: string | null) => Promise<{
  format: string;
  parseSource?: string;
  total: number;
  skipped: number;
  warningCount: number;
  warnings: unknown[];
  inserted: number;
}>;

type MergeEntityFn = (input: {
  entityType: "model" | "benchmark";
  sourceId: number;
  targetId: number;
  targetBenchmarkName?: string;
}) => Promise<void>;

type TransactionCallback = (tx: unknown) => Promise<unknown>;

let mergeEntityForTest: MergeEntityFn;
let importBenchmarkCsvForTest: ImportBenchmarkCsvFn;
let dbForTest: {
  select: (...args: unknown[]) => unknown;
  transaction: (callback: TransactionCallback) => Promise<unknown>;
};

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const adminServiceModule = await import("@/lib/admin-service");
  mergeEntityForTest = adminServiceModule.mergeEntity as MergeEntityFn;
  importBenchmarkCsvForTest = adminServiceModule.importBenchmarkCsv as ImportBenchmarkCsvFn;

  const dbClientModule = await import("@/lib/db/client");
  dbForTest = dbClientModule.db as typeof dbForTest;
});

beforeEach(() => {
  vi.restoreAllMocks();
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
    const updateSet = vi.fn<(payload: Record<string, unknown>) => { where: typeof updateWhere }>(
      () => ({ where: updateWhere })
    );
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
    };

    const transactionSpy = vi
      .spyOn(dbForTest, "transaction")
      .mockImplementation(async (callback: TransactionCallback) => callback(tx));

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
    const updateSet = vi.fn<(payload: Record<string, unknown>) => { where: typeof updateWhere }>(
      () => ({ where: updateWhere })
    );
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
    };

    const transactionSpy = vi
      .spyOn(dbForTest, "transaction")
      .mockImplementation(async (callback: TransactionCallback) => callback(tx));

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
    const updateSet = vi.fn<(payload: Record<string, unknown>) => { where: typeof updateWhere }>(
      () => ({ where: updateWhere })
    );
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
    };

    const transactionSpy = vi
      .spyOn(dbForTest, "transaction")
      .mockImplementation(async (callback: TransactionCallback) => callback(tx));

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
    const dbSelectWhere = createSelectWhereMock([[]]);
    const dbSelectFrom = vi.fn(() => ({ where: dbSelectWhere }));
    const dbSelectSpy = vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: dbSelectFrom }));

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn<(payload: Record<string, unknown>) => { where: typeof updateWhere }>(
      () => ({ where: updateWhere })
    );
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
    };

    const transactionSpy = vi
      .spyOn(dbForTest, "transaction")
      .mockImplementation(async (callback: TransactionCallback) => callback(tx));

    await mergeEntityForTest({
      entityType: "benchmark",
      sourceId: 101,
      targetId: 202,
      targetBenchmarkName: "TAU2-Bench"
    });

    const benchmarkRenameCalls = updateSet.mock.calls
      .map((call) => call[0])
      .filter((payload): payload is Record<string, unknown> =>
        Boolean(payload) && typeof payload === "object" && "benchmarkName" in payload
      );

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

    dbSelectSpy.mockRestore();
    transactionSpy.mockRestore();
  });

  test("矩阵分类继承得到的非 General type 导入时不会错误复用同名 General benchmark", async () => {
    const inputText = [
      "Category\tBenchmark\tGPT-5.4",
      "Professional\tOfficeQA Pro\t68.1"
    ].join("\n");

    const dbSelectSpy = vi.spyOn(dbForTest, "select").mockImplementation(() => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    });

    const activeBenchmarks = [
      {
        id: 11,
        benchmarkName: "OfficeQA Pro",
        benchmarkType: "General",
        unit: "score",
        higherIsBetter: true,
        modalities: ["Text"],
        canonicalKey: "officeqapro:general",
        sourceBenchmarkId: null,
        mergedIntoBenchmarkId: null,
        createdAt: new Date("2026-04-01T00:00:00.000Z")
      }
    ];

    const createdBenchmark = {
      id: 22,
      benchmarkName: "OfficeQA Pro",
      benchmarkType: "Professional",
      unit: "score",
      higherIsBetter: true,
      modalities: ["Professional"],
      canonicalKey: "officeqapro:professional",
      sourceBenchmarkId: null,
      mergedIntoBenchmarkId: null,
      createdAt: new Date("2026-04-24T00:00:00.000Z")
    };

    const createdProvider = { id: 1, name: "OpenAI", slug: "openai", createdAt: new Date("2026-04-01T00:00:00.000Z") };
    const createdModel = {
      id: 2,
      providerId: 1,
      modelName: "GPT-5.4",
      modelAlias: null,
      canonicalKey: "gpt54",
      sourceModelId: null,
      mergedIntoModelId: null,
      createdAt: new Date("2026-04-01T00:00:00.000Z")
    };

    const providerSelectLimit = vi.fn().mockResolvedValue([createdProvider]);
    const providerSelectWhere = vi.fn().mockReturnValue({ limit: providerSelectLimit });
    const providerSelectFrom = vi.fn().mockReturnValue({ where: providerSelectWhere });

    const modelSelectLimit = vi.fn().mockResolvedValue([]);
    const modelSelectWhere = vi.fn().mockReturnValue({ limit: modelSelectLimit });
    const modelSelectFrom = vi.fn().mockReturnValue({ where: modelSelectWhere });

    const benchmarkCanonicalLimit = vi.fn().mockResolvedValue([]);
    const benchmarkCanonicalWhere = vi.fn().mockReturnValue({ limit: benchmarkCanonicalLimit });
    const benchmarkCanonicalFrom = vi.fn().mockReturnValue({ where: benchmarkCanonicalWhere });

    const benchmarkNameTypeLimit = vi.fn().mockResolvedValue([]);
    const benchmarkNameTypeWhere = vi.fn().mockReturnValue({ limit: benchmarkNameTypeLimit });
    const benchmarkNameTypeFrom = vi.fn().mockReturnValue({ where: benchmarkNameTypeWhere });

    const txSelect = vi.fn()
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(activeBenchmarks) }) })
      .mockReturnValueOnce({ from: providerSelectFrom })
      .mockReturnValueOnce({ from: modelSelectFrom })
      .mockReturnValueOnce({ from: benchmarkCanonicalFrom })
      .mockReturnValueOnce({ from: benchmarkNameTypeFrom });

    const insertCalls: Array<{ target: string; payload: unknown }> = [];

    const providerReturning = vi.fn().mockResolvedValue([createdProvider]);
    const providerValues = vi.fn((payload: unknown) => {
      insertCalls.push({ target: "providers", payload });
      return {
        onConflictDoUpdate: vi.fn(() => ({ returning: providerReturning }))
      };
    });

    const modelReturning = vi.fn().mockResolvedValue([createdModel]);
    const modelValues = vi.fn((payload: unknown) => {
      insertCalls.push({ target: "models", payload });
      return { returning: modelReturning };
    });

    const benchmarkReturning = vi.fn().mockResolvedValue([createdBenchmark]);
    const benchmarkValuesInsert = vi.fn((payload: unknown) => {
      insertCalls.push({ target: "benchmarks", payload });
      return { returning: benchmarkReturning };
    });

    const valueRowsInsert = vi.fn((payload: unknown) => {
      insertCalls.push({ target: "benchmark_values", payload });
      return Promise.resolve(undefined);
    });

    const sourceMetaOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const sourceMetaValues = vi.fn((payload: unknown) => {
      insertCalls.push({ target: "benchmark_source_meta", payload });
      return { onConflictDoUpdate: sourceMetaOnConflictDoUpdate };
    });

    const txInsert = vi.fn()
      .mockReturnValueOnce({ values: providerValues })
      .mockReturnValueOnce({ values: modelValues })
      .mockReturnValueOnce({ values: benchmarkValuesInsert })
      .mockReturnValueOnce({ values: valueRowsInsert })
      .mockReturnValueOnce({ values: sourceMetaValues });

    const tx = {
      select: txSelect,
      insert: txInsert,
      update: vi.fn(() => ({ set: vi.fn() })),
      delete: vi.fn()
    };

    const transactionSpy = vi
      .spyOn(dbForTest, "transaction")
      .mockImplementation(async (callback: TransactionCallback) => callback(tx));

    try {
      const result = await importBenchmarkCsvForTest(inputText, "text:unit-test");

      expect(result.inserted).toBe(1);
      expect(benchmarkValuesInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          benchmarkName: "OfficeQA Pro",
          benchmarkType: "Professional"
        })
      );
      expect(sourceMetaValues).toHaveBeenCalledWith([
        expect.objectContaining({
          benchmarkId: 22,
          source: "text:unit-test",
          benchmarkType: "Professional"
        })
      ]);
    } finally {
      transactionSpy.mockRestore();
      dbSelectSpy.mockRestore();
    }
  });

  test("测试环境下 settings 查询不可用时会回退默认 dedupe 规则继续导入", async () => {
    const inputText = [
      "Category\tBenchmark\tGPT-5.4",
      "Professional\tOfficeQA Pro\t68.1"
    ].join("\n");

    const dbSelectSpy = vi.spyOn(dbForTest, "select").mockImplementation(() => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    });

    const createdProvider = { id: 1, name: "OpenAI", slug: "openai", createdAt: new Date("2026-04-01T00:00:00.000Z") };
    const createdModel = {
      id: 2,
      providerId: 1,
      modelName: "GPT-5.4",
      modelAlias: null,
      canonicalKey: "gpt54",
      sourceModelId: null,
      mergedIntoModelId: null,
      createdAt: new Date("2026-04-01T00:00:00.000Z")
    };
    const createdBenchmark = {
      id: 22,
      benchmarkName: "OfficeQA Pro",
      benchmarkType: "Professional",
      unit: "score",
      higherIsBetter: true,
      modalities: ["Professional"],
      canonicalKey: "officeqapro:professional",
      sourceBenchmarkId: null,
      mergedIntoBenchmarkId: null,
      createdAt: new Date("2026-04-24T00:00:00.000Z")
    };

    const txSelect = vi.fn()
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([createdProvider]) }) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) });

    const providerReturning = vi.fn().mockResolvedValue([createdProvider]);
    const providerOnConflictDoUpdate = vi.fn(() => ({ returning: providerReturning }));
    const modelReturning = vi.fn().mockResolvedValue([createdModel]);
    const benchmarkReturning = vi.fn().mockResolvedValue([createdBenchmark]);
    const valueRowsInsert = vi.fn().mockResolvedValue(undefined);
    const sourceMetaOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);

    const txInsert = vi.fn()
      .mockReturnValueOnce({ values: vi.fn(() => ({ onConflictDoUpdate: providerOnConflictDoUpdate })) })
      .mockReturnValueOnce({ values: vi.fn(() => ({ returning: modelReturning })) })
      .mockReturnValueOnce({ values: vi.fn(() => ({ returning: benchmarkReturning })) })
      .mockReturnValueOnce({ values: vi.fn(() => valueRowsInsert) })
      .mockReturnValueOnce({ values: vi.fn(() => ({ onConflictDoUpdate: sourceMetaOnConflictDoUpdate })) });

    const tx = {
      select: txSelect,
      insert: txInsert,
      update: vi.fn(() => ({ set: vi.fn() })),
      delete: vi.fn()
    };

    const transactionSpy = vi
      .spyOn(dbForTest, "transaction")
      .mockImplementation(async (callback: TransactionCallback) => callback(tx));

    try {
      const result = await importBenchmarkCsvForTest(inputText, "text:unit-test");
      expect(result.inserted).toBe(1);
      expect(txInsert).toHaveBeenCalled();
    } finally {
      transactionSpy.mockRestore();
      dbSelectSpy.mockRestore();
    }
  });
});
