import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

type DetectFn = () => Promise<{
  generatedAt: string;
  issues: Array<{
    benchmarkId: number;
    benchmarkName: string;
    benchmarkType: string;
    valueCount: number;
    smallValueCount: number;
    largeValueCount: number;
    minValue: number;
    maxValue: number;
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

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const adminServiceModule = await import("@/lib/admin-service");
  detectScaleIssuesForTest = adminServiceModule.detectBenchmarkScaleConsistencyIssues as DetectFn;
  normalizeScaleByTargetForTest = adminServiceModule.normalizeBenchmarkScaleByTarget as NormalizeFn;

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
        benchmarkId: 11,
        benchmarkName: "Bench-1",
        benchmarkType: "Type-A",
        valueCount: 12,
        smallValueCount: 4,
        largeValueCount: 8,
        minValue: 0.12,
        maxValue: 87.4,
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
});
