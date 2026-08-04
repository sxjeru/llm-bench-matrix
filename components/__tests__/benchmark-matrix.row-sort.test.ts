import { describe, expect, test } from "vitest";

import { sortMatrixRows } from "@/components/benchmark-matrix/selectors";
import type { MatrixRow } from "@/components/benchmark-matrix/types";

function buildRow(partial: {
  rowKey: string;
  category: string;
  benchmark: string;
  sourceOrderKey: number | null;
  firstSeenIndex?: number;
}): MatrixRow {
  return {
    rowKey: partial.rowKey,
    category: partial.category,
    benchmark: partial.benchmark,
    higherIsBetter: true,
    modalities: ["Text"],
    cells: new Map(),
    firstSeenIndex: partial.firstSeenIndex ?? partial.sourceOrderKey ?? 0,
    sourceOrderKey: partial.sourceOrderKey,
    rowDataCount: 1,
    rowNumericCount: 1,
    minComparable: null,
    maxComparable: null,
    minComparable2: null,
    maxComparable2: null,
    minNum: null,
    maxNum: null,
    minNum2: null,
    maxNum2: null
  };
}

describe("sortMatrixRows Artificial Analysis source order", () => {
  const rows = [
    buildRow({
      rowKey: "cost-1",
      category: "Cost",
      benchmark: "AA Intelligence Index Cost per Task",
      sourceOrderKey: 1
    }),
    buildRow({
      rowKey: "perf-1",
      category: "Performance",
      benchmark: "Output Speed",
      sourceOrderKey: 2
    }),
    buildRow({
      rowKey: "eval-1",
      category: "Overall",
      benchmark: "AA Intelligence Index",
      sourceOrderKey: 10
    }),
    buildRow({
      rowKey: "eval-2",
      category: "Reasoning",
      benchmark: "GPQA Diamond",
      sourceOrderKey: 11
    })
  ];

  test("AA 页签默认 source 排序把 Cost / Performance 放到评测指标后面", () => {
    const sorted = sortMatrixRows(
      rows,
      { column: "benchmark", mode: "source" },
      "Artificial Analysis"
    );

    expect(sorted.map((row) => row.rowKey)).toEqual(["eval-1", "eval-2", "cost-1", "perf-1"]);
  });

  test("非 AA 页签仍按 sourceOrderKey 排序，不特殊处理 Cost / Performance", () => {
    const sorted = sortMatrixRows(
      rows,
      { column: "benchmark", mode: "source" },
      "text:other-source"
    );

    expect(sorted.map((row) => row.rowKey)).toEqual(["cost-1", "perf-1", "eval-1", "eval-2"]);
  });

  test("AA 页签在 alpha / data 模式下不强制把 Cost / Performance 沉底", () => {
    const alphaSorted = sortMatrixRows(
      rows,
      { column: "benchmark", mode: "alpha" },
      "Artificial Analysis"
    );
    expect(alphaSorted.map((row) => row.benchmark)).toEqual([
      "AA Intelligence Index",
      "AA Intelligence Index Cost per Task",
      "GPQA Diamond",
      "Output Speed"
    ]);

    const dataSorted = sortMatrixRows(
      [
        { ...rows[0]!, rowDataCount: 5 },
        { ...rows[1]!, rowDataCount: 4 },
        { ...rows[2]!, rowDataCount: 3 },
        { ...rows[3]!, rowDataCount: 2 }
      ],
      { column: "benchmark", mode: "data" },
      "Artificial Analysis"
    );
    expect(dataSorted.map((row) => row.rowKey)).toEqual(["cost-1", "perf-1", "eval-1", "eval-2"]);
  });
});
