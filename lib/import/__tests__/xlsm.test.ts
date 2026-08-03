import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";

import { parseWorkbookBuffer } from "@/lib/import/xlsm";

function buildWorkbookBuffer(rows: Array<Array<string>>): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

  return XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx"
  }) as Buffer;
}

describe("parseWorkbookBuffer", () => {
  test("Category 列为空时会继承上一行分类", async () => {
    const buffer = buildWorkbookBuffer([
      ["Category", "Benchmark", "Model A", "Model B"],
      ["Professional", "GDPval", "83", "82"],
      ["", "FinanceAgent v1.1", "56", "61.5"]
    ]);

    const parsed = await parseWorkbookBuffer(buffer, "Sheet1");

    const gdpRows = parsed.records.filter((row) => row.benchmarkName === "GDPval");
    const financeRows = parsed.records.filter((row) => row.benchmarkName === "FinanceAgent v1.1");

    expect(gdpRows.length).toBeGreaterThan(0);
    expect(financeRows.length).toBeGreaterThan(0);
    expect(gdpRows.every((row) => row.category === "Professional")).toBe(true);
    expect(financeRows.every((row) => row.category === "Professional")).toBe(true);
  });

  test("支持货币格式值并识别为有效数值", async () => {
    const buffer = buildWorkbookBuffer([
      ["Category", "Benchmark", "Model A"],
      ["Business", "Vending Bench 2", "$4,432.12"]
    ]);

    const parsed = await parseWorkbookBuffer(buffer, "Sheet1");
    const row = parsed.records.find((item) => item.benchmarkName === "Vending Bench 2");

    expect(row).toBeDefined();
    expect(row?.valid).toBe(true);
    expect(row?.rawValue).toBe("$4,432.12");
    expect(row?.valueNum).toBeCloseTo(4432.12);
    expect(parsed.warnings).toHaveLength(0);
  });

  test("支持 56.2 / 60.7* 这类双值+星号格式", async () => {
    const buffer = buildWorkbookBuffer([
      ["Category", "Benchmark", "Model A"],
      ["Business", "Pair Bench", "56.2 / 60.7*"]
    ]);

    const parsed = await parseWorkbookBuffer(buffer, "Sheet1");
    const row = parsed.records.find((item) => item.benchmarkName === "Pair Bench");

    expect(row).toBeDefined();
    expect(row?.valid).toBe(true);
    expect(row?.rawValue).toBe("56.2 / 60.7*");
    expect(row?.valueNum).toBeCloseTo(56.2);
    expect(row?.valueNum2).toBeCloseTo(60.7);
    expect(row?.valueNote).toBeNull();
    expect(parsed.warnings).toHaveLength(0);
  });

  test("支持 -- / 66.1 这类半空双值格式", async () => {
    const buffer = buildWorkbookBuffer([
      ["Category", "Benchmark", "Model A", "Model B"],
      ["Business", "Pair Bench", "-- / 66.1", "66.1 / --"]
    ]);

    const parsed = await parseWorkbookBuffer(buffer, "Sheet1");
    const modelA = parsed.records.find(
      (item) => item.benchmarkName === "Pair Bench" && item.modelName === "Model A"
    );
    const modelB = parsed.records.find(
      (item) => item.benchmarkName === "Pair Bench" && item.modelName === "Model B"
    );

    expect(modelA).toBeDefined();
    expect(modelA?.valid).toBe(true);
    expect(modelA?.rawValue).toBe("-- / 66.1");
    expect(modelA?.valueNum).toBeNull();
    expect(modelA?.valueNum2).toBeCloseTo(66.1);

    expect(modelB).toBeDefined();
    expect(modelB?.valid).toBe(true);
    expect(modelB?.rawValue).toBe("66.1 / --");
    expect(modelB?.valueNum).toBeCloseTo(66.1);
    expect(modelB?.valueNum2).toBeNull();
    expect(parsed.warnings).toHaveLength(0);
  });

  test("两侧都是空占位的双值按无数据跳过", async () => {
    const buffer = buildWorkbookBuffer([
      ["Category", "Benchmark", "Model A", "Model B", "Model C", "Model D", "Model E"],
      ["Business", "Pair Bench", "-/-", "--/--", "null/null", "na/na", "n/a / -"]
    ]);

    const parsed = await parseWorkbookBuffer(buffer, "Sheet1");

    expect(parsed.records.filter((item) => item.benchmarkName === "Pair Bench")).toHaveLength(0);
    expect(parsed.warnings).toHaveLength(0);
  });

  test("支持首个双值段带星号格式", async () => {
    const buffer = buildWorkbookBuffer([
      ["Category", "Benchmark", "Model A"],
      ["Business", "Pair Bench", "91*/83"]
    ]);

    const parsed = await parseWorkbookBuffer(buffer, "Sheet1");
    const row = parsed.records.find((item) => item.benchmarkName === "Pair Bench");

    expect(row).toBeDefined();
    expect(row?.valid).toBe(true);
    expect(row?.rawValue).toBe("91* / 83");
    expect(row?.valueNum).toBeCloseTo(91);
    expect(row?.valueNum2).toBeCloseTo(83);
    expect(row?.valueNote).toBeNull();
    expect(parsed.warnings).toHaveLength(0);
  });

  test("双值星号后的紧贴明确文本会作为注释", async () => {
    const buffer = buildWorkbookBuffer([
      ["Category", "Benchmark", "Model A"],
      ["Business", "Pair Bench", "81/77.3*paper"]
    ]);

    const parsed = await parseWorkbookBuffer(buffer, "Sheet1");
    const row = parsed.records.find((item) => item.benchmarkName === "Pair Bench");

    expect(row).toBeDefined();
    expect(row?.valid).toBe(true);
    expect(row?.rawValue).toBe("81 / 77.3*");
    expect(row?.valueNum).toBeCloseTo(81);
    expect(row?.valueNum2).toBeCloseTo(77.3);
    expect(row?.valueNote).toBe("paper");
    expect(parsed.warnings).toHaveLength(0);
  });

  test("支持 #3.4 这类名次值，且自动标记 higherIsBetter 为 false", async () => {
    const buffer = buildWorkbookBuffer([
      ["Category", "Benchmark", "Model A"],
      ["Business", "Rank Bench", "#3.4"]
    ]);

    const parsed = await parseWorkbookBuffer(buffer, "Sheet1");
    const row = parsed.records.find((item) => item.benchmarkName === "Rank Bench");

    expect(row).toBeDefined();
    expect(row?.valid).toBe(true);
    expect(row?.rawValue).toBe("#3.4");
    expect(row?.valueNum).toBeCloseTo(3.4);
    expect(row?.valueNum2).toBeNull();
    expect(row?.valueNote).toBeNull();
    expect(row?.higherIsBetter).toBe(false);
    expect(parsed.warnings).toHaveLength(0);
  });

  test("支持 75.6 | 46.8 | 77.9 三值管道格式", async () => {
    const buffer = buildWorkbookBuffer([
      ["Category", "Benchmark", "Model A"],
      ["Audio", "SongFormBench-HarmonixSet(acc|hr.5f|hr3f)", "75.6 | 46.8 | 77.9"]
    ]);

    const parsed = await parseWorkbookBuffer(buffer, "Sheet1");
    const benchmarkNames = new Set(parsed.records.map((item) => item.benchmarkName));
    const valueByBenchmark = new Map(parsed.records.map((item) => [item.benchmarkName, item.rawValue]));

    expect(benchmarkNames).toEqual(
      new Set([
        "SongFormBench-HarmonixSet (acc)",
        "SongFormBench-HarmonixSet (hr.5f)",
        "SongFormBench-HarmonixSet (hr3f)"
      ])
    );
    expect(parsed.records.every((item) => item.valid)).toBe(true);
    expect(valueByBenchmark.get("SongFormBench-HarmonixSet (acc)")).toBe("75.6");
    expect(valueByBenchmark.get("SongFormBench-HarmonixSet (hr.5f)")).toBe("46.8");
    expect(valueByBenchmark.get("SongFormBench-HarmonixSet (hr3f)")).toBe("77.9");
    expect(parsed.warnings).toHaveLength(0);
  });

  test("支持 3.36 | 4.41 两值管道格式", async () => {
    const buffer = buildWorkbookBuffer([
      ["Category", "Benchmark", "Model A"],
      ["Audio", "Librispeech(clean|other)", "3.36 | 4.41"]
    ]);

    const parsed = await parseWorkbookBuffer(buffer, "Sheet1");
    const row = parsed.records.find((item) => item.benchmarkName === "Librispeech");

    expect(row).toBeDefined();
    expect(row?.valid).toBe(true);
    expect(row?.rawValue).toBe("3.36 / 4.41");
    expect(row?.valueNum).toBeCloseTo(3.36);
    expect(row?.valueNum2).toBeCloseTo(4.41);
    expect(row?.valueNote).toContain("(clean|other)");
    expect(parsed.warnings).toHaveLength(0);
  });
});
