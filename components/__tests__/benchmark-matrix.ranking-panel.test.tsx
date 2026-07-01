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

const rows = [
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
    modelName: "Model B",
    benchmarkName: "Bench-1",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-1:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "75",
    valueNum: 75,
    valueNote: null,
    source: "text:S1"
  }
] as const;

describe("BenchmarkMatrix ranking panel", () => {
  beforeEach(() => {
    window.localStorage.clear();

    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  test("Ctrl/Cmd clicking a benchmark row expands a model ranking chart", () => {
    const { container } = render(<BenchmarkMatrix rows={[...rows]} allRows={[...rows]} />);

    const benchRow = screen.getByText("Bench-1").closest("tr");
    expect(benchRow).not.toBeNull();

    fireEvent.click(benchRow!, { ctrlKey: true });

    expect(screen.getAllByText("Bench-1").length).toBeGreaterThan(0);

    const modelB = container.querySelector('[data-ranking-model="Model B"]');
    const modelA = container.querySelector('[data-ranking-model="Model A"]');
    expect(modelB).not.toBeNull();
    expect(modelA).not.toBeNull();
    expect(modelB).toHaveTextContent("#1");
    expect(modelB).toHaveTextContent("75");
    expect(modelA).toHaveTextContent("#2");

    fireEvent.click(screen.getByRole("button", { name: "0-100" }));
    expect(screen.getAllByText("0-100").length).toBeGreaterThan(0);

    const panel = container.querySelector("[data-benchmark-ranking-panel]");
    expect(panel?.parentElement).not.toBeNull();
    expect(panel?.parentElement?.parentElement).not.toBeNull();
    fireEvent.mouseDown(panel!.parentElement!.parentElement!);
    expect(container.querySelector("[data-benchmark-ranking-panel]")).toBeNull();
  });

  test("Ctrl/Cmd clicking a price row expands a lower-price ranking chart", () => {
    const { container } = render(
      <BenchmarkMatrix
        rows={[...rows]}
        allRows={[...rows]}
        modelPrices={[
          { modelName: "Model A", inputCost: 3, outputCost: 15, cacheReadCost: 0.3 },
          { modelName: "Model B", inputCost: 1, outputCost: 5, cacheReadCost: 0.1 },
          { modelName: "Model C", inputCost: 2, outputCost: 8, cacheReadCost: 0.2 }
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /显示价格/ }));

    const inputPriceRow = screen.getByText("Input Price").closest("tr");
    expect(inputPriceRow).not.toBeNull();

    fireEvent.click(inputPriceRow!, { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "全部" }));

    expect(screen.getAllByText("Input Price").length).toBeGreaterThan(0);

    const modelB = container.querySelector('[data-ranking-model="Model B"]');
    const modelC = container.querySelector('[data-ranking-model="Model C"]');
    const modelA = container.querySelector('[data-ranking-model="Model A"]');
    expect(modelB).not.toBeNull();
    expect(modelC).not.toBeNull();
    expect(modelA).not.toBeNull();
    expect(modelB).toHaveTextContent("#1");
    expect(modelB).toHaveTextContent("$1");
    expect(modelC).toHaveTextContent("#2");
    expect(modelA).toHaveTextContent("#3");
  });
});
