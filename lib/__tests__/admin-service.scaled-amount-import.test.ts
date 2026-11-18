import { beforeAll, describe, expect, test } from "vitest";
import { parseBenchmarkValue } from "@/lib/db/parse-value";

type ParsedRow = {
  rowNumber: number;
  modelName: string;
  benchmarkName: string;
  valueRaw: string;
  valueNote: string | null;
};

type ParsedTextImport = {
  rows: ParsedRow[];
  warnings?: Array<Record<string, unknown>>;
};

let parseBenchmarkTextRowsForTest: (inputText: string, sourceInput?: string | null) => Promise<ParsedTextImport>;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  const adminServiceModule = await import("@/lib/admin-service");
  parseBenchmarkTextRowsForTest =
    adminServiceModule.__parseBenchmarkTextRowsForTest as typeof parseBenchmarkTextRowsForTest;
});

describe("文本导入的量级后缀", () => {
  test("货币量级按原始书写入库并换算成数值", async () => {
    const inputText = [
      "Benchmark\tM1\tM2\tM3\tM4",
      "Total estimated bounty\t$1.03825M\t$687.25k\t$438k\t$317.5k"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const byModel = new Map(parsed.rows.map((row) => [row.modelName, row]));

    expect(byModel.get("M1")?.valueRaw).toBe("$1.03825M");
    expect(parseBenchmarkValue(byModel.get("M1")?.valueRaw ?? "").valueNum).toBeCloseTo(1_038_250);
    expect(parseBenchmarkValue(byModel.get("M4")?.valueRaw ?? "").valueNum).toBeCloseTo(317_500);
  });

  test("无货币符号的 k/M 同样换算", async () => {
    const inputText = [
      "Benchmark\tM1\tM2",
      "Context Length\t128K\t1.2M"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const byModel = new Map(parsed.rows.map((row) => [row.modelName, row]));

    expect(byModel.get("M1")?.valueRaw).toBe("128K");
    expect(parseBenchmarkValue(byModel.get("M1")?.valueRaw ?? "").valueNum).toBeCloseTo(128_000);
    expect(parseBenchmarkValue(byModel.get("M2")?.valueRaw ?? "").valueNum).toBeCloseTo(1_200_000);
  });

  test("同一 benchmark 内后缀与裸值并存时给出告警", async () => {
    const inputText = [
      "Benchmark\tM1\tM2",
      "Total estimated bounty\t$1.2M\t$1.2"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const warnings = (parsed.warnings ?? []).filter(
      (warning) => warning.type === "mixed-magnitude-import-value"
    );

    expect(warnings).toHaveLength(1);
    // 矩阵导入按源行记录 rowNumber，同一行的多个模型共用一个行号
    expect(warnings[0]).toMatchObject({
      benchmarkName: "Total estimated bounty",
      rowNumbers: [2]
    });
  });

  test("整列写法一致时不告警", async () => {
    const allMagnitude = await parseBenchmarkTextRowsForTest([
      "Benchmark\tM1\tM2",
      "Bounty\t$1.2M\t$2.4M"
    ].join("\n"), "text:unit-test");

    const allBare = await parseBenchmarkTextRowsForTest([
      "Benchmark\tM1\tM2",
      "Bounty\t$1.2\t$2.4"
    ].join("\n"), "text:unit-test");

    for (const parsed of [allMagnitude, allBare]) {
      expect((parsed.warnings ?? []).some(
        (warning) => warning.type === "mixed-magnitude-import-value"
      )).toBe(false);
    }
  });
});
