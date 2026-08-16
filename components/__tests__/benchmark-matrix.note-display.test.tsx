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

function restorePrototypeProperty(
  prototype: object,
  key: string,
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) {
    Object.defineProperty(prototype, key, descriptor);
    return;
  }
  Reflect.deleteProperty(prototype, key);
}

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
    expect(tooltip).toHaveAttribute("data-cell-tooltip-scrollable", "0");
    expect(tooltip).toHaveClass("pointer-events-none");
  });

  test("记录列表溢出时，鼠标可移入 tooltip 滚动且移出后关闭", async () => {
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains("overflow-auto") ? 2000 : 120;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains("overflow-auto") ? 240 : 120;
      }
    });

    try {
      const { container } = render(
        <BenchmarkMatrix
          rows={Array.from({ length: 24 }, (_, index) => ({
            providerName: "OpenAI",
            modelName: "GPT-5-mini",
            benchmarkName: "LiveCodeBench",
            benchmarkType: `Coding Agent ${index}`,
            benchTime: `2026-04-06T${String(index).padStart(2, "0")}:00:00.000Z`,
            valueRaw: String(50 + index),
            valueNum: 50 + index,
            valueNote: null,
            source: `text:S${index}`
          }))}
        />
      );

      const questionMark = Array.from(container.querySelectorAll("span")).find(
        (node) => node.textContent === "?" && !node.hasAttribute("data-overall-tooltip-trigger")
      );
      expect(questionMark).toBeTruthy();
      fireEvent.mouseEnter(questionMark as HTMLElement);

      const tooltip = (await screen.findByText("存在多条记录")).closest("div");
      expect(tooltip).not.toBeNull();
      expect(tooltip).toHaveAttribute("data-cell-tooltip-scrollable", "1");
      expect(tooltip).toHaveClass("pointer-events-auto");

      fireEvent.mouseLeave(questionMark as HTMLElement);
      fireEvent.mouseEnter(tooltip as HTMLElement);
      expect(screen.getByText("存在多条记录")).toBeInTheDocument();

      fireEvent.mouseLeave(tooltip as HTMLElement);
      await waitFor(() => {
        expect(screen.queryByText("存在多条记录")).not.toBeInTheDocument();
      });
    } finally {
      restorePrototypeProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
      restorePrototypeProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
    }
  });

  test("溢出记录 tooltip 的上下边界保持在可视范围内", async () => {
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 360 });

    const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).hasAttribute("data-cell-tooltip") ? 400 : 16;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains("overflow-auto") ? 2000 : 120;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains("overflow-auto") ? 240 : 120;
      }
    });

    try {
      const { container } = render(
        <BenchmarkMatrix
          rows={Array.from({ length: 24 }, (_, index) => ({
            providerName: "OpenAI",
            modelName: "GPT-5-mini",
            benchmarkName: "LiveCodeBench",
            benchmarkType: `Coding Agent ${index}`,
            benchTime: `2026-04-06T${String(index).padStart(2, "0")}:00:00.000Z`,
            valueRaw: String(50 + index),
            valueNum: 50 + index,
            valueNote: null,
            source: `text:S${index}`
          }))}
        />
      );

      const questionMark = Array.from(container.querySelectorAll("span")).find(
        (node) => node.textContent === "?" && !node.hasAttribute("data-overall-tooltip-trigger")
      );
      expect(questionMark).toBeTruthy();
      fireEvent.mouseEnter(questionMark as HTMLElement);

      const tooltip = (await screen.findByText("存在多条记录")).closest("div") as HTMLElement;
      expect(tooltip).not.toBeNull();

      const top = Number.parseFloat(tooltip.style.top);
      const maxHeight = tooltip.style.maxHeight;
      expect(top).toBeGreaterThanOrEqual(8);
      expect(top).toBeLessThanOrEqual(8);
      expect(maxHeight).toBe("calc(100vh - 16px)");
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
      restorePrototypeProperty(HTMLElement.prototype, "offsetHeight", offsetHeightDescriptor);
      restorePrototypeProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
      restorePrototypeProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
    }
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

  test("双值单元格保留每段数字后紧贴的后缀", () => {
    render(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "GPT-5-mini High",
            benchmarkName: "Terminal Bench 2.0",
            benchmarkType: "Coding Agent",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "2x / 3x",
            valueNum: 2,
            valueNum2: 3,
            valueNote: null,
            source: "text:demo"
          }
        ]}
      />
    );

    const valueCell = screen.getByText("2x").closest("td");
    expect(valueCell).not.toBeNull();
    expect(valueCell).toHaveTextContent("2x/3x");
    expect(screen.getByText("3x")).toBeInTheDocument();
  });
});
