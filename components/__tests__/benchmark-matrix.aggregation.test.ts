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
import {
  hasMatrixCellPairRawValue,
  isEloBenchmark,
  isLatestValueBenchmark
} from "@/components/benchmark-matrix/scoring";

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

  test("单条记录的单元格跳过去重与聚合，展示值与原始记录一致", () => {
    const rows = [makeRow("Model A", 70, 0)];
    const matrixRow = buildMatrixRows(rows, rows, false, false, SOURCE_ALL)[0]!;
    const cell = matrixRow.cells.get("Model A")!;

    expect(cell.allEntries).toHaveLength(1);
    expect(cell.uniqueEntries).toEqual(cell.allEntries);
    expect(cell.valueNum).toBe(70);
    expect(cell.displayValue).toBe("70");
    expect(cell.hasMeaningfulMultipleValues).toBe(false);
  });

  test("只为 coverage 里出现的分组键建行，firstSeenIndex 仍取自 base 首次出现位置", () => {
    const base = [
      makeRow("M1", 10, 0),
      {
        ...makeRow("M1", 20, 1),
        benchmarkName: "Hidden Bench",
        benchmarkCanonicalKey: "hidden-bench:general"
      },
      {
        ...makeRow("M2", 30, 2),
        benchmarkName: "Late Bench",
        benchmarkCanonicalKey: "late-bench:general"
      }
    ];
    const pruned = [base[2]!];
    const rows = buildMatrixRows(base, pruned, false, false, SOURCE_ALL);

    expect(rows.map((row) => row.benchmark)).toEqual(["Late Bench"]);
    expect(rows[0]!.firstSeenIndex).toBe(2);
    expect(rows[0]!.cells.get("M2")?.valueNum).toBe(30);
  });

  test("isLatestValueBenchmark 与 isEloBenchmark 能精确识别各种形式的 Elo 基准且不误伤普通词汇", () => {
    expect(isLatestValueBenchmark("Chatbot Arena (Elo)")).toBe(true);
    expect(isLatestValueBenchmark("GDPval-AA (Elo)")).toBe(true);
    expect(isLatestValueBenchmark("Arena Hard (elo)")).toBe(true);
    expect(isLatestValueBenchmark("Chatbot Arena（Elo）")).toBe(true);
    expect(isLatestValueBenchmark("LMSYS Chatbot Arena Elo")).toBe(true);
    expect(isLatestValueBenchmark("Coding Elo")).toBe(true);
    expect(isLatestValueBenchmark("Arena", "Elo")).toBe(true);
    expect(isLatestValueBenchmark("Arena", "Arena Elo")).toBe(true);

    expect(isEloBenchmark("Chatbot Arena (Elo)")).toBe(true);

    // 不误伤普通基准及包含 elo 子串的英文单词
    expect(isLatestValueBenchmark("MMLU-Pro", "General")).toBe(false);
    expect(isLatestValueBenchmark("GSM8K")).toBe(false);
    expect(isLatestValueBenchmark("Below Average")).toBe(false);
    expect(isLatestValueBenchmark("Model Velocity")).toBe(false);
    expect(isLatestValueBenchmark("Belonging Test")).toBe(false);
  });

  test("识别到 Elo 行时，无论数据源为何，聚合模式均返回 latest 并展示最新记录", () => {
    const eloEntries = [
      makeEntry(1200, { source: "text:LMSYS", benchTime: "2026-03-01T00:00:00.000Z", recordId: 1 }),
      makeEntry(1250, { source: "text:LMSYS", benchTime: "2026-04-01T00:00:00.000Z", recordId: 2 }),
      makeEntry(1300, { source: "text:LMSYS", benchTime: "2026-05-01T00:00:00.000Z", recordId: 3 })
    ];

    const context = { benchmarkName: "Chatbot Arena (Elo)", benchmarkType: "General" };

    // 普通无 context 时，非 AA 仍按中位数
    expect(resolveMatrixCellAggregateModeFromEntries(eloEntries)).toBe("median");
    // 传入 Elo 上下文时，自动切换为 latest
    expect(resolveMatrixCellAggregateModeFromEntries(eloEntries, context)).toBe("latest");

    const aggregate = aggregateMatrixCellEntries(eloEntries, true, undefined, context);
    expect(aggregate.valueNum).toBe(1300);
    expect(aggregate.entry?.recordId).toBe(3);
    expect(aggregate.entry?.benchTime).toBe("2026-05-01T00:00:00.000Z");

    // 跨非 AA 多源也是取最新一条
    const mixedNonAaEntries = [
      makeEntry(1220, { source: "text:Source1", benchTime: "2026-03-01T00:00:00.000Z", recordId: 10 }),
      makeEntry(1350, { source: "text:Source2", benchTime: "2026-06-01T00:00:00.000Z", recordId: 11 }),
      makeEntry(1280, { source: "text:Source1", benchTime: "2026-04-01T00:00:00.000Z", recordId: 12 })
    ];
    const mixedAggregate = aggregateMatrixCellEntries(mixedNonAaEntries, true, undefined, context);
    expect(mixedAggregate.valueNum).toBe(1350);
    expect(mixedAggregate.entry?.source).toBe("text:Source2");
  });

  test("矩阵 buildMatrixRows 对 Elo 行展示最新值，对普通行保持中位数", () => {
    const eloRows = [
      {
        ...makeRow("Model A", 1200, 0),
        benchmarkName: "Chatbot Arena (Elo)",
        benchmarkCanonicalKey: "chatbot-arena-elo:general",
        benchTime: "2026-03-01T00:00:00.000Z",
        source: "text:LMSYS"
      },
      {
        ...makeRow("Model A", 1250, 1),
        benchmarkName: "Chatbot Arena (Elo)",
        benchmarkCanonicalKey: "chatbot-arena-elo:general",
        benchTime: "2026-04-01T00:00:00.000Z",
        source: "text:LMSYS"
      },
      {
        ...makeRow("Model A", 1300, 2),
        benchmarkName: "Chatbot Arena (Elo)",
        benchmarkCanonicalKey: "chatbot-arena-elo:general",
        benchTime: "2026-05-01T00:00:00.000Z",
        source: "text:LMSYS"
      }
    ];

    const matrixRows = buildMatrixRows(eloRows, eloRows, false, false, SOURCE_ALL);
    expect(matrixRows).toHaveLength(1);
    const cell = matrixRows[0]!.cells.get("Model A");
    // Elo 行取最新值 1300，而不是中位数 1250
    expect(cell?.valueNum).toBe(1300);
    expect(cell?.benchTime).toBe("2026-05-01T00:00:00.000Z");

    // 对比常规行（如 MMLU-Pro）在相同数值下仍取中位数 1250
    const regularRows = eloRows.map((r) => ({
      ...r,
      benchmarkName: "MMLU-Pro",
      benchmarkCanonicalKey: "mmlu-pro:general"
    }));
    const regularMatrixRows = buildMatrixRows(regularRows, regularRows, false, false, SOURCE_ALL);
    const regularCell = regularMatrixRows[0]!.cells.get("Model A");
    expect(regularCell?.valueNum).toBe(1250);
  });

  test("Elo 行的列排序和排名弹窗数据与最新值口径一致", () => {
    const eloRows = [
      {
        ...makeRow("Model 1", 1200, 0),
        benchmarkName: "Arena (Elo)",
        benchmarkCanonicalKey: "arena-elo:general",
        benchTime: "2026-03-01T00:00:00.000Z"
      },
      {
        ...makeRow("Model 1", 1400, 1), // Model 1 最新值为 1400（历史中位数为 1300）
        benchmarkName: "Arena (Elo)",
        benchmarkCanonicalKey: "arena-elo:general",
        benchTime: "2026-05-01T00:00:00.000Z"
      },
      {
        ...makeRow("Model 1", 1300, 2),
        benchmarkName: "Arena (Elo)",
        benchmarkCanonicalKey: "arena-elo:general",
        benchTime: "2026-04-01T00:00:00.000Z"
      },
      {
        ...makeRow("Model 2", 1350, 3), // Model 2 值为 1350
        benchmarkName: "Arena (Elo)",
        benchmarkCanonicalKey: "arena-elo:general",
        benchTime: "2026-04-01T00:00:00.000Z"
      }
    ];

    const matrixRows = buildMatrixRows(eloRows, eloRows, false, false, SOURCE_ALL);
    const eloRow = matrixRows[0]!;

    // Model 1 最新值 1400 > Model 2 的 1350；若按中位数 1300 则 Model 2 会排前面
    const sortedColumns = buildModelColumns(
      eloRows,
      "",
      eloRow.rowKey,
      false,
      {},
      SOURCE_ALL
    );
    expect(sortedColumns.slice(0, 2)).toEqual(["Model 1", "Model 2"]);

    // 排名弹窗数据验证
    const rankingData = buildBenchmarkRankingData(
      eloRow,
      eloRows,
      ["Model 1", "Model 2"],
      ["Model 1", "Model 2"],
      false,
      "relative"
    );
    const item1 = rankingData.items.find((i) => i.modelName === "Model 1");
    const item2 = rankingData.items.find((i) => i.modelName === "Model 2");
    expect(item1?.valueNum).toBe(1400);
    expect(item2?.valueNum).toBe(1350);
    expect(item1?.rank).toBe(1);
    expect(item2?.rank).toBe(2);
  });
});
