import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";

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

describe("BenchmarkMatrix 总评行", () => {
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

  test("问号 tooltip 展示覆盖率修正后的分数与名次", async () => {
    const { container } = render(<BenchmarkMatrix rows={[...rows]} />);

    const trigger = container.querySelector('[data-overall-tooltip-trigger="Model C"]') as HTMLElement | null;
    expect(trigger).not.toBeNull();

    fireEvent.mouseEnter(trigger!);

    expect(await screen.findByText(/修正后总评：/)).toBeInTheDocument();
    expect(screen.getByText(/修正后名次：/)).toBeInTheDocument();
    expect(screen.getByText(/主展示名次按原始总评分计算/)).toBeInTheDocument();
  });
});
