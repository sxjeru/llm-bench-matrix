import { describe, expect, test } from "vitest";

import type { MatrixCell, MatrixCellEntry, MatrixRow } from "@/components/benchmark-matrix/types";
import { toScatterMetric } from "@/components/model-scatter/metrics";
import {
  extractMetricSnapshots,
  formatTimeDifferenceDays,
  pickNearestSampleByTime,
  resolveSampleForSnapshot
} from "@/components/model-scatter/snapshots";
import {
  buildScatterDataset,
  buildScatterSnapshotOverlayDataset
} from "@/components/model-scatter/dataset";
import {
  buildScatterSearchParams,
  parseScatterSearchParams
} from "@/components/model-scatter/persistence";
import type { ScatterHistorySample } from "@/components/model-scatter/types";

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
    category: "Overall",
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

describe("extractMetricSnapshots", () => {
  test("同一批次时间相近（<= 4小时）聚合成单一快照", () => {
    const history = new Map<string, ScatterHistorySample[]>([
      [
        "ModelA",
        [
          { value: 80, benchTime: "2026-08-01T10:00:00.000Z", recordId: 1 },
          { value: 85, benchTime: "2026-08-15T12:00:00.000Z", recordId: 3 }
        ]
      ],
      [
        "ModelB",
        [
          { value: 70, benchTime: "2026-08-01T10:30:00.000Z", recordId: 2 },
          { value: 75, benchTime: "2026-08-15T12:15:00.000Z", recordId: 4 }
        ]
      ]
    ]);

    const snapshots = extractMetricSnapshots(history);
    expect(snapshots.length).toBe(2);
    expect(snapshots[0]?.isLatest).toBe(true);
    expect(snapshots[0]?.label).toBe("2026-08-15");
    expect(snapshots[0]?.modelCount).toBe(2);

    expect(snapshots[1]?.isLatest).toBe(false);
    expect(snapshots[1]?.label).toBe("2026-08-01");
    expect(snapshots[1]?.modelCount).toBe(2);
  });

  test("只有单批次评测数据时不生成历史快照列表", () => {
    const history = new Map<string, ScatterHistorySample[]>([
      ["ModelA", [{ value: 80, benchTime: "2026-08-01T10:00:00.000Z", recordId: 1 }]],
      ["ModelB", [{ value: 70, benchTime: "2026-08-01T10:30:00.000Z", recordId: 2 }]]
    ]);

    const snapshots = extractMetricSnapshots(history);
    expect(snapshots).toEqual([]);
  });
});

describe("pickNearestSampleByTime & resolveSampleForSnapshot", () => {
  const samples: ScatterHistorySample[] = [
    { value: 50, benchTime: "2026-06-01T00:00:00.000Z", recordId: 1 },
    { value: 65, benchTime: "2026-07-01T00:00:00.000Z", recordId: 2 },
    { value: 80, benchTime: "2026-08-01T00:00:00.000Z", recordId: 3 }
  ];

  test("传 null 时返回最新样本", () => {
    expect(pickNearestSampleByTime(samples, null)?.value).toBe(80);
  });

  test("精确匹配时间", () => {
    const target = new Date("2026-07-01T00:00:00.000Z").getTime();
    expect(pickNearestSampleByTime(samples, target)?.value).toBe(65);
  });

  test("就近吸附最近的时间样本", () => {
    const target = new Date("2026-07-10T00:00:00.000Z").getTime();
    expect(pickNearestSampleByTime(samples, target)?.value).toBe(65);
  });

  test("resolveSampleForSnapshot 超出窗口范围返回 null", () => {
    const target = new Date("2026-07-15T00:00:00.000Z").getTime();
    // 窗口默认 8 小时
    expect(resolveSampleForSnapshot(samples, target)).toBeNull();
  });
});

describe("buildScatterDataset with Snapshots", () => {
  const yRow = createRow("y", "AA Intelligence Index", {
    ModelA: createCell(85, [
      createEntry(70, "2026-06-01T00:00:00.000Z", 1),
      createEntry(85, "2026-08-01T00:00:00.000Z", 3)
    ]),
    ModelB: createCell(90, [
      createEntry(90, "2026-08-01T00:00:00.000Z", 4)
    ]) // ModelB 在 2026-06-01 尚不存在
  });

  const xRow = createRow("x", "AA Cost per Task", {
    ModelA: createCell(1.0, [
      createEntry(3.0, "2026-06-05T00:00:00.000Z", 11),
      createEntry(1.0, "2026-08-01T00:00:00.000Z", 13)
    ]),
    ModelB: createCell(0.5, [
      createEntry(0.5, "2026-08-01T00:00:00.000Z", 14)
    ])
  }, false);

  const yMetric = toScatterMetric(yRow);
  const xMetric = toScatterMetric(xRow);

  test("选 2026-06-01 快照时，Y 严格取快照值，X 就近取 2026-06-05 的值，且排除未发布的 ModelB", () => {
    const dataset = buildScatterDataset({
      xMetric,
      yMetric,
      modelNames: ["ModelA", "ModelB"],
      providerNameByModel: new Map([["ModelA", "OpenAI"], ["ModelB", "Anthropic"]]),
      colorByModel: new Map([["ModelA", "#ff0000"], ["ModelB", "#00ff00"]]),
      xScale: "linear",
      yScale: "linear",
      ySnapshot: "2026-06-01T00:00:00.000Z"
    });

    // 只有 ModelA 在 2026-06-01 有评测记录
    expect(dataset.points.length).toBe(1);
    const pointA = dataset.points[0]!;
    expect(pointA.modelName).toBe("ModelA");
    expect(pointA.y).toBe(70);
    expect(pointA.x).toBe(3.0); // 距离 2026-06-01 最近的 2026-06-05
    expect(pointA.yBenchTime).toBe("2026-06-01T00:00:00.000Z");
    expect(pointA.xBenchTime).toBe("2026-06-05T00:00:00.000Z");
  });

  test("选最新时两模型均绘制最新成绩", () => {
    const dataset = buildScatterDataset({
      xMetric,
      yMetric,
      modelNames: ["ModelA", "ModelB"],
      providerNameByModel: new Map([["ModelA", "OpenAI"], ["ModelB", "Anthropic"]]),
      colorByModel: new Map([["ModelA", "#ff0000"], ["ModelB", "#00ff00"]]),
      xScale: "linear",
      yScale: "linear"
    });

    expect(dataset.points.length).toBe(2);
    expect(dataset.points.find((p) => p.modelName === "ModelA")?.y).toBe(85);
    expect(dataset.points.find((p) => p.modelName === "ModelB")?.y).toBe(90);
  });
});

describe("buildScatterSnapshotOverlayDataset (Ctrl+点击背景叠加)", () => {
  const yRow = createRow("y", "AA Intelligence Index", {
    ModelA: createCell(85, [
      createEntry(70, "2026-06-01T00:00:00.000Z", 1),
      createEntry(85, "2026-08-01T00:00:00.000Z", 3)
    ]),
    ModelB: createCell(90, [
      createEntry(60, "2026-06-01T00:00:00.000Z", 2),
      createEntry(90, "2026-08-01T00:00:00.000Z", 4)
    ])
  });

  const xRow = createRow("x", "AA Cost per Task", {
    ModelA: createCell(1.0, [
      createEntry(2.0, "2026-06-01T00:00:00.000Z", 11),
      createEntry(1.0, "2026-08-01T00:00:00.000Z", 13)
    ]),
    ModelB: createCell(0.5, [
      createEntry(4.0, "2026-06-01T00:00:00.000Z", 12),
      createEntry(0.5, "2026-08-01T00:00:00.000Z", 14)
    ])
  }, false);

  const yMetric = toScatterMetric(yRow);
  const xMetric = toScatterMetric(xRow);

  test("生成 2026-06-01 的历史背景叠加数据集，并正确计算历史帕累托前沿", () => {
    const overlay = buildScatterSnapshotOverlayDataset({
      snapshotId: "2026-06-01T00:00:00.000Z",
      xMetric,
      yMetric,
      modelNames: ["ModelA", "ModelB"],
      providerNameByModel: new Map([["ModelA", "OpenAI"], ["ModelB", "Anthropic"]]),
      colorByModel: new Map([["ModelA", "#ff0000"], ["ModelB", "#00ff00"]]),
      xScale: "linear",
      yScale: "linear"
    });

    expect(overlay).not.toBeNull();
    if (!overlay) return;

    expect(overlay.points.length).toBe(2);
    // ModelA 在 2026-06-01: y=70, x=2.0 (更高且成本更低，绝对支配 ModelB y=60, x=4.0)
    const pointA = overlay.points.find((p) => p.modelName === "ModelA")!;
    const pointB = overlay.points.find((p) => p.modelName === "ModelB")!;

    expect(pointA.isPareto).toBe(true);
    expect(pointB.isPareto).toBe(false);
    expect(overlay.paretoPath.map((p) => p.modelName)).toEqual(["ModelA"]);
  });

  test("当 snapshotId 属于 X 轴指标时，X 严格对齐且 Y 就近吸附", () => {
    // 构造只有 X 轴拥有历史快照，Y 轴为普通无历史指标的场景
    const xSnapshotId = xMetric.snapshots[xMetric.snapshots.length - 1]?.id ?? "2026-06-01T00:00:00.000Z";
    const yRowNoHistory = createRow("price", "Price", {
      ModelA: createCell(10, [createEntry(10, "2026-08-01T00:00:00.000Z", 101)]),
      ModelB: createCell(20, [createEntry(20, "2026-08-01T00:00:00.000Z", 102)])
    });
    const yMetricNoHistory = toScatterMetric(yRowNoHistory);

    const overlay = buildScatterSnapshotOverlayDataset({
      snapshotId: xSnapshotId,
      xMetric,
      yMetric: yMetricNoHistory,
      modelNames: ["ModelA", "ModelB"],
      providerNameByModel: new Map([["ModelA", "OpenAI"], ["ModelB", "Anthropic"]]),
      colorByModel: new Map([["ModelA", "#ff0000"], ["ModelB", "#00ff00"]]),
      xScale: "linear",
      yScale: "linear"
    });

    expect(overlay).not.toBeNull();
    expect(overlay?.points.length).toBe(2);
    const pointA = overlay?.points.find((p) => p.modelName === "ModelA");
    expect(pointA?.x).toBe(2.0);
    expect(pointA?.y).toBe(10);
  });
});

describe("URL persistence with snapshots and overlay", () => {
  test("序列化与反序列化 xt, yt, oy 参数", () => {
    const parsed = parseScatterSearchParams(
      new URLSearchParams("x=cost&y=intelligence&yt=2026-08-01&oy=2026-06-01")
    );
    expect(parsed.xKey).toBe("cost");
    expect(parsed.yKey).toBe("intelligence");
    expect(parsed.ySnapshot).toBe("2026-08-01");
    expect(parsed.overlaySnapshot).toBe("2026-06-01");

    const serialized = buildScatterSearchParams({
      xKey: "cost",
      yKey: "intelligence",
      xSnapshot: null,
      ySnapshot: "2026-08-01",
      overlaySnapshot: "2026-06-01",
      xScale: "linear",
      yScale: "linear",
      showPareto: true,
      dimNonPareto: false,
      paretoLineStyle: "linear",
      labelMode: "auto",
      showGuides: false,
      activeSource: "__ALL__"
    });

    expect(serialized).toContain("yt=2026-08-01");
    expect(serialized).toContain("oy=2026-06-01");
  });
});

describe("formatTimeDifferenceDays", () => {
  test("准确计算批次与天数差异", () => {
    const t1 = new Date("2026-08-01T10:00:00Z").getTime();
    const t2 = new Date("2026-08-01T12:00:00Z").getTime();
    const t3 = new Date("2026-08-05T10:00:00Z").getTime();

    expect(formatTimeDifferenceDays(t1, t2)).toBe("相差 2 小时");
    expect(formatTimeDifferenceDays(t1, t3)).toBe("相差 4 天");
  });
});

