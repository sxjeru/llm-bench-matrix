import { describe, expect, test } from "vitest";

import {
  buildMatrixMarkdownTable,
  escapeMarkdownTableCell
} from "@/components/benchmark-matrix/export-markdown";
import type { MatrixCell, MatrixCellEntry, MatrixRow, OverallModelSummary } from "@/components/benchmark-matrix/types";

function createCell(overrides: Partial<MatrixCell> = {}): MatrixCell {
  return {
    valueRaw: "70.1",
    valueNum: 70.1,
    valueNum2: null,
    valueNote: null,
    source: "text:only",
    benchTime: "2026-04-06T00:00:00.000Z",
    allEntries: [],
    hasMultipleValues: false,
    uniqueEntries: [],
    noteText: "",
    displayValue: "70.1",
    hasMeaningfulMultipleValues: false,
    hasMultipleActiveSourceValues: false,
    shouldShowQuestionMark: false,
    ...overrides
  };
}

function createRow(overrides: Partial<MatrixRow> = {}): MatrixRow {
  return {
    rowKey: "mmlu",
    category: "Knowledge",
    benchmark: "MMLU-Pro",
    higherIsBetter: true,
    modalities: ["Text"],
    cells: new Map([
      ["Model A", createCell()],
      ["Model B", createCell({ displayValue: "80", valueRaw: "80", valueNum: 80 })]
    ]),
    firstSeenIndex: 0,
    sourceOrderKey: null,
    rowDataCount: 2,
    rowNumericCount: 2,
    minComparable: null,
    maxComparable: null,
    minComparable2: null,
    maxComparable2: null,
    minNum: 70.1,
    maxNum: 80,
    minNum2: null,
    maxNum2: null,
    ...overrides
  };
}

function createEntry(overrides: Partial<MatrixCellEntry> = {}): MatrixCellEntry {
  return {
    valueRaw: "70.1",
    valueNum: 70.1,
    valueNum2: null,
    valueNote: null,
    source: "text:alpha",
    benchTime: "2026-04-06T00:00:00.000Z",
    ...overrides
  };
}

describe("escapeMarkdownTableCell", () => {
  test("转义竖线并把换行压成空格", () => {
    expect(escapeMarkdownTableCell("a|b\nc")).toBe("a\\|b c");
  });

  test("先转义反斜杠再转义竖线，避免 \\| 被解析成未转义列分隔", () => {
    expect(escapeMarkdownTableCell("a\\|b")).toBe("a\\\\\\|b");
  });
});

describe("buildMatrixMarkdownTable", () => {
  test("输出管道表，缺单元格为 --，默认不含类别列", () => {
    const markdown = buildMatrixMarkdownTable({
      rows: [
        createRow({
          cells: new Map([
            ["Model A", createCell()],
            ["Model B", createCell({ displayValue: "80", valueRaw: "80", valueNum: 80 })]
          ])
        }),
        createRow({
          rowKey: "empty",
          benchmark: "Empty Bench",
          modalities: ["Vision"],
          cells: new Map([
            ["Model A", createCell({ displayValue: "", valueRaw: "", valueNum: null })]
          ])
        })
      ],
      modelColumns: ["Model A", "Model B"],
      showCategory: false
    });

    expect(markdown).toBe([
      "| Modality | Benchmark | Model A | Model B |",
      "| --- | --- | --- | --- |",
      "| Text | MMLU-Pro | 70.1 | 80 |",
      "| Vision | Empty Bench | -- | -- |"
    ].join("\n"));
  });

  test("开启类别列时插入 Category", () => {
    const markdown = buildMatrixMarkdownTable({
      rows: [createRow({ modalities: ["Text", "Vision"] })],
      modelColumns: ["Model A", "Model B"],
      showCategory: true
    });

    expect(markdown).toBe([
      "| Modality | Category | Benchmark | Model A | Model B |",
      "| --- | --- | --- | --- | --- |",
      "| Text, Vision | Knowledge | MMLU-Pro | 70.1 | 80 |"
    ].join("\n"));
  });

  test("转义单元格中的竖线", () => {
    const markdown = buildMatrixMarkdownTable({
      rows: [createRow({
        benchmark: "A|B",
        cells: new Map([
          ["Model | A", createCell({ displayValue: "1|2" })]
        ])
      })],
      modelColumns: ["Model | A"],
      showCategory: false
    });

    expect(markdown).toContain("| Text | A\\|B | 1\\|2 |");
    expect(markdown.startsWith("| Modality | Benchmark | Model \\| A |")).toBe(true);
  });

  test("可选输出 Overall 行，分数带名次，无分为 --", () => {
    const overallSummaryByModel = new Map<string, OverallModelSummary>([
      ["Model A", {
        rawScore: 85.04,
        rawRank: 1,
        correctedScore: 85.04,
        correctedRank: 1,
        coverage: 1,
        coveredRows: 1,
        totalRows: 1,
        correctionFactor: 1
      }],
      ["Model B", {
        rawScore: null,
        rawRank: null,
        correctedScore: null,
        correctedRank: null,
        coverage: 0,
        coveredRows: 0,
        totalRows: 1,
        correctionFactor: 1
      }]
    ]);

    const markdown = buildMatrixMarkdownTable({
      rows: [createRow()],
      modelColumns: ["Model A", "Model B"],
      showCategory: true,
      shouldShowOverallSummary: true,
      overallSummaryByModel,
      overallScoreDisplayDecimalsByModel: new Map([
        ["Model A", 2],
        ["Model B", 1]
      ])
    });

    expect(markdown.endsWith("| ∑ | Overall | 总评 / Ranking | 85.04 (1) | -- |")).toBe(true);
  });

  test("非货币双值单元格输出 first / second", () => {
    const markdown = buildMatrixMarkdownTable({
      rows: [createRow({
        cells: new Map([
          ["Model A", createCell({
            valueRaw: "12.5 / 8",
            valueNum: 12.5,
            valueNum2: 8,
            displayValue: "12.5 / 8"
          })]
        ])
      })],
      modelColumns: ["Model A"],
      showCategory: false
    });

    expect(markdown).toContain("| Text | MMLU-Pro | 12.5 / 8 |");
  });

  test("source 原值覆盖聚合 displayValue", () => {
    const markdown = buildMatrixMarkdownTable({
      rows: [createRow({
        cells: new Map([
          ["Model A", createCell({
            displayValue: "75",
            valueNum: 75,
            hasMeaningfulMultipleValues: true,
            uniqueEntries: [
              createEntry({
                source: "text:alpha",
                valueRaw: "91",
                valueNum: 91,
                benchTime: "2026-05-01T00:00:00.000Z"
              }),
              createEntry({
                source: "text:beta",
                valueRaw: "70",
                valueNum: 70,
                benchTime: "2026-04-01T00:00:00.000Z"
              })
            ]
          })]
        ])
      })],
      modelColumns: ["Model A"],
      showCategory: false,
      displaySourceValuesInCells: true,
      activeSource: "text:alpha",
      sourceValueMode: "latest"
    });

    expect(markdown).toContain("| Text | MMLU-Pro | 91 |");
  });
});
