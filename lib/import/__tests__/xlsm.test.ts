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
  test("Category 列为空时会继承上一行分类", () => {
    const buffer = buildWorkbookBuffer([
      ["Category", "Benchmark", "Model A", "Model B"],
      ["Professional", "GDPval", "83", "82"],
      ["", "FinanceAgent v1.1", "56", "61.5"]
    ]);

    const parsed = parseWorkbookBuffer(buffer, "Sheet1");

    const gdpRows = parsed.records.filter((row) => row.benchmarkName === "GDPval");
    const financeRows = parsed.records.filter((row) => row.benchmarkName === "FinanceAgent v1.1");

    expect(gdpRows.length).toBeGreaterThan(0);
    expect(financeRows.length).toBeGreaterThan(0);
    expect(gdpRows.every((row) => row.category === "Professional")).toBe(true);
    expect(financeRows.every((row) => row.category === "Professional")).toBe(true);
  });

  test("支持货币格式值并识别为有效数值", () => {
    const buffer = buildWorkbookBuffer([
      ["Category", "Benchmark", "Model A"],
      ["Business", "Vending Bench 2", "$4,432.12"]
    ]);

    const parsed = parseWorkbookBuffer(buffer, "Sheet1");
    const row = parsed.records.find((item) => item.benchmarkName === "Vending Bench 2");

    expect(row).toBeDefined();
    expect(row?.valid).toBe(true);
    expect(row?.rawValue).toBe("$4,432.12");
    expect(row?.valueNum).toBeCloseTo(4432.12);
    expect(parsed.warnings).toHaveLength(0);
  });

  test("支持 56.2 / 60.7* 这类双值+星号格式", () => {
    const buffer = buildWorkbookBuffer([
      ["Category", "Benchmark", "Model A"],
      ["Business", "Pair Bench", "56.2 / 60.7*"]
    ]);

    const parsed = parseWorkbookBuffer(buffer, "Sheet1");
    const row = parsed.records.find((item) => item.benchmarkName === "Pair Bench");

    expect(row).toBeDefined();
    expect(row?.valid).toBe(true);
    expect(row?.rawValue).toBe("56.2 / 60.7*");
    expect(row?.valueNum).toBeCloseTo(56.2);
    expect(row?.valueNum2).toBeCloseTo(60.7);
    expect(parsed.warnings).toHaveLength(0);
  });
});
