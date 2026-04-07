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

describe("BenchmarkMatrix 星号值显示", () => {
  test("单元格只显示净值，备注通过问号展示", async () => {
    render(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "GPT-5-mini High",
            benchmarkName: "Terminal Bench 2.0",
            benchmarkType: "Coding Agent",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "65.5* data from the technical report",
            valueNum: 65.5,
            valueNote: "data from the technical report",
            source: "text:demo"
          }
        ]}
      />
    );

    expect(screen.getByText("65.5*")).toBeInTheDocument();
    expect(screen.queryByText(/data from the technical report/i)).not.toBeInTheDocument();

    const valueCell = screen.getByText("65.5*").closest("td");
    expect(valueCell).not.toBeNull();
    expect(valueCell).toHaveStyle({ paddingRight: "22px" });

    const questionMark = screen.getByText("?");
    fireEvent.mouseEnter(questionMark);

    expect(await screen.findByText("注释：data from the technical report")).toBeInTheDocument();
  });

  test("tooltip 会隐藏数值和 source 都相同的重复记录", async () => {
    render(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "Alibaba",
            modelName: "Qwen3.6",
            benchmarkName: "LiveCodeBench",
            benchmarkType: "Coding Agent",
            benchTime: "2026-04-07T01:01:00.000Z",
            valueRaw: "57.1",
            valueNum: 57.1,
            valueNote: null,
            source: "text:Qwen3.6"
          },
          {
            providerName: "Seed",
            modelName: "Seed2.0",
            benchmarkName: "LiveCodeBench",
            benchmarkType: "Coding Agent",
            benchTime: "2026-04-06T12:43:00.000Z",
            valueRaw: "55.4",
            valueNum: 55.4,
            valueNote: null,
            source: "text:Seed2.0"
          },
          {
            providerName: "Seed",
            modelName: "Seed2.0",
            benchmarkName: "LiveCodeBench",
            benchmarkType: "Coding Agent",
            benchTime: "2026-04-06T12:35:00.000Z",
            valueRaw: "55.4",
            valueNum: 55.4,
            valueNote: null,
            source: "text:Seed2.0"
          }
        ]}
      />
    );

    const questionMark = screen.getByText("?");
    fireEvent.mouseEnter(questionMark);

    const duplicateHint = await screen.findByText("该单元格存在多条记录");
    const tooltip = duplicateHint.closest("div");
    expect(tooltip).not.toBeNull();

    const tooltipTextList = Array.from(tooltip!.querySelectorAll("span")).map((node) => node.textContent ?? "");
    const seedEntries = tooltipTextList.filter((text) => text.includes("55.4") && text.includes("text:Seed2.0"));
    const qwenEntries = tooltipTextList.filter((text) => text.includes("57.1") && text.includes("text:Qwen3.6"));

    expect(seedEntries).toHaveLength(1);
    expect(qwenEntries).toHaveLength(1);
  });
});
