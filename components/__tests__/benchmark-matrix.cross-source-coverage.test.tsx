import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";

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
});
