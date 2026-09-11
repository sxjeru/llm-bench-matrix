import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

type LoadAaBaselineScoresFn = (target: {
  benchmarkName: string;
  benchmarkType: string;
}) => Promise<Map<string, number>>;

let loadAaBaselineScoresForTest: LoadAaBaselineScoresFn;
let dbForTest: {
  select: (...args: unknown[]) => unknown;
};

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const storeModule = await import("@/lib/benchmark-versions/aa-index-version-store");
  loadAaBaselineScoresForTest = storeModule.loadAaBaselineScores;

  const dbClientModule = await import("@/lib/db/client");
  dbForTest = dbClientModule.db as typeof dbForTest;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadAaBaselineScores", () => {
  test("正确解析数据库 numeric 返回的字符串格式分数（如 '85.600000'），不被 Number.isFinite 误丢弃", async () => {
    const mockRows = [
      {
        modelName: "Claude 3.5 Sonnet",
        valueNum: "85.600000", // postgres numeric column 返回字符串
        benchTime: new Date("2026-09-01T00:00:00.000Z"),
        id: 101
      },
      {
        modelName: "GPT-4o",
        valueNum: 79.2, // 兼容数值类型
        benchTime: new Date("2026-09-01T00:00:00.000Z"),
        id: 102
      },
      {
        modelName: "Claude 3.5 Sonnet",
        valueNum: "80.000000", // 同一模型的更旧分数，应被去重忽略
        benchTime: new Date("2026-08-01T00:00:00.000Z"),
        id: 99
      },
      {
        modelName: "Invalid Model",
        valueNum: "not-a-number", // 非法数值应跳过
        benchTime: new Date("2026-09-01T00:00:00.000Z"),
        id: 103
      },
      {
        modelName: "Null Model",
        valueNum: null, // 空分值应跳过
        benchTime: new Date("2026-09-01T00:00:00.000Z"),
        id: 104
      }
    ];

    const orderByMock = vi.fn().mockResolvedValue(mockRows);
    const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
    const innerJoin2Mock = vi.fn(() => ({ where: whereMock }));
    const innerJoin1Mock = vi.fn(() => ({ innerJoin: innerJoin2Mock }));
    const fromMock = vi.fn(() => ({ innerJoin: innerJoin1Mock }));
    vi.spyOn(dbForTest, "select").mockImplementation(() => ({ from: fromMock }));

    const result = await loadAaBaselineScoresForTest({
      benchmarkName: "Intelligence Index",
      benchmarkType: "composite"
    });

    expect(result.size).toBe(2);
    expect(result.get("Claude 3.5 Sonnet")).toBe(85.6);
    expect(result.get("GPT-4o")).toBe(79.2);
    expect(result.has("Invalid Model")).toBe(false);
    expect(result.has("Null Model")).toBe(false);
  });
});

