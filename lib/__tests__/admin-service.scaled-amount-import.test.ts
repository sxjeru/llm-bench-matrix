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

type MixedMagnitudeInputRow = {
  rowNumber: number;
  modelName: string;
  benchmarkName: string;
  benchmarkType?: string;
  valueRaw: string;
  unit?: string;
  source?: string | null;
};

let parseBenchmarkTextRowsForTest: (inputText: string, sourceInput?: string | null) => Promise<ParsedTextImport>;
let collectMixedMagnitudeWarningsForTest: (rows: MixedMagnitudeInputRow[]) => Array<Record<string, unknown>>;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  const adminServiceModule = await import("@/lib/admin-service");
  parseBenchmarkTextRowsForTest =
    adminServiceModule.__parseBenchmarkTextRowsForTest as typeof parseBenchmarkTextRowsForTest;
  collectMixedMagnitudeWarningsForTest =
    adminServiceModule.__collectMixedMagnitudeImportValueWarningsForTest as typeof collectMixedMagnitudeWarningsForTest;
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
      benchmarkType: "General",
      source: "text:unit-test",
      magnitudeModels: ["M1"],
      bareModels: ["M2"],
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

  test("0、$0、0.0、-0 与双值里的 0 不触发裸值误报", async () => {
    const parsed = await parseBenchmarkTextRowsForTest([
      "Benchmark\tM1\tM2\tM3\tM4\tM5\tM6",
      "Total estimated bounty\t$1.2M\t$0\t0\t0.0\t-0\t$1.2M / 0"
    ].join("\n"), "text:unit-test");

    expect((parsed.warnings ?? []).some(
      (warning) => warning.type === "mixed-magnitude-import-value"
    )).toBe(false);
  });

  test("不同 source / benchmarkType / unit 分组隔离，不跨组误报", async () => {
    const crossSourceCsv = [
      "model,benchmark,value,source",
      "M1,Total estimated bounty,$1.2M,source-a",
      "M2,Total estimated bounty,$500,source-b"
    ].join("\n");

    const crossTypeCsv = [
      "model,benchmark,benchmark_type,value,source",
      "M1,Latency,Tokens,128K,source-a",
      "M2,Latency,Seconds,12.5,source-a"
    ].join("\n");

    const crossUnitCsv = [
      "model,benchmark,value,unit,source",
      "M1,Bounty,$1.2M,USD,source-a",
      "M2,Bounty,120,score,source-a"
    ].join("\n");

    for (const csv of [crossSourceCsv, crossTypeCsv, crossUnitCsv]) {
      const parsed = await parseBenchmarkTextRowsForTest(csv, "text:unit-test");
      expect((parsed.warnings ?? []).some(
        (warning) => warning.type === "mixed-magnitude-import-value"
      )).toBe(false);
    }
  });

  test("#1.2M 与 85.3% 不会被忽略，混用时正常触发告警", async () => {
    const rankMixed = await parseBenchmarkTextRowsForTest([
      "Benchmark\tM1\tM2",
      "Rank Metric\t#1.2M\t#500"
    ].join("\n"), "text:unit-test");

    const rankWarnings = (rankMixed.warnings ?? []).filter(
      (warning) => warning.type === "mixed-magnitude-import-value"
    );
    expect(rankWarnings).toHaveLength(1);
    expect(rankWarnings[0]).toMatchObject({
      benchmarkName: "Rank Metric",
      magnitudeModels: ["M1"],
      bareModels: ["M2"]
    });

    // 直接校验未剥离 % 的原始值（含单值与双值）
    const percentWarnings = collectMixedMagnitudeWarningsForTest([
      { rowNumber: 2, modelName: "M1", benchmarkName: "Mixed Percent", valueRaw: "#1.2M", source: "s1" },
      { rowNumber: 3, modelName: "M2", benchmarkName: "Mixed Percent", valueRaw: "85.3%", source: "s1" }
    ]);
    expect(percentWarnings).toHaveLength(1);
    expect(percentWarnings[0]).toMatchObject({
      benchmarkName: "Mixed Percent",
      source: "s1",
      magnitudeModels: ["M1"],
      bareModels: ["M2"],
      rowNumbers: [2, 3]
    });

    const pairPercentWarnings = collectMixedMagnitudeWarningsForTest([
      { rowNumber: 4, modelName: "M1", benchmarkName: "Pair Percent", valueRaw: "85.3% / #1.2M", source: "s1" }
    ]);
    expect(pairPercentWarnings).toHaveLength(1);
    expect(pairPercentWarnings[0]).toMatchObject({
      benchmarkName: "Pair Percent",
      magnitudeModels: ["M1"],
      bareModels: ["M1"],
      rowNumbers: [4]
    });
  });
});
