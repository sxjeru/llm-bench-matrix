import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { MetricCombobox } from "@/components/model-scatter/metric-combobox";
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

describe("MetricCombobox with Snapshots & Submenu", () => {
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
        isBatchSnapshot: true
      },
      {
        id: "2026-08-01T00:00:00.000Z",
        timestamp: new Date("2026-08-01T00:00:00.000Z").getTime(),
        label: "2026-08-01",
        modelCount: 38,
        isLatest: false,
        isBatchSnapshot: true
      }
    ]
  };

  const metricGroups: ScatterMetricGroup[] = [
    {
      category: "Overall",
      metrics: [metricWithSnapshots]
    }
  ];

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
    expect(badge?.textContent).toContain("2个版本");
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
});

