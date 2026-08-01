import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";

import { ModelScatter } from "@/components/model-scatter";
import { ScatterCanvas } from "@/components/model-scatter/scatter-canvas";
import { toScatterMetric } from "@/components/model-scatter/metrics";
import { buildScatterDataset } from "@/components/model-scatter/dataset";
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

  test("清空模型选择时给出空态引导", () => {
    renderScatter();

    fireEvent.click(screen.getByRole("button", { name: "清空模型" }));

    expect(screen.getByText("当前条件下没有可绘制的点")).toBeInTheDocument();
    expect(comparableModelCount()).toBe("0");
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

describe("ScatterCanvas", () => {
  const yMetric = toScatterMetric(
    createRow("y", "Score", { Alpha: 100, Beta: 67, Gamma: 33, Delta: 0 })
  );
  const xMetric = toScatterMetric(
    createRow("x", "Output Price", { Alpha: 10, Beta: 4, Gamma: 1, Delta: 20 }, {
      higherIsBetter: false,
      isPriceRow: true
    })
  );

  const dataset = buildScatterDataset({
    xMetric,
    yMetric,
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

  function renderCanvas(overrides: Partial<React.ComponentProps<typeof ScatterCanvas>> = {}) {
    return render(
      <ScatterCanvas
        width={640}
        height={420}
        xMetric={xMetric}
        yMetric={yMetric}
        dataset={dataset}
        xScale="linear"
        yScale="linear"
        showPareto
        dimNonPareto={false}
        paretoLineStyle="linear"
        labelMode="auto"
        showGuides={false}
        highlightedModel={null}
        {...overrides}
      />
    );
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

  test("标签模式为隐藏时不渲染标签层", () => {
    const { container } = renderCanvas({ labelMode: "none" });

    expect(container.querySelector(".scatter-label-layer")).toBeNull();
  });

  test("标签模式为自动时渲染模型名", () => {
    const { container } = renderCanvas();
    const labels = container.querySelectorAll(".scatter-label-layer text");

    expect(labels.length).toBeGreaterThan(0);
  });

  test("开启中位参考线时画出参考层", () => {
    const { container } = renderCanvas({ showGuides: true });

    expect(container.querySelectorAll(".scatter-guide-layer line").length).toBe(2);
  });
});
