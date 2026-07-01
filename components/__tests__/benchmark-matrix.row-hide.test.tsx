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
    valueRaw: "80",
    valueNum: 80,
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
    valueRaw: "81",
    valueNum: 81,
    valueNote: null,
    source: "text:S1"
  }
] as const;

function renderMatrix() {
  return render(<BenchmarkMatrix rows={[...rows]} allRows={[...rows]} />);
}

describe("BenchmarkMatrix 临时隐藏行", () => {
  beforeEach(() => {
    window.localStorage.clear();

    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  test("shift 点击行会临时隐藏该行，重新挂载后恢复", () => {
    const firstRender = renderMatrix();

    const benchOneRow = screen.getByText("Bench-1").closest("tr");
    expect(benchOneRow).not.toBeNull();

    const shiftMouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      shiftKey: true
    });
    benchOneRow!.dispatchEvent(shiftMouseDown);
    expect(shiftMouseDown.defaultPrevented).toBe(true);

    fireEvent.click(benchOneRow!, { shiftKey: true });

    expect(screen.queryByText("Bench-1")).not.toBeInTheDocument();
    expect(screen.getByText("Bench-2")).toBeInTheDocument();

    firstRender.unmount();
    renderMatrix();

    expect(screen.getByText("Bench-1")).toBeInTheDocument();
    expect(screen.getByText("Bench-2")).toBeInTheDocument();
  });
});
