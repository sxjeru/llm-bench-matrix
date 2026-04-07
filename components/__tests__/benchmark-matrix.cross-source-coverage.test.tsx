import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  __applyExportSourceFrameFallbackForTest,
  __buildSourceFrameShadowsForTest,
  __resolveCaptureDimensionsForTest,
  BenchmarkMatrix
} from "@/components/benchmark-matrix";

const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => mockSearchParams
}));

const baseRows = [
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "Bench-1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "70",
    valueNum: 70,
    valueNote: null,
    source: "text:S1"
  },
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "Bench-2",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-2:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "71",
    valueNum: 71,
    valueNote: null,
    source: "text:S1"
  },
  {
    providerName: "OpenAI",
    modelName: "Model B",
    benchmarkName: "Bench-1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "69",
    valueNum: 69,
    valueNote: null,
    source: "text:S1"
  }
] as const;

const allRows = [
  ...baseRows,
  {
    providerName: "Anthropic",
    modelName: "Model C",
    benchmarkName: "Bench-1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "68",
    valueNum: 68,
    valueNote: null,
    source: "text:S2"
  },
  {
    providerName: "Anthropic",
    modelName: "Model D",
    benchmarkName: "Bench-3",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-3:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "67",
    valueNum: 67,
    valueNote: null,
    source: "text:S2"
  }
] as const;

const providerOrderRows = [
  {
    providerName: "Gemma",
    modelName: "Gemma 4 31B",
    benchmarkName: "Bench-1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "80",
    valueNum: 80,
    valueNote: null,
    source: "text:Gemma 4"
  },
  {
    providerName: "Gemma",
    modelName: "Gemma 4 31B",
    benchmarkName: "Bench-2",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-2:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "81",
    valueNum: 81,
    valueNote: null,
    source: "text:Gemma 4"
  }
] as const;

const providerOrderAllRows = [
  ...providerOrderRows,
  {
    providerName: "Gemma",
    modelName: "Gemma 4 E4B",
    benchmarkName: "Bench-1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "78",
    valueNum: 78,
    valueNote: null,
    source: "text:Gemma 4"
  },
  {
    providerName: "OpenAI",
    modelName: "GPT-4.1",
    benchmarkName: "Bench-1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "82",
    valueNum: 82,
    valueNote: null,
    source: "text:OpenAI"
  },
  {
    providerName: "OpenAI",
    modelName: "GPT-4.1",
    benchmarkName: "Bench-2",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-2:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "83",
    valueNum: 83,
    valueNote: null,
    source: "text:OpenAI"
  },
  {
    providerName: "Anthropic",
    modelName: "Claude-3.7",
    benchmarkName: "Bench-1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "79",
    valueNum: 79,
    valueNote: null,
    source: "text:Anthropic"
  }
] as const;

const columnSortRows = [
  {
    providerName: "Gemma",
    modelName: "Gemma 4 E4B",
    benchmarkName: "Bench-Sort",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-sort:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "74",
    valueNum: 74,
    valueNote: null,
    source: "text:Gemma 4"
  },
  {
    providerName: "Gemma",
    modelName: "Gemma 4 31B",
    benchmarkName: "Bench-Sort",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-sort:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "75",
    valueNum: 75,
    valueNote: null,
    source: "text:Gemma 4"
  }
] as const;

const qwenSortRows = [
  {
    providerName: "Qwen",
    modelName: "Qwen3.6-Plus",
    benchmarkName: "Bench-Q1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-q1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "78",
    valueNum: 78,
    valueNote: null,
    source: "text:Qwen"
  },
  {
    providerName: "Qwen",
    modelName: "Qwen3.5-397B-A17B",
    benchmarkName: "Bench-Q1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-q1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "77",
    valueNum: 77,
    valueNote: null,
    source: "text:Qwen"
  },
  {
    providerName: "Qwen",
    modelName: "Qwen3.5-122B-A10B",
    benchmarkName: "Bench-Q1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-q1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "76",
    valueNum: 76,
    valueNote: null,
    source: "text:Qwen"
  },
  {
    providerName: "Qwen",
    modelName: "Qwen3.5-122B-A10B",
    benchmarkName: "Bench-Q2",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-q2:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "75",
    valueNum: 75,
    valueNote: null,
    source: "text:Qwen"
  }
] as const;

const pairMaxSplitRows = [
  {
    providerName: "Pair",
    modelName: "Model P1",
    benchmarkName: "Bench-Pair",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-pair:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "80 / 90",
    valueNum: 80,
    valueNum2: 90,
    valueNote: null,
    source: "text:pair"
  },
  {
    providerName: "Pair",
    modelName: "Model P2",
    benchmarkName: "Bench-Pair",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-pair:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "70 / 95",
    valueNum: 70,
    valueNum2: 95,
    valueNote: null,
    source: "text:pair"
  }
] as const;

describe("BenchmarkMatrix 跨页签模型覆盖", () => {
  beforeEach(() => {
    window.localStorage.clear();

    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  test("显示跨页签模型覆盖率并隐藏 0 覆盖模型", () => {
    render(
      <BenchmarkMatrix
        sourceOptions={["text:S1", "text:S2"]}
        rows={[...baseRows]}
        allRows={[...allRows]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "展开模型筛选" }));

    expect(screen.getByLabelText("Model C")).toBeInTheDocument();
    expect(screen.queryByLabelText("Model D")).not.toBeInTheDocument();

    const crossModelLabel = screen.getByText("Model C").closest("label");
    expect(crossModelLabel).not.toBeNull();
    expect(crossModelLabel).toHaveClass("border-dashed");

    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText(/覆盖率 50%/)).toBeInTheDocument();
  });

  test("Category / Benchmark 表头显示唯一项计数", () => {
    render(
      <BenchmarkMatrix
        sourceOptions={["text:S1", "text:S2"]}
        rows={[...baseRows]}
        allRows={[...allRows]}
      />
    );

    expect(screen.getByRole("button", { name: /Category/})).toHaveTextContent("(1)");
    expect(screen.getByRole("button", { name: /Benchmark/})).toHaveTextContent("(2)");
  });

  test("列较少时表格按内容宽度展示，不强制拉伸填满", () => {
    const { container } = render(
      <BenchmarkMatrix
        sourceOptions={["text:S1"]}
        rows={[...baseRows]}
        allRows={[...baseRows]}
      />
    );

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table).toHaveStyle("width: max-content");
  });

  test("导出尺寸按表格内容计算，忽略右侧留白", () => {
    const container = document.createElement("div");
    const table = document.createElement("table");
    container.appendChild(table);

    Object.defineProperty(container, "scrollWidth", { value: 920, configurable: true });
    Object.defineProperty(container, "clientWidth", { value: 920, configurable: true });
    Object.defineProperty(container, "scrollHeight", { value: 420, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 420, configurable: true });

    Object.defineProperty(table, "scrollWidth", { value: 640, configurable: true });
    Object.defineProperty(table, "clientWidth", { value: 640, configurable: true });
    Object.defineProperty(table, "scrollHeight", { value: 260, configurable: true });
    Object.defineProperty(table, "clientHeight", { value: 260, configurable: true });

    expect(__resolveCaptureDimensionsForTest(container)).toEqual({ width: 640, height: 260 });
  });

  test("导出捕获模式保留边框高亮但改为无发光轻量线框", () => {
    const normal = __buildSourceFrameShadowsForTest({
      isMatched: true,
      isFirst: true,
      isLast: true,
      includeTop: true,
      includeBottom: true,
      exportMode: false
    });

    const exportMode = __buildSourceFrameShadowsForTest({
      isMatched: true,
      isFirst: true,
      isLast: true,
      includeTop: true,
      includeBottom: true,
      exportMode: true
    });

    expect(normal.length).toBeGreaterThan(0);
    expect(exportMode.length).toBeGreaterThan(0);
    expect(normal.some((item) => item.includes("2px"))).toBe(true);
    expect(exportMode.some((item) => item.includes("2px"))).toBe(true);
    expect(normal.some((item) => item.includes("rgba(93, 167, 255, 0.42)"))).toBe(true);
    expect(exportMode.some((item) => item.includes("rgba(93, 167, 255, 0.72)"))).toBe(true);
  });

  test("导出 source 边框兜底会为底部单元格写入可见底边", () => {
    const root = document.createElement("div");
    const cell = document.createElement("td");

    cell.setAttribute("data-source-match", "1");
    cell.setAttribute("data-source-match-first", "1");
    cell.setAttribute("data-source-match-last", "1");
    cell.setAttribute("data-source-match-bottom", "1");
    root.appendChild(cell);

    __applyExportSourceFrameFallbackForTest(root, "rgba(93, 167, 255, 0.65)", 2);

    expect(cell.style.borderLeft).toContain("2px");
    expect(cell.style.borderRight).toContain("2px");
    expect(cell.style.borderBottom).toContain("2px");
    expect(cell.style.boxShadow).toBe("none");
  });

  test("表头 tooltip 仅显示点击动作且会随排序状态更新", () => {
    render(
      <BenchmarkMatrix
        sourceOptions={["text:S1", "text:S2"]}
        rows={[...baseRows]}
        allRows={[...allRows]}
      />
    );

    const benchmarkSortButton = screen.getByRole("button", { name: /Benchmark/ });

    expect(benchmarkSortButton).toHaveAttribute("title", "点击按首字母排序");

    fireEvent.click(benchmarkSortButton);

    expect(benchmarkSortButton).toHaveAttribute("title", "点击按数据量排序");
  });

  test("刷新到非全部 source 页签时，默认进入 source 导入顺序模式", async () => {
    mockSearchParams.set("source", "text:S1");

    render(
      <BenchmarkMatrix
        sourceOptions={["text:S1", "text:S2"]}
        rows={[...baseRows]}
        allRows={[...allRows]}
      />
    );

    const benchmarkSortButton = screen.getByRole("button", { name: /Benchmark/ });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "S1" })).toHaveClass("tab-active");
      expect(benchmarkSortButton).toHaveAttribute("title", "点击按首字母排序");
      expect(benchmarkSortButton).not.toHaveTextContent("↓");
    });
  });

  test("同一 source 多次导入时，行默认按导入先后顺序展示（第一次在前）", async () => {
    mockSearchParams.set("source", "text:S1");

    const multiImportRows = [
      {
        recordId: 101,
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-A",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-a:general",
        benchTime: "2026-04-06T00:00:00.000Z",
        valueRaw: "81",
        valueNum: 81,
        valueNote: null,
        source: "text:S1"
      },
      {
        recordId: 102,
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-B",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-b:general",
        benchTime: "2026-04-06T00:00:00.000Z",
        valueRaw: "82",
        valueNum: 82,
        valueNote: null,
        source: "text:S1"
      },
      {
        recordId: 201,
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-C",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-c:general",
        benchTime: "2025-01-01T00:00:00.000Z",
        valueRaw: "71",
        valueNum: 71,
        valueNote: null,
        source: "text:S1"
      },
      {
        recordId: 202,
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-D",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-d:general",
        benchTime: "2025-01-01T00:00:00.000Z",
        valueRaw: "72",
        valueNum: 72,
        valueNote: null,
        source: "text:S1"
      }
    ] as const;

    const { container } = render(
      <BenchmarkMatrix
        sourceOptions={["text:S1"]}
        rows={[...multiImportRows]}
        allRows={[...multiImportRows]}
      />
    );

    const benchmarkSortButton = screen.getByRole("button", { name: /Benchmark/ });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "S1" })).toHaveClass("tab-active");
      expect(benchmarkSortButton).toHaveAttribute("title", "点击按首字母排序");
    });

    const benchmarkOrder = Array.from(container.querySelectorAll("tbody tr"))
      .map((row) => {
        const cellText = Array.from(row.querySelectorAll("td"))
          .map((cell) => (cell.textContent ?? "").trim())
          .find((text) => /^Bench-[ABCD]$/.test(text));

        return cellText ?? "";
      })
      .filter(Boolean);

    expect(benchmarkOrder.slice(0, 4)).toEqual(["Bench-A", "Bench-B", "Bench-C", "Bench-D"]);
  });

  test("provider 按覆盖率排序，且当前页签相关 provider 始终置顶", () => {
    const { container } = render(
      <BenchmarkMatrix
        sourceOptions={["text:Gemma 4", "text:OpenAI", "text:Anthropic"]}
        rows={[...providerOrderRows]}
        allRows={[...providerOrderAllRows]}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Gemma 4" }));
    fireEvent.click(screen.getByRole("button", { name: "展开模型筛选" }));

    const providerOrder = Array.from(container.querySelectorAll("details summary span.text-sm.font-medium"))
      .map((node) => node.textContent?.replace(/\(跨页签\)/g, "").trim())
      .filter((text): text is string => Boolean(text));

    expect(providerOrder.slice(0, 3)).toEqual(["Gemma", "OpenAI", "Anthropic"]);
  });

  test("source 命中列会输出导出边框兜底所需 data 属性", () => {
    const { container } = render(
      <BenchmarkMatrix
        sourceOptions={["text:Gemma 4", "text:OpenAI", "text:Anthropic"]}
        rows={[...providerOrderRows]}
        allRows={[...providerOrderAllRows]}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Gemma 4" }));

    const sourceMatchedHeaders = container.querySelectorAll('th[data-source-match="1"]');
    const sourceMatchedCells = container.querySelectorAll('td[data-source-match="1"]');

    expect(sourceMatchedHeaders.length).toBeGreaterThan(0);
    expect(sourceMatchedCells.length).toBeGreaterThan(0);
  });

  test("列排序支持同级数字+B规则：31B 在 E4B 前", () => {
    render(
      <BenchmarkMatrix
        sourceOptions={["text:Gemma 4"]}
        rows={[...columnSortRows]}
        allRows={[...columnSortRows]}
      />
    );

    const headerTexts = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent?.replace(/\s+/g, " ").trim() ?? "");

    const benchmarkIndex = headerTexts.findIndex((text) => text.includes("Benchmark"));
    expect(benchmarkIndex).toBeGreaterThanOrEqual(0);

    const modelHeaders = headerTexts.slice(benchmarkIndex + 1).filter((text) => text.length > 0);
    expect(modelHeaders.slice(0, 2)).toEqual(["Gemma 4 31B", "Gemma 4 E4B"]);
  });

  test("同 provider 列排序优先版本，其次参数规模：Qwen3.6 > Qwen3.5，且 397B > 122B", () => {
    render(
      <BenchmarkMatrix
        sourceOptions={["text:Qwen"]}
        rows={[...qwenSortRows]}
        allRows={[...qwenSortRows]}
      />
    );

    const headerTexts = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent?.replace(/\s+/g, " ").trim() ?? "");

    const benchmarkIndex = headerTexts.findIndex((text) => text.includes("Benchmark"));
    expect(benchmarkIndex).toBeGreaterThanOrEqual(0);

    const modelHeaders = headerTexts.slice(benchmarkIndex + 1).filter((text) => text.length > 0);
    expect(modelHeaders.slice(0, 3)).toEqual([
      "Qwen3.6-Plus",
      "Qwen3.5-397B-A17B",
      "Qwen3.5-122B-A10B"
    ]);
  });

  test("双值场景下前后值最大值分开统计并分别高亮", () => {
    render(
      <BenchmarkMatrix
        sourceOptions={["text:pair"]}
        rows={[...pairMaxSplitRows]}
        allRows={[...pairMaxSplitRows]}
      />
    );

    expect(screen.getByText("80")).toHaveStyle("text-decoration: underline");
    expect(screen.getByText("95")).toHaveStyle("text-decoration: underline");

    expect(screen.getByText("70")).not.toHaveStyle("text-decoration: underline");
    expect(screen.getByText("90")).not.toHaveStyle("text-decoration: underline");
  });
});
