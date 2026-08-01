import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";

import { ModelScatter } from "@/components/model-scatter";
import { ScatterCanvas } from "@/components/model-scatter/scatter-canvas";
import { toScatterMetric } from "@/components/model-scatter/metrics";
import { buildScatterDataset, computeAxisDomain } from "@/components/model-scatter/dataset";
import { buildPointProjections, computePlotArea } from "@/components/model-scatter/projection";
import {
  SCATTER_CHART_MARGIN,
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

function axisLabel(container: HTMLElement, axis: "x" | "y"): string {
  const select = container.querySelector<HTMLSelectElement>(`#scatter-axis-${axis}`);
  if (!select) throw new Error(`未找到 ${axis} 轴选择器`);
  return select.selectedOptions[0]?.text ?? "";
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

    const xSelect = container.querySelector<HTMLSelectElement>("#scatter-axis-x");
    expect(xSelect?.value).toBe("price-output");
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

  test("交换按钮互换双轴", () => {
    const { container } = renderScatter();

    fireEvent.click(screen.getByRole("button", { name: "交换 X / Y 轴" }));

    expect(axisLabel(container, "y")).toBe("Output Price");
    expect(axisLabel(container, "x")).toBe("Overall Score");
  });

  test("切换 Y 轴指标后卡片与前沿同步更新", () => {
    const { container } = renderScatter();

    const ySelect = container.querySelector<HTMLSelectElement>("#scatter-axis-y")!;
    const paramsOption = Array.from(ySelect.options).find((option) => option.text === "Params");
    expect(paramsOption).toBeDefined();

    fireEvent.change(ySelect, { target: { value: paramsOption!.value } });

    expect(axisLabel(container, "y")).toBe("Params");
    // 参数量与价格都是越小越好，Gamma（1 美元 / 300B）与 Alpha（10 美元 / 100B）等构成前沿
    expect(Number(paretoCount())).toBeGreaterThan(0);
  });

  test("轴选择器按分类分组，且总评排在最前", () => {
    const { container } = renderScatter();

    const ySelect = container.querySelector<HTMLSelectElement>("#scatter-axis-y")!;
    const groups = Array.from(ySelect.querySelectorAll("optgroup")).map((group) => group.label);

    expect(groups[0]).toBe("Summary");
    expect(groups).toContain("Pricing");
    expect(groups).toContain("Model Info");
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

    fireEvent.click(screen.getByRole("button", { name: /OpenAI/ }));

    // Alpha 与 Beta 属于 OpenAI，隐藏后只剩 Anthropic 的两个模型
    expect(comparableModelCount()).toBe("2");
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
  colorByModel: new Map([["Alpha", "#ff5533"]]),
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

  test("标签模式为隐藏时不渲染标签", () => {
    const { container } = renderCanvas({ labelMode: "none" });

    expect(container.querySelectorAll(".recharts-scatter-symbol text").length).toBe(0);
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

  test("开启中位参考线时画出参考层", () => {
    const { container } = renderCanvas({ showGuides: true });

    expect(container.querySelectorAll(".scatter-guide-layer line").length).toBe(2);
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
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 340, clientY: 200 });
    expect(surface.classList.contains("is-panning")).toBe(true);

    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(surface.classList.contains("is-panning")).toBe(false);
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
