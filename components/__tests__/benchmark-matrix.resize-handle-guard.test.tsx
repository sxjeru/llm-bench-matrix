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
    benchmarkName: "Bench-1",
    benchmarkType: "General",
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
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "71",
    valueNum: 71,
    valueNote: null,
    source: "text:S1"
  }
] as const;

describe("BenchmarkMatrix 列宽拖拽防误触", () => {
  test("拖拽列宽把手后立即点击 Benchmark 表头，不会触发排序切换", () => {
    render(<BenchmarkMatrix rows={[...rows]} />);

    const benchmarkSortButton = screen.getByRole("button", { name: /Benchmark/ });
    const resizeHandle = screen.getByLabelText("调整 Benchmark 列宽");
    const initialTitle = benchmarkSortButton.getAttribute("title");

    expect(initialTitle).toBeTruthy();

    fireEvent.pointerDown(resizeHandle, { clientX: 220 });
    fireEvent.pointerUp(window, { clientX: 250 });
    fireEvent.click(benchmarkSortButton);

    expect(benchmarkSortButton).toHaveAttribute("title", initialTitle);
  });
});
