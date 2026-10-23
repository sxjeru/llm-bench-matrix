/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let previewBenchmarkTextImport: any;
let db: any;

function mockDbQuery(resolveValue: any) {
  const query: any = {
    from: vi.fn().mockImplementation(() => query),
    innerJoin: vi.fn().mockImplementation(() => query),
    where: vi.fn().mockImplementation(() => query),
    groupBy: vi.fn().mockImplementation(() => query),
    limit: vi.fn().mockImplementation(() => query),
    then: vi.fn().mockImplementation((onfulfilled: any) => {
      return Promise.resolve(resolveValue).then(onfulfilled);
    })
  };
  return query;
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const adminServiceModule = await import("@/lib/admin-service");
  previewBenchmarkTextImport = adminServiceModule.previewBenchmarkTextImport;

  const dbClientModule = await import("@/lib/db/client");
  db = dbClientModule.db;
});

describe("previewBenchmarkTextImport 来源存在性检查与重复值比对", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("未输入 source 时，不进行库内查重，全部保留为可导入", async () => {
    const selectSpy = vi.spyOn(db, "select");

    const inputText = [
      "Benchmark,Model A,Model B",
      "MMLU,85.0,90.0"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText);

    expect(selectSpy).not.toHaveBeenCalled();
    expect(result.total).toBe(2);
    expect(result.duplicateCount).toBe(0);
    expect(result.previewRows.every((r: any) => !r.isDuplicate)).toBe(true);
  });

  test("输入的 source 在库中不存在现有记录时，不进行忽略，保留为可导入", async () => {
    vi.spyOn(db, "select").mockImplementation(() => mockDbQuery([]));

    const inputText = [
      "Benchmark,Model A,Model B",
      "MMLU,85.0,90.0"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText, "new-source-xyz");

    expect(result.total).toBe(2);
    expect(result.duplicateCount).toBe(0);
    expect(result.previewRows.every((r: any) => !r.isDuplicate)).toBe(true);
  });

  test("库中存在现有 source 时，比对模型名、benchmark 与分数，相同则标记为重复忽略", async () => {
    const existingDbRows = [
      {
        valueRaw: "85.0",
        valueNum: "85.000000",
        valueNum2: null,
        source: "text:existing-source",
        modelName: "Model A",
        modelAlias: null,
        benchmarkName: "MMLU",
        benchmarkType: "general"
      },
      {
        valueRaw: "70.5",
        valueNum: "70.500000",
        valueNum2: null,
        source: "text:existing-source",
        modelName: "Model B",
        modelAlias: null,
        benchmarkName: "GSM8K",
        benchmarkType: "general"
      }
    ];

    vi.spyOn(db, "select").mockImplementation(() => mockDbQuery(existingDbRows));

    const inputText = [
      "Benchmark,Model A,Model B",
      "MMLU,85.0,92.0",
      "GSM8K,60.0,70.5"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText, "existing-source");

    expect(result.previewRows).toHaveLength(4);
    expect(result.duplicateCount).toBe(2);
    expect(result.total).toBe(2);

    // MMLU + Model A: 85.0 vs 85.0 -> duplicate
    const mmluModelA = result.previewRows.find(
      (r: any) => r.benchmarkName === "MMLU" && r.modelName === "Model A"
    );
    expect(mmluModelA?.isDuplicate).toBe(true);

    // MMLU + Model B: 92.0 vs DB has no MMLU for Model B -> not duplicate
    const mmluModelB = result.previewRows.find(
      (r: any) => r.benchmarkName === "MMLU" && r.modelName === "Model B"
    );
    expect(mmluModelB?.isDuplicate).toBe(false);

    // GSM8K + Model A: 60.0 vs DB has no GSM8K for Model A -> not duplicate
    const gsm8kModelA = result.previewRows.find(
      (r: any) => r.benchmarkName === "GSM8K" && r.modelName === "Model A"
    );
    expect(gsm8kModelA?.isDuplicate).toBe(false);

    // GSM8K + Model B: 70.5 vs 70.5 -> duplicate
    const gsm8kModelB = result.previewRows.find(
      (r: any) => r.benchmarkName === "GSM8K" && r.modelName === "Model B"
    );
    expect(gsm8kModelB?.isDuplicate).toBe(true);
  });

  test("相同模型和 benchmark 但分数不同时不判定为重复", async () => {
    const existingDbRows = [
      {
        valueRaw: "80.0",
        valueNum: "80.000000",
        valueNum2: null,
        source: "text:src1",
        modelName: "Model A",
        modelAlias: null,
        benchmarkName: "MMLU",
        benchmarkType: "general"
      }
    ];

    vi.spyOn(db, "select").mockImplementation(() => mockDbQuery(existingDbRows));

    const inputText = [
      "Benchmark,Model A",
      "MMLU,85.0"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText, "src1");

    expect(result.duplicateCount).toBe(0);
    expect(result.total).toBe(1);
    expect(result.previewRows[0].isDuplicate).toBe(false);
  });

  test("括号空格归一化与大小写不敏感匹配", async () => {
    const existingDbRows = [
      {
        valueRaw: "88.0",
        valueNum: "88.000000",
        valueNum2: null,
        source: "text:src1",
        modelName: "Claude 3.5 Sonnet (20241022)",
        modelAlias: null,
        benchmarkName: "MATH (Hard)",
        benchmarkType: "general"
      }
    ];

    vi.spyOn(db, "select").mockImplementation(() => mockDbQuery(existingDbRows));

    // Notice no space before parentheses in imported model and benchmark
    const inputText = [
      "Benchmark,claude 3.5 sonnet(20241022)",
      "math(hard),88.00"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText, "src1");

    expect(result.duplicateCount).toBe(1);
    expect(result.total).toBe(0);
    expect(result.previewRows[0].isDuplicate).toBe(true);
  });
});

