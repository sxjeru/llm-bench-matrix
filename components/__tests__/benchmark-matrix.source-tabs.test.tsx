import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  test("同系列 source 页签按新版本优先排序（如 Qwen3.6 在 Qwen3.5 前）", () => {
    render(
      <BenchmarkMatrix
        sourceOptions={["text:Qwen3.5", "text:Qwen3.6", "text:Qwen3.4", "text:Gemini-2.5-Pro"]}
        rows={[
          {
            providerName: "Qwen",
            modelName: "Qwen Model",
            benchmarkName: "Bench-Q",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Qwen3.5"
          }
        ]}
      />
    );

    const qwenTabs = screen
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.trim() ?? "")
      .filter((label) => label.startsWith("Qwen3."));

    expect(qwenTabs).toEqual(["Qwen3.6", "Qwen3.5", "Qwen3.4"]);
  });

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

  test("从 Gemma 4 切回全部时，模型选择会恢复到全量 allRows", async () => {
    render(
      <BenchmarkMatrix
        sourceOptions={["text:Gemma 4", "text:Seed2.0"]}
        rows={[
          {
            providerName: "Google",
            modelName: "Gemma 4 31B",
            benchmarkName: "Bench-G",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Gemma 4"
          }
        ]}
        allRows={[
          {
            providerName: "Google",
            modelName: "Gemma 4 31B",
            benchmarkName: "Bench-G",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Gemma 4"
          },
          {
            providerName: "Seed",
            modelName: "Seed2.0 Pro",
            benchmarkName: "Bench-S",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "77",
            valueNum: 77,
            valueNote: null,
            source: "text:Seed2.0"
          }
        ]}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Gemma 4" }));
    fireEvent.click(screen.getByRole("tab", { name: "全部" }));

    await waitFor(() => {
      expect(screen.getByText("已选模型 2/2")).toBeInTheDocument();
    });
    expect(screen.getByText("Bench-S")).toBeInTheDocument();
  });
});
