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

type HasBenchmarkSymbolSemanticMismatchFn = (left: string, right: string) => boolean;
type GetDashboardRowsFn = (limit?: number | null, sourceFilter?: string | null) => Promise<Array<{
  benchmarkName: string;
  benchmarkType: string;
  sourceBenchmarkType: string | null;
  modalities: string[];
  sourceModalities: string[] | null;
  source: string | null;
}>>;

type TransactionCallback = (tx: unknown) => Promise<unknown>;

let mergeEntityForTest: MergeEntityFn;
let importBenchmarkCsvForTest: ImportBenchmarkCsvFn;
let hasBenchmarkSymbolSemanticMismatchForTest: HasBenchmarkSymbolSemanticMismatchFn;
let getDashboardRowsForTest: GetDashboardRowsFn;
let dbForTest: {
  select: (...args: unknown[]) => unknown;
  transaction: (callback: TransactionCallback) => Promise<unknown>;
};

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const adminServiceModule = await import("@/lib/admin-service");
  mergeEntityForTest = adminServiceModule.mergeEntity as MergeEntityFn;
  importBenchmarkCsvForTest = adminServiceModule.importBenchmarkCsv as ImportBenchmarkCsvFn;
  hasBenchmarkSymbolSemanticMismatchForTest = adminServiceModule.__hasBenchmarkSymbolSemanticMismatchForTest as HasBenchmarkSymbolSemanticMismatchFn;

  const queryModule = await import("@/lib/db/queries");
  getDashboardRowsForTest = queryModule.getDashboardRows as GetDashboardRowsFn;

  const dbClientModule = await import("@/lib/db/client");
  dbForTest = dbClientModule.db as typeof dbForTest;
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("mergeEntity benchmark source meta migration", () => {
  test("benchmark 重复检测会识别 @ 和 ^ 的关键语义差异", () => {
    expect(
      hasBenchmarkSymbolSemanticMismatchForTest(
        "Claw-Eval (Pass@3) [Agentic]",
        "Claw-Eval (Pass^3) [Coding Agent]"
      )
    ).toBe(true);

    expect(
      hasBenchmarkSymbolSemanticMismatchForTest(
        "Claw-Eval (Pass@3)",
        "Claw-Eval (Pass@3)"
      )
    ).toBe(false);
  });

  test("source 视图会优先展示 benchmark_source_meta 中保留的原类别", async () => {
    const baseRows = [
      {
        id: 1,
        providerId: 1,
        providerName: "Anthropic",
        providerConfig: null,
        modelName: "Claude 4",
        benchmarkName: "Claw-Eval",
        benchmarkType: "Coding Agent",
        higherIsBetter: true,
        benchmarkTypeOverride: "Agentic",
        benchmarkCanonicalKey: "claweval:codingagent",
        modalities: ["Text"],
        modalitiesOverride: ["Agentic"],
        benchTime: new Date("2026-05-06T00:00:00.000Z"),
        valueRaw: "75",
        valueNum: 75,
        valueNum2: null,
        valueNote: null,
        source: "text:claw-source",
        updatedAt: new Date("2026-05-06T00:00:00.000Z")
      }
    ];

    const providerRows: unknown[] = [];
    const dashboardLimit = vi.fn().mockResolvedValue(baseRows);
    const dashboardOrderBy = vi.fn(() => ({ limit: dashboardLimit }));
    const dashboardWhere = vi.fn(() => ({ orderBy: dashboardOrderBy }));
    const dashboardLeftJoin = vi.fn(() => ({ where: dashboardWhere }));
    const dashboardInnerJoin3 = vi.fn(() => ({ leftJoin: dashboardLeftJoin }));
    const dashboardInnerJoin2 = vi.fn(() => ({ innerJoin: dashboardInnerJoin3 }));
    const dashboardInnerJoin1 = vi.fn(() => ({ innerJoin: dashboardInnerJoin2 }));
    const dashboardFrom = vi.fn(() => ({ innerJoin: dashboardInnerJoin1 }));

    const providerSelect = {
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(providerRows)
      }))
    };

    const selectMock = vi.fn().mockImplementation((selection?: unknown) => {
      if (selection && typeof selection === "object") {
        return { from: dashboardFrom };
      }
      return providerSelect;
    });

    const dbSelectSpy = vi.spyOn(dbForTest, "select").mockImplementation(selectMock);

    try {
      const sourceRows = await getDashboardRowsForTest(null, "text:claw-source");
      const allRows = await getDashboardRowsForTest(null, null);

      expect(sourceRows[0]?.benchmarkType).toBe("Coding Agent");
      expect(sourceRows[0]?.sourceBenchmarkType).toBe("Agentic");
      expect(sourceRows[0]?.modalities).toEqual(["Text"]);
      expect(sourceRows[0]?.sourceModalities).toEqual(["Agentic"]);
      expect(allRows[0]?.benchmarkType).toBe("Coding Agent");
    } finally {
      dbSelectSpy.mockRestore();
    }
  });

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

  test("矩阵分类继承得到的非 General type 导入时会复用同名 General benchmark，并用 source meta 保留导入分类", async () => {
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

    const txSelect = vi.fn()
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(activeBenchmarks) }) })
      .mockReturnValueOnce({ from: providerSelectFrom })
      .mockReturnValueOnce({ from: modelSelectFrom });

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
      expect(insertCalls.some((call) => call.target === "benchmarks")).toBe(false);
      expect(valueRowsInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          benchmarkId: 11
        })
      ]);
      expect(sourceMetaValues).toHaveBeenCalledWith([
        expect.objectContaining({
          benchmarkId: 11,
          source: "text:unit-test",
          benchmarkType: "Professional"
        })
      ]);
    } finally {
      transactionSpy.mockRestore();
      dbSelectSpy.mockRestore();
    }
  });

  test("导入同名但类别不同的 benchmark 时会复用已有更多记录的同名 benchmark，并保留新 source 类别", async () => {
    const inputText = [
      "Category\tBenchmark\tQwen3.6",
      "STEM\tMMMU-Pro\t72.4"
    ].join("\n");

    const dbSelectSpy = vi.spyOn(dbForTest, "select").mockImplementation(() => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    });

    const activeBenchmarks = [
      {
        id: 58,
        benchmarkName: "MMMU-Pro",
        benchmarkType: "STEM and Puzzle",
        unit: "score",
        higherIsBetter: true,
        modalities: ["STEM", "Puzzle"],
        canonicalKey: "mmmupro:stemandpuzzle",
        sourceBenchmarkId: null,
        mergedIntoBenchmarkId: null,
        createdAt: new Date("2026-04-01T00:00:00.000Z")
      }
    ];

    const createdProvider = { id: 1, name: "Qwen", slug: "qwen", createdAt: new Date("2026-04-01T00:00:00.000Z") };
    const createdModel = {
      id: 2,
      providerId: 1,
      modelName: "Qwen3.6",
      modelAlias: null,
      canonicalKey: "qwen36",
      sourceModelId: null,
      mergedIntoModelId: null,
      createdAt: new Date("2026-04-01T00:00:00.000Z")
    };

    const txSelect = vi.fn()
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(activeBenchmarks) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([createdProvider]) }) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) });

    const providerReturning = vi.fn().mockResolvedValue([createdProvider]);
    const modelReturning = vi.fn().mockResolvedValue([createdModel]);
    const valueRowsInsert = vi.fn().mockResolvedValue(undefined);
    const sourceMetaOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const sourceMetaValues = vi.fn(() => ({ onConflictDoUpdate: sourceMetaOnConflictDoUpdate }));

    const txInsert = vi.fn()
      .mockReturnValueOnce({ values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(() => ({ returning: providerReturning })) })) })
      .mockReturnValueOnce({ values: vi.fn(() => ({ returning: modelReturning })) })
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
      const result = await importBenchmarkCsvForTest(inputText, "text:Qwen3.6");

      expect(result.inserted).toBe(1);
      expect(txInsert).toHaveBeenCalledTimes(4);
      expect(valueRowsInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          benchmarkId: 58,
          source: "text:Qwen3.6"
        })
      ]);
      expect(sourceMetaValues).toHaveBeenCalledWith([
        expect.objectContaining({
          benchmarkId: 58,
          source: "text:Qwen3.6",
          benchmarkType: "STEM"
        })
      ]);
    } finally {
      transactionSpy.mockRestore();
      dbSelectSpy.mockRestore();
    }
  });

  test("导入 >100 数值时会自动复用已存在的同名 Elo benchmark", async () => {
    const inputText = [
      "Category\tBenchmark\tGPT-5.4",
      "Professional\tGDPval-AA\t1215"
    ].join("\n");

    const dbSelectSpy = vi.spyOn(dbForTest, "select").mockImplementation(() => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    });

    const activeBenchmarks = [
      {
        id: 41,
        benchmarkName: "GDPval-AA",
        benchmarkType: "General",
        unit: "score",
        higherIsBetter: true,
        modalities: ["Text"],
        canonicalKey: "gdpvalaa:general",
        sourceBenchmarkId: null,
        mergedIntoBenchmarkId: null,
        createdAt: new Date("2026-04-01T00:00:00.000Z")
      },
      {
        id: 42,
        benchmarkName: "GDPval-AA (Elo)",
        benchmarkType: "General",
        unit: "score",
        higherIsBetter: true,
        modalities: ["Text"],
        canonicalKey: "gdpvalaaelo:general",
        sourceBenchmarkId: null,
        mergedIntoBenchmarkId: null,
        createdAt: new Date("2026-04-01T00:00:00.000Z")
      }
    ];

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

    const txSelect = vi.fn()
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(activeBenchmarks) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([createdProvider]) }) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) });

    const providerReturning = vi.fn().mockResolvedValue([createdProvider]);
    const modelReturning = vi.fn().mockResolvedValue([createdModel]);
    const valueRowsInsert = vi.fn().mockResolvedValue(undefined);
    const sourceMetaOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const sourceMetaValues = vi.fn(() => ({ onConflictDoUpdate: sourceMetaOnConflictDoUpdate }));

    const txInsert = vi.fn()
      .mockReturnValueOnce({ values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(() => ({ returning: providerReturning })) })) })
      .mockReturnValueOnce({ values: vi.fn(() => ({ returning: modelReturning })) })
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
      const result = await importBenchmarkCsvForTest(inputText, "text:gdpval-aa");

      expect(result.inserted).toBe(1);
      expect(txInsert).toHaveBeenCalledTimes(4);
      expect(valueRowsInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          benchmarkId: 42,
          valueRaw: "1215",
          valueNum: "1215",
          source: "text:gdpval-aa"
        })
      ]);
      expect(sourceMetaValues).toHaveBeenCalledWith([
        expect.objectContaining({
          benchmarkId: 42,
          source: "text:gdpval-aa",
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
