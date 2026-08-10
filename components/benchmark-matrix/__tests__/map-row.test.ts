import { describe, expect, test } from "vitest";

import { toMatrixInputRow } from "@/components/benchmark-matrix/map-row";
import type { DashboardRow } from "@/lib/db/queries";

function createDashboardRow(overrides: Partial<DashboardRow> = {}): DashboardRow {
  return {
    id: 11,
    providerName: "OpenAI",
    providerDisplayName: "OpenAI",
    providerBrandColor: null,
    providerEntityId: 3,
    modelName: "GPT-5",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    sourceBenchmarkType: null,
    higherIsBetter: true,
    benchmarkCanonicalKey: "mmlu-pro:knowledge",
    modalities: ["Text"],
    sourceModalities: null,
    benchTime: "2026-05-01T00:00:00.000Z",
    valueRaw: "70.1",
    valueNum: 70.1,
    valueNum2: null,
    valueNote: null,
    source: "text:only",
    updatedAt: "2026-05-01T12:00:00.000Z",
    ...overrides
  };
}

describe("toMatrixInputRow", () => {
  test("省略默认值与空字段，减小下发载荷", () => {
    const mapped = toMatrixInputRow(createDashboardRow());

    expect(mapped).toEqual({
      recordId: 11,
      providerName: "OpenAI",
      modelName: "GPT-5",
      benchmarkName: "MMLU-Pro",
      benchmarkType: "Knowledge",
      benchmarkCanonicalKey: "mmlu-pro:knowledge",
      modalities: ["Text"],
      benchTime: "2026-05-01T00:00:00.000Z",
      valueRaw: "70.1",
      valueNum: 70.1,
      source: "text:only",
      updatedAt: "2026-05-01T12:00:00.000Z"
    });
    expect(mapped).not.toHaveProperty("providerDisplayName");
    expect(mapped).not.toHaveProperty("providerBrandColor");
    expect(mapped).not.toHaveProperty("higherIsBetter");
    expect(mapped).not.toHaveProperty("valueNote");
    expect(mapped).not.toHaveProperty("valueNum2");
    expect(mapped).not.toHaveProperty("sourceBenchmarkType");
    expect(mapped).not.toHaveProperty("sourceModalities");
    expect(mapped).not.toHaveProperty("providerEntityId");
  });

  test("保留有信息量的非默认字段", () => {
    const mapped = toMatrixInputRow(createDashboardRow({
      providerDisplayName: "OpenAI 官方",
      providerBrandColor: "#10a37f",
      higherIsBetter: false,
      sourceBenchmarkType: "Reasoning",
      sourceModalities: ["Text", "Vision"],
      valueNum2: 12.5,
      valueNote: "x",
      source: "  text:aa  "
    }));

    expect(mapped.providerDisplayName).toBe("OpenAI 官方");
    expect(mapped.providerBrandColor).toBe("#10a37f");
    expect(mapped.higherIsBetter).toBe(false);
    expect(mapped.sourceBenchmarkType).toBe("Reasoning");
    expect(mapped.sourceModalities).toEqual(["Text", "Vision"]);
    expect(mapped.valueNum2).toBe(12.5);
    expect(mapped.valueNote).toBe("x");
    expect(mapped.source).toBe("text:aa");
  });

  test("valueNum 为 null 时仍显式保留", () => {
    const mapped = toMatrixInputRow(createDashboardRow({
      valueRaw: "-",
      valueNum: null
    }));

    expect(mapped.valueNum).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(mapped, "valueNum")).toBe(true);
  });
});
