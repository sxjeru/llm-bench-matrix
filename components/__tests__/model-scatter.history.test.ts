import { describe, expect, test } from "vitest";

import type { MatrixCell, MatrixCellEntry, MatrixRow } from "@/components/benchmark-matrix/types";
import { toScatterMetric } from "@/components/model-scatter/metrics";
import {
  canUseScatterHistoryX,
  nextScatterHistoryMode,
  resolveScatterHistoricalPoint
} from "@/components/model-scatter/history";
import type { ScatterHistorySample, ScatterMetric, ScatterPoint } from "@/components/model-scatter/types";

function createEntry(
  valueNum: number,
  benchTime: string,
  recordId: number
): MatrixCellEntry {
  return {
    recordId,
    valueRaw: String(valueNum),
    valueNum,
    valueNum2: null,
    valueNote: null,
    source: "text:artificial analysis",
    benchTime
  };
}

function createCell(current: number, entries: MatrixCellEntry[]): MatrixCell {
  return {
    valueRaw: String(current),
    valueNum: current,
    valueNum2: null,
    valueNote: null,
    source: "text:artificial analysis",
    benchTime: entries.at(-1)?.benchTime ?? "2026-08-01T00:00:00.000Z",
    allEntries: entries,
    hasMultipleValues: entries.length > 1,
    uniqueEntries: entries,
    noteText: "",
    displayValue: String(current),
    hasMeaningfulMultipleValues: entries.length > 1,
    hasMultipleActiveSourceValues: entries.length > 1,
    shouldShowQuestionMark: false
  };
}

function createRow(
  rowKey: string,
  benchmark: string,
  cells: Record<string, MatrixCell>,
  higherIsBetter = true
): MatrixRow {
  const cellMap = new Map(Object.entries(cells));
  return {
    rowKey,
    benchmark,
    category: "Cost",
    higherIsBetter,
    modalities: ["Text"],
    cells: cellMap,
    firstSeenIndex: 0,
    sourceOrderKey: null,
    rowDataCount: cellMap.size,
    rowNumericCount: cellMap.size,
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

function createCurrent(overrides: Partial<ScatterPoint> = {}): ScatterPoint {
  return {
    modelName: "Alpha",
    providerName: "OpenAI",
    color: "#ff5533",
    x: 1.2,
    y: 70,
    isPareto: false,
    ...overrides
  };
}

function withHistory(metric: ScatterMetric, samples: ScatterHistorySample[]): ScatterMetric {
  return {
    ...metric,
    historyByModel: new Map([["Alpha", samples]])
  };
}

describe("resolveScatterHistoricalPoint", () => {
  const xMetric = toScatterMetric(
    createRow(
      "x",
      "AA Intelligence Index Cost per Task",
      {
        Alpha: createCell(1.2, [
          createEntry(3.5, "2026-01-01T00:00:00.000Z", 1),
          createEntry(0.4, "2026-03-01T00:00:00.000Z", 2),
          createEntry(1.2, "2026-08-01T00:00:00.000Z", 3)
        ])
      },
      false
    )
  );
  const yMetric = toScatterMetric(
    createRow("y", "AA Intelligence Index", {
      Alpha: createCell(70, [
        createEntry(55, "2026-01-10T00:00:00.000Z", 11),
        createEntry(62, "2026-03-05T00:00:00.000Z", 12),
        createEntry(70, "2026-08-01T00:00:00.000Z", 13)
      ])
    })
  );

  test("越小越好时第一次取历史最优（最小 X），Y 取最近时间", () => {
    const result = resolveScatterHistoricalPoint({
      current: createCurrent(),
      mode: "best",
      xMetric,
      yMetric,
      xScale: "linear",
      yScale: "linear"
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.point.x).toBe(0.4);
    expect(result.point.y).toBe(62);
    expect(result.point.xBenchTime).toBe("2026-03-01T00:00:00.000Z");
    expect(result.point.yBenchTime).toBe("2026-03-05T00:00:00.000Z");
    expect(result.point.mode).toBe("best");
  });

  test("越小越好时第二次取历史最差（最大 X）", () => {
    const result = resolveScatterHistoricalPoint({
      current: createCurrent(),
      mode: "worst",
      xMetric,
      yMetric,
      xScale: "linear",
      yScale: "linear"
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.point.x).toBe(3.5);
    expect(result.point.y).toBe(55);
  });

  test("越大越好时第一次取最大 X，第二次取最小 X", () => {
    const higherX = toScatterMetric(
      createRow(
        "score",
        "AA Intelligence Index",
        {
          Alpha: createCell(70, [
            createEntry(40, "2026-01-01T00:00:00.000Z", 1),
            createEntry(90, "2026-03-01T00:00:00.000Z", 2),
            createEntry(70, "2026-08-01T00:00:00.000Z", 3)
          ])
        },
        true
      )
    );
    const best = resolveScatterHistoricalPoint({
      current: createCurrent({ x: 70, y: 1.2 }),
      mode: "best",
      xMetric: higherX,
      yMetric: xMetric,
      xScale: "linear",
      yScale: "linear"
    });
    const worst = resolveScatterHistoricalPoint({
      current: createCurrent({ x: 70, y: 1.2 }),
      mode: "worst",
      xMetric: higherX,
      yMetric: xMetric,
      xScale: "linear",
      yScale: "linear"
    });

    expect(best.status).toBe("ok");
    expect(worst.status).toBe("ok");
    if (best.status !== "ok" || worst.status !== "ok") return;
    expect(best.point.x).toBe(90);
    expect(worst.point.x).toBe(40);
  });

  test("Y 为合成轴时保持当前水平", () => {
    const syntheticY: ScatterMetric = {
      ...yMetric,
      kind: "overall",
      historyByModel: new Map()
    };
    const result = resolveScatterHistoricalPoint({
      current: createCurrent({ y: 82 }),
      mode: "best",
      xMetric,
      yMetric: syntheticY,
      xScale: "linear",
      yScale: "linear"
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.point.x).toBe(0.4);
    expect(result.point.y).toBe(82);
    expect(result.point.yBenchTime).toBeNull();
  });

  test("价格轴不支持历史点", () => {
    const priceX: ScatterMetric = { ...xMetric, kind: "price" };
    expect(canUseScatterHistoryX(priceX)).toBe(false);
    expect(
      resolveScatterHistoricalPoint({
        current: createCurrent(),
        mode: "best",
        xMetric: priceX,
        yMetric,
        xScale: "linear",
        yScale: "linear"
      })
    ).toEqual({ status: "unavailable", reason: "unsupported-x" });
  });

  test("没有不同于当前值的历史记录时不可用", () => {
    const noHistoryX = withHistory(xMetric, [
      { value: 1.2, benchTime: "2026-08-01T00:00:00.000Z", recordId: 3 }
    ]);
    expect(
      resolveScatterHistoricalPoint({
        current: createCurrent(),
        mode: "best",
        xMetric: noHistoryX,
        yMetric,
        xScale: "linear",
        yScale: "linear"
      })
    ).toEqual({ status: "unavailable", reason: "no-history" });
  });

  test("历史最优与最差相同时第二次不可用", () => {
    const sameExtremeX = withHistory(xMetric, [
      { value: 0.4, benchTime: "2026-03-01T00:00:00.000Z", recordId: 2 },
      { value: 1.2, benchTime: "2026-08-01T00:00:00.000Z", recordId: 3 }
    ]);
    const best = resolveScatterHistoricalPoint({
      current: createCurrent(),
      mode: "best",
      xMetric: sameExtremeX,
      yMetric,
      xScale: "linear",
      yScale: "linear"
    });
    const worst = resolveScatterHistoricalPoint({
      current: createCurrent(),
      mode: "worst",
      xMetric: sameExtremeX,
      yMetric,
      xScale: "linear",
      yScale: "linear"
    });

    expect(best.status).toBe("ok");
    expect(worst).toEqual({ status: "unavailable", reason: "same-extreme" });
  });

  test("Y 时间等距时取较早记录", () => {
    const tiedY = withHistory(yMetric, [
      { value: 50, benchTime: "2026-02-01T00:00:00.000Z", recordId: 21 },
      { value: 80, benchTime: "2026-04-01T00:00:00.000Z", recordId: 22 }
    ]);
    const tiedX = withHistory(xMetric, [
      { value: 0.4, benchTime: "2026-03-01T00:00:00.000Z", recordId: 2 }
    ]);
    const result = resolveScatterHistoricalPoint({
      current: createCurrent(),
      mode: "best",
      xMetric: tiedX,
      yMetric: tiedY,
      xScale: "linear",
      yScale: "linear"
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.point.y).toBe(50);
    expect(result.point.yBenchTime).toBe("2026-02-01T00:00:00.000Z");
  });

  test("对数轴下非正历史值不可绘制", () => {
    const negativeX = withHistory(xMetric, [
      { value: 0, benchTime: "2026-03-01T00:00:00.000Z", recordId: 2 }
    ]);
    expect(
      resolveScatterHistoricalPoint({
        current: createCurrent(),
        mode: "best",
        xMetric: negativeX,
        yMetric,
        xScale: "log",
        yScale: "linear"
      })
    ).toEqual({ status: "unavailable", reason: "non-positive" });
  });
});

describe("toScatterMetric historyByModel", () => {
  test("从 allEntries 收集数值历史，价格行保持空", () => {
    const metric = toScatterMetric(
      createRow("x", "AA Intelligence Index Cost per Task", {
        Alpha: createCell(1.2, [
          createEntry(3.5, "2026-01-01T00:00:00.000Z", 1),
          createEntry(1.2, "2026-08-01T00:00:00.000Z", 3)
        ])
      }, false)
    );
    const priceMetric = toScatterMetric({
      ...createRow("price", "Output Price", { Alpha: createCell(10, []) }),
      isPriceRow: true
    });

    expect(metric.historyByModel.get("Alpha")?.map((sample) => sample.value)).toEqual([3.5, 1.2]);
    expect(priceMetric.historyByModel.size).toBe(0);
    expect(canUseScatterHistoryX(metric)).toBe(true);
    expect(canUseScatterHistoryX(priceMetric)).toBe(false);
  });
});

describe("nextScatterHistoryMode", () => {
  test("同一模型按 最优 → 最差 → 清除 循环", () => {
    expect(nextScatterHistoryMode(null, "Alpha")).toBe("best");
    expect(nextScatterHistoryMode({ modelName: "Alpha", mode: "best" }, "Alpha")).toBe("worst");
    expect(nextScatterHistoryMode({ modelName: "Alpha", mode: "worst" }, "Alpha")).toBeNull();
  });

  test("换模型时从最优重新开始", () => {
    expect(nextScatterHistoryMode({ modelName: "Alpha", mode: "worst" }, "Beta")).toBe("best");
  });
});
