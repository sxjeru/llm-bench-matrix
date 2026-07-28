import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix, __buildOverallScoreDisplayDecimalsMapForTest } from "@/components/benchmark-matrix";
import { buildOverallSummaryByModel, buildPriceMatrixRows } from "@/components/benchmark-matrix/selectors";
import type { MatrixCell, MatrixRow } from "@/components/benchmark-matrix/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}));

const rows = [
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "Bench-01",
    benchmarkType: "General",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "0.9",
    valueNum: 0.9,
    valueNote: null,
    source: "text:overall"
  },
  {
    providerName: "OpenAI",
    modelName: "Model B",
    benchmarkName: "Bench-01",
    benchmarkType: "General",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "0.8",
    valueNum: 0.8,
    valueNote: null,
    source: "text:overall"
  },
  {
    providerName: "OpenAI",
    modelName: "Model C",
    benchmarkName: "Bench-01",
    benchmarkType: "General",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "0.85",
    valueNum: 0.85,
    valueNote: null,
    source: "text:overall"
  },
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "Bench-02",
    benchmarkType: "General",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "85",
    valueNum: 85,
    valueNote: null,
    source: "text:overall"
  },
  {
    providerName: "OpenAI",
    modelName: "Model B",
    benchmarkName: "Bench-02",
    benchmarkType: "General",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "90",
    valueNum: 90,
    valueNote: null,
    source: "text:overall"
  },
  {
    providerName: "OpenAI",
    modelName: "Model C",
    benchmarkName: "Bench-02",
    benchmarkType: "General",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "88",
    valueNum: 88,
    valueNote: null,
    source: "text:overall"
  },
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "Vending Bench 2",
    benchmarkType: "Business",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "$6,000",
    valueNum: 6000,
    valueNote: null,
    source: "text:overall"
  },
  {
    providerName: "OpenAI",
    modelName: "Model B",
    benchmarkName: "Vending Bench 2",
    benchmarkType: "Business",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "$3,000",
    valueNum: 3000,
    valueNote: null,
    source: "text:overall"
  }
] as const;

function getModelHeaderOrder(): string[] {
  const headerTexts = screen
    .getAllByRole("columnheader")
    .map((header) => header.textContent?.replace(/\s+/g, " ").trim() ?? "");

  const benchmarkIndex = headerTexts.findIndex((text) => text.includes("Benchmark"));
  return headerTexts.slice(benchmarkIndex + 1).filter(Boolean);
}

describe("BenchmarkMatrix 总评行", () => {
  test("价格行参与总评时按低价格更优计算", () => {
    const createCell = (valueNum: number): MatrixCell => ({
      valueRaw: String(valueNum),
      valueNum,
      valueNum2: null,
      valueNote: null,
      source: null,
      benchTime: "2026-04-06T00:00:00.000Z",
      allEntries: [],
      hasMultipleValues: false,
      uniqueEntries: [],
      noteText: "",
      displayValue: String(valueNum),
      hasMeaningfulMultipleValues: false,
      hasMultipleActiveSourceValues: false,
      shouldShowQuestionMark: false
    });

    const priceRow: MatrixRow = {
      rowKey: "__price:input",
      category: "Price",
      benchmark: "Input Price",
      higherIsBetter: true,
      modalities: ["Text"],
      cells: new Map([
        ["Expensive Model", createCell(3)],
        ["Cheap Model", createCell(1)]
      ]),
      firstSeenIndex: 0,
      sourceOrderKey: null,
      rowDataCount: 2,
      rowNumericCount: 2,
      minComparable: null,
      maxComparable: null,
      minComparable2: null,
      maxComparable2: null,
      minNum: 1,
      maxNum: 3,
      minNum2: null,
      maxNum2: null,
      isPriceRow: true
    };

    const summary = buildOverallSummaryByModel([priceRow], ["Expensive Model", "Cheap Model"]);

    expect(summary.get("Cheap Model")?.rawScore).toBe(100);
    expect(summary.get("Cheap Model")?.rawRank).toBe(1);
    expect(summary.get("Expensive Model")?.rawScore).toBe(0);
    expect(summary.get("Expensive Model")?.rawRank).toBe(2);
  });

  test("价格行使用真实价格更新时间且缺失时不回退到 epoch", () => {
    const syncedAt = "2026-05-26T12:00:00.000Z";
    const updatedAt = "2026-05-25T08:30:00.000Z";
    const [inputPriceRow] = buildPriceMatrixRows(
      ["Model A", "Model B", "Model C"],
      [
        { modelName: "Model A", inputCost: 3, outputCost: 15, cacheReadCost: 0.3, lastSyncedAt: syncedAt, updatedAt },
        { modelName: "Model B", inputCost: 1, outputCost: 5, cacheReadCost: 0.1, updatedAt },
        { modelName: "Model C", inputCost: null, outputCost: 8, cacheReadCost: null }
      ]
    );

    const modelACell = inputPriceRow!.cells.get("Model A");
    const modelBCell = inputPriceRow!.cells.get("Model B");
    const modelCCell = inputPriceRow!.cells.get("Model C");

    expect(modelACell?.benchTime).toBe(syncedAt);
    expect(modelACell?.uniqueEntries[0]?.benchTime).toBe(syncedAt);
    expect(modelBCell?.benchTime).toBe(updatedAt);
    expect(modelBCell?.uniqueEntries[0]?.benchTime).toBe(updatedAt);
    expect(modelCCell?.benchTime).toBeNull();
    expect(modelCCell?.uniqueEntries[0]?.benchTime).toBeNull();
    expect(modelCCell?.benchTime).not.toBe(new Date(0).toISOString());
  });

  test("同一位小数但名次不同时显示两位小数", () => {
    const decimalsMap = __buildOverallScoreDisplayDecimalsMapForTest([
      { modelName: "Model A", rawScore: 68.24, rawRank: 4 },
      { modelName: "Model B", rawScore: 68.21, rawRank: 5 },
      { modelName: "Model C", rawScore: 67.95, rawRank: 6 },
      { modelName: "Model D", rawScore: null, rawRank: null },
      { modelName: "Model E", rawScore: 59.31, rawRank: 8 },
      { modelName: "Model F", rawScore: 59.31, rawRank: 8 }
    ]);

    expect(decimalsMap.get("Model A")).toBe(2);
    expect(decimalsMap.get("Model B")).toBe(2);
    expect(decimalsMap.get("Model C")).toBe(1);
    expect(decimalsMap.get("Model D")).toBe(1);
    expect(decimalsMap.get("Model E")).toBe(1);
    expect(decimalsMap.get("Model F")).toBe(1);
  });

  test("表格末尾展示原始总评与原始名次", () => {
    const { container } = render(<BenchmarkMatrix rows={[...rows]} />);

    const overallRow = container.querySelector('tr[data-overall-row="1"]');
    expect(overallRow).not.toBeNull();
    expect(overallRow).toHaveTextContent("总评");

    const modelACell = overallRow!.querySelector('[data-overall-model="Model A"]');
    const modelBCell = overallRow!.querySelector('[data-overall-model="Model B"]');

    expect(modelACell).not.toBeNull();
    expect(modelBCell).not.toBeNull();
    expect(modelACell!.textContent ?? "").toMatch(/\d+(?:\.\d+)?\s*\(\d+\)/);
    expect(modelBCell!.textContent ?? "").toMatch(/\d+(?:\.\d+)?\s*\(\d+\)/);
  });

  test("点击总评行后按总评排名排序列，再次点击可恢复", () => {
    const { container } = render(<BenchmarkMatrix rows={[...rows]} />);

    const initialOrder = getModelHeaderOrder();
    expect(initialOrder.length).toBe(3);

    const overallRow = container.querySelector('tr[data-overall-row="1"]');
    expect(overallRow).not.toBeNull();

    fireEvent.click(overallRow!);
    expect(getModelHeaderOrder()).toEqual(["Model A", "Model C", "Model B"]);

    fireEvent.click(overallRow!);
    expect(getModelHeaderOrder()).toEqual(initialOrder);
  });

  test("点击总评行 tooltip 图标不会触发排序", () => {
    const { container } = render(<BenchmarkMatrix rows={[...rows]} />);
    const initialOrder = getModelHeaderOrder();

    const overallRow = container.querySelector('tr[data-overall-row="1"]');
    expect(overallRow).not.toBeNull();
    expect(overallRow!.className).not.toContain("matrix-row-selected");

    // 点击总评行上的问号 tooltip 触发元素
    const tooltipTrigger = overallRow!.querySelector('[data-overall-tooltip-trigger="Model C"]') as HTMLElement | null;
    expect(tooltipTrigger).not.toBeNull();

    fireEvent.click(tooltipTrigger!);

    // 断言点击 tooltip 不会改变列头顺序（即不会触发排序）
    expect(getModelHeaderOrder()).toEqual(initialOrder);
    expect(overallRow!.className).not.toContain("matrix-row-selected");
  });


  test("问号 tooltip 展示覆盖率修正后的分数与名次", async () => {
    const { container } = render(<BenchmarkMatrix rows={[...rows]} />);

    const trigger = container.querySelector('[data-overall-tooltip-trigger="Model C"]') as HTMLElement | null;
    expect(trigger).not.toBeNull();

    fireEvent.mouseEnter(trigger!);

    expect(await screen.findByText(/修正后总评：/)).toBeInTheDocument();
    expect(screen.getByText(/修正后名次：/)).toBeInTheDocument();
    expect(screen.getByText(/主展示名次按原始总评分计算/)).toBeInTheDocument();
  });

  test("当行数据标记 higherIsBetter=false 时，显示低值更优提示", () => {
    render(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "Model A",
            benchmarkName: "Latency Score",
            benchmarkType: "General",
            higherIsBetter: false,
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "10",
            valueNum: 10,
            valueNote: null,
            source: "text:overall"
          },
          {
            providerName: "OpenAI",
            modelName: "Model B",
            benchmarkName: "Latency Score",
            benchmarkType: "General",
            higherIsBetter: false,
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "20",
            valueNum: 20,
            valueNote: null,
            source: "text:overall"
          }
        ]}
      />
    );

    expect(screen.getByTitle("该项目为低值更优")).toBeInTheDocument();
  });

  test("显示价格后在 benchmark 前插入三行价格并参与总评覆盖率", () => {
    const { container } = render(
      <BenchmarkMatrix
        rows={[...rows]}
        modelPrices={[
          { modelName: "Model A", inputCost: 3, outputCost: 15, cacheReadCost: 0.3 },
          { modelName: "Model B", inputCost: 1, outputCost: 5, cacheReadCost: 0.1 },
          { modelName: "Model C", inputCost: null, outputCost: 8, cacheReadCost: null }
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /显示价格/ }));

    const bodyRows = Array.from(container.querySelectorAll("tbody tr"));
    expect(bodyRows[0]).toHaveTextContent("Input Price");
    expect(bodyRows[1]).toHaveTextContent("Output Price");
    expect(bodyRows[2]).toHaveTextContent("Cache Input Price");

    // Assert that price rows use price-specific comparison logic instead of benchmark score transforms.
    const priceRows = Array.from(
      container.querySelectorAll('[data-metric-type="price"]')
    ) as HTMLElement[];

    // We still expect three price rows to be rendered.
    expect(priceRows).toHaveLength(3);

    // Assert individual model cells within a price row show raw prices, not normalized ratios/percents.
    for (const row of priceRows) {
      const modelACell = row.querySelector('[data-model-name="Model A"]') as HTMLElement | null;
      const modelBCell = row.querySelector('[data-model-name="Model B"]') as HTMLElement | null;

      expect(modelACell).not.toBeNull();
      expect(modelBCell).not.toBeNull();

      // Guard against accidentally applying percent/ratio formatting like "85%" or "0.83x".
      expect(modelACell!.textContent).not.toMatch(/%|x/);
      expect(modelBCell!.textContent).not.toMatch(/%|x/);
    }

    // For price metrics, lower is better: Model B (cheapest, $1) should be highlighted as better than Model A ($3).
    const inputPriceRow = priceRows[0];
    const modelACell = inputPriceRow.querySelector('[data-model-name="Model A"]') as HTMLElement | null;
    const modelBCell = inputPriceRow.querySelector('[data-model-name="Model B"]') as HTMLElement | null;

    expect(modelACell).not.toBeNull();
    expect(modelBCell).not.toBeNull();

    // Verify raw values are formatted as currency:
    expect(modelACell!.textContent).toBe("$3");
    expect(modelBCell!.textContent).toBe("$1");

    // The cheaper model (Model B) should have a different background color (i.e. better heat blending) from the expensive model (Model A).
    expect(modelBCell!.style.backgroundColor).not.toBe(modelACell!.style.backgroundColor);

    fireEvent.click(inputPriceRow);
    expect(getModelHeaderOrder()).toEqual(["Model B", "Model A", "Model C"]);

    const trigger = container.querySelector('[data-overall-tooltip-trigger="Model C"]') as HTMLElement | null;
    expect(trigger).not.toBeNull();
    fireEvent.mouseEnter(trigger!);

    expect(screen.getByText(/覆盖率：/)).toHaveTextContent("3/6");
  });

  test("无价格数据时不会因持久化开关渲染空价格行", async () => {
    window.localStorage.setItem("benchmark-matrix:show-price-rows", "1");

    const { container } = render(<BenchmarkMatrix rows={[...rows]} />);

    expect(container.querySelectorAll('[data-metric-type="price"]')).toHaveLength(0);
    expect(screen.queryByText("Input Price")).not.toBeInTheDocument();
  });
});
