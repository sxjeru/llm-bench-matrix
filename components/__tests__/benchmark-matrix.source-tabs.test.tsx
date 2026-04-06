import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}));

describe("BenchmarkMatrix source tabs", () => {
  test("当 rows 仅有单一 source 时，也会按 sourceOptions 展示全部页签", () => {
    render(
      <BenchmarkMatrix
        sourceOptions={["text:Model A", "text:Qwen3.5-27B", "text:Gemini-2.5-Pro"]}
        rows={[
          {
            providerName: "OpenAI",
            modelName: "Model A",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "70.1",
            valueNum: 70.1,
            valueNote: null,
            source: "text:Model A"
          },
          {
            providerName: "OpenAI",
            modelName: "Model B",
            benchmarkName: "Bench-2",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "71.2",
            valueNum: 71.2,
            valueNote: null,
            source: null
          }
        ]}
      />
    );

    expect(screen.getByRole("tab", { name: "全部" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Model A" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Qwen3.5-27B" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Gemini-2.5-Pro" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "未标注" })).toBeInTheDocument();

    const tablist = screen.getByRole("tablist");
    expect(tablist.className).toContain("overflow-x-auto");
  });
});
