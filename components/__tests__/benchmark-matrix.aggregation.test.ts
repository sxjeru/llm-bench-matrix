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
  getSourceValueDeltaRaw,
  resolveMatrixCellAggregateMode,
  resolveMatrixCellAggregateModeFromEntries
} from "@/components/benchmark-matrix/utils";
import { calculateBoxPlotStats } from "@/lib/boxplot-stats";
import { hasMatrixCellPairRawValue } from "@/components/benchmark-matrix/scoring";

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
  test("单值奇数取中间值，偶数取指标方向上更优的中间值", () => {
    const oddEntries = [70, 80, 100].map((value) => makeEntry(value));
    const evenEntries = [70, 80, 82, 100].map((value) => makeEntry(value));

    expect(aggregateMatrixCellEntries(oddEntries, true).valueNum).toBe(80);
    expect(aggregateMatrixCellEntries(oddEntries, false).valueNum).toBe(80);
    // 越大越优取较大的中间值 82，越小越优取较小的中间值 80
    expect(aggregateMatrixCellEntries(evenEntries, true).valueNum).toBe(82);
    expect(aggregateMatrixCellEntries(evenEntries, false).valueNum).toBe(80);
  });

  test("聚合结果始终落在真实记录上，raw / source / benchTime 与数值同源", () => {
    const entries = [
      makeEntry(1, { valueRaw: "$1.00", source: "text:S1", benchTime: "2026-03-01T00:00:00.000Z" }),
      makeEntry(5, { valueRaw: "$5.00", source: "text:S2", benchTime: "2026-04-01T00:00:00.000Z" }),
      makeEntry(9, { valueRaw: "$9.00", source: "text:S3", benchTime: "2026-05-01T00:00:00.000Z" })
    ];

    const aggregate = aggregateMatrixCellEntries(entries, true);
    expect(aggregate.valueNum).toBe(5);
    expect(aggregate.entry?.valueRaw).toBe("$5.00");
    expect(aggregate.entry?.source).toBe("text:S2");
    expect(aggregate.entry?.benchTime).toBe("2026-04-01T00:00:00.000Z");
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
    ])).toMatchObject({ entry: null, valueNum: null, valueNum2: null });
  });

  test("纯双值记录继续整条记录按指标方向择优", () => {
    const entries = [
      makeEntry(22, { valueRaw: "22 / 33", valueNum2: 33 }),
      makeEntry(44, { valueRaw: "44 / 55", valueNum2: 55 })
    ];

    expect(aggregateMatrixCellEntries(entries, true)).toMatchObject({ valueNum: 44, valueNum2: 55 });
    expect(aggregateMatrixCellEntries(entries, false)).toMatchObject({ valueNum: 22, valueNum2: 33 });
  });

  test("单双值混合时取中位数，双值只拿前值参与", () => {
    const pairEntry = makeEntry(46.2, {
      valueRaw: "46.2 / 42.5*",
      valueNum2: 42.5,
      source: "text:Hy3",
      benchTime: "2026-07-06T20:38:00.000Z"
    });
    const entries = [
      makeEntry(44, { source: "text:Grok", benchTime: "2026-07-09T07:59:00.000Z" }),
      makeEntry(46.2, { source: "text:GLM-5.2", benchTime: "2026-06-17T08:08:00.000Z" }),
      pairEntry,
      makeEntry(54.9, { source: "text:Macaron", benchTime: "2026-07-21T22:35:00.000Z" }),
      makeEntry(46.2, { source: "text:Kimi", benchTime: "2026-07-17T07:32:00.000Z" }),
      makeEntry(46.2, { source: "text:GLM-5.3", benchTime: "2026-08-14T13:31:00.000Z" }),
      makeEntry(46.2, { source: "text:DeepSeek-V4-Pro", benchTime: "2026-08-13T19:46:00.000Z" }),
      makeEntry(46.2, { source: "text:Smaug", benchTime: "2026-08-11T07:14:00.000Z" }),
      makeEntry(46.2, { source: "text:DeepSeek-V4-Flash", benchTime: "2026-07-31T14:15:00.000Z" })
    ];

    const aggregate = aggregateMatrixCellEntries(entries, true);
    expect(aggregate.valueNum).toBe(46.2);
    expect(aggregate.entry?.source).not.toBe("text:Macaron");
    expect(aggregate.entry?.valueRaw).not.toBe("54.9");
  });

  test("混合数据里双值前值成为中位数时，展示仍跟该条记录同源", () => {
    const pairEntry = makeEntry(80, {
      valueRaw: "80 / 10",
      valueNum2: 10,
      source: "text:Pair",
      benchTime: "2026-05-01T00:00:00.000Z"
    });
    const entries = [
      makeEntry(70, { source: "text:S1", benchTime: "2026-03-01T00:00:00.000Z" }),
      pairEntry,
      makeEntry(100, { source: "text:S3", benchTime: "2026-06-01T00:00:00.000Z" })
    ];

    expect(aggregateMatrixCellEntries(entries, true)).toMatchObject({
      valueNum: 80,
      valueNum2: 10,
      entry: expect.objectContaining({ source: "text:Pair", valueRaw: "80 / 10" })
    });
  });

  test("N/A 等含斜杠的占位符不会被当成双值记录，仍走中位数", () => {
    const entries = [makeEntry(70), makeEntry(80), makeEntry(null), makeEntry(100)];

    // 若把 "N/A" 误判为双值，这里会退回整条择优拿到 100
    expect(aggregateMatrixCellEntries(entries, true).valueNum).toBe(80);
    expect(hasMatrixCellPairRawValue("N/A")).toBe(false);
    expect(hasMatrixCellPairRawValue("22 / 33")).toBe(true);
    expect(hasMatrixCellPairRawValue("$1.50/$3.00")).toBe(true);
  });

  test("upper / lower median 仅用于矩阵箱线图口径，默认插值口径保持不变", () => {
    const values = [70, 80, 82, 100];

    expect(calculateBoxPlotStats(values).median).toBe(81);
    expect(calculateBoxPlotStats(values, { medianMode: "upper" }).median).toBe(82);
    expect(calculateBoxPlotStats(values, { medianMode: "lower" }).median).toBe(80);
    expect(calculateBoxPlotStats([70], { medianMode: "lower" }).median).toBe(70);
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

  test("Source 差值使用 allEntries 的聚合中位数作为基线", () => {
    const entries = [
      makeEntry(60, { source: "text:S2", benchTime: "2026-06-01T00:00:00.000Z", recordId: 4 }),
      makeEntry(75, { source: "text:S1", benchTime: "2026-05-01T00:00:00.000Z", recordId: 3 }),
      makeEntry(80, { source: "text:S2", benchTime: "2026-04-01T00:00:00.000Z", recordId: 2 }),
      makeEntry(85, { source: "text:S1", benchTime: "2026-03-01T00:00:00.000Z", recordId: 1 })
    ];

    expect(aggregateMatrixCellEntries(entries).valueNum).toBe(80);
    expect(getSourceValueDeltaRaw(entries, "text:S1", true)).toBe(-5);
  });

  test("Artificial Analysis 源按记录 source 取最新值，与当前页签无关", () => {
    const entries = [
      makeEntry(70, { source: "text:Artificial Analysis", benchTime: "2026-03-01T00:00:00.000Z", recordId: 1 }),
      makeEntry(80, { source: "text:Artificial Analysis", benchTime: "2026-04-01T00:00:00.000Z", recordId: 2 }),
      makeEntry(100, { source: "text:Artificial Analysis", benchTime: "2026-05-01T00:00:00.000Z", recordId: 3 })
    ];

    expect(resolveMatrixCellAggregateMode("text:Artificial Analysis")).toBe("latest");
    expect(resolveMatrixCellAggregateMode("Artificial Analysis")).toBe("latest");
    expect(resolveMatrixCellAggregateMode("text:S1")).toBe("median");
    expect(resolveMatrixCellAggregateModeFromEntries(entries)).toBe("latest");
    expect(aggregateMatrixCellEntries(entries, true).valueNum).toBe(100);
    expect(aggregateMatrixCellEntries(entries, true).entry?.recordId).toBe(3);
    expect(aggregateMatrixCellEntries(entries, true, "median").valueNum).toBe(100);
  });

  test("Artificial Analysis 在 All 页签也展示最新值，其他 source 仍用中位数", () => {
    const aaRows = [
      makeRow("Model A", 70, 0),
      makeRow("Model A", 80, 1),
      makeRow("Model A", 100, 2)
    ].map((row, index) => ({
      ...row,
      source: "text:Artificial Analysis",
      benchTime: `2026-04-0${index + 1}T00:00:00.000Z`
    }));

    const aaOnOwnTab = buildMatrixRows(aaRows, aaRows, false, false, "text:Artificial Analysis")[0]!;
    expect(aaOnOwnTab.cells.get("Model A")?.valueNum).toBe(100);
    expect(aaOnOwnTab.cells.get("Model A")?.displayValue).toBe("100");

    const aaOnAllTab = buildMatrixRows(aaRows, aaRows, false, false, SOURCE_ALL)[0]!;
    expect(aaOnAllTab.cells.get("Model A")?.valueNum).toBe(100);
    expect(aaOnAllTab.cells.get("Model A")?.displayValue).toBe("100");

    const otherRows = [
      makeRow("Model A", 70, 0),
      makeRow("Model A", 80, 1),
      makeRow("Model A", 100, 2)
    ];
    const otherOnAllTab = buildMatrixRows(otherRows, otherRows, false, false, SOURCE_ALL)[0]!;
    expect(otherOnAllTab.cells.get("Model A")?.valueNum).toBe(80);
  });

  test("All 页签混合 source 时，AA 先折叠成最新值再参与中位数", () => {
    const mixedEntries = [
      makeEntry(70, { source: "text:Artificial Analysis", benchTime: "2026-03-01T00:00:00.000Z", recordId: 1 }),
      makeEntry(80, { source: "text:Artificial Analysis", benchTime: "2026-04-01T00:00:00.000Z", recordId: 2 }),
      makeEntry(100, { source: "text:Artificial Analysis", benchTime: "2026-05-01T00:00:00.000Z", recordId: 3 }),
      makeEntry(60, { source: "text:S1", benchTime: "2026-04-02T00:00:00.000Z", recordId: 4 }),
      makeEntry(90, { source: "text:S2", benchTime: "2026-04-03T00:00:00.000Z", recordId: 5 })
    ];

    expect(resolveMatrixCellAggregateModeFromEntries(mixedEntries)).toBe("median");
    expect(aggregateMatrixCellEntries(mixedEntries, true).valueNum).toBe(90);
    expect(aggregateMatrixCellEntries(mixedEntries, true).entry?.source).toBe("text:S2");
  });
});
