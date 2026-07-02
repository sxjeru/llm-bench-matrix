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
  test("货币值展示保留美元符号与千分位", () => {
    render(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "GPT-5-mini",
            benchmarkName: "Vending Bench 2",
            benchmarkType: "Business",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "$5,634.00",
            valueNum: 5634,
            valueNote: null,
            source: "text:demo"
          }
        ]}
      />
    );

    expect(screen.getByText("$5,634.00")).toBeInTheDocument();
    expect(screen.queryByText(/^5634(?:\.0+)?$/)).not.toBeInTheDocument();
  });

  test("单元格只显示净值，备注通过问号展示", async () => {
    const { container } = render(
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

    const questionMark = Array.from(container.querySelectorAll("span")).find(
      (node) => node.textContent === "?" && !node.hasAttribute("data-overall-tooltip-trigger")
    );
    expect(questionMark).toBeTruthy();
    fireEvent.mouseEnter(questionMark as HTMLElement);

    expect(await screen.findByText("注释：data from the technical report")).toBeInTheDocument();
  });

  test("带#前缀的数值保留#符号显示", () => {
    render(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "GPT-5",
            benchmarkName: "MT-Bench",
            benchmarkType: "Chat",
            benchTime: "2026-04-23T00:00:00.000Z",
            valueRaw: "#2",
            valueNum: 2,
            valueNote: null,
            source: "text:demo"
          },
          {
            providerName: "Anthropic",
            modelName: "Claude 3 Opus",
            benchmarkName: "MT-Bench",
            benchmarkType: "Chat",
            benchTime: "2026-04-23T00:00:00.000Z",
            valueRaw: "＃1",
            valueNum: 1,
            valueNote: null,
            source: "text:demo"
          }
        ]}
      />
    );

    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("＃1")).toBeInTheDocument();
    expect(screen.queryByText(/^2$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^1$/)).not.toBeInTheDocument();
  });

  test("tooltip 会隐藏数值和 source 都相同的重复记录", async () => {
    const { container } = render(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "Alibaba",
            modelName: "Seed2.0",
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

    const questionMark = Array.from(container.querySelectorAll("span")).find(
      (node) => node.textContent === "?" && !node.hasAttribute("data-overall-tooltip-trigger")
    );
    expect(questionMark).toBeTruthy();
    fireEvent.mouseEnter(questionMark as HTMLElement);

    const duplicateHint = await screen.findByText("存在多条记录");
    const tooltip = duplicateHint.closest("div");
    expect(tooltip).not.toBeNull();

    const tooltipEntryRows = Array.from(tooltip!.querySelectorAll("span.block.rounded-md"));
    const tooltipTextList = tooltipEntryRows.map((node) => node.textContent ?? "");
    const seedEntries = tooltipTextList.filter((text) => text.includes("55.4") && text.includes("text:Seed2.0"));
    const qwenEntries = tooltipTextList.filter((text) => text.includes("57.1") && text.includes("text:Qwen3.6"));

    expect(seedEntries).toHaveLength(1);
    expect(qwenEntries).toHaveLength(1);
  });

  test("遇到注释为 x 的，在表格数值后直接显示 x 且不展示问号标记", () => {
    const { container } = render(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "GPT-5-mini High",
            benchmarkName: "Terminal Bench 2.0",
            benchmarkType: "Coding Agent",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "23",
            valueNum: 23,
            valueNote: "x",
            source: "text:demo"
          }
        ]}
      />
    );

    expect(screen.getByText("23x")).toBeInTheDocument();
    
    const questionMark = Array.from(container.querySelectorAll("span")).find(
      (node) => node.textContent === "?" && !node.hasAttribute("data-overall-tooltip-trigger")
    );
    expect(questionMark).toBeUndefined();
  });
});
