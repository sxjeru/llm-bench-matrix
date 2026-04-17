import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  __applyExportCompareBaselineFallbackForTest,
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

const compareRows = [
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
  },
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "Bench-2",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-2:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "60",
    valueNum: 60,
    valueNote: null,
    source: "text:S1"
  },
  {
    providerName: "OpenAI",
    modelName: "Model B",
    benchmarkName: "Bench-2",
    benchmarkType: "General",
    benchmarkCanonicalKey: "bench-2:general",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "58",
    valueNum: 58,
    valueNote: null,
    source: "text:S1"
  }
] as const;

const lowerBetterRows = [
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "OmniDocBench 1.5",
    benchmarkType: "General VQA",
    benchmarkCanonicalKey: "omnidocbench-1-5:general-vqa",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "0.120",
    valueNum: 0.12,
    valueNote: null,
    source: "text:S1"
  },
  {
    providerName: "OpenAI",
    modelName: "Model B",
    benchmarkName: "OmniDocBench 1.5",
    benchmarkType: "General VQA",
    benchmarkCanonicalKey: "omnidocbench-1-5:general-vqa",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "0.100",
    valueNum: 0.1,
    valueNote: null,
    source: "text:S1"
  }
] as const;

const presenceRows = [
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
    valueRaw: "71",
    valueNum: 71,
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
    valueRaw: "60",
    valueNum: 60,
    valueNote: null,
    source: "text:S1"
  }
] as const;

describe("BenchmarkMatrix 模型比较", () => {
  beforeEach(() => {
    window.localStorage.clear();

    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  test("Ctrl/Cmd 点击可建立基准与比较模型，并显示差值徽标", () => {
    const { container } = render(<BenchmarkMatrix rows={[...compareRows]} allRows={[...compareRows]} />);

    const headerA = screen.getByRole("columnheader", { name: /Model A/ });
    const headerB = screen.getByRole("columnheader", { name: /Model B/ });

    fireEvent.click(headerA, { ctrlKey: true });
    fireEvent.click(headerB, { ctrlKey: true });

    expect(screen.getByText("Baseline")).toBeInTheDocument();
    expect(container.querySelector('th[data-compare-baseline="1"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-compare-delta-badge="1"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('tbody tr[data-overall-row="1"] td[data-compare-baseline="1"]').length).toBe(0);
    expect(container.querySelectorAll('tbody tr:not([data-overall-row="1"]) td[data-compare-baseline="1"]').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "清空比较" }));

    expect(container.querySelector('th[data-compare-baseline="1"]')).toBeNull();
    expect(container.querySelectorAll('[data-compare-delta-badge="1"]').length).toBe(0);
  });

  test("比较模式会适度扩展默认列宽，避免徽标拥挤", async () => {
    render(<BenchmarkMatrix rows={[...compareRows]} allRows={[...compareRows]} />);

    const headerA = screen.getByRole("columnheader", { name: /Model A/ });
    const headerB = screen.getByRole("columnheader", { name: /Model B/ });

    fireEvent.click(headerA, { ctrlKey: true });
    fireEvent.click(headerB, { ctrlKey: true });

    await waitFor(() => {
      const baselineWidth = Number.parseFloat(window.getComputedStyle(headerA).width);
      const compareWidth = Number.parseFloat(window.getComputedStyle(headerB).width);

      expect(baselineWidth).toBeGreaterThanOrEqual(86);
      expect(compareWidth).toBeGreaterThanOrEqual(100);
    });
  });

  test("比较模式下手动拖窄后不会被强制抬高", async () => {
    render(<BenchmarkMatrix rows={[...compareRows]} allRows={[...compareRows]} />);

    const headerA = screen.getByRole("columnheader", { name: /Model A/ });
    const headerB = screen.getByRole("columnheader", { name: /Model B/ });

    fireEvent.click(headerA, { ctrlKey: true });
    fireEvent.click(headerB, { ctrlKey: true });

    await waitFor(() => {
      const baselineWidth = Number.parseFloat(window.getComputedStyle(headerA).width);
      const compareWidth = Number.parseFloat(window.getComputedStyle(headerB).width);

      expect(baselineWidth).toBeGreaterThanOrEqual(96);
      expect(compareWidth).toBeGreaterThanOrEqual(108);
    });

    const resizeHandleA = screen.getByLabelText("调整 Model A 列宽");
    const resizeHandleB = screen.getByLabelText("调整 Model B 列宽");

    fireEvent.pointerDown(resizeHandleA, { clientX: 420 });
    fireEvent.pointerMove(window, { clientX: 290 });
    fireEvent.pointerUp(window, { clientX: 290 });

    fireEvent.pointerDown(resizeHandleB, { clientX: 420 });
    fireEvent.pointerMove(window, { clientX: 280 });
    fireEvent.pointerUp(window, { clientX: 280 });

    await waitFor(() => {
      const baselineWidth = Number.parseFloat(window.getComputedStyle(headerA).width);
      const compareWidth = Number.parseFloat(window.getComputedStyle(headerB).width);

      expect(baselineWidth).toBeGreaterThanOrEqual(24);
      expect(compareWidth).toBeGreaterThanOrEqual(24);
      expect(baselineWidth).toBeLessThan(96);
      expect(compareWidth).toBeLessThan(108);
    });
  });

  test("低值更优 benchmark 中，较低分数应显示绿色上升方向", () => {
    const { container } = render(<BenchmarkMatrix rows={[...lowerBetterRows]} allRows={[...lowerBetterRows]} />);

    const headerA = screen.getByRole("columnheader", { name: /Model A/ });
    const headerB = screen.getByRole("columnheader", { name: /Model B/ });

    fireEvent.click(headerA, { ctrlKey: true });
    fireEvent.click(headerB, { ctrlKey: true });

    expect(container.querySelector('[data-compare-delta-badge="1"][data-compare-direction="up"]')).not.toBeNull();
  });

  test("Ctrl/Cmd 点击不会触发行存在性过滤，普通点击仍按原行为过滤", () => {
    render(<BenchmarkMatrix rows={[...presenceRows]} allRows={[...presenceRows]} />);

    const headerB = screen.getByRole("columnheader", { name: /Model B/ });

    fireEvent.click(headerB, { ctrlKey: true });
    expect(screen.getByText("Bench-2")).toBeInTheDocument();

    fireEvent.click(headerB);
    expect(screen.queryByText("Bench-2")).toBeNull();
  });

  test("导出 compare 基准列兜底会写入左右与底部边框", () => {
    const root = document.createElement("div");
    const header = document.createElement("th");
    const cell = document.createElement("td");

    header.setAttribute("data-compare-baseline", "1");
    cell.setAttribute("data-compare-baseline", "1");
    cell.setAttribute("data-compare-baseline-bottom", "1");

    root.appendChild(header);
    root.appendChild(cell);

    __applyExportCompareBaselineFallbackForTest(root, "rgba(250, 211, 106, 0.9)", 2);

    expect(header.style.borderTop).toContain("2px");
    expect(header.style.borderLeft).toContain("2px");
    expect(header.style.borderRight).toContain("2px");

    expect(cell.style.borderLeft).toContain("2px");
    expect(cell.style.borderRight).toContain("2px");
    expect(cell.style.borderBottom).toContain("2px");
  });
});
