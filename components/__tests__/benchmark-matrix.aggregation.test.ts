import { describe, expect, test } from "vitest";

import { SOURCE_ALL } from "@/components/benchmark-matrix/constants";
import {
  buildBenchmarkRankingData,
  buildMatrixRows,
  buildModelColumns,
  buildOverallSummaryByModel
} from "@/components/benchmark-matrix/selectors";
import type { MatrixCellEntry, MatrixInputRow } from "@/components/benchmark-matrix/types";
import {
  aggregateMatrixCellEntries,
  getSourceValueDeltaRaw
} from "@/components/benchmark-matrix/utils";
import { calculateBoxPlotStats } from "@/lib/boxplot-stats";

function makeEntry(valueNum: number | null, overrides: Partial<MatrixCellEntry> = {}): MatrixCellEntry {
  return {
    recordId: null,
    valueRaw: valueNum === null ? "N/A" : String(valueNum),
    valueNum,
    valueNum2: null,
    valueNote: null,
    source: "text:S1",
    benchTime: null,
    ...overrides
  };
}

function makeRow(modelName: string, valueNum: number, index: number): MatrixInputRow {
  return {
    recordId: index + 1,
    providerName: "Provider",
    modelName,
    benchmarkName: "Median Bench",
    benchmarkType: "General",
    benchmarkCanonicalKey: "median-bench:general",
    higherIsBetter: true,
    benchTime: `2026-04-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    valueRaw: String(valueNum),
    valueNum,
    valueNum2: null,
    valueNote: null,
    source: `text:S${index + 1}`
  };
}

describe("benchmark matrix repeated-value aggregation", () => {
  test("单值奇数取中间值，偶数取较大的中间值，且不受指标方向影响", () => {
    const oddEntries = [70, 80, 100].map((value) => makeEntry(value));
    const evenEntries = [70, 80, 82, 100].map((value) => makeEntry(value));

    expect(aggregateMatrixCellEntries(oddEntries, true).valueNum).toBe(80);
    expect(aggregateMatrixCellEntries(evenEntries, true).valueNum).toBe(82);
    expect(aggregateMatrixCellEntries(evenEntries, false).valueNum).toBe(82);
  });

  test("忽略无效数值，无有效数值时保持 null", () => {
    expect(aggregateMatrixCellEntries([
      makeEntry(null),
      makeEntry(Number.NaN),
      makeEntry(75)
    ]).valueNum).toBe(75);

    expect(aggregateMatrixCellEntries([
      makeEntry(null),
      makeEntry(Number.NaN)
    ])).toEqual({ valueNum: null, valueNum2: null });
  });

  test("双值记录继续整条记录按指标方向择优", () => {
    const entries = [
      makeEntry(22, { valueRaw: "22 / 33", valueNum2: 33 }),
      makeEntry(44, { valueRaw: "44 / 55", valueNum2: 55 })
    ];

    expect(aggregateMatrixCellEntries(entries, true)).toEqual({ valueNum: 44, valueNum2: 55 });
    expect(aggregateMatrixCellEntries(entries, false)).toEqual({ valueNum: 22, valueNum2: 33 });
  });

  test("upper median 仅用于矩阵箱线图口径，默认插值口径保持不变", () => {
    const values = [70, 80, 82, 100];

    expect(calculateBoxPlotStats(values).median).toBe(81);
    expect(calculateBoxPlotStats(values, { medianMode: "upper" }).median).toBe(82);
  });

  test("矩阵值、列排序、排名箱线图与 Overall 使用同一聚合值", () => {
    const rows = [
      ...[0, 0, 50, 100].map((value, index) => makeRow("Model A", value, index)),
      ...[60, 60, 60].map((value, index) => makeRow("Model B", value, index + 4))
    ];
    const matrixRow = buildMatrixRows(rows, rows, false, false, SOURCE_ALL)[0]!;

    expect(matrixRow.cells.get("Model A")?.valueNum).toBe(50);
    expect(matrixRow.cells.get("Model B")?.valueNum).toBe(60);
    expect(matrixRow.minNum).toBe(50);
    expect(matrixRow.maxNum).toBe(60);

    expect(buildModelColumns(rows, "", matrixRow.rowKey, false, {}, SOURCE_ALL).slice(0, 2))
      .toEqual(["Model B", "Model A"]);

    const ranking = buildBenchmarkRankingData(
      matrixRow,
      rows,
      ["Model A", "Model B"],
      ["Model A", "Model B"],
      false,
      "relative"
    );
    const modelA = ranking.items.find((item) => item.modelName === "Model A");
    const modelB = ranking.items.find((item) => item.modelName === "Model B");
    expect(modelA?.valueNum).toBe(50);
    expect(modelA?.boxplot?.rawMedian).toBe(50);
    expect(modelB?.rank).toBe(1);

    const overall = buildOverallSummaryByModel([matrixRow], ["Model A", "Model B"]);
    expect(overall.get("Model B")?.rawScore).toBe(100);
    expect(overall.get("Model A")?.rawScore).toBe(0);
  });

  test("Source 差值使用 allEntries 的默认上中位数作为基线", () => {
    const entries = [
      makeEntry(60, { source: "text:S2", benchTime: "2026-06-01T00:00:00.000Z", recordId: 4 }),
      makeEntry(75, { source: "text:S1", benchTime: "2026-05-01T00:00:00.000Z", recordId: 3 }),
      makeEntry(80, { source: "text:S2", benchTime: "2026-04-01T00:00:00.000Z", recordId: 2 }),
      makeEntry(85, { source: "text:S1", benchTime: "2026-03-01T00:00:00.000Z", recordId: 1 })
    ];

    expect(aggregateMatrixCellEntries(entries).valueNum).toBe(80);
    expect(getSourceValueDeltaRaw(entries, "text:S1", true)).toBe(-5);
  });
});
