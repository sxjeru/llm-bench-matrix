import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

type DetectFn = () => Promise<{
  generatedAt: string;
  issues: Array<{
    issueType: "mixed-scale-0-1-vs-100" | "mixed-scale-100-vs-elo";
    recommendedAction: "normalize-scale" | "split-benchmark";
    benchmarkId: number;
    benchmarkName: string;
    benchmarkType: string;
    valueCount: number;
    smallValueCount: number;
    largeValueCount: number;
    zeroToHundredCount: number;
    overHundredCount: number;
    minValue: number;
    maxValue: number;
    segments: Array<{
      key: "small" | "large" | "base" | "elo";
      label: string;
      count: number;
      minValue: number | null;
      maxValue: number | null;
    }>;
    valueDetails: Array<{
      value: number;
      field: "valueNum" | "valueNum2";
      modelName: string;
      source: string | null;
      benchTime: string;
    }>;
  }>;
}>;

type NormalizeFn = (input: {
  benchmarkId: number;
  targetScale: 1 | 100;
}) => Promise<{
  ok: true;
  benchmarkId: number;
  benchmarkName: string;
  benchmarkType: string;
  targetScale: 1 | 100;
  updatedRows: number;
  updatedCells: number;
}>;

type TransactionCallback = (tx: unknown) => Promise<unknown>;

let detectScaleIssuesForTest: DetectFn;
let normalizeScaleByTargetForTest: NormalizeFn;
let splitBenchmarkScaleByModeForTest: (input: {
  benchmarkId: number;
  splitMode: "hundred-vs-elo";
  baseBenchmarkName: string;
  eloBenchmarkName: string;
}) => Promise<{
  ok: true;
  movedRows: number;
  splitRows: number;
  createdRows: number;
  eloBenchmarkName: string;
}>;
let dbForTest: {
  select: (...args: unknown[]) => unknown;
  execute: (...args: unknown[]) => Promise<unknown>;
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

function createResolvedQueryMock(result: unknown) {
  const queryPromise = Promise.resolve(result) as Promise<unknown> & {
    limit: (value: number) => Promise<unknown>;
  };

  queryPromise.limit = vi.fn().mockResolvedValue(result);
  return queryPromise;
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const adminServiceModule = await import("@/lib/admin-service");
  detectScaleIssuesForTest = adminServiceModule.detectBenchmarkScaleConsistencyIssues as DetectFn;
  normalizeScaleByTargetForTest = adminServiceModule.normalizeBenchmarkScaleByTarget as NormalizeFn;
  splitBenchmarkScaleByModeForTest = adminServiceModule.splitBenchmarkScaleByMode;

  const dbClientModule = await import("@/lib/db/client");
  dbForTest = dbClientModule.db as typeof dbForTest;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("benchmark scale consistency", () => {
  test("detectBenchmarkScaleConsistencyIssues 返回混合量纲 benchmark 列表", async () => {
    vi.spyOn(dbForTest, "execute")
      .mockResolvedValueOnce({
        rows: [
          {
            benchmark_id: 11,
            benchmark_name: "Bench-1",
            benchmark_type: "Type-A",
            value_count: "12",
            small_count: "4",
            large_count: "8",
            zero_to_hundred_count: "2",
            over_hundred_count: "0",
            min_value: "0.12",
            max_value: "87.4"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            benchmark_id: 11,
            value_num: "0.12",
            value_num2: null,
            model_name: "Model A",
            source: "text:seed",
            bench_time: "2026-04-18T09:00:00.000Z"
          },
          {
            benchmark_id: 11,
            value_num: "87.4",
            value_num2: null,
            model_name: "Model B",
            source: "text:seed",
            bench_time: "2026-04-18T09:05:00.000Z"
          }
        ]
      });

    const result = await detectScaleIssuesForTest();

    expect(result.issues).toEqual([
      {
        issueType: "mixed-scale-0-1-vs-100",
        recommendedAction: "normalize-scale",
        benchmarkId: 11,
        benchmarkName: "Bench-1",
        benchmarkType: "Type-A",
        valueCount: 12,
        smallValueCount: 4,
        largeValueCount: 8,
        zeroToHundredCount: 2,
        overHundredCount: 0,
        minValue: 0.12,
        maxValue: 87.4,
        segments: [
          {
            key: "small",
            label: "0-1",
            count: 4,
            minValue: 0.12,
            maxValue: 0.12
          },
          {
            key: "large",
            label: ">10",
            count: 8,
            minValue: 87.4,
            maxValue: 87.4
          }
        ],
        valueDetails: [
          {
            value: 0.12,
            field: "valueNum",
            modelName: "Model A",
            source: "text:seed",
            benchTime: "2026-04-18T09:00:00.000Z"
          },
          {
            value: 87.4,
            field: "valueNum",
            modelName: "Model B",
            source: "text:seed",
            benchTime: "2026-04-18T09:05:00.000Z"
          }
        ]
      }
    ]);
  });

  test("detectBenchmarkScaleConsistencyIssues 忽略 small_count=0 的结果（负值不触发 <1 告警）", async () => {
    const executeSpy = vi.spyOn(dbForTest, "execute").mockResolvedValue({
      rows: [
        {
          benchmark_id: 12,
          benchmark_name: "Bench-Neg",
          benchmark_type: "Type-N",
          value_count: "6",
          small_count: "0",
          large_count: "3",
          zero_to_hundred_count: "3",
          over_hundred_count: "0",
          min_value: "-0.42",
          max_value: "91.5"
        }
      ]
    });

    const result = await detectScaleIssuesForTest();

    expect(result.issues).toEqual([]);
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  test("detectBenchmarkScaleConsistencyIssues 返回 0-100 与 >100 的 Elo 拆分告警", async () => {
    vi.spyOn(dbForTest, "execute")
      .mockResolvedValueOnce({
        rows: [
          {
            benchmark_id: 21,
            benchmark_name: "Arena Hard",
            benchmark_type: "arena",
            value_count: "6",
            small_count: "0",
            large_count: "6",
            zero_to_hundred_count: "3",
            over_hundred_count: "3",
            min_value: "72",
            max_value: "1215"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            benchmark_id: 21,
            value_num: "87",
            value_num2: "1215",
            model_name: "Model A",
            source: "text:seed",
            bench_time: "2026-04-18T09:00:00.000Z"
          }
        ]
      });

    const result = await detectScaleIssuesForTest();

    expect(result.issues).toEqual([
      expect.objectContaining({
        issueType: "mixed-scale-100-vs-elo",
        recommendedAction: "split-benchmark",
        benchmarkId: 21,
        benchmarkName: "Arena Hard",
        benchmarkType: "arena",
        zeroToHundredCount: 3,
        overHundredCount: 3
      })
    ]);
  });

  test("detectBenchmarkScaleConsistencyIssues 在双命中场景优先返回 Elo 拆分告警", async () => {
    vi.spyOn(dbForTest, "execute")
      .mockResolvedValueOnce({
        rows: [
          {
            benchmark_id: 31,
            benchmark_name: "Arena Blend",
            benchmark_type: "arena",
            value_count: "9",
            small_count: "2",
            large_count: "7",
            zero_to_hundred_count: "5",
            over_hundred_count: "2",
            min_value: "0.12",
            max_value: "1320"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            benchmark_id: 31,
            value_num: "0.12",
            value_num2: null,
            model_name: "Model A",
            source: "text:seed",
            bench_time: "2026-04-18T09:00:00.000Z"
          },
          {
            benchmark_id: 31,
            value_num: "88",
            value_num2: "1320",
            model_name: "Model B",
            source: "text:seed",
            bench_time: "2026-04-18T09:05:00.000Z"
          }
        ]
      });

    const result = await detectScaleIssuesForTest();

    expect(result.issues).toEqual([
      expect.objectContaining({
        issueType: "mixed-scale-100-vs-elo",
        recommendedAction: "split-benchmark",
        benchmarkId: 31,
        benchmarkName: "Arena Blend",
        benchmarkType: "arena",
        smallValueCount: 2,
        largeValueCount: 7,
        zeroToHundredCount: 5,
        overHundredCount: 2,
        segments: [
          {
            key: "base",
            label: "0-100",
            count: 5,
            minValue: 0.12,
            maxValue: 88
          },
          {
            key: "elo",
            label: ">100 (Elo)",
            count: 2,
            minValue: 1320,
            maxValue: 1320
          }
        ]
      })
    ]);
  });

  test("normalizeBenchmarkScaleByTarget 会把 >10 同化为 1 量纲并追加标记", async () => {
    const dbSelectWhere = createSelectWhereMock([
      [
        {
          id: 11,
          benchmarkName: "Bench-1",
          benchmarkType: "Type-A"
        }
      ]
    ]);
    const dbSelectFrom = vi.fn(() => ({ where: dbSelectWhere }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: dbSelectFrom }));

    const executeSpy = vi.spyOn(dbForTest, "execute").mockResolvedValue({
      rows: [
        {
          small_count: "2",
          large_count: "2"
        }
      ]
    });

    const txSelectWhere = createSelectWhereMock([
      [
        {
          id: 1001,
          valueNum: "85",
          valueNum2: null,
          valueNote: null
        },
        {
          id: 1002,
          valueNum: "0.25",
          valueNum2: "73",
          valueNote: "from-report"
        },
        {
          id: 1003,
          valueNum: "0.88",
          valueNum2: null,
          valueNote: null
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

    const result = await normalizeScaleByTargetForTest({
      benchmarkId: 11,
      targetScale: 1
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      benchmarkId: 11,
      benchmarkName: "Bench-1",
      benchmarkType: "Type-A",
      targetScale: 1,
      updatedRows: 2,
      updatedCells: 2
    });

    expect(updateSet).toHaveBeenCalledTimes(2);

    const updatePayloads = updateSet.mock.calls.map(([payload]) => payload as Record<string, unknown>);
    expect(updatePayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          valueNum: "0.85",
          valueNum2: null,
          valueNote: "normalized-scale-to-1"
        }),
        expect.objectContaining({
          valueNum: "0.25",
          valueNum2: "0.73",
          valueNote: "from-report; normalized-scale-to-1"
        })
      ])
    );
  });

  test("splitBenchmarkScaleByMode 会将 >100 值拆分到 Elo benchmark，并处理跨组 pair", async () => {
    const dbSelectWhere = createSelectWhereMock([
      [
        {
          id: 21,
          benchmarkName: "Arena Hard",
          benchmarkType: "arena",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Text"],
          sourceBenchmarkId: null
        }
      ]
    ]);
    const dbSelectFrom = vi.fn(() => ({ where: dbSelectWhere }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: dbSelectFrom }));

    vi.spyOn(dbForTest, "execute")
      .mockResolvedValueOnce({
        rows: [
          {
            benchmark_id: 21,
            benchmark_name: "Arena Hard",
            benchmark_type: "arena",
            value_count: "4",
            small_count: "0",
            large_count: "4",
            zero_to_hundred_count: "2",
            over_hundred_count: "2",
            min_value: "87",
            max_value: "1215"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const txSelectWhere = vi.fn()
      .mockImplementationOnce(() => createResolvedQueryMock([]))
      .mockImplementationOnce(() => createResolvedQueryMock([]))
      .mockImplementationOnce(() => createResolvedQueryMock([
        {
          id: 101,
          modelId: 1,
          benchmarkId: 21,
          benchTime: new Date("2026-04-18T09:00:00.000Z"),
          valueRaw: "87 / 1215",
          valueNum: "87",
          valueNum2: "1215",
          valueNote: null,
          source: "text:seed"
        },
        {
          id: 102,
          modelId: 2,
          benchmarkId: 21,
          benchTime: new Date("2026-04-18T09:05:00.000Z"),
          valueRaw: "1188",
          valueNum: "1188",
          valueNum2: null,
          valueNote: null,
          source: "text:seed"
        }
      ]))
      .mockImplementationOnce(() => Promise.resolve([]));
    const txSelectFrom = vi.fn(() => ({ where: txSelectWhere }));
    const txSelect = vi.fn(() => ({ from: txSelectFrom }));

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateReturning = vi.fn().mockResolvedValue([{ id: 21 }]);
    const updateSet = vi.fn((payload: Record<string, unknown>) => {
      if ("canonicalKey" in payload || "benchmarkName" in payload) {
        return {
          where: vi.fn(() => ({ returning: updateReturning })),
          returning: updateReturning
        };
      }

      return { where: updateWhere };
    });
    const update = vi.fn(() => ({ set: updateSet }));

    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);

    const splitInsertPayloads: Array<Record<string, unknown>> = [];
    const splitUpdatePayloads: Array<Record<string, unknown>> = [];

    const insertValues = vi.fn((payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
      const rows = Array.isArray(payload) ? payload : [payload];
      const firstRow = rows[0];

      if (firstRow && "benchmarkName" in firstRow) {
        return {
          onConflictDoUpdate: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([
              {
                id: 31,
                benchmarkName: "Arena Hard (Elo)",
                benchmarkType: "arena"
              }
            ])
          })),
          returning: vi.fn().mockResolvedValue([
            {
              id: 31,
              benchmarkName: "Arena Hard (Elo)",
              benchmarkType: "arena"
            }
          ])
        };
      }

      if (firstRow && "source" in firstRow && "modalities" in firstRow) {
        return {
          onConflictDoNothing
        };
      }

      if (firstRow && "modelId" in firstRow) {
        splitInsertPayloads.push(...rows);
      }

      return Promise.resolve(undefined);
    });
    const insert = vi.fn(() => ({ values: insertValues }));

    updateSet.mockImplementation((payload: Record<string, unknown>) => {
      if ("canonicalKey" in payload || "benchmarkName" in payload) {
        return {
          where: vi.fn(() => ({ returning: updateReturning })),
          returning: updateReturning
        };
      }

      if ("benchmarkId" in payload) {
        splitUpdatePayloads.push(payload);
      }

      return { where: updateWhere };
    });

    const tx = { select: txSelect, update, insert };
    vi.spyOn(dbForTest, "transaction").mockImplementation(async (callback: TransactionCallback) => callback(tx));

    const result = await splitBenchmarkScaleByModeForTest({
      benchmarkId: 21,
      splitMode: "hundred-vs-elo",
      baseBenchmarkName: "Arena Hard",
      eloBenchmarkName: "Arena Hard (Elo)"
    });

    expect(result.ok).toBe(true);
    expect(result.movedRows).toBe(1);
    expect(result.splitRows).toBe(1);
    expect(result.createdRows).toBe(1);
    expect(result.eloBenchmarkName).toBe("Arena Hard (Elo)");

    expect(splitUpdatePayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          benchmarkId: 21,
          valueRaw: "87",
          valueNum: "87",
          valueNum2: null,
          valueNote: "split-benchmark-base"
        })
      ])
    );
    expect(splitInsertPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          benchmarkId: 31,
          valueRaw: "1215",
          valueNum: "1215",
          valueNum2: null,
          valueNote: "split-benchmark-elo"
        })
      ])
    );
  });

  test("splitBenchmarkScaleByMode 会为 Elo benchmark 补齐 source meta 继承", async () => {
    const dbSelectWhere = createSelectWhereMock([
      [
        {
          id: 21,
          benchmarkName: "Arena Hard",
          benchmarkType: "arena",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Text"],
          sourceBenchmarkId: null
        }
      ]
    ]);
    const dbSelectFrom = vi.fn(() => ({ where: dbSelectWhere }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: dbSelectFrom }));

    vi.spyOn(dbForTest, "execute")
      .mockResolvedValueOnce({
        rows: [
          {
            benchmark_id: 21,
            benchmark_name: "Arena Hard",
            benchmark_type: "arena",
            value_count: "2",
            small_count: "0",
            large_count: "2",
            zero_to_hundred_count: "1",
            over_hundred_count: "1",
            min_value: "87",
            max_value: "1215"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const txSelectWhere = vi.fn()
      .mockImplementationOnce(() => createResolvedQueryMock([]))
      .mockImplementationOnce(() => createResolvedQueryMock([]))
      .mockImplementationOnce(() => Promise.resolve([
        {
          id: 101,
          modelId: 1,
          benchmarkId: 21,
          benchTime: new Date("2026-04-18T09:00:00.000Z"),
          valueRaw: "1215",
          valueNum: "1215",
          valueNum2: null,
          valueNote: null,
          source: "text:seed"
        }
      ]))
      .mockImplementationOnce(() => Promise.resolve([
        {
          source: "text:seed",
          benchmarkType: "arena",
          modalities: ["Vision"]
        }
      ]));
    const txSelectFrom = vi.fn(() => ({ where: txSelectWhere }));
    const txSelect = vi.fn(() => ({ from: txSelectFrom }));

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateReturning = vi.fn().mockResolvedValue([{ id: 21 }]);
    const updateSet = vi.fn((payload: Record<string, unknown>) => {
      if ("canonicalKey" in payload || "benchmarkName" in payload) {
        return {
          where: vi.fn(() => ({ returning: updateReturning })),
          returning: updateReturning
        };
      }

      return { where: updateWhere };
    });
    const update = vi.fn(() => ({ set: updateSet }));

    const onConflictDoUpdate = vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([
        {
          id: 31,
          benchmarkName: "Arena Hard (Elo)",
          benchmarkType: "arena"
        }
      ])
    }));
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const insertValues = vi.fn((payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
      const rows = Array.isArray(payload) ? payload : [payload];
      const firstRow = rows[0];

      if (firstRow && "benchmarkName" in firstRow) {
        return {
          onConflictDoUpdate,
          returning: vi.fn().mockResolvedValue([
            {
              id: 31,
              benchmarkName: "Arena Hard (Elo)",
              benchmarkType: "arena"
            }
          ])
        };
      }

      if (firstRow && "source" in firstRow && "modalities" in firstRow) {
        return {
          onConflictDoNothing
        };
      }

      return Promise.resolve(undefined);
    });
    const insert = vi.fn(() => ({ values: insertValues }));

    const tx = { select: txSelect, update, insert };
    vi.spyOn(dbForTest, "transaction").mockImplementation(async (callback: TransactionCallback) => callback(tx));

    await splitBenchmarkScaleByModeForTest({
      benchmarkId: 21,
      splitMode: "hundred-vs-elo",
      baseBenchmarkName: "Arena Hard",
      eloBenchmarkName: "Arena Hard (Elo)"
    });

    expect(insertValues).toHaveBeenCalledWith([
      {
        benchmarkId: 31,
        source: "text:seed",
        benchmarkType: "arena",
        modalities: ["Vision"]
      }
    ]);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});
