import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { MetricCombobox } from "@/components/model-scatter/metric-combobox";
import { ScatterCanvas } from "@/components/model-scatter/scatter-canvas";
import { ScatterTooltip } from "@/components/model-scatter/scatter-tooltip";
import {
  ScatterSnapshotOverlayLayer,
  SCATTER_OVERLAY_PARETO_LINE_COLOR_DARK
} from "@/components/model-scatter/snapshot-overlay-layer";
import type {
  ScatterMetric,
  ScatterMetricGroup,
  ScatterSnapshotOverlayDataset
} from "@/components/model-scatter/types";

// Mock recharts scale hooks for testing SVG layer
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    useXAxisScale: () => (val: number) => val * 10,
    useYAxisScale: () => (val: number) => 100 - val
  };
});

const metricWithSnapshots: ScatterMetric = {
    key: "aa-intelligence",
    rowKey: "merged::aa-intelligence",
    label: "AA Intelligence Index",
    category: "Overall",
    kind: "benchmark",
    higherIsBetter: true,
    unit: "score",
    preferLogScale: false,
    valueByModel: new Map([["ModelA", 85]]),
    historyByModel: new Map(),
    snapshots: [
      {
        id: "2026-08-15T00:00:00.000Z",
        timestamp: new Date("2026-08-15T00:00:00.000Z").getTime(),
        label: "2026-08-15",
        modelCount: 40,
        isLatest: true,
        isBatchSnapshot: true,
        isMajorRevision: true
      },
      {
        id: "2026-08-01T00:00:00.000Z",
        timestamp: new Date("2026-08-01T00:00:00.000Z").getTime(),
        label: "2026-08-01",
        modelCount: 38,
        isLatest: false,
        isBatchSnapshot: true,
        isMajorRevision: true
      }
    ]
  };

const metricGroups: ScatterMetricGroup[] = [
  {
    category: "Overall",
    metrics: [metricWithSnapshots]
  }
];

describe("MetricCombobox with Snapshots & Submenu", () => {
  test("有多版本快照的指标展示版本徽章", () => {
    const { container } = render(
      <MetricCombobox
        id="test-combobox"
        axisName="Y 轴"
        metric={metricWithSnapshots}
        metricGroups={metricGroups}
        onChange={vi.fn()}
      />
    );

    const input = container.querySelector("input")!;
    fireEvent.focus(input);

    const badge = container.querySelector(".scatter-combobox-snapshot-tag");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("2");
  });

  test("鼠标悬浮到该指标上触发右侧子菜单展开", async () => {
    vi.useFakeTimers();

    const { container } = render(
      <MetricCombobox
        id="test-combobox"
        axisName="Y 轴"
        metric={metricWithSnapshots}
        metricGroups={metricGroups}
        onChange={vi.fn()}
      />
    );

    const input = container.querySelector("input")!;
    fireEvent.focus(input);

    const option = container.querySelector(".scatter-combobox-option")!;

    // 模拟鼠标悬浮
    fireEvent.mouseEnter(option);

    // 推进 120ms 防抖定时器
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // 验证子菜单已出现在 DOM 中
    const submenu = document.querySelector(".scatter-combobox-submenu");
    expect(submenu).not.toBeNull();
    expect(submenu?.textContent).toContain("最新数据（默认）");
    expect(submenu?.textContent).toContain("2026-08-15");
    expect(submenu?.textContent).toContain("2026-08-01");

    vi.useRealTimers();
  });

  test("普通点击快照项选择特定历史快照", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();

    const { container } = render(
      <MetricCombobox
        id="test-combobox"
        axisName="Y 轴"
        metric={metricWithSnapshots}
        metricGroups={metricGroups}
        onChange={onChange}
      />
    );

    const input = container.querySelector("input")!;
    fireEvent.focus(input);

    const option = container.querySelector(".scatter-combobox-option")!;
    fireEvent.mouseEnter(option);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    const items = document.querySelectorAll(".scatter-combobox-submenu-item");
    // items[0] 是最新，items[1] 是 2026-08-15, items[2] 是 2026-08-01
    const snapshotItem = items[2]!;
    fireEvent.click(snapshotItem);

    expect(onChange).toHaveBeenCalledWith("aa-intelligence", "2026-08-01T00:00:00.000Z");

    vi.useRealTimers();
  });

  test("按住 Ctrl 点击快照项触发 onToggleOverlaySnapshot 叠加背景", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const onToggleOverlaySnapshot = vi.fn();

    const { container } = render(
      <MetricCombobox
        id="test-combobox"
        axisName="Y 轴"
        metric={metricWithSnapshots}
        metricGroups={metricGroups}
        onChange={onChange}
        onToggleOverlaySnapshot={onToggleOverlaySnapshot}
      />
    );

    const input = container.querySelector("input")!;
    fireEvent.focus(input);

    const option = container.querySelector(".scatter-combobox-option")!;
    fireEvent.mouseEnter(option);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    const items = document.querySelectorAll(".scatter-combobox-submenu-item");
    const snapshotItem = items[2]!;

    // 按住 Ctrl 点击
    fireEvent.click(snapshotItem, { ctrlKey: true });

    expect(onToggleOverlaySnapshot).toHaveBeenCalledWith("2026-08-01T00:00:00.000Z");
    expect(onChange).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  test("同时包含主要变动与普通快照时正确展示分组标题与标签", async () => {
    vi.useFakeTimers();
    const metricWithMixedSnapshots: ScatterMetric = {
      ...metricWithSnapshots,
      snapshots: [
        {
          id: "2026-08-15T00:00:00.000Z",
          timestamp: new Date("2026-08-15T00:00:00.000Z").getTime(),
          label: "2026-08-15",
          modelCount: 40,
          isLatest: true,
          isBatchSnapshot: true,
          isMajorRevision: true
        },
        {
          id: "2026-07-01T00:00:00.000Z",
          timestamp: new Date("2026-07-01T00:00:00.000Z").getTime(),
          label: "2026-07-01",
          modelCount: 3,
          isLatest: false,
          isBatchSnapshot: true,
          isMajorRevision: false
        }
      ]
    };

    const { container } = render(
      <MetricCombobox
        id="test-combobox"
        axisName="Y 轴"
        metric={metricWithMixedSnapshots}
        metricGroups={[
          {
            category: "Overall",
            metrics: [metricWithMixedSnapshots]
          }
        ]}
        onChange={vi.fn()}
      />
    );

    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    const option = container.querySelector(".scatter-combobox-option")!;
    fireEvent.mouseEnter(option);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    const dividers = document.querySelectorAll(".scatter-combobox-submenu-divider");
    expect(dividers.length).toBe(2);
    expect(dividers[0]?.textContent).toContain("主要变动");
    expect(dividers[1]?.textContent).toContain("其他历史快照");

    const items = document.querySelectorAll(".scatter-combobox-submenu-item");
    expect(items[1]?.textContent).toContain("2026-08-15");
    expect(items[1]?.textContent).toContain("40 模型");
    expect(items[1]?.textContent).not.toContain("主要变动批次");

    expect(items[2]?.textContent).toContain("2026-07-01");
    expect(items[2]?.textContent).toContain("3 模型");
    expect(items[2]?.textContent).not.toContain("公共批量导入");
    expect(items[2]?.textContent).not.toContain("评测记录");

    vi.useRealTimers();
  });

  test("仅在被选中的快照项或默认最新项上展示「当前」tag，无「当前主选」", async () => {
    vi.useFakeTimers();

    // 1. 默认状态（未选具体快照，即最新数据为当前）
    const { container, rerender } = render(
      <MetricCombobox
        id="test-combobox"
        axisName="Y 轴"
        metric={metricWithSnapshots}
        metricGroups={metricGroups}
        selectedSnapshotId={null}
        onChange={vi.fn()}
      />
    );

    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    const option = container.querySelector(".scatter-combobox-option")!;
    fireEvent.mouseEnter(option);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    let items = document.querySelectorAll(".scatter-combobox-submenu-item");
    // items[0] 是最新数据，应该带有「当前」badge
    expect(items[0]?.querySelector(".scatter-combobox-badge-new")?.textContent).toBe("当前");
    // 历史快照不应有「当前」badge
    expect(items[1]?.querySelector(".scatter-combobox-badge-new")).toBeNull();
    expect(items[2]?.querySelector(".scatter-combobox-badge-new")).toBeNull();
    // 绝无「当前主选」
    expect(document.body.textContent).not.toContain("当前主选");

    // 2. 选中特定历史快照 2026-08-01
    rerender(
      <MetricCombobox
        id="test-combobox"
        axisName="Y 轴"
        metric={metricWithSnapshots}
        metricGroups={metricGroups}
        selectedSnapshotId="2026-08-01T00:00:00.000Z"
        onChange={vi.fn()}
      />
    );

    items = document.querySelectorAll(".scatter-combobox-submenu-item");
    // items[0] 最新数据不再显示「当前」
    expect(items[0]?.querySelector(".scatter-combobox-badge-new")).toBeNull();
    // items[1] 未选中的快照不显示「当前」
    expect(items[1]?.querySelector(".scatter-combobox-badge-new")).toBeNull();
    // items[2] 选中的快照显示「当前」
    expect(items[2]?.querySelector(".scatter-combobox-badge-new")?.textContent).toBe("当前");
    expect(document.body.textContent).not.toContain("当前主选");

    vi.useRealTimers();
  });
});

describe("ScatterSnapshotOverlayLayer SVG 图层渲染", () => {
  const overlayData: ScatterSnapshotOverlayDataset = {
    snapshotId: "2026-08-01T00:00:00.000Z",
    snapshotLabel: "2026-08-01",
    points: [
      {
        modelName: "ModelA",
        providerName: "OpenAI",
        color: "#ff5533",
        x: 2.0,
        y: 80,
        xBenchTime: "2026-08-01T00:00:00.000Z",
        yBenchTime: "2026-08-01T00:00:00.000Z",
        isPareto: true
      },
      {
        modelName: "ModelB",
        providerName: "Anthropic",
        color: "#33bb55",
        x: 5.0,
        y: 60,
        xBenchTime: "2026-08-01T00:00:00.000Z",
        yBenchTime: "2026-08-01T00:00:00.000Z",
        isPareto: false
      }
    ],
    paretoPath: [
      {
        modelName: "ModelA",
        providerName: "OpenAI",
        color: "#ff5533",
        x: 2.0,
        y: 80,
        xBenchTime: "2026-08-01T00:00:00.000Z",
        yBenchTime: "2026-08-01T00:00:00.000Z",
        isPareto: true
      }
    ]
  };

  test("渲染琥珀色虚线历史帕累托折线与叉号，且在前沿点绘制模型名称文本", () => {
    const { container } = render(
      <svg>
        <ScatterSnapshotOverlayLayer overlay={overlayData} />
      </svg>
    );

    // 1. 历史帕累托折线
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute("stroke")).toBe(SCATTER_OVERLAY_PARETO_LINE_COLOR_DARK);
    expect(polyline?.getAttribute("stroke-dasharray")).toBe("4 3");

    // 2. 两个模型均绘制为叉号（path）
    const paths = container.querySelectorAll(".scatter-overlay-cross-group path");
    expect(paths.length).toBe(2);

    // 3. 处于历史帕累托前沿的 ModelA 显示了文字标签
    const label = container.querySelector(".scatter-overlay-cross-group text");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("ModelA");
  });

  test("鼠标悬浮历史点命中区域时正确回传 SVG 坐标", () => {
    const onHoverPoint = vi.fn();
    const { container } = render(
      <svg>
        <ScatterSnapshotOverlayLayer overlay={overlayData} onHoverPoint={onHoverPoint} />
      </svg>
    );

    const hitCircle = container.querySelector(".scatter-overlay-cross-group circle[fill='transparent']")!;
    expect(hitCircle).not.toBeNull();
    fireEvent.mouseEnter(hitCircle);

    expect(onHoverPoint).toHaveBeenCalledWith(
      overlayData.points[0],
      { x: 20, y: 20 }
    );

    fireEvent.mouseLeave(hitCircle);
    expect(onHoverPoint).toHaveBeenCalledWith(null);
  });

  test("悬浮历史快照背景点时，非前沿模型不显示「当期非前沿」，前沿模型显示「★ 当期处于帕累托前沿」", () => {
    const { container } = render(
      <ScatterCanvas
        width={640}
        height={420}
        xMetric={metricWithSnapshots}
        yMetric={metricWithSnapshots}
        dataset={{
          points: [],
          paretoKeys: new Set(),
          paretoPath: [],
          trendLine: null,
          missingCount: 0,
          nonPositiveCount: 0
        }}
        xScale="linear"
        yScale="linear"
        showPareto={true}
        overlayMode="pareto"
        dimNonPareto={false}
        paretoLineStyle="linear"
        labelMode="auto"
        showGuides={false}
        highlightedModel={null}
        snapshotOverlay={overlayData}
      />
    );

    const hitCircles = container.querySelectorAll(
      ".scatter-overlay-cross-group circle[fill='transparent']"
    );
    expect(hitCircles.length).toBe(2);

    // 悬浮在 ModelA (isPareto = true)
    fireEvent.mouseEnter(hitCircles[0]!);
    expect(container.textContent).toContain("ModelA");
    expect(container.textContent).toContain("★ 当期处于帕累托前沿");
    expect(container.textContent).not.toContain("当期非前沿");
    // 日期变黄显示在厂商名右侧，无独立对比背景徽章
    const providerRow = container.querySelector(".scatter-overlay-tooltip .scatter-tooltip-provider");
    expect(providerRow?.textContent).toContain("OpenAI");
    expect(providerRow?.textContent).toContain("2026-08-01");
    expect(container.querySelector(".scatter-overlay-tooltip .text-amber-400")?.textContent).toBe("2026-08-01");
    expect(container.textContent).not.toContain("对比背景");

    // 悬浮在 ModelB (isPareto = false)
    fireEvent.mouseEnter(hitCircles[1]!);
    expect(container.textContent).toContain("ModelB");
    expect(container.textContent).not.toContain("★ 当期处于帕累托前沿");
    expect(container.textContent).not.toContain("当期非前沿");
    expect(container.textContent).not.toContain("对比背景");
  });

  test("点 tooltip 两个值为同日期时将日期显示在厂商名右侧，且不重复在指标行显示", () => {
    const pointWithSameDate = {
      modelName: "ModelA",
      providerName: "OpenAI",
      color: "#ff5533",
      x: 2.0,
      y: 80,
      isPareto: false,
      xBenchTime: "2026-08-01T10:00:00.000Z",
      yBenchTime: "2026-08-01T12:00:00.000Z"
    };

    const { container } = render(
      <ScatterTooltip
        active={true}
        payload={[{ payload: pointWithSameDate }]}
        xMetric={metricWithSnapshots}
        yMetric={metricWithSnapshots}
        xScale="linear"
        yScale="linear"
        showPareto={false}
        points={[pointWithSameDate]}
      />
    );

    const providerRow = container.querySelector(".scatter-tooltip-provider");
    expect(providerRow?.textContent).toContain("OpenAI");
    expect(providerRow?.textContent).toContain("2026-08-01");

    // 两指标行内不应有独立的日期
    const rowDates = container.querySelectorAll(".scatter-tooltip-row span");
    expect(rowDates.length).toBe(0);
  });

  test("点 tooltip 两个值为不同日期时分别在各自指标行显示日期", () => {
    const pointWithDiffDates = {
      modelName: "ModelA",
      providerName: "OpenAI",
      color: "#ff5533",
      x: 2.0,
      y: 80,
      isPareto: false,
      xBenchTime: "2026-06-01T00:00:00.000Z",
      yBenchTime: "2026-08-01T00:00:00.000Z"
    };

    const { container } = render(
      <ScatterTooltip
        active={true}
        payload={[{ payload: pointWithDiffDates }]}
        xMetric={metricWithSnapshots}
        yMetric={metricWithSnapshots}
        xScale="linear"
        yScale="linear"
        showPareto={false}
        points={[pointWithDiffDates]}
      />
    );

    const providerRow = container.querySelector(".scatter-tooltip-provider");
    expect(providerRow?.textContent).toBe("OpenAI");

    // 两指标行各自显示对应日期
    const rowDates = container.querySelectorAll(".scatter-tooltip-row span");
    expect(rowDates.length).toBe(2);
    expect(rowDates[0]?.textContent).toContain("2026-08-01");
    expect(rowDates[1]?.textContent).toContain("2026-06-01");
  });
});


