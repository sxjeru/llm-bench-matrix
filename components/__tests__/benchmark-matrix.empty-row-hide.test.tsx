import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderReady } from "@/tests/flush-microtasks";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import {
  filterMatrixRowsWithContent,
  hasMatrixRowContent,
  hasMeaningfulMatrixCellContent,
  isMatrixRowEmpty
} from "@/components/benchmark-matrix/selectors";
import type { MatrixCell, MatrixRow, ModelParamsInfo, ModelPriceInfo } from "@/components/benchmark-matrix/types";

const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => mockSearchParams
}));

function createMockCell(overrides: Partial<MatrixCell> = {}): MatrixCell {
  return {
    valueRaw: "--",
    valueNum: null,
    valueNum2: null,
    valueNote: null,
    source: "test",
    benchTime: null,
    allEntries: [],
    hasMultipleValues: false,
    uniqueEntries: [],
    noteText: "",
    displayValue: "--",
    hasMeaningfulMultipleValues: false,
    hasMultipleActiveSourceValues: false,
    shouldShowQuestionMark: false,
    ...overrides
  };
}

function createMockRow(rowKey: string, cellsRecord: Record<string, MatrixCell>): MatrixRow {
  const cells = new Map<string, MatrixCell>(Object.entries(cellsRecord));
  return {
    rowKey,
    category: "General",
    benchmark: rowKey,
    higherIsBetter: true,
    modalities: ["Text"],
    cells,
    firstSeenIndex: 0,
    sourceOrderKey: null,
    rowDataCount: cells.size,
    rowNumericCount: Array.from(cells.values()).filter((c) => c.valueNum !== null).length,
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

describe("hasMeaningfulMatrixCellContent", () => {
  test("undefined 与空单元格判定为无内容", () => {
    expect(hasMeaningfulMatrixCellContent(undefined)).toBe(false);
    expect(hasMeaningfulMatrixCellContent(createMockCell({ displayValue: "--", valueRaw: "--" }))).toBe(false);
    expect(hasMeaningfulMatrixCellContent(createMockCell({ displayValue: "", valueRaw: "" }))).toBe(false);
    expect(hasMeaningfulMatrixCellContent(createMockCell({ displayValue: "   ", valueRaw: "   " }))).toBe(false);
  });

  test("占位标记判定为无内容", () => {
    const emptyMarkers = ["-", "--", "—", "–", "n/a", "N/A", "na", "null", "NULL", "none", "- / -", "-- / --", "n/a / null"];
    for (const marker of emptyMarkers) {
      expect(hasMeaningfulMatrixCellContent(createMockCell({ displayValue: marker, valueRaw: marker }))).toBe(false);
    }
  });

  test("纯星号标记判定为无内容", () => {
    expect(hasMeaningfulMatrixCellContent(createMockCell({ displayValue: "*", valueRaw: "*" }))).toBe(false);
    expect(hasMeaningfulMatrixCellContent(createMockCell({ displayValue: "***", valueRaw: "***" }))).toBe(false);
  });

  test("有效数值判定为有内容（含 0 与负数）", () => {
    expect(hasMeaningfulMatrixCellContent(createMockCell({ valueNum: 0, displayValue: "0" }))).toBe(true);
    expect(hasMeaningfulMatrixCellContent(createMockCell({ valueNum: 95.5, displayValue: "95.5" }))).toBe(true);
    expect(hasMeaningfulMatrixCellContent(createMockCell({ valueNum: -4, displayValue: "-4" }))).toBe(true);
    expect(hasMeaningfulMatrixCellContent(createMockCell({ valueNum: null, valueNum2: 66.1, displayValue: "-- / 66.1" }))).toBe(true);
  });

  test("有实际意义的非数值文本判定为有内容", () => {
    expect(hasMeaningfulMatrixCellContent(createMockCell({ displayValue: "Pass", valueRaw: "Pass" }))).toBe(true);
    expect(hasMeaningfulMatrixCellContent(createMockCell({ displayValue: "$1.50", valueRaw: "$1.50" }))).toBe(true);
    expect(hasMeaningfulMatrixCellContent(createMockCell({ displayValue: "4.3%", valueRaw: "4.3%" }))).toBe(true);
    expect(hasMeaningfulMatrixCellContent(createMockCell({ displayValue: "120B", valueRaw: "120B" }))).toBe(true);
  });
});

describe("hasMatrixRowContent & filterMatrixRowsWithContent", () => {
  const modelCols = ["Model-A", "Model-B"];

  test("所有模型列均为占位符的行被判定为空行并过滤", () => {
    const emptyRow = createMockRow("empty-bench", {
      "Model-A": createMockCell({ displayValue: "--", valueRaw: "--" }),
      "Model-B": createMockCell({ displayValue: "n/a", valueRaw: "n/a" })
    });

    expect(hasMatrixRowContent(emptyRow, modelCols)).toBe(false);
    expect(isMatrixRowEmpty(emptyRow, modelCols)).toBe(true);
    expect(filterMatrixRowsWithContent([emptyRow], modelCols)).toHaveLength(0);
  });

  test("至少一个模型有内容的行被保留", () => {
    const rowWithData = createMockRow("valid-bench", {
      "Model-A": createMockCell({ displayValue: "--", valueRaw: "--" }),
      "Model-B": createMockCell({ valueNum: 88, displayValue: "88", valueRaw: "88" })
    });

    expect(hasMatrixRowContent(rowWithData, modelCols)).toBe(true);
    expect(isMatrixRowEmpty(rowWithData, modelCols)).toBe(false);
    expect(filterMatrixRowsWithContent([rowWithData], modelCols)).toHaveLength(1);
  });

  test("仅未展示模型有数据时，当前模型列视角判定为空行并过滤", () => {
    const hiddenModelRow = createMockRow("hidden-bench", {
      "Model-C": createMockCell({ valueNum: 99, displayValue: "99", valueRaw: "99" })
    });

    expect(hasMatrixRowContent(hiddenModelRow, modelCols)).toBe(false);
    expect(filterMatrixRowsWithContent([hiddenModelRow], modelCols)).toHaveLength(0);
  });
});

describe("BenchmarkMatrix 价格空行隐藏集成测试", () => {
  beforeEach(() => {
    window.localStorage.clear();
    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  const baseRows = [
    {
      providerName: "OpenAI",
      modelName: "Model-1",
      benchmarkName: "Bench-1",
      benchmarkType: "General",
      benchTime: "2026-04-06T00:00:00.000Z",
      valueRaw: "85",
      valueNum: 85,
      valueNote: null,
      source: "text:S1"
    },
    {
      providerName: "OpenAI",
      modelName: "Model-2",
      benchmarkName: "Bench-1",
      benchmarkType: "General",
      benchTime: "2026-04-06T00:00:00.000Z",
      valueRaw: "90",
      valueNum: 90,
      valueNote: null,
      source: "text:S1"
    }
  ];

  test("打开显示价格时，无任何模型有缓存读价格则自动隐藏 Cache Input Price 行", async () => {
    const pricesWithoutCache: ModelPriceInfo[] = [
      { modelName: "Model-1", inputCost: 2.5, outputCost: 10, cacheReadCost: null },
      { modelName: "Model-2", inputCost: 1.0, outputCost: 5, cacheReadCost: null }
    ];

    await renderReady(
      <BenchmarkMatrix rows={baseRows} allRows={baseRows} modelPrices={pricesWithoutCache} />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /显示价格/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /显示价格/ }));

    // Input Price 和 Output Price 有数据应显示
    expect(screen.getByText("Input Price")).toBeInTheDocument();
    expect(screen.getByText("Output Price")).toBeInTheDocument();

    // Cache Input Price 全行为空，应当自动隐藏
    expect(screen.queryByText("Cache Input Price")).toBeNull();
  });

  test("若某个模型包含缓存读价格，则 Cache Input Price 行正常显示", async () => {
    const pricesWithCache: ModelPriceInfo[] = [
      { modelName: "Model-1", inputCost: 2.5, outputCost: 10, cacheReadCost: 0.25 },
      { modelName: "Model-2", inputCost: 1.0, outputCost: 5, cacheReadCost: null }
    ];

    await renderReady(
      <BenchmarkMatrix rows={baseRows} allRows={baseRows} modelPrices={pricesWithCache} />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /显示价格/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /显示价格/ }));

    expect(screen.getByText("Input Price")).toBeInTheDocument();
    expect(screen.getByText("Output Price")).toBeInTheDocument();
    expect(screen.getByText("Cache Input Price")).toBeInTheDocument();
  });
});

describe("BenchmarkMatrix 参数量空行隐藏集成测试", () => {
  beforeEach(() => {
    window.localStorage.clear();
    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  const denseRows = [
    {
      providerName: "OpenAI",
      modelName: "Dense-A",
      benchmarkName: "Bench-1",
      benchmarkType: "General",
      benchTime: "2026-04-06T00:00:00.000Z",
      valueRaw: "80",
      valueNum: 80,
      valueNote: null,
      source: "text:S1"
    },
    {
      providerName: "OpenAI",
      modelName: "Dense-B",
      benchmarkName: "Bench-1",
      benchmarkType: "General",
      benchTime: "2026-04-06T00:00:00.000Z",
      valueRaw: "85",
      valueNum: 85,
      valueNote: null,
      source: "text:S1"
    }
  ];

  test("当前模型全部为稠密模型时，开启显示参数量自动隐藏 Activated % 行", async () => {
    const denseParams: ModelParamsInfo[] = [
      { modelId: 1, modelName: "Dense-A", totalParamsB: 70, activatedParamsB: null, isEstimated: false, note: null },
      { modelId: 2, modelName: "Dense-B", totalParamsB: 120, activatedParamsB: null, isEstimated: false, note: null }
    ];

    await renderReady(
      <BenchmarkMatrix rows={denseRows} allRows={denseRows} modelParams={denseParams} />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /显示参数量/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /显示参数量/ }));

    // Params 行有数据正常展示
    expect(screen.getByText("Params")).toBeInTheDocument();

    // Activated % 行全部为 --，应当隐藏不显示
    expect(screen.queryByText("Activated %")).toBeNull();
  });
});

describe("BenchmarkMatrix 普通评测基准空行隐藏集成测试", () => {
  beforeEach(() => {
    window.localStorage.clear();
    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  test("某个 benchmark 行在所有展示模型下均无有效内容（占位符）时应当隐藏", async () => {
    const rowsWithEmptyBench = [
      {
        providerName: "OpenAI",
        modelName: "Model-1",
        benchmarkName: "Active-Bench",
        benchmarkType: "General",
        benchTime: "2026-04-06T00:00:00.000Z",
        valueRaw: "85",
        valueNum: 85,
        valueNote: null,
        source: "text:S1"
      },
      {
        providerName: "OpenAI",
        modelName: "Model-2",
        benchmarkName: "Active-Bench",
        benchmarkType: "General",
        benchTime: "2026-04-06T00:00:00.000Z",
        valueRaw: "90",
        valueNum: 90,
        valueNote: null,
        source: "text:S1"
      },
      {
        providerName: "OpenAI",
        modelName: "Model-1",
        benchmarkName: "Ghost-Bench",
        benchmarkType: "General",
        benchTime: "2026-04-06T00:00:00.000Z",
        valueRaw: "--",
        valueNum: null,
        valueNote: null,
        source: "text:S1"
      },
      {
        providerName: "OpenAI",
        modelName: "Model-2",
        benchmarkName: "Ghost-Bench",
        benchmarkType: "General",
        benchTime: "2026-04-06T00:00:00.000Z",
        valueRaw: "n/a",
        valueNum: null,
        valueNote: null,
        source: "text:S1"
      }
    ];

    await renderReady(
      <BenchmarkMatrix rows={rowsWithEmptyBench} allRows={rowsWithEmptyBench} />
    );

    await waitFor(() => {
      expect(screen.getByText("Active-Bench")).toBeInTheDocument();
    });

    // Ghost-Bench 在 Model-1 与 Model-2 下均为占位符，不应显示
    expect(screen.queryByText("Ghost-Bench")).toBeNull();
  });
});

