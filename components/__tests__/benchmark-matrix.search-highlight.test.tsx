import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { HighlightText } from "@/components/benchmark-matrix/highlight-text";
import {
  escapeRegExp,
  extractSearchTokens
} from "@/components/benchmark-matrix/search-match";
import { renderReady } from "@/tests/flush-microtasks";

describe("HighlightText 核心高亮逻辑与无障碍测试", () => {
  test("搜索词为空或未提供时，返回纯文本，不创建 mark", () => {
    const { container: c1 } = render(<HighlightText text="MMLU-Pro" query="" />);
    expect(c1.querySelector("mark")).toBeNull();
    expect(c1.textContent).toBe("MMLU-Pro");

    const { container: c2 } = render(<HighlightText text="MMLU-Pro" query="   " />);
    expect(c2.querySelector("mark")).toBeNull();
    expect(c2.textContent).toBe("MMLU-Pro");

    const { container: c3 } = render(<HighlightText text={null} query="MMLU" />);
    expect(c3.textContent).toBe("");
  });

  test("全词匹配时直接渲染带有 matrix-search-highlight 的单一 mark", () => {
    const { container } = render(<HighlightText text="GSM8K" query="gsm8k" />);
    const mark = container.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark?.className).toContain("matrix-search-highlight");
    expect(mark?.textContent).toBe("GSM8K");
    // 全匹配无需 sr-only 冗余
    expect(container.querySelector(".sr-only")).toBeNull();
  });

  test("部分命中时保持原始大小写，并生成无障碍 sr-only 轨道与 aria-hidden 视觉高亮", () => {
    const { container } = render(<HighlightText text="HumanEval-Python" query="eval" />);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("Eval");
    expect(marks[0].className).toContain("matrix-search-highlight");

    // 辅助工具可获取完整文本
    const srOnly = container.querySelector(".sr-only");
    expect(srOnly).not.toBeNull();
    expect(srOnly?.textContent).toBe("HumanEval-Python");

    // 隐藏副本不应被框选复制，避免复制出的文本重复一遍
    expect(srOnly).toHaveClass("select-none");

    // 视觉呈现层带有 aria-hidden
    const ariaHidden = container.querySelector('[aria-hidden="true"]');
    expect(ariaHidden).not.toBeNull();
    expect(ariaHidden?.textContent).toBe("HumanEval-Python");
  });

  test("支持多词与特殊字符安全转义匹配", () => {
    expect(escapeRegExp("C++ (Math) [Pro]*")).toBe("C\\+\\+ \\(Math\\) \\[Pro\\]\\*");
    expect(extractSearchTokens("math 500")).toEqual(["math 500", "math", "500"]);

    const { container } = render(<HighlightText text="MATH-500 (CoT)" query="math cot" />);
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThanOrEqual(2);
    const markTexts = Array.from(marks).map((m) => m.textContent);
    expect(markTexts).toContain("MATH");
    expect(markTexts).toContain("CoT");

    const { container: escapedContainer } = render(<HighlightText text="C++ (Math)" query="C++" />);
    expect(escapedContainer.querySelector("mark")?.textContent).toBe("C++");
  });
});

const mockSearchParams = new URLSearchParams();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: mockReplace
  }),
  useSearchParams: () => mockSearchParams
}));

vi.mock("html2canvas-pro", () => ({
  default: () => Promise.resolve(document.createElement("canvas"))
}));

describe("BenchmarkMatrix 表格搜索词高亮集成", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const rows = [
    {
      providerName: "OpenAI",
      modelName: "GPT-4o",
      benchmarkName: "MATH-500",
      benchmarkType: "Reasoning",
      benchmarkCanonicalKey: "math-500:reasoning",
      benchTime: "2026-04-06T00:00:00.000Z",
      valueRaw: "92",
      valueNum: 92,
      valueNote: null,
      source: "text:S1"
    },
    {
      providerName: "Anthropic",
      modelName: "Claude 3.5 Sonnet",
      benchmarkName: "HumanEval",
      benchmarkType: "Coding",
      benchmarkCanonicalKey: "humaneval:coding",
      benchTime: "2026-04-06T00:00:00.000Z",
      valueRaw: "90",
      valueNum: 90,
      valueNote: null,
      source: "text:S1"
    }
  ];

  test("在表格中筛选后，Benchmark 中匹配的关键字以 mark 呈现高亮", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:S1"]}
        rows={rows}
      />
    );

    const searchInput = screen.getByPlaceholderText("筛选 Benchmark");

    // 初始状态下表格内无 mark 高亮
    expect(document.querySelectorAll("mark.matrix-search-highlight")).toHaveLength(0);

    // 搜索 "math"
    fireEvent.change(searchInput, { target: { value: "math" } });
    act(() => {
      vi.advanceTimersByTime(300);
      vi.runAllTicks();
    });

    // 此时仅 MATH-500 命中，且完整文本未因分词丢失
    const marks = document.querySelectorAll("mark.matrix-search-highlight");
    expect(marks.length).toBeGreaterThan(0);
    expect(Array.from(marks).some((m) => m.textContent === "MATH")).toBe(true);
    expect(screen.getByText("MATH-500")).toBeInTheDocument();
    expect(screen.queryByText("HumanEval")).not.toBeInTheDocument();

    // 清空搜索后，高亮与过滤同时恢复
    const clearBtn = screen.getByLabelText("清除搜索");
    fireEvent.click(clearBtn);
    expect(document.querySelectorAll("mark.matrix-search-highlight")).toHaveLength(0);
    expect(screen.getByText("HumanEval")).toBeInTheDocument();
  });

  test("搜索 Category 关键词时，Category 单元格同样得到高亮", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:S1"]}
        rows={rows}
      />
    );

    const searchInput = screen.getByPlaceholderText("筛选 Benchmark");
    fireEvent.change(searchInput, { target: { value: "Coding" } });
    act(() => {
      vi.advanceTimersByTime(300);
      vi.runAllTicks();
    });

    const marks = document.querySelectorAll("mark.matrix-search-highlight");
    expect(marks.length).toBeGreaterThan(0);
    expect(Array.from(marks).some((m) => m.textContent === "Coding")).toBe(true);
    expect(screen.getByText("HumanEval")).toBeInTheDocument();
    expect(screen.queryByText("MATH-500")).not.toBeInTheDocument();
  });

  test("多关键词搜索：命中的每个关键词都会高亮，且筛选与高亮口径一致", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:S1"]}
        rows={rows}
      />
    );

    const searchInput = screen.getByPlaceholderText("筛选 Benchmark");
    fireEvent.change(searchInput, { target: { value: "math 500" } });
    act(() => {
      vi.advanceTimersByTime(300);
      vi.runAllTicks();
    });

    // MATH-500 命中两个关键词，HumanEval 不命中
    const markTexts = Array.from(document.querySelectorAll("mark.matrix-search-highlight")).map(
      (mark) => mark.textContent
    );
    expect(markTexts).toContain("MATH");
    expect(markTexts).toContain("500");
    expect(screen.getByText("MATH-500")).toBeInTheDocument();
    expect(screen.queryByText("HumanEval")).not.toBeInTheDocument();
  });
});
