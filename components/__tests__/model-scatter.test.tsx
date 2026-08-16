import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";

import { ModelScatter } from "@/components/model-scatter";
import { ScatterCanvas } from "@/components/model-scatter/scatter-canvas";
import { ScatterHistoryLayer } from "@/components/model-scatter/history-layer";
import { buildArrowGeometry, resolveArrowHeadSize } from "@/components/model-scatter/arrow-layer";
import { isInWorstQuadrant } from "@/components/model-scatter/guide-layer";
import { toScatterMetric } from "@/components/model-scatter/metrics";
import { buildScatterDataset, computeAxisDomain } from "@/components/model-scatter/dataset";
import { buildPointProjections, computePlotArea } from "@/components/model-scatter/projection";
import {
  SCATTER_CHART_MARGIN,
  SCATTER_CURSOR_STROKE,
  SCATTER_DIMMED_OPACITY,
  SCATTER_X_AXIS_HEIGHT,
  SCATTER_Y_AXIS_WIDTH
} from "@/components/model-scatter/constants";
import type { MatrixCell, MatrixInputRow, MatrixRow } from "@/components/benchmark-matrix/types";

const replaceMock = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/scatter",
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  // 惰性读取，测试可在 render 前改写查询串
  useSearchParams: () => mockSearchParams
}));

/**
 * 固定样例：Overall Score（Y，越大越好）× Output Price（X，越小越好）。
 * A/B/C 三档「更贵但更强」互不压制，D 又贵又弱必被 A 压制。
 */
const MODEL_SPECS = [
  { modelName: "Alpha", provider: "OpenAI", bench1: 90, bench2: 85, outputCost: 10 },
  { modelName: "Beta", provider: "OpenAI", bench1: 80, bench2: 75, outputCost: 4 },
  { modelName: "Gamma", provider: "Anthropic", bench1: 70, bench2: 65, outputCost: 1 },
  { modelName: "Delta", provider: "Anthropic", bench1: 60, bench2: 55, outputCost: 20 }
];

const rows: MatrixInputRow[] = MODEL_SPECS.flatMap((spec, specIndex) =>
  [
    { name: "Bench-One", type: "Reasoning", value: spec.bench1 },
    { name: "Bench-Two", type: "Coding", value: spec.bench2 }
  ].map((bench, benchIndex) => ({
    recordId: specIndex * 10 + benchIndex,
    providerName: spec.provider,
    providerDisplayName: spec.provider,
    providerBrandColor: null,
    modelName: spec.modelName,
    benchmarkName: bench.name,
    benchmarkType: bench.type,
    sourceBenchmarkType: null,
    higherIsBetter: true,
    benchmarkCanonicalKey: bench.name.toLowerCase(),
    modalities: ["Text"],
    sourceModalities: null,
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: String(bench.value),
    valueNum: bench.value,
    valueNum2: null,
    valueNote: null,
    source: "text:demo",
    updatedAt: "2026-04-06T00:00:00.000Z"
  }))
);

const modelPrices = MODEL_SPECS.map((spec, index) => ({
  modelId: index + 1,
  modelName: spec.modelName,
  inputCost: spec.outputCost / 4,
  outputCost: spec.outputCost,
  cacheReadCost: null,
  lastSyncedAt: null,
  updatedAt: null
}));

const modelParams = MODEL_SPECS.map((spec, index) => ({
  modelId: index + 1,
  modelName: spec.modelName,
  totalParamsB: 100 * (index + 1),
  activatedParamsB: null,
  isEstimated: false,
  note: null
}));

function renderScatter() {
  return render(
    <ModelScatter
      rows={rows}
      allRows={rows}
      sourceOptions={["text:demo"]}
      modelPrices={modelPrices}
      modelParams={modelParams}
    />
  );
}

function stubScatterChartHostSize() {
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains("scatter-chart-host")) {
      return originalGetBoundingClientRect.call(this);
    }

    const width = 960;
    return {
      left: 0,
      top: 0,
      right: width,
      bottom: 0,
      width,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect;
  });
}

// 顶部指标卡已移除，统计改为说明行的紧凑 chip
function statNote(prefix: string): string {
  const notes = Array.from(document.querySelectorAll<HTMLElement>(".scatter-note"));
  const note = notes.find((item) => item.textContent?.trim().startsWith(prefix));
  return note?.textContent?.trim() ?? "";
}

function comparableModelCount(): string {
  return statNote("可比模型").replace(/^可比模型\s*/, "").split("/")[0]?.trim() ?? "";
}

function paretoCount(): string {
  const note = statNote("帕累托前沿");
  return note ? note.replace(/^帕累托前沿\s*/, "").trim() : "--";
}

function legendCount(providerName: string): string {
  const button = screen.getByRole("button", { name: new RegExp(providerName) });
  return button.querySelector(".scatter-legend-count")?.textContent ?? "";
}

function axisInput(container: HTMLElement, axis: "x" | "y"): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`#scatter-axis-${axis}`);
  if (!input) throw new Error(`未找到 ${axis} 轴选择器`);
  return input;
}

// 组合框收起时输入框里显示的就是当前选中的指标
function axisLabel(container: HTMLElement, axis: "x" | "y"): string {
  return axisInput(container, axis).value;
}

/** 展开组合框并返回当前可见的选项文本 */
function openAxisOptions(container: HTMLElement, axis: "x" | "y", query?: string): string[] {
  const input = axisInput(container, axis);
  fireEvent.focus(input);
  if (query !== undefined) fireEvent.change(input, { target: { value: query } });

  return Array.from(container.querySelectorAll(".scatter-combobox-option-label")).map(
    (node) => node.textContent ?? ""
  );
}

function pickAxisOption(container: HTMLElement, axis: "x" | "y", label: string) {
  const input = axisInput(container, axis);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: label } });

  const option = Array.from(container.querySelectorAll(".scatter-combobox-option")).find(
    (node) => node.querySelector(".scatter-combobox-option-label")?.textContent === label
  );
  if (!option) throw new Error(`选项未出现在下拉里：${label}`);
  fireEvent.click(option);
}

beforeEach(() => {
  replaceMock.mockClear();
  mockSearchParams = new URLSearchParams();
  window.localStorage.clear();
});

describe("ModelScatter", () => {
  test("默认渲染 Overall Score × Output Price", () => {
    const { container } = renderScatter();

    expect(axisLabel(container, "y")).toBe("Overall Score");
    expect(axisLabel(container, "x")).toBe("Output Price");

    expect(axisInput(container, "x").getAttribute("role")).toBe("combobox");
  });

  test("导出默认不含底部图例，并可切换为包含图例", () => {
    renderScatter();

    const legendSelect = screen.getByRole("combobox", { name: "导出图例" });
    expect(legendSelect).toHaveValue("exclude");

    fireEvent.change(legendSelect, { target: { value: "include" } });
    expect(legendSelect).toHaveValue("include");
  });

  test("统计出可比模型数与帕累托前沿数", () => {
    renderScatter();

    expect(comparableModelCount()).toBe("4");
    // Delta 又贵又弱，被 Alpha 全面压制
    expect(paretoCount()).toBe("3");
  });

  test("关闭帕累托开关后不再统计前沿", () => {
    renderScatter();

    const toggle = screen.getByRole("checkbox", { name: /帕累托前沿/ });
    expect(paretoCount()).toBe("3");

    fireEvent.click(toggle);
    expect(paretoCount()).toBe("--");

    fireEvent.click(toggle);
    expect(paretoCount()).toBe("3");
  });

  test("双线性且两轴方向一致时切换为散点趋势线", () => {
    const { container } = renderScatter();

    pickAxisOption(container, "y", "Bench-Two");
    pickAxisOption(container, "x", "Bench-One");

    expect(screen.getByRole("checkbox", { name: /散点趋势线/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /淡化非前沿/ })).toBeNull();
    expect(paretoCount()).toBe("--");
  });

  test("任一坐标轴切为对数后恢复帕累托前沿", () => {
    const { container } = renderScatter();

    pickAxisOption(container, "y", "Bench-Two");
    pickAxisOption(container, "x", "Bench-One");
    const yAxisField = axisInput(container, "y").closest<HTMLElement>(".scatter-axis-field");
    if (!yAxisField) throw new Error("未找到 Y 轴控件");
    fireEvent.click(within(yAxisField).getByRole("button", { name: "对数" }));

    expect(screen.getByRole("checkbox", { name: /帕累托前沿/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /淡化非前沿/ })).toBeInTheDocument();
  });

  test("交换按钮互换双轴", () => {
    const { container } = renderScatter();

    fireEvent.click(screen.getByRole("button", { name: "交换 X / Y 轴" }));

    expect(axisLabel(container, "y")).toBe("Output Price");
    expect(axisLabel(container, "x")).toBe("Overall Score");
  });

  test("切换 Y 轴指标后卡片与前沿同步更新", () => {
    const { container } = renderScatter();

    pickAxisOption(container, "y", "Params");

    expect(axisLabel(container, "y")).toBe("Params");
    // 参数量与价格都是越小越好，Gamma（1 美元 / 300B）与 Alpha（10 美元 / 100B）等构成前沿
    expect(Number(paretoCount())).toBeGreaterThan(0);
  });

  test("轴选择器按分类分组，且总评排在最前", () => {
    const { container } = renderScatter();

    fireEvent.focus(axisInput(container, "y"));
    const groups = Array.from(container.querySelectorAll(".scatter-combobox-group")).map(
      (node) => node.textContent
    );

    expect(groups[0]).toBe("Summary");
    expect(groups).toContain("Pricing");
    expect(groups).toContain("Model Info");
  });

  test("Cost 排第二，Performance 在价格之后；AA Index 归入 Summary", () => {
    const extraRows = MODEL_SPECS.flatMap((spec, index) => [
      {
        recordId: 1000 + index * 3,
        providerName: spec.provider,
        providerDisplayName: spec.provider,
        providerBrandColor: null,
        modelName: spec.modelName,
        benchmarkName: "AA Intelligence Index Cost per Task",
        benchmarkType: "Cost",
        sourceBenchmarkType: null,
        higherIsBetter: false,
        benchmarkCanonicalKey: "cost-per-task",
        modalities: ["Text"],
        sourceModalities: null,
        benchTime: "2026-04-06T00:00:00.000Z",
        valueRaw: String(0.2 * (index + 1)),
        valueNum: 0.2 * (index + 1),
        valueNum2: null,
        valueNote: null,
        source: "text:demo",
        updatedAt: "2026-04-06T00:00:00.000Z"
      },
      {
        recordId: 1001 + index * 3,
        providerName: spec.provider,
        providerDisplayName: spec.provider,
        providerBrandColor: null,
        modelName: spec.modelName,
        benchmarkName: "Output Speed",
        benchmarkType: "Performance",
        sourceBenchmarkType: null,
        higherIsBetter: true,
        benchmarkCanonicalKey: "output-speed",
        modalities: ["Text"],
        sourceModalities: null,
        benchTime: "2026-04-06T00:00:00.000Z",
        valueRaw: String(100 + index * 10),
        valueNum: 100 + index * 10,
        valueNum2: null,
        valueNote: null,
        source: "text:demo",
        updatedAt: "2026-04-06T00:00:00.000Z"
      },
      {
        recordId: 1002 + index * 3,
        providerName: spec.provider,
        providerDisplayName: spec.provider,
        providerBrandColor: null,
        modelName: spec.modelName,
        benchmarkName: "AA Intelligence Index",
        benchmarkType: "Overall",
        sourceBenchmarkType: null,
        higherIsBetter: true,
        benchmarkCanonicalKey: "aa-intelligence-index",
        modalities: ["Text"],
        sourceModalities: null,
        benchTime: "2026-04-06T00:00:00.000Z",
        valueRaw: String(60 + index),
        valueNum: 60 + index,
        valueNum2: null,
        valueNote: null,
        source: "text:demo",
        updatedAt: "2026-04-06T00:00:00.000Z"
      }
    ]);

    const { container } = render(
      <ModelScatter
        rows={[...rows, ...extraRows]}
        allRows={[...rows, ...extraRows]}
        sourceOptions={["text:demo"]}
        modelPrices={modelPrices}
        modelParams={modelParams}
      />
    );

    fireEvent.focus(axisInput(container, "x"));
    const groups = Array.from(container.querySelectorAll(".scatter-combobox-group")).map(
      (node) => node.textContent ?? ""
    );
    const optionLabels = Array.from(container.querySelectorAll(".scatter-combobox-option-label")).map(
      (node) => node.textContent ?? ""
    );

    const summaryIndex = groups.indexOf("Summary");
    const costIndex = groups.indexOf("Cost");
    const modelInfoIndex = groups.indexOf("Model Info");
    const pricingIndex = groups.indexOf("Pricing");
    const performanceIndex = groups.indexOf("Performance");
    const codingIndex = groups.indexOf("Coding");

    expect(summaryIndex).toBe(0);
    expect(costIndex).toBe(1);
    expect(modelInfoIndex).toBeGreaterThan(costIndex);
    expect(pricingIndex).toBeGreaterThan(modelInfoIndex);
    expect(performanceIndex).toBeGreaterThan(pricingIndex);
    expect(codingIndex).toBeGreaterThan(performanceIndex);
    expect(optionLabels).toContain("AA Intelligence Index");
    expect(optionLabels).toContain("Overall Score");
  });

  test("方向提示随指标切换", () => {
    const { container } = renderScatter();

    const xField = container.querySelector("#scatter-axis-x")!.closest(".scatter-axis-field")!;
    expect(xField.textContent).toContain("越小越好");

    const yField = container.querySelector("#scatter-axis-y")!.closest(".scatter-axis-field")!;
    expect(yField.textContent).toContain("越大越好");
  });

  test("点击图例可隐藏厂商，前沿随之重算", () => {
    renderScatter();

    expect(comparableModelCount()).toBe("4");
    expect(legendCount("OpenAI")).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: /OpenAI/ }));

    // Alpha 与 Beta 属于 OpenAI，隐藏后只剩 Anthropic 的两个模型
    expect(comparableModelCount()).toBe("2");
    expect(legendCount("OpenAI")).toBe("0");
    expect(legendCount("Anthropic")).toBe("2");
  });

  test("图例只统计当前双轴下实际绘制的模型", () => {
    render(
      <ModelScatter
        rows={rows}
        allRows={rows}
        sourceOptions={["text:demo"]}
        modelPrices={modelPrices.filter((price) => price.modelName !== "Delta")}
        modelParams={modelParams}
      />
    );

    expect(comparableModelCount()).toBe("3");
    expect(legendCount("OpenAI")).toBe("2");
    expect(legendCount("Anthropic")).toBe("1");
  });

  test("图例全部隐藏时给出空态引导", () => {
    renderScatter();

    fireEvent.click(screen.getByRole("button", { name: /OpenAI/ }));
    fireEvent.click(screen.getByRole("button", { name: /Anthropic/ }));

    expect(screen.getByText("当前条件下没有可绘制的点")).toBeInTheDocument();
    expect(comparableModelCount()).toBe("0");
  });

  test("不再渲染模型层叠筛选面板", () => {
    renderScatter();

    expect(screen.queryByText(/模型层叠筛选/)).toBeNull();
    expect(screen.queryByRole("button", { name: "全选模型" })).toBeNull();
    expect(screen.queryByPlaceholderText("筛选 Benchmark")).toBeNull();
  });

  test("提供全屏切换按钮", () => {
    renderScatter();

    const fullscreenButton = screen.getByRole("button", { name: "全屏" });
    expect(fullscreenButton).toBeInTheDocument();
    expect(fullscreenButton.getAttribute("aria-pressed")).toBe("false");
  });

  test("视图状态变更会写回 URL", () => {
    renderScatter();

    replaceMock.mockClear();
    fireEvent.click(screen.getByRole("checkbox", { name: /帕累托前沿/ }));

    expect(replaceMock).toHaveBeenCalled();
    const lastUrl = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(lastUrl).toContain("pareto=0");
  });

  test("URL 参数优先于默认值", () => {
    mockSearchParams = new URLSearchParams("x=params&y=price-output&pareto=0&labels=none");

    const { container } = renderScatter();

    expect(axisLabel(container, "x")).toBe("Params");
    expect(axisLabel(container, "y")).toBe("Output Price");
    expect(paretoCount()).toBe("--");
  });

  test("URL 参数优先于 localStorage 存档", () => {
    window.localStorage.setItem("model-scatter:axis-x", "price-input");
    window.localStorage.setItem("model-scatter:axis-y", "overall");
    mockSearchParams = new URLSearchParams("x=price-output");

    const { container } = renderScatter();

    expect(axisLabel(container, "x")).toBe("Output Price");
  });

  test("没有 URL 参数时读取 localStorage 存档", () => {
    window.localStorage.setItem("model-scatter:axis-x", "price-input");

    const { container } = renderScatter();

    expect(axisLabel(container, "x")).toBe("Input Price");
  });

  test("存档里的轴已失效时回落到默认轴", () => {
    window.localStorage.setItem("model-scatter:axis-x", "no-such-metric");

    const { container } = renderScatter();

    expect(axisLabel(container, "x")).toBe("Output Price");
  });

  test("来源下拉不显示 text: 之类的前缀", () => {
    const { container } = renderScatter();

    const sourceSelect = container.querySelector<HTMLSelectElement>("#scatter-source")!;
    const labels = Array.from(sourceSelect.options).map((option) => option.text);

    expect(labels).toContain("demo");
    expect(labels.some((label) => label.includes("text:"))).toBe(false);
  });

  test("自定义按钮带 scatter-btn 类，避开全局 button 样式覆盖", () => {
    const { container } = renderScatter();

    const swapButton = container.querySelector(".scatter-swap-btn")!;
    expect(swapButton.classList.contains("scatter-btn")).toBe(true);

    container.querySelectorAll(".scatter-segment-btn").forEach((button) => {
      expect(button.classList.contains("scatter-btn")).toBe(true);
    });

    container.querySelectorAll(".scatter-legend-item").forEach((button) => {
      expect(button.classList.contains("scatter-btn")).toBe(true);
    });
  });

  test("不再渲染顶部指标卡", () => {
    const { container } = renderScatter();

    expect(container.querySelector(".home-metric-card")).toBeNull();
  });

  function findScatterSymbol(container: HTMLElement, modelName: string): HTMLElement | undefined {
    return Array.from(container.querySelectorAll(".recharts-scatter-symbol")).find(
      (symbol) =>
        symbol.querySelector("text")?.textContent === modelName ||
        symbol.querySelector(`[data-model-name='${modelName}']`) !== null
    ) as HTMLElement | undefined;
  }

  test("价格轴 Alt 点击只提示不支持，不钉住模型", () => {
    stubScatterChartHostSize();
    const { container } = renderScatter();

    fireEvent.click(findScatterSymbol(container, "Alpha")!, { altKey: true });

    expect(screen.getByText("当前 X 轴没有时间历史，无法绘制历史点")).toBeInTheDocument();
    expect(container.querySelector(".scatter-history-layer")).toBeNull();
    expect(screen.queryByText(/已钉住 Alpha/)).toBeNull();
  });

  test("X 为有历史的 benchmark 时 Alt 点击循环最优、最差并清除", () => {
    stubScatterChartHostSize();
    const extraRows: MatrixInputRow[] = [
      {
        recordId: 9001,
        providerName: "OpenAI",
        providerDisplayName: "OpenAI",
        providerBrandColor: null,
        modelName: "Alpha",
        benchmarkName: "Bench-One",
        benchmarkType: "Reasoning",
        sourceBenchmarkType: null,
        higherIsBetter: true,
        benchmarkCanonicalKey: "bench-one",
        modalities: ["Text"],
        sourceModalities: null,
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "50",
        valueNum: 50,
        valueNum2: null,
        valueNote: null,
        source: "text:demo",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        recordId: 9002,
        providerName: "OpenAI",
        providerDisplayName: "OpenAI",
        providerBrandColor: null,
        modelName: "Alpha",
        benchmarkName: "Bench-One",
        benchmarkType: "Reasoning",
        sourceBenchmarkType: null,
        higherIsBetter: true,
        benchmarkCanonicalKey: "bench-one",
        modalities: ["Text"],
        sourceModalities: null,
        benchTime: "2026-02-01T00:00:00.000Z",
        valueRaw: "99",
        valueNum: 99,
        valueNum2: null,
        valueNote: null,
        source: "text:demo",
        updatedAt: "2026-02-01T00:00:00.000Z"
      },
      {
        recordId: 9003,
        providerName: "OpenAI",
        providerDisplayName: "OpenAI",
        providerBrandColor: null,
        modelName: "Beta",
        benchmarkName: "Bench-One",
        benchmarkType: "Reasoning",
        sourceBenchmarkType: null,
        higherIsBetter: true,
        benchmarkCanonicalKey: "bench-one",
        modalities: ["Text"],
        sourceModalities: null,
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "45",
        valueNum: 45,
        valueNum2: null,
        valueNote: null,
        source: "text:demo",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        recordId: 9004,
        providerName: "OpenAI",
        providerDisplayName: "OpenAI",
        providerBrandColor: null,
        modelName: "Beta",
        benchmarkName: "Bench-One",
        benchmarkType: "Reasoning",
        sourceBenchmarkType: null,
        higherIsBetter: true,
        benchmarkCanonicalKey: "bench-one",
        modalities: ["Text"],
        sourceModalities: null,
        benchTime: "2026-02-01T00:00:00.000Z",
        valueRaw: "92",
        valueNum: 92,
        valueNum2: null,
        valueNote: null,
        source: "text:demo",
        updatedAt: "2026-02-01T00:00:00.000Z"
      }
    ];

    const { container } = render(
      <ModelScatter
        rows={[...rows, ...extraRows]}
        allRows={[...rows, ...extraRows]}
        sourceOptions={["text:demo"]}
        modelPrices={modelPrices}
        modelParams={modelParams}
      />
    );

    pickAxisOption(container, "x", "Bench-One");

    fireEvent.click(findScatterSymbol(container, "Alpha")!, { altKey: true });
    expect(container.querySelector(".scatter-history-layer")?.getAttribute("data-history-mode")).toBe("best");
    expect(screen.getByRole("button", { name: /Alpha · 历史最优/ })).toBeInTheDocument();

    fireEvent.click(findScatterSymbol(container, "Beta")!, { altKey: true });
    expect(container.querySelectorAll(".scatter-history-layer")).toHaveLength(2);
    expect(
      container.querySelector(".scatter-history-layer[data-model-name='Alpha']")?.getAttribute("data-curve-sign")
    ).toBe("1");
    expect(
      container.querySelector(".scatter-history-layer[data-model-name='Beta']")?.getAttribute("data-curve-sign")
    ).toBe("-1");
    expect(screen.getByRole("button", { name: /Beta · 历史最优/ })).toBeInTheDocument();

    fireEvent.click(findScatterSymbol(container, "Alpha")!, { altKey: true });
    expect(
      container.querySelector(".scatter-history-layer[data-model-name='Alpha']")?.getAttribute("data-history-mode")
    ).toBe("worst");
    expect(container.querySelectorAll(".scatter-history-layer")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Alpha · 历史最差/ })).toBeInTheDocument();

    fireEvent.click(findScatterSymbol(container, "Alpha")!, { altKey: true });
    expect(container.querySelector(".scatter-history-layer[data-model-name='Alpha']")).toBeNull();
    expect(container.querySelectorAll(".scatter-history-layer")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Alpha · 历史最优|Alpha · 历史最差/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Beta · 历史最优/ })).toBeInTheDocument();
  });
});

describe("轴选择器（可输入下拉）", () => {
  test("聚焦即展开，按分类分组列出全部指标", () => {
    const { container } = renderScatter();
    const labels = openAxisOptions(container, "y");

    expect(labels).toContain("Overall Score");
    expect(labels).toContain("Output Price");
    expect(labels).toContain("Bench-One");
  });

  test("输入关键词即时筛选", () => {
    const { container } = renderScatter();
    const labels = openAxisOptions(container, "y", "price");

    expect(labels).toContain("Output Price");
    expect(labels).toContain("Input Price");
    expect(labels).not.toContain("Overall Score");
  });

  test("按分类名也能搜到", () => {
    const { container } = renderScatter();
    const labels = openAxisOptions(container, "x", "Model Info");

    expect(labels).toContain("Params");
  });

  test("无匹配时给出空态而不是空白列表", () => {
    const { container } = renderScatter();
    openAxisOptions(container, "x", "zzz-not-a-metric");

    expect(container.querySelector(".scatter-combobox-empty")?.textContent).toBe("没有匹配的指标");
  });

  test("点击选项完成切换并收起", () => {
    const { container } = renderScatter();

    pickAxisOption(container, "x", "Params");

    expect(axisLabel(container, "x")).toBe("Params");
    expect(container.querySelector(".scatter-combobox-list")).toBeNull();
  });

  test("方向键 + 回车可选中", () => {
    const { container } = renderScatter();
    const input = axisInput(container, "y");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Input Price" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(axisLabel(container, "y")).toBe("Input Price");
  });

  test("Esc 关闭并还原成当前选中项", () => {
    const { container } = renderScatter();
    const input = axisInput(container, "y");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "price" } });
    expect(container.querySelector(".scatter-combobox-list")).not.toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(container.querySelector(".scatter-combobox-list")).toBeNull();
    expect(input.value).toBe("Overall Score");
  });

  test("输入时自动放开低覆盖指标", () => {
    const { container } = renderScatter();

    const toggle = screen.getByRole("checkbox", { name: /含低覆盖指标/ }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.focus(axisInput(container, "x"));
    fireEvent.change(axisInput(container, "x"), { target: { value: "bench" } });

    expect(toggle.checked).toBe(true);
  });

  test("仅聚焦不输入时不改动低覆盖开关", () => {
    const { container } = renderScatter();
    const toggle = screen.getByRole("checkbox", { name: /含低覆盖指标/ }) as HTMLInputElement;

    fireEvent.focus(axisInput(container, "x"));

    expect(toggle.checked).toBe(false);
  });

  test("清空输入不会把低覆盖开关又关回去", () => {
    const { container } = renderScatter();
    const input = axisInput(container, "x");
    const toggle = screen.getByRole("checkbox", { name: /含低覆盖指标/ }) as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "bench" } });
    fireEvent.change(input, { target: { value: "" } });

    // 开关是可见、可手动撤销的，自动关回去反而会让刚搜到的指标突然消失
    expect(toggle.checked).toBe(true);
  });
});

function createCell(valueNum: number): MatrixCell {
  return {
    valueRaw: String(valueNum),
    valueNum,
    valueNum2: null,
    valueNote: null,
    source: "test",
    benchTime: null,
    allEntries: [],
    hasMultipleValues: false,
    uniqueEntries: [],
    noteText: "",
    displayValue: String(valueNum),
    hasMeaningfulMultipleValues: false,
    hasMultipleActiveSourceValues: false,
    shouldShowQuestionMark: false
  };
}

function createRow(rowKey: string, benchmark: string, values: Record<string, number>, overrides: Partial<MatrixRow> = {}): MatrixRow {
  const cells = new Map<string, MatrixCell>();
  Object.entries(values).forEach(([modelName, value]) => cells.set(modelName, createCell(value)));

  return {
    rowKey,
    benchmark,
    category: "General",
    higherIsBetter: true,
    modalities: ["Text"],
    cells,
    firstSeenIndex: 0,
    sourceOrderKey: null,
    rowDataCount: cells.size,
    rowNumericCount: cells.size,
    minComparable: null,
    maxComparable: null,
    minComparable2: null,
    maxComparable2: null,
    minNum: null,
    maxNum: null,
    minNum2: null,
    maxNum2: null,
    ...overrides
  };
}

const canvasYMetric = toScatterMetric(
  createRow("y", "Score", { Alpha: 100, Beta: 67, Gamma: 33, Delta: 0 })
);
const canvasXMetric = toScatterMetric(
  createRow("x", "Output Price", { Alpha: 10, Beta: 4, Gamma: 1, Delta: 20 }, {
    higherIsBetter: false,
    isPriceRow: true
  })
);

const dataset = buildScatterDataset({
  xMetric: canvasXMetric,
  yMetric: canvasYMetric,
  modelNames: ["Alpha", "Beta", "Gamma", "Delta"],
  providerNameByModel: new Map([
    ["Alpha", "OpenAI"],
    ["Beta", "OpenAI"],
    ["Gamma", "Anthropic"],
    ["Delta", "Anthropic"]
  ]),
  colorByModel: new Map([
    ["Alpha", "#ff5533"],
    ["Beta", "#34d399"],
    ["Gamma", "#e09a0e"],
    ["Delta", "#a16dfa"]
  ]),
  xScale: "linear",
  yScale: "linear"
});

const canvasProps: React.ComponentProps<typeof ScatterCanvas> = {
  width: 640,
  height: 420,
  xMetric: canvasXMetric,
  yMetric: canvasYMetric,
  dataset,
  xScale: "linear",
  yScale: "linear",
  showPareto: true,
  overlayMode: "pareto",
  dimNonPareto: false,
  paretoLineStyle: "linear",
  labelMode: "auto",
  showGuides: false,
  highlightedModel: null
};

// jsdom 的 getBoundingClientRect 恒为 0，滚轮换算需要一个真实的矩形
function stubSurfaceRect(surface: HTMLElement) {
  surface.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: canvasProps.width,
      bottom: canvasProps.height,
      width: canvasProps.width,
      height: canvasProps.height,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }) as DOMRect;
}

describe("ScatterCanvas", () => {
  function renderCanvas(overrides: Partial<React.ComponentProps<typeof ScatterCanvas>> = {}) {
    return render(<ScatterCanvas {...canvasProps} {...overrides} />);
  }

  test("每个数据点都画出一个散点", () => {
    const { container } = renderCanvas();
    const dots = container.querySelectorAll(".recharts-scatter-symbol circle");

    expect(dots.length).toBeGreaterThanOrEqual(dataset.points.length);
  });

  test("开启帕累托时画出前沿折线", () => {
    const { container } = renderCanvas();

    expect(container.querySelector(".scatter-pareto-layer polyline")).not.toBeNull();
  });

  test("关闭帕累托时不画前沿层", () => {
    const { container } = renderCanvas({ showPareto: false });

    expect(container.querySelector(".scatter-pareto-layer")).toBeNull();
  });

  test("趋势线模式绘制回归线而不绘制帕累托层", () => {
    const { container } = renderCanvas({ overlayMode: "trend" });

    expect(container.querySelector(".scatter-trend-line-layer line")).not.toBeNull();
    expect(container.querySelector(".scatter-pareto-layer")).toBeNull();
  });

  test("标签模式为隐藏时不渲染标签", () => {
    const { container } = renderCanvas({ labelMode: "none" });

    expect(container.querySelectorAll(".recharts-scatter-symbol text").length).toBe(0);
  });

  test("模型名标签跟散点同色，并带深色描边", () => {
    const { container } = renderCanvas({ labelMode: "all" });
    const colorByModel = new Map(dataset.points.map((point) => [point.modelName, point.color]));

    const labels = Array.from(container.querySelectorAll(".recharts-scatter-symbol text"));
    expect(labels.length).toBe(dataset.points.length);

    labels.forEach((node) => {
      const modelName = node.textContent ?? "";
      expect(node.getAttribute("fill")?.toLowerCase()).toBe(colorByModel.get(modelName)?.toLowerCase());
      expect(node.getAttribute("stroke")).toBe("rgba(11, 16, 32, 0.88)");
      expect(Number(node.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(2.25);
      expect(node.getAttribute("paint-order")).toBe("stroke");
    });
  });

  test("标签画进散点的命中区内，鼠标移到文字上也能触发浮窗", () => {
    const { container } = renderCanvas();
    const symbols = Array.from(container.querySelectorAll(".recharts-scatter-symbol"));

    // 标签必须是散点 symbol 的后代 —— Recharts 把 onMouseEnter 挂在这层
    const labelled = symbols.filter((symbol) => symbol.querySelector("text"));
    expect(labelled.length).toBeGreaterThan(0);

    // 每个标签都配一块透明底板，整块区域可悬浮而不是只有笔画
    labelled.forEach((symbol) => {
      expect(symbol.querySelector('rect[fill="transparent"]')).not.toBeNull();
    });
  });

  test("散点浮窗显示时右键只隐藏浮窗并保留十字线，继续移动后恢复悬浮", () => {
    const { container } = renderCanvas();
    const surface = container.querySelector(".scatter-chart-surface") as HTMLElement;
    const symbol = container.querySelector(".recharts-scatter-symbol") as HTMLElement;

    fireEvent.mouseEnter(symbol);
    expect(container.querySelector(".scatter-tooltip")).not.toBeNull();
    expect(container.querySelector(".recharts-tooltip-cursor")).not.toBeNull();

    const contextMenuEvent = fireEvent.contextMenu(symbol);
    expect(contextMenuEvent).toBe(false);
    expect(container.querySelector(".scatter-tooltip")).toBeNull();
    expect(container.querySelector(".recharts-tooltip-cursor")).not.toBeNull();

    fireEvent.mouseMove(surface);
    expect(container.querySelector(".scatter-tooltip")).not.toBeNull();
  });

  test("Shift 点击前沿点会临时隐藏该点并刷新帕累托前沿", () => {
    const { container } = renderCanvas({ labelMode: "all" });
    const findAlphaSymbol = () =>
      Array.from(container.querySelectorAll(".recharts-scatter-symbol")).find(
        (symbol) =>
          symbol.querySelector("text")?.textContent === "Alpha" ||
          symbol.querySelector("[data-model-name='Alpha']") !== null
      ) as HTMLElement | undefined;

    const alphaSymbol = findAlphaSymbol();
    expect(alphaSymbol).not.toBeUndefined();

    const lineBefore = container.querySelector(".scatter-pareto-layer polyline");
    const pointsBefore = lineBefore?.getAttribute("points");
    expect(pointsBefore).toBeTruthy();

    fireEvent.click(alphaSymbol!, { shiftKey: true });

    const hiddenAlpha = findAlphaSymbol();
    expect(hiddenAlpha).not.toBeUndefined();
    const hiddenGroup = hiddenAlpha!.querySelector("[data-model-name='Alpha']");
    expect(hiddenGroup?.getAttribute("opacity")).toBe(String(SCATTER_DIMMED_OPACITY));
    expect(hiddenGroup?.querySelector("text")?.textContent).toBe("Alpha");
    const lineAfter = container.querySelector(".scatter-pareto-layer polyline");
    expect(lineAfter?.getAttribute("points")).toBeTruthy();
    expect(lineAfter?.getAttribute("points")).not.toBe(pointsBefore);
    expect(container.querySelectorAll(".scatter-pareto-layer circle").length).toBe(
      dataset.paretoPath.length - 1
    );
  });

  function findSymbolByModel(container: HTMLElement, modelName: string): HTMLElement | undefined {
    return Array.from(container.querySelectorAll(".recharts-scatter-symbol")).find(
      (symbol) =>
        symbol.querySelector("text")?.textContent === modelName ||
        symbol.querySelector(`[data-model-name='${modelName}']`) !== null
    ) as HTMLElement | undefined;
  }

  test("Ctrl 依次点击两个点会添加弧形箭头标注", () => {
    const onSelectModel = vi.fn();
    const { container } = renderCanvas({ labelMode: "all", onSelectModel });

    const alpha = findSymbolByModel(container, "Alpha");
    expect(alpha).not.toBeUndefined();

    fireEvent.click(alpha!, { ctrlKey: true });
    expect(container.querySelector(".scatter-arrow-start-ring")).not.toBeNull();
    expect(container.querySelector(".scatter-chart-surface")?.classList.contains("is-annotating")).toBe(
      true
    );
    expect(onSelectModel).not.toHaveBeenCalled();

    // 起点高亮会重绘 symbol，必须重新取终点节点
    const beta = findSymbolByModel(container, "Beta");
    expect(beta).not.toBeUndefined();
    fireEvent.click(beta!, { ctrlKey: true });

    const arrow = container.querySelector(".scatter-arrow-annotation") as SVGElement | null;
    expect(arrow).not.toBeNull();
    expect(arrow?.getAttribute("data-from-model")).toBe("Alpha");
    expect(arrow?.getAttribute("data-to-model")).toBe("Beta");
    expect(container.querySelector(".scatter-arrow-path")?.getAttribute("d")).toContain("Q");
    expect(container.querySelector(".scatter-arrow-start-ring")).toBeNull();
    expect(onSelectModel).not.toHaveBeenCalled();
  });

  test("可连续添加多条箭头，普通点击不会钉住起点", () => {
    const onSelectModel = vi.fn();
    const { container } = renderCanvas({ labelMode: "all", onSelectModel });

    fireEvent.click(findSymbolByModel(container, "Alpha")!, { ctrlKey: true });
    fireEvent.click(findSymbolByModel(container, "Beta")!, { ctrlKey: true });
    fireEvent.click(findSymbolByModel(container, "Beta")!, { ctrlKey: true });
    fireEvent.click(findSymbolByModel(container, "Gamma")!, { metaKey: true });

    const arrows = Array.from(container.querySelectorAll(".scatter-arrow-annotation"));
    expect(arrows).toHaveLength(2);
    expect(arrows[0]?.getAttribute("data-from-model")).toBe("Alpha");
    expect(arrows[0]?.getAttribute("data-to-model")).toBe("Beta");
    expect(arrows[0]?.getAttribute("data-curve-sign")).toBe("1");
    expect(arrows[1]?.getAttribute("data-from-model")).toBe("Beta");
    expect(arrows[1]?.getAttribute("data-to-model")).toBe("Gamma");
    expect(arrows[1]?.getAttribute("data-curve-sign")).toBe("-1");
    expect(onSelectModel).not.toHaveBeenCalled();
  });

  test("传入历史点时绘制空心环与指向当前点的箭头", () => {
    const { container } = renderCanvas({
      historicalPoints: [{
        modelName: "Alpha",
        providerName: "OpenAI",
        color: "#ff5533",
        mode: "best",
        x: 2,
        y: 80,
        xBenchTime: "2026-03-01T00:00:00.000Z",
        yBenchTime: "2026-03-05T00:00:00.000Z",
        currentX: 10,
        currentY: 100
      }]
    });

    const layer = container.querySelector(".scatter-history-layer");
    expect(layer).not.toBeNull();
    expect(layer?.getAttribute("data-history-mode")).toBe("best");
    expect(container.querySelector(".scatter-history-ring-outer")).not.toBeNull();
    expect(container.querySelector(".scatter-history-ring-outer")?.getAttribute("r")).toBe("6");
    expect(container.querySelector(".scatter-history-arrow-path")?.getAttribute("d")).toContain("Q");
    expect(container.querySelector(".scatter-history-label")?.textContent).toBe("历史最优");
  });

  test("悬浮历史点时显示历史 tooltip 与十字线", () => {
    const { container } = renderCanvas({
      historicalPoints: [{
        modelName: "Alpha",
        providerName: "OpenAI",
        color: "#ff5533",
        mode: "best",
        x: 2,
        y: 80,
        xBenchTime: "2026-03-01T00:00:00.000Z",
        yBenchTime: "2026-03-05T00:00:00.000Z",
        currentX: 10,
        currentY: 100
      }]
    });

    const hitTarget = container.querySelector(".scatter-history-hit-target");
    expect(hitTarget).not.toBeNull();

    fireEvent.mouseEnter(hitTarget!);

    expect(container.querySelector(".scatter-history-tooltip")).not.toBeNull();
    expect(container.querySelector(".scatter-history-tooltip")?.textContent).toContain("历史最优");
    const tooltipAnchor = container.querySelector(".scatter-history-tooltip-anchor");
    expect(tooltipAnchor?.getAttribute("data-placement")).toBe("left");
    expect(Number((tooltipAnchor as HTMLElement | null)?.style.left.replace("px", ""))).toBeLessThan(
      Number(hitTarget?.getAttribute("cx"))
    );
    expect(tooltipAnchor?.parentElement).toBe(container.querySelector(".scatter-chart-surface"));
    expect(container.querySelector(".scatter-history-layer")?.contains(tooltipAnchor)).toBe(false);
    expect(container.querySelectorAll(".scatter-history-cursor line")).toHaveLength(2);
    expect(container.querySelector(".scatter-history-cursor-x")?.getAttribute("stroke-dasharray")).toBe(
      "4 3"
    );

    fireEvent.mouseLeave(hitTarget!);
    expect(container.querySelector(".scatter-history-tooltip")).toBeNull();
  });

  test("箭头会选择避开标签占位框的弧线", () => {
    const direct = buildArrowGeometry({ x: 100, y: 200 }, { x: 300, y: 200 });
    const avoided = buildArrowGeometry(
      { x: 100, y: 200 },
      { x: 300, y: 200 },
      [{ left: 150, right: 250, top: 214, bottom: 230 }]
    );

    expect(direct?.path).toBeTruthy();
    expect(avoided?.path).toBeTruthy();
    expect(avoided?.path).not.toBe(direct?.path);
  });

  test("上弧箭头从目标点斜上方入射", () => {
    const geometry = buildArrowGeometry(
      { x: 100, y: 200 },
      { x: 300, y: 200 },
      [{ left: 150, right: 250, top: 214, bottom: 230 }]
    );

    expect(geometry).not.toBeNull();
    expect(geometry!.end.x).toBeLessThan(300);
    expect(geometry!.end.y).toBeLessThan(200);
  });

  test("下弧箭头从目标点斜下方入射", () => {
    const geometry = buildArrowGeometry({ x: 100, y: 200 }, { x: 300, y: 200 });

    expect(geometry).not.toBeNull();
    expect(geometry!.end.x).toBeLessThan(300);
    expect(geometry!.end.y).toBeGreaterThan(200);
  });

  test("短路径或重叠时缩小箭头末端", () => {
    const long = buildArrowGeometry({ x: 40, y: 200 }, { x: 280, y: 200 });
    const short = buildArrowGeometry({ x: 180, y: 200 }, { x: 216, y: 200 });
    expect(resolveArrowHeadSize(36)).toBeLessThan(resolveArrowHeadSize(180));
    expect(resolveArrowHeadSize(180, 8)).toBeLessThan(resolveArrowHeadSize(180));
    expect(short?.headSize).toBeLessThan(long?.headSize ?? Number.POSITIVE_INFINITY);
    expect(long?.headSize).toBeGreaterThan(20);
    expect(short?.headSize).toBeGreaterThanOrEqual(15);
    expect(resolveArrowHeadSize(180, 20)).toBeGreaterThanOrEqual(14);
  });

  test("Shift 淡化当前模型时历史层同步淡化", () => {
    const { container } = renderCanvas({
      labelMode: "all",
      historicalPoints: [{
        modelName: "Alpha",
        providerName: "OpenAI",
        color: "#ff5533",
        mode: "best",
        x: 2,
        y: 80,
        xBenchTime: "2026-03-01T00:00:00.000Z",
        yBenchTime: "2026-03-05T00:00:00.000Z",
        currentX: 10,
        currentY: 100
      }]
    });

    fireEvent.click(findSymbolByModel(container, "Alpha")!, { shiftKey: true });

    expect(container.querySelector(".scatter-history-layer")?.getAttribute("opacity")).toBe(
      String(SCATTER_DIMMED_OPACITY)
    );
  });

  test("历史点或当前点离开缩放视口后不渲染历史层", () => {
    const { container } = render(
      <ScatterHistoryLayer
        point={{
          modelName: "Alpha",
          providerName: "OpenAI",
          color: "#ff5533",
          mode: "best",
          x: 20,
          y: 80,
          xBenchTime: "2026-03-01T00:00:00.000Z",
          yBenchTime: "2026-03-05T00:00:00.000Z",
          currentX: 2,
          currentY: 50
        }}
        xDomain={[0, 10]}
        yDomain={[0, 100]}
        xScale="linear"
        yScale="linear"
        plotArea={{ left: 70, right: 600, top: 20, bottom: 380 }}
      />
    );

    expect(container.querySelector(".scatter-history-layer")).toBeNull();
  });

  test("Alt 点击点会交给外部历史切换，不钉住模型", () => {
    const onSelectModel = vi.fn();
    const onToggleHistory = vi.fn();
    const { container } = renderCanvas({ labelMode: "all", onSelectModel, onToggleHistory });

    fireEvent.click(findSymbolByModel(container, "Alpha")!, { altKey: true });

    expect(onToggleHistory).toHaveBeenCalledWith("Alpha");
    expect(onSelectModel).not.toHaveBeenCalled();
  });

  test("空白处点击会取消待选的箭头起点", () => {
    const { container } = renderCanvas({ labelMode: "all" });
    const surface = container.querySelector(".scatter-chart-surface") as HTMLElement;

    fireEvent.click(findSymbolByModel(container, "Alpha")!, { ctrlKey: true });
    expect(container.querySelector(".scatter-arrow-start-ring")).not.toBeNull();

    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(surface, { pointerId: 1, button: 0, clientX: 300, clientY: 200 });

    expect(container.querySelector(".scatter-arrow-start-ring")).toBeNull();
    expect(container.querySelector(".scatter-chart-surface")?.classList.contains("is-annotating")).toBe(
      false
    );
  });

  test("开启中位参考线时画出参考层", () => {
    const { container } = renderCanvas({ showGuides: true });

    expect(container.querySelectorAll(".scatter-guide-layer line").length).toBe(2);
  });

  test("最优象限铺浅绿底色，落在两轴更优的一侧", () => {
    // X = Output Price（越小越好，左侧更优）；Y = Score（越大越好，上方更优）
    const { container } = renderCanvas({ showGuides: true });

    const quadrant = container.querySelector(".scatter-best-quadrant") as SVGRectElement | null;
    expect(quadrant).not.toBeNull();

    const verticalLine = container.querySelector(".scatter-guide-layer line") as SVGLineElement;
    const xMedianPixel = Number(verticalLine.getAttribute("x1"));

    const rectX = Number(quadrant!.getAttribute("x"));
    const rectWidth = Number(quadrant!.getAttribute("width"));
    const rectY = Number(quadrant!.getAttribute("y"));

    // 左半边：右边界贴着中位线
    expect(rectX + rectWidth).toBeCloseTo(xMedianPixel, 1);
    // 上半边：顶边贴着绘图区顶部
    expect(rectY).toBeCloseTo(SCATTER_CHART_MARGIN.top, 1);
    expect(quadrant!.getAttribute("fill")).toContain("101, 212, 143");
  });

  test("方向翻转时最优象限跟着换边", () => {
    const flippedX = { ...canvasXMetric, higherIsBetter: true };
    const { container } = renderCanvas({ showGuides: true, xMetric: flippedX });

    const verticalLine = container.querySelector(".scatter-guide-layer line") as SVGLineElement;
    const xMedianPixel = Number(verticalLine.getAttribute("x1"));
    const quadrant = container.querySelector(".scatter-best-quadrant") as SVGRectElement;

    // X 改为越大越好后，最优象限落到右半边
    expect(Number(quadrant.getAttribute("x"))).toBeCloseTo(xMedianPixel, 1);
  });

  test("关闭参考线时不画最优象限", () => {
    const { container } = renderCanvas({ showGuides: false });

    expect(container.querySelector(".scatter-best-quadrant")).toBeNull();
  });

  test("钉住模型时即使关闭中位参考线也会画出以该点为中心的十字", () => {
    const { container } = renderCanvas({ showGuides: false, highlightedModel: "Alpha" });

    const guide = container.querySelector(".scatter-guide-layer");
    expect(guide).not.toBeNull();
    expect(guide?.getAttribute("data-emphasis")).toBe("pinned");
    expect(guide?.classList.contains("is-pinned")).toBe(true);
    expect(container.querySelectorAll(".scatter-guide-layer line").length).toBe(2);
  });

  test("钉住后十字与最优象限以该点为中心，而不是全体中位", () => {
    const { container } = renderCanvas({ showGuides: true, highlightedModel: "Alpha", labelMode: "all" });

    const alphaSymbol = Array.from(container.querySelectorAll(".recharts-scatter-symbol")).find(
      (symbol) => symbol.querySelector("text")?.textContent === "Alpha"
    );
    expect(alphaSymbol).not.toBeUndefined();

    // 主圆是钉住环之后的那个实心圆
    const alphaDot = alphaSymbol!.querySelectorAll("circle")[1] as SVGCircleElement;
    const alphaCx = Number(alphaDot.getAttribute("cx"));
    const alphaCy = Number(alphaDot.getAttribute("cy"));

    const verticalLine = container.querySelector(".scatter-guide-line-x") as SVGLineElement;
    const horizontalLine = container.querySelector(".scatter-guide-line-y") as SVGLineElement;
    expect(Number(verticalLine.getAttribute("x1"))).toBeCloseTo(alphaCx, 1);
    expect(Number(horizontalLine.getAttribute("y1"))).toBeCloseTo(alphaCy, 1);

    // 钉住十字用定位十字同档的亮色，区别于中位淡线
    expect(verticalLine.getAttribute("stroke")).toBe(SCATTER_CURSOR_STROKE);

    const quadrant = container.querySelector(".scatter-best-quadrant") as SVGRectElement;
    // X 越小越好 → 最优在左侧；Y 越大越好 → 最优在上方；中心贴着 Alpha
    expect(Number(quadrant.getAttribute("x")) + Number(quadrant.getAttribute("width"))).toBeCloseTo(
      alphaCx,
      1
    );
    expect(Number(quadrant.getAttribute("y"))).toBeCloseTo(SCATTER_CHART_MARGIN.top, 1);
    expect(
      Number(quadrant.getAttribute("y")) + Number(quadrant.getAttribute("height"))
    ).toBeCloseTo(alphaCy, 1);
  });

  test("钉住后淡化最差象限内的点", () => {
    // Alpha (x=10, y=100)：X 越小越好、Y 越大越好 → 最差象限是更贵且更弱
    // Delta (20, 0) 全面落后；Beta/Gamma 至少有一轴更优，不应被淡化
    const { container } = renderCanvas({ highlightedModel: "Alpha", labelMode: "all" });

    const opacityByModel = new Map(
      Array.from(container.querySelectorAll(".recharts-scatter-symbol")).map((symbol) => {
        const name = symbol.querySelector("text")?.textContent ?? "";
        // 与厂商淡化测试同一路径：opacity 挂在 shape 内我们返回的 <g> 上
        const opacity = Number(
          symbol.querySelector(".recharts-shape > g")?.getAttribute("opacity") ?? "1"
        );
        return [name, opacity] as const;
      })
    );

    expect(opacityByModel.get("Alpha")).toBe(1);
    expect(opacityByModel.get("Beta")).toBe(1);
    expect(opacityByModel.get("Gamma")).toBe(1);
    expect(opacityByModel.get("Delta")).toBe(SCATTER_DIMMED_OPACITY);
  });

  test("最差象限判定：两轴都更差才算，贴边不算", () => {
    const center = { x: 10, y: 100 };
    // X 越小越好、Y 越大越好
    expect(isInWorstQuadrant({ x: 20, y: 0 }, center, false, true)).toBe(true);
    expect(isInWorstQuadrant({ x: 4, y: 67 }, center, false, true)).toBe(false);
    expect(isInWorstQuadrant({ x: 1, y: 33 }, center, false, true)).toBe(false);
    expect(isInWorstQuadrant({ x: 10, y: 0 }, center, false, true)).toBe(false);
    expect(isInWorstQuadrant({ x: 20, y: 100 }, center, false, true)).toBe(false);
  });

  test("悬浮厂商时其全部模型都带标签，即便会压到别人", () => {
    // auto 模式下密集区域本来会省略部分标签
    const { container } = renderCanvas({ hoveredProvider: "Anthropic", labelMode: "auto" });

    const labels = Array.from(container.querySelectorAll(".recharts-scatter-symbol text")).map(
      (node) => node.textContent
    );

    expect(labels).toContain("Gamma");
    expect(labels).toContain("Delta");
  });

  test("滚轮在绘图区内缩放并阻止页面滚动", () => {
    const onZoomChange = vi.fn();
    const { container } = renderCanvas({ onZoomChange });
    const surface = container.querySelector(".scatter-chart-surface") as HTMLElement;
    expect(surface).not.toBeNull();

    const dotPositions = () =>
      Array.from(container.querySelectorAll(".recharts-scatter-symbol circle"))
        .map((node) => `${node.getAttribute("cx")},${node.getAttribute("cy")}`)
        .join("|");

    const before = dotPositions();
    expect(before).not.toBe("");

    stubSurfaceRect(surface);

    const wheelEvent = new WheelEvent("wheel", {
      deltaY: -120,
      clientX: 320,
      clientY: 210,
      bubbles: true,
      cancelable: true
    });

    act(() => {
      surface.dispatchEvent(wheelEvent);
    });

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(onZoomChange).toHaveBeenLastCalledWith(true);
    // 缩放必须真的挪动落点，而不只是改了内部状态
    expect(dotPositions()).not.toBe(before);
  });

  test("缩放时回报当前视窗内的点，重置后恢复全部", () => {
    const onVisiblePointsChange = vi.fn();
    const { container } = renderCanvas({ onVisiblePointsChange });
    const surface = container.querySelector(".scatter-chart-surface") as HTMLElement;

    expect(onVisiblePointsChange).toHaveBeenLastCalledWith(dataset.points);
    stubSurfaceRect(surface);

    act(() => {
      surface.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -120,
          clientX: 320,
          clientY: 210,
          bubbles: true,
          cancelable: true
        })
      );
    });

    const zoomedPoints = onVisiblePointsChange.mock.calls.at(-1)?.[0] as typeof dataset.points;
    expect(zoomedPoints.length).toBeLessThan(dataset.points.length);

    fireEvent.doubleClick(surface);
    expect(onVisiblePointsChange).toHaveBeenLastCalledWith(dataset.points);
  });

  test("绘图区之外的滚轮不拦截页面滚动", () => {
    const { container } = renderCanvas();
    const surface = container.querySelector(".scatter-chart-surface") as HTMLElement;

    stubSurfaceRect(surface);

    // 落在下方坐标轴标题区域，不属于绘图区
    const wheelEvent = new WheelEvent("wheel", {
      deltaY: -120,
      clientX: 320,
      clientY: 415,
      bubbles: true,
      cancelable: true
    });

    act(() => {
      surface.dispatchEvent(wheelEvent);
    });

    expect(wheelEvent.defaultPrevented).toBe(false);
  });

  test("双击重置缩放", () => {
    const onZoomChange = vi.fn();
    const { container } = renderCanvas({ onZoomChange });
    const surface = container.querySelector(".scatter-chart-surface") as HTMLElement;

    stubSurfaceRect(surface);

    act(() => {
      surface.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -120, clientX: 320, clientY: 210, bubbles: true, cancelable: true })
      );
    });
    expect(onZoomChange).toHaveBeenLastCalledWith(true);

    fireEvent.doubleClick(surface);
    expect(onZoomChange).toHaveBeenLastCalledWith(false);
  });

  test("悬浮图例时淡化其他厂商的点", () => {
    const { container } = renderCanvas({ hoveredProvider: "Anthropic" });

    const groups = Array.from(container.querySelectorAll(".recharts-scatter-symbol .recharts-shape > g"));
    const opacities = groups.map((group) => Number(group.getAttribute("opacity") ?? "1"));

    // Anthropic 两个（Gamma / Delta）保持全亮，OpenAI 两个（Alpha / Beta）被淡化
    expect(opacities.filter((value) => value === 1).length).toBe(2);
    expect(opacities.filter((value) => value < 1).length).toBe(2);
  });

  test("被钉住的点即使不属于悬浮厂商也不淡化", () => {
    const { container } = renderCanvas({ hoveredProvider: "Anthropic", highlightedModel: "Alpha" });

    const groups = Array.from(container.querySelectorAll(".recharts-scatter-symbol .recharts-shape > g"));
    const opacities = groups.map((group) => Number(group.getAttribute("opacity") ?? "1"));

    // Alpha 钉住全亮；Gamma 属悬浮厂商且不在 Alpha 最差象限 → 全亮；
    // Delta 虽属 Anthropic，但对 Alpha 两轴都更差 → 仍淡化；Beta 非悬浮厂商 → 淡化
    expect(opacities.filter((value) => value === 1).length).toBe(2);
    expect(opacities.filter((value) => value < 1).length).toBe(2);
  });

  test("被钉住的点画在最上层，不会被其他点覆盖", () => {
    const { container } = renderCanvas({ highlightedModel: "Beta" });

    const symbols = Array.from(container.querySelectorAll(".recharts-scatter-symbol"));
    // SVG 没有 z-index，最后画的才在最上面
    const lastSymbolText = symbols.at(-1)?.querySelector("text")?.textContent;

    expect(lastSymbolText).toBe("Beta");
  });

  test("悬浮厂商的点排在普通点之后（更靠上层）", () => {
    const { container } = renderCanvas({ hoveredProvider: "Anthropic", labelMode: "all" });

    const labels = Array.from(container.querySelectorAll(".recharts-scatter-symbol text")).map(
      (node) => node.textContent
    );

    const lastOpenAiIndex = Math.max(labels.indexOf("Alpha"), labels.indexOf("Beta"));
    const firstAnthropicIndex = Math.min(
      ...["Gamma", "Delta"].map((name) => labels.indexOf(name)).filter((index) => index >= 0)
    );

    expect(firstAnthropicIndex).toBeGreaterThan(lastOpenAiIndex);
  });

  test("没有悬浮与钉住时保持原始绘制顺序", () => {
    const { container } = renderCanvas({ labelMode: "all" });
    const labels = Array.from(container.querySelectorAll(".recharts-scatter-symbol text")).map(
      (node) => node.textContent
    );

    expect(labels).toEqual(dataset.points.map((point) => point.modelName));
  });

  test("图表内除根 svg 外还有 tabindex=-1 的分层容器（焦点框压制必须覆盖后代）", () => {
    const { container } = renderCanvas();

    const surface = container.querySelector(".recharts-surface");
    expect(surface?.getAttribute("tabindex")).toBe("0");

    // 这些 <g> 只是 Recharts 的 z-index 排版容器，却带着 tabindex=-1。
    // Chrome 里它们能被鼠标点中并获得焦点，焦点框套在其包围盒上就成了「整张图被框住」。
    // globals.css 里的压制规则因此必须写成 `.scatter-chart-surface :focus`，
    // 只盯着 .recharts-surface 是不够的 —— 这条测试就是为了守住这个前提。
    const focusableLayers = container.querySelectorAll('.recharts-surface [tabindex="-1"]');
    expect(focusableLayers.length).toBeGreaterThan(0);
  });

  test("钉住标记用模型自己的品牌色，不画白环", () => {
    const { container } = renderCanvas({ highlightedModel: "Alpha" });

    const strokes = Array.from(container.querySelectorAll(".recharts-scatter-symbol circle"))
      .map((node) => (node.getAttribute("stroke") ?? "").toLowerCase());

    // 纯白硬边会被误读成浏览器焦点框
    expect(strokes.some((stroke) => stroke === "#ffffff" || stroke === "white")).toBe(false);
    expect(strokes).toContain("#ff5533");
  });

  test("反复切换标签模式不会触发渲染循环", () => {
    const { container, rerender } = render(
      <ScatterCanvas {...canvasProps} labelMode="auto" />
    );

    for (let round = 0; round < 5; round += 1) {
      rerender(<ScatterCanvas {...canvasProps} labelMode="none" />);
      rerender(<ScatterCanvas {...canvasProps} labelMode="all" />);
      rerender(<ScatterCanvas {...canvasProps} labelMode="auto" />);
    }

    expect(container.querySelectorAll(".recharts-scatter-symbol").length).toBe(dataset.points.length);
  });
});

describe("ScatterCanvas 拖拽平移", () => {
  function setupSurface(overrides: Partial<React.ComponentProps<typeof ScatterCanvas>> = {}) {
    const view = render(<ScatterCanvas {...canvasProps} {...overrides} />);
    const surface = view.container.querySelector(".scatter-chart-surface") as HTMLElement;
    stubSurfaceRect(surface);
    surface.setPointerCapture = () => {};
    surface.releasePointerCapture = () => {};
    return { ...view, surface };
  }

  function dotPositions(container: HTMLElement): string {
    return Array.from(container.querySelectorAll(".recharts-scatter-symbol circle"))
      .map((node) => `${node.getAttribute("cx")},${node.getAttribute("cy")}`)
      .join("|");
  }

  test("在绘图区内按住拖动会平移视图", () => {
    const { container, surface } = setupSurface();
    const before = dotPositions(container);

    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 360, clientY: 230 });
    fireEvent.pointerUp(surface, { pointerId: 1 });

    expect(dotPositions(container)).not.toBe(before);
  });

  test("拖拽期间标记 is-panning，松手后恢复", () => {
    const { surface } = setupSurface();

    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    // 未过阈值时还是点击候选，不应进入拖拽态
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 301, clientY: 200 });
    expect(surface.classList.contains("is-panning")).toBe(false);

    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 340, clientY: 200 });
    expect(surface.classList.contains("is-panning")).toBe(true);

    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(surface.classList.contains("is-panning")).toBe(false);
  });

  test("拖拽期间及结束后不显示 Tooltip，下一次移动才恢复悬浮", () => {
    const { container, surface } = setupSurface();
    const symbol = container.querySelector(".recharts-scatter-symbol") as HTMLElement;

    fireEvent.mouseEnter(symbol);
    expect(container.querySelector(".scatter-tooltip")).not.toBeNull();

    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 340, clientY: 200 });
    expect(container.querySelector(".scatter-tooltip")).toBeNull();

    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(container.querySelector(".scatter-tooltip")).toBeNull();

    fireEvent.mouseMove(surface);
    expect(container.querySelector(".scatter-tooltip")).not.toBeNull();
  });

  test("按下未拖动时不进入 is-panning，保留散点点击", () => {
    const onSelectModel = vi.fn();
    const { container, surface } = setupSurface({ onSelectModel });

    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    expect(surface.classList.contains("is-panning")).toBe(false);
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(surface.classList.contains("is-panning")).toBe(false);

    const symbol = container.querySelector(".recharts-scatter-symbol") as HTMLElement;
    fireEvent.click(symbol);
    expect(onSelectModel).toHaveBeenCalledTimes(1);
  });

  test("绘图区之外按下不启动平移", () => {
    const { container, surface } = setupSurface();
    const before = dotPositions(container);

    // 落在底部坐标轴区域
    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 300, clientY: 415 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 360, clientY: 415 });
    fireEvent.pointerUp(surface, { pointerId: 1 });

    expect(dotPositions(container)).toBe(before);
    expect(surface.classList.contains("is-panning")).toBe(false);
  });

  test("右键按下不触发平移", () => {
    const { container, surface } = setupSurface();
    const before = dotPositions(container);

    fireEvent.pointerDown(surface, { pointerId: 1, button: 2, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 360, clientY: 230 });

    expect(dotPositions(container)).toBe(before);
  });

  test("平移会被判为已缩放，从而给出重置入口", () => {
    const onZoomChange = vi.fn();
    const { surface } = setupSurface({ onZoomChange });

    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 360, clientY: 200 });
    fireEvent.pointerUp(surface, { pointerId: 1 });

    expect(onZoomChange).toHaveBeenLastCalledWith(true);

    fireEvent.doubleClick(surface);
    expect(onZoomChange).toHaveBeenLastCalledWith(false);
  });

  test("原地轻点仍然可以钉住模型", () => {
    const onSelectModel = vi.fn();
    const { container, surface } = setupSurface({ onSelectModel });

    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(surface, { pointerId: 1 });

    const symbol = container.querySelector(".recharts-scatter-symbol") as HTMLElement;
    fireEvent.click(symbol);

    expect(onSelectModel).toHaveBeenCalledTimes(1);
  });

  test("空白轻点会取消钉住", () => {
    const onSelectModel = vi.fn();
    const { surface } = setupSurface({ onSelectModel, highlightedModel: "Alpha" });

    // 落在绘图区空白处（非散点 symbol）
    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 320, clientY: 210 });
    fireEvent.pointerUp(surface, { pointerId: 1, target: surface });

    expect(onSelectModel).toHaveBeenCalledWith(null);
  });

  test("拖拽平移不会取消钉住", () => {
    const onSelectModel = vi.fn();
    const { surface } = setupSurface({ onSelectModel, highlightedModel: "Alpha" });

    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 360, clientY: 230 });
    fireEvent.pointerUp(surface, { pointerId: 1, target: surface });

    expect(onSelectModel).not.toHaveBeenCalled();
  });

  test("拖拽之后紧跟的点击不会误钉模型", () => {
    const onSelectModel = vi.fn();
    const { container, surface } = setupSurface({ onSelectModel });

    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 360, clientY: 240 });
    fireEvent.pointerUp(surface, { pointerId: 1 });

    const symbol = container.querySelector(".recharts-scatter-symbol") as HTMLElement;
    fireEvent.click(symbol);

    expect(onSelectModel).not.toHaveBeenCalled();
  });
});

describe("散点投影", () => {
  test("自算的像素位置与 Recharts 实际渲染的落点一致", () => {
    // 标签靠这套投影定位；一旦与 Recharts 的布局脱节，标签就会飘到别的点旁边
    const { container } = render(<ScatterCanvas {...canvasProps} labelMode="none" />);

    const plotArea = computePlotArea({
      width: canvasProps.width,
      height: canvasProps.height,
      margin: SCATTER_CHART_MARGIN,
      yAxisWidth: SCATTER_Y_AXIS_WIDTH,
      xAxisHeight: SCATTER_X_AXIS_HEIGHT
    });
    expect(plotArea).not.toBeNull();

    const projections = buildPointProjections({
      points: dataset.points,
      xDomain: computeAxisDomain(dataset.points.map((point) => point.x), "linear"),
      yDomain: computeAxisDomain(dataset.points.map((point) => point.y), "linear"),
      xScale: "linear",
      yScale: "linear",
      plotArea
    });

    const renderedDots = Array.from(container.querySelectorAll(".recharts-scatter-symbol circle"));
    expect(renderedDots.length).toBe(dataset.points.length);

    const renderedPositions = renderedDots
      .map((node) => ({
        cx: Number(node.getAttribute("cx")),
        cy: Number(node.getAttribute("cy"))
      }))
      .sort((left, right) => left.cx - right.cx);

    const projectedPositions = Array.from(projections.values()).sort((left, right) => left.cx - right.cx);

    projectedPositions.forEach((projected, index) => {
      expect(projected.cx).toBeCloseTo(renderedPositions[index]!.cx, 1);
      expect(projected.cy).toBeCloseTo(renderedPositions[index]!.cy, 1);
    });
  });
});
