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
    then: vi.fn().mockImplementation((onfulfilled: any, onrejected?: any) => {
      return Promise.resolve(resolveValue).then(onfulfilled, onrejected);
    }),
    catch: vi.fn().mockImplementation(function (this: any, onrejected: any) {
      return this.then(undefined, onrejected);
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

    const result = await previewBenchmarkTextImport(inputText, null, null, { checkDuplicates: true });

    expect(selectSpy).not.toHaveBeenCalled();
    expect(result.total).toBe(2);
    expect(result.duplicateCount).toBe(0);
    expect(result.previewRows.every((r: any) => !r.isDuplicate)).toBe(true);
  });

  test("未启用 checkDuplicates 时（默认），即使提供 source 也不查询数据库，不阻塞预览", async () => {
    const selectSpy = vi.spyOn(db, "select");

    const inputText = [
      "Benchmark,Model A,Model B",
      "MMLU,85.0,90.0"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText, "some-source");

    expect(selectSpy).not.toHaveBeenCalled();
    expect(result.total).toBe(2);
    expect(result.duplicateCount).toBe(0);
    expect(result.previewRows.every((r: any) => !r.isDuplicate)).toBe(true);
  });

  test("显式 checkDuplicates: false 时，即使提供 source 也不查询数据库", async () => {
    const selectSpy = vi.spyOn(db, "select");

    const inputText = [
      "Benchmark,Model A,Model B",
      "MMLU,85.0,90.0"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText, "some-source", null, { checkDuplicates: false });

    expect(selectSpy).not.toHaveBeenCalled();
    expect(result.total).toBe(2);
    expect(result.duplicateCount).toBe(0);
    expect(result.previewRows.every((r: any) => !r.isDuplicate)).toBe(true);
  });

  test("输入的 source 在库中不存在现有记录时，不进行忽略，保留为可导入", async () => {
    const query = mockDbQuery([]);
    vi.spyOn(db, "select").mockImplementation(() => query);

    const inputText = [
      "Benchmark,Model A,Model B",
      "MMLU,85.0,90.0"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText, "new-source-xyz", null, { checkDuplicates: true });

    expect(result.total).toBe(2);
    expect(result.duplicateCount).toBe(0);
    expect(result.previewRows.every((r: any) => !r.isDuplicate)).toBe(true);
    expect(query.then).toHaveBeenCalledTimes(1);
  });

  test("查重数据库查询只执行一次（不因 catch 与 runWithTimeout 重复触发 Drizzle thenable 执行）", async () => {
    const query = mockDbQuery([]);
    vi.spyOn(db, "select").mockImplementation(() => query);

    const inputText = [
      "Benchmark,Model A",
      "MMLU,85.0"
    ].join("\n");

    await previewBenchmarkTextImport(inputText, "some-source", null, { checkDuplicates: true });

    expect(query.then).toHaveBeenCalledTimes(1);
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

    const query = mockDbQuery(existingDbRows);
    vi.spyOn(db, "select").mockImplementation(() => query);

    const inputText = [
      "Benchmark,Model A,Model B",
      "MMLU,85.0,92.0",
      "GSM8K,60.0,70.5"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText, "existing-source", null, { checkDuplicates: true });

    expect(query.then).toHaveBeenCalledTimes(1);

    expect(result.previewRows).toHaveLength(4);
    expect(result.duplicateCount).toBe(2);
    expect(result.total).toBe(2);

    // MMLU + Model A: 85.0 vs 85.0 -> duplicate
    const mmluModelA = result.previewRows.find(
      (r: any) => r.benchmarkName === "MMLU" && r.modelName === "Model A"
    );
    expect(mmluModelA?.isDuplicate).toBe(true);
    expect(mmluModelA?.duplicateSlotKey).toBe("model a::mmlu");

    // MMLU + Model B: 92.0 vs DB has no MMLU for Model B -> not duplicate
    const mmluModelB = result.previewRows.find(
      (r: any) => r.benchmarkName === "MMLU" && r.modelName === "Model B"
    );
    expect(mmluModelB?.isDuplicate).toBe(false);
    expect(mmluModelB?.duplicateSlotKey).toBeUndefined();

    // GSM8K + Model A: 60.0 vs DB has no GSM8K for Model A -> not duplicate
    const gsm8kModelA = result.previewRows.find(
      (r: any) => r.benchmarkName === "GSM8K" && r.modelName === "Model A"
    );
    expect(gsm8kModelA?.isDuplicate).toBe(false);
    expect(gsm8kModelA?.duplicateSlotKey).toBeUndefined();

    // GSM8K + Model B: 70.5 vs 70.5 -> duplicate
    const gsm8kModelB = result.previewRows.find(
      (r: any) => r.benchmarkName === "GSM8K" && r.modelName === "Model B"
    );
    expect(gsm8kModelB?.isDuplicate).toBe(true);
    expect(gsm8kModelB?.duplicateSlotKey).toBe("model b::gsm8k");
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

    const result = await previewBenchmarkTextImport(inputText, "src1", null, { checkDuplicates: true });

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

    const result = await previewBenchmarkTextImport(inputText, "src1", null, { checkDuplicates: true });

    expect(result.duplicateCount).toBe(1);
    expect(result.total).toBe(0);
    expect(result.previewRows[0].isDuplicate).toBe(true);
  });

  test("checkDuplicates: true 时若 DB 查询报错，自动 fail-open 并追加 duplicate-check-skipped 警告", async () => {
    let queryObj: any;
    vi.spyOn(db, "select").mockImplementation(() => {
      const query: any = {
        from: vi.fn().mockImplementation(() => query),
        innerJoin: vi.fn().mockImplementation(() => query),
        where: vi.fn().mockImplementation(() => query),
        then: vi.fn().mockImplementation((_onfulfilled: any, onrejected: any) => {
          return Promise.reject(new Error("DB connection terminated")).then(_onfulfilled, onrejected);
        }),
        catch: vi.fn().mockImplementation(function (this: any, onrejected: any) {
          return this.then(undefined, onrejected);
        })
      };
      queryObj = query;
      return query;
    });

    const inputText = [
      "Benchmark,Model A",
      "MMLU,85.0"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText, "src1", null, { checkDuplicates: true });

    expect(queryObj.then).toHaveBeenCalledTimes(1);
    expect(result.duplicateCount).toBe(0);
    expect(result.total).toBe(1);
    expect(result.previewRows[0].isDuplicate).toBe(false);
    expect(result.warningCount).toBe(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "duplicate-check-skipped",
          reason: expect.stringContaining("DB connection terminated")
        })
      ])
    );
  });

  test("checkDuplicates: true 时若 DB 查询超时，自动 fail-open 并追加 duplicate-check-skipped 警告", async () => {
    let queryObj: any;
    vi.spyOn(db, "select").mockImplementation(() => {
      const query: any = {
        from: vi.fn().mockImplementation(() => query),
        innerJoin: vi.fn().mockImplementation(() => query),
        where: vi.fn().mockImplementation(() => query),
        then: vi.fn().mockImplementation(() => {
          // hanging promise
          return new Promise(() => {});
        }),
        catch: vi.fn().mockImplementation(function (this: any, onrejected: any) {
          return this.then(undefined, onrejected);
        })
      };
      queryObj = query;
      return query;
    });

    const inputText = [
      "Benchmark,Model A",
      "MMLU,85.0"
    ].join("\n");

    const start = Date.now();
    const result = await previewBenchmarkTextImport(inputText, "src1", null, {
      checkDuplicates: true,
      duplicateTimeoutMs: 50
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(queryObj.then).toHaveBeenCalledTimes(1);
    expect(result.duplicateCount).toBe(0);
    expect(result.total).toBe(1);
    expect(result.previewRows[0].isDuplicate).toBe(false);
    expect(result.warningCount).toBe(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "duplicate-check-skipped",
          reason: expect.stringContaining("timed out after 50ms")
        })
      ])
    );
  });

  test("相同模型和 benchmark 但 benchmarkType 不同时，分数相同仍判定为重复（类型不参与查重）", async () => {
    // 库内已有 MMLU [5-shot] = 85.0
    const existingDbRows = [
      {
        valueRaw: "85.0",
        valueNum: "85.000000",
        valueNum2: null,
        source: "text:paper-src",
        modelName: "Model A",
        modelAlias: null,
        benchmarkName: "MMLU",
        benchmarkType: "5-shot"
      }
    ];

    vi.spyOn(db, "select").mockImplementation(() => mockDbQuery(existingDbRows));

    // 导入同一模型在 MMLU [0-shot] 下的得分，也恰好是 85.0
    const inputText = [
      "Benchmark,Category,Model A",
      "MMLU,0-shot,85.0"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText, "paper-src", null, { checkDuplicates: true });

    expect(result.duplicateCount).toBe(1);
    expect(result.total).toBe(0);
    expect(result.previewRows[0].isDuplicate).toBe(true);
    expect(result.previewRows[0].benchmarkType).toBe("0-shot");
    expect(result.previewRows[0].duplicateSlotKey).toBe("model a::mmlu");
  });

  test("相同模型、相同 benchmark 且相同 benchmarkType 且分数相同时判定为重复", async () => {
    const existingDbRows = [
      {
        valueRaw: "85.0",
        valueNum: "85.000000",
        valueNum2: null,
        source: "text:paper-src",
        modelName: "Model A",
        modelAlias: null,
        benchmarkName: "MMLU",
        benchmarkType: "5-shot"
      }
    ];

    vi.spyOn(db, "select").mockImplementation(() => mockDbQuery(existingDbRows));

    const inputText = [
      "Benchmark,Category,Model A",
      "MMLU,5-shot,85.0"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText, "paper-src", null, { checkDuplicates: true });

    expect(result.duplicateCount).toBe(1);
    expect(result.total).toBe(0);
    expect(result.previewRows[0].isDuplicate).toBe(true);
    expect(result.previewRows[0].duplicateSlotKey).toBe("model a::mmlu");
  });

  test("导入文本未提供 benchmarkType 时退回到 model::benchmark 名称级查重（库内为其他类型也能命中）", async () => {
    const existingDbRows = [
      {
        valueRaw: "85.0",
        valueNum: "85.000000",
        valueNum2: null,
        source: "text:paper-src",
        modelName: "Model A",
        modelAlias: null,
        benchmarkName: "MMLU",
        benchmarkType: "Agentic"
      }
    ];

    vi.spyOn(db, "select").mockImplementation(() => mockDbQuery(existingDbRows));

    const inputText = [
      "Benchmark,Model A",
      "MMLU,85.0"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText, "paper-src", null, { checkDuplicates: true });

    expect(result.previewRows[0].benchmarkType).toBe("General");
    expect(result.previewRows[0].benchmarkTypeProvided).toBe(false);
    expect(result.duplicateCount).toBe(1);
    expect(result.total).toBe(0);
    expect(result.previewRows[0].isDuplicate).toBe(true);
    expect(result.previewRows[0].duplicateSlotKey).toBe("model a::mmlu");
  });

  test("导入文本显式提供 benchmarkType 时同样忽略类型，只按 model::benchmark 判重", async () => {
    const existingDbRows = [
      {
        valueRaw: "85.0",
        valueNum: "85.000000",
        valueNum2: null,
        source: "text:paper-src",
        modelName: "Model A",
        modelAlias: null,
        benchmarkName: "MMLU",
        benchmarkType: "Agentic"
      }
    ];

    vi.spyOn(db, "select").mockImplementation(() => mockDbQuery(existingDbRows));

    const inputText = [
      "Benchmark,Category,Model A",
      "MMLU,Reasoning,85.0"
    ].join("\n");

    const result = await previewBenchmarkTextImport(inputText, "paper-src", null, { checkDuplicates: true });

    expect(result.previewRows[0].benchmarkType).toBe("Reasoning");
    expect(result.previewRows[0].benchmarkTypeProvided).toBe(true);
    expect(result.duplicateCount).toBe(1);
    expect(result.previewRows[0].isDuplicate).toBe(true);
    expect(result.previewRows[0].duplicateSlotKey).toBe("model a::mmlu");
  });
});

