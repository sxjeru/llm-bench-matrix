import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { ModelDedupeRule } from "@/lib/db/normalize";

type EnsureBenchmarkFn = (
  input: {
    benchmarkName: string;
    benchmarkType: string;
    unit?: string;
    higherIsBetter?: boolean;
    modalities?: string[];
    sourceBenchmarkId?: string | null;
  },
  options?: { dedupeRule?: ModelDedupeRule; db?: unknown }
) => Promise<{
  id: number;
  benchmarkName: string;
  benchmarkType: string;
  unit: string;
  higherIsBetter: boolean;
  modalities: string[];
  canonicalKey: string;
  mergedIntoBenchmarkId: number | null;
}>;

const DEFAULT_DEDUPE_RULE: ModelDedupeRule = {
  lowercase: true,
  removeHyphen: true,
  removeSpace: true,
  removeDot: false
};

let ensureBenchmarkForTest: EnsureBenchmarkFn;
let dbForTest: {
  select: (...args: unknown[]) => unknown;
  update: (...args: unknown[]) => unknown;
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
  ensureBenchmarkForTest = adminServiceModule.ensureBenchmark as EnsureBenchmarkFn;

  const dbClientModule = await import("@/lib/db/client");
  dbForTest = dbClientModule.db as unknown as typeof dbForTest;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureBenchmark with merged target resolution", () => {
  test("name/type 查到已合并记录时应 resolve 到 active target，且不修改 active target 的 canonicalKey", async () => {
    // Queue (getModelDedupeRule bypassed via options.dedupeRule):
    //   1st select → by canonicalKey → not found
    //   2nd select → by name/type → merged record
    //   3rd select → resolveActiveBenchmark lookup → active record
    const selectWhere = createSelectWhereMock([
      [], // by canonicalKey → not found
      [
        {
          id: 329,
          benchmarkName: "MATH-Vision",
          benchmarkType: "Vision",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Vision"],
          canonicalKey: "math-vision:vision",
          mergedIntoBenchmarkId: 120
        }
      ], // by name/type → merged record found
      [
        {
          id: 120,
          benchmarkName: "MathVision",
          benchmarkType: "STEM and Puzzle",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Vision"],
          canonicalKey: "mathvision:stemandpuzzle",
          mergedIntoBenchmarkId: null
        }
      ] // resolveActiveBenchmark: look up id=120
    ]);

    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) }));
    const updateMock = vi.fn(() => ({ set: updateSet }));

    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: selectFrom }));
    vi.spyOn(dbForTest, "update").mockImplementation(updateMock);

    const result = await ensureBenchmarkForTest(
      { benchmarkName: "MATH-Vision", benchmarkType: "Vision" },
      { dedupeRule: DEFAULT_DEDUPE_RULE } // bypass getModelDedupeRule() DB call
    );

    expect(result.id).toBe(120);
    expect(result.benchmarkName).toBe("MathVision");
    expect(result.mergedIntoBenchmarkId).toBeNull();
    // active target's canonicalKey must NOT be modified
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("active benchmark 直接命中时直接返回，不触发额外 resolve 查询", async () => {
    // Queue (getModelDedupeRule bypassed via options.dedupeRule):
    //   1st select → by canonicalKey → active record found directly
    //   resolveActiveBenchmark is NOT called (mergedIntoBenchmarkId is null)
    const selectWhere = createSelectWhereMock([
      [
        {
          id: 120,
          benchmarkName: "MathVision",
          benchmarkType: "STEM and Puzzle",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Vision"],
          canonicalKey: "mathvision:stemandpuzzle",
          mergedIntoBenchmarkId: null
        }
      ] // by canonicalKey → active record found directly
    ]);

    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: selectFrom }));

    const result = await ensureBenchmarkForTest(
      { benchmarkName: "MathVision", benchmarkType: "STEM and Puzzle" },
      { dedupeRule: DEFAULT_DEDUPE_RULE } // bypass getModelDedupeRule() DB call
    );

    expect(result.id).toBe(120);
    expect(result.benchmarkName).toBe("MathVision");
    expect(result.mergedIntoBenchmarkId).toBeNull();
  });

  test("多级合并链（A -> B -> C）的 resolve 场景", async () => {
    // Queue:
    //   1st select → by canonicalKey → not found
    //   2nd select → by name/type → A (id: 1, mergedIntoBenchmarkId: 2)
    //   3rd select → resolveActiveBenchmark for id: 2 → B (id: 2, mergedIntoBenchmarkId: 3)
    //   4th select → resolveActiveBenchmark for id: 3 → C (id: 3, mergedIntoBenchmarkId: null)
    const selectWhere = createSelectWhereMock([
      [], // by canonicalKey
      [
        {
          id: 1,
          benchmarkName: "A",
          benchmarkType: "Type",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Text"],
          canonicalKey: "a:type",
          mergedIntoBenchmarkId: 2
        }
      ], // by name/type
      [
        {
          id: 2,
          benchmarkName: "B",
          benchmarkType: "Type",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Text"],
          canonicalKey: "b:type",
          mergedIntoBenchmarkId: 3
        }
      ], // resolve B
      [
        {
          id: 3,
          benchmarkName: "C",
          benchmarkType: "Type",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Text"],
          canonicalKey: "c:type",
          mergedIntoBenchmarkId: null
        }
      ] // resolve C (active)
    ]);

    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: selectFrom }));

    const result = await ensureBenchmarkForTest(
      { benchmarkName: "A", benchmarkType: "Type" },
      { dedupeRule: DEFAULT_DEDUPE_RULE }
    );

    expect(result.id).toBe(3);
    expect(result.benchmarkName).toBe("C");
    expect(result.mergedIntoBenchmarkId).toBeNull();
  });

  test("合并链中出现环的防御（A -> B -> A）", async () => {
    // Queue:
    //   1st select → by canonicalKey → not found
    //   2nd select → by name/type → A (id: 1, mergedIntoBenchmarkId: 2)
    //   3rd select → resolveActiveBenchmark for id: 2 → B (id: 2, mergedIntoBenchmarkId: 1)
    //   (Check seenIds for nextId=1 fails the loop, avoiding 4th query and returning B)
    const selectWhere = createSelectWhereMock([
      [], // by canonicalKey
      [
        {
          id: 1,
          benchmarkName: "A",
          benchmarkType: "Type",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Text"],
          canonicalKey: "a:type",
          mergedIntoBenchmarkId: 2
        }
      ], // by name/type
      [
        {
          id: 2,
          benchmarkName: "B",
          benchmarkType: "Type",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Text"],
          canonicalKey: "b:type",
          mergedIntoBenchmarkId: 1
        }
      ] // resolve B
    ]);

    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: selectFrom }));

    const result = await ensureBenchmarkForTest(
      { benchmarkName: "A", benchmarkType: "Type" },
      { dedupeRule: DEFAULT_DEDUPE_RULE }
    );

    // Breaks loop at nextId=1, returns current which is B (id: 2)
    expect(result.id).toBe(2);
    expect(result.benchmarkName).toBe("B");
    expect(result.mergedIntoBenchmarkId).toBe(1);
  });

  test("forceLowerIsBetter 与 merged 记录组合时的 update 行为 (canonicalKey 匹配)", async () => {
    // Queue:
    //   1st select → by canonicalKey → A (id: 1, mergedIntoBenchmarkId: 2)
    //   2nd select → resolveActiveBenchmark for id: 2 → B (id: 2, mergedIntoBenchmarkId: null, higherIsBetter: true)
    const selectWhere = createSelectWhereMock([
      [
        {
          id: 1,
          benchmarkName: "A",
          benchmarkType: "Type",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Text"],
          canonicalKey: "a:type",
          mergedIntoBenchmarkId: 2
        }
      ], // by canonicalKey
      [
        {
          id: 2,
          benchmarkName: "B",
          benchmarkType: "Type",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Text"],
          canonicalKey: "b:type",
          mergedIntoBenchmarkId: null
        }
      ] // resolve B
    ]);

    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: selectFrom }));

    const returningMock = vi.fn().mockResolvedValue([
      {
        id: 2,
        benchmarkName: "B",
        benchmarkType: "Type",
        unit: "score",
        higherIsBetter: false,
        modalities: ["Text"],
        canonicalKey: "b:type",
        mergedIntoBenchmarkId: null
      }
    ]);
    const updateWhere = vi.fn(() => ({ returning: returningMock }));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const updateSpy = vi.spyOn(dbForTest, "update").mockImplementation(() => ({ set: updateSet }));

    const result = await ensureBenchmarkForTest(
      { benchmarkName: "A", benchmarkType: "Type", higherIsBetter: false },
      { dedupeRule: DEFAULT_DEDUPE_RULE }
    );

    // Should resolve to B, but sync higherIsBetter=false to B (id: 2)
    expect(result.id).toBe(2);
    expect(result.higherIsBetter).toBe(false);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ higherIsBetter: false }));
  });

  test("forceLowerIsBetter 与 merged 记录组合时的 update 行为 (name/type 匹配)", async () => {
    // Queue:
    //   1st select → by canonicalKey → empty
    //   2nd select → by name/type → A (id: 1, mergedIntoBenchmarkId: 2)
    //   3rd select → resolveActiveBenchmark for id: 2 → B (id: 2, mergedIntoBenchmarkId: null, higherIsBetter: true)
    const selectWhere = createSelectWhereMock([
      [], // by canonicalKey
      [
        {
          id: 1,
          benchmarkName: "A",
          benchmarkType: "Type",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Text"],
          canonicalKey: "a:type",
          mergedIntoBenchmarkId: 2
        }
      ], // by name/type
      [
        {
          id: 2,
          benchmarkName: "B",
          benchmarkType: "Type",
          unit: "score",
          higherIsBetter: true,
          modalities: ["Text"],
          canonicalKey: "b:type",
          mergedIntoBenchmarkId: null
        }
      ] // resolve B
    ]);

    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: selectFrom }));

    const returningMock = vi.fn().mockResolvedValue([
      {
        id: 2,
        benchmarkName: "B",
        benchmarkType: "Type",
        unit: "score",
        higherIsBetter: false,
        modalities: ["Text"],
        canonicalKey: "b:type",
        mergedIntoBenchmarkId: null
      }
    ]);
    const updateWhere = vi.fn(() => ({ returning: returningMock }));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const updateSpy = vi.spyOn(dbForTest, "update").mockImplementation(() => ({ set: updateSet }));

    const result = await ensureBenchmarkForTest(
      { benchmarkName: "A", benchmarkType: "Type", higherIsBetter: false },
      { dedupeRule: DEFAULT_DEDUPE_RULE }
    );

    // Should resolve to B, but sync higherIsBetter=false to B (id: 2)
    expect(result.id).toBe(2);
    expect(result.higherIsBetter).toBe(false);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ higherIsBetter: false }));
  });
});

