import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { HighlightText } from "@/components/benchmark-matrix/highlight-text";
import {
  createSearchMatcher,
  escapeRegExp,
  getSearchHighlightPlan
} from "@/components/benchmark-matrix/search-match";
import { renderReady } from "@/tests/flush-microtasks";

describe("search-match 交集匹配口径", () => {
  test("空格分隔的检索词必须全部命中（交集），顺序无关且忽略大小写", () => {
    const matcher = createSearchMatcher("Harvey Legal Agent");
    expect(matcher).not.toBeNull();

    expect(matcher?.("Harvey Legal Agent")).toBe(true);
    expect(matcher?.("Harvey-Legal Agent (All Pass)")).toBe(true);
    // 顺序无关：词按交集判断，不要求与输入顺序一致
    expect(matcher?.("Agent Legal Harvey")).toBe(true);
    // 缺任一词即不命中，不再因为 "agent" 这类常见词单独命中而入选
    expect(matcher?.("Legal Agent")).toBe(false);
    expect(matcher?.("AgentBench")).toBe(false);
    expect(matcher?.(null)).toBe(false);
  });

  test("单个检索词仍是子串匹配，空白检索词不做过滤", () => {
    expect(createSearchMatcher("   ")).toBeNull();

    const matcher = createSearchMatcher("agent");
    expect(matcher?.("SWE-Agent")).toBe(true);
    expect(matcher?.("AgentBench")).toBe(true);
    expect(matcher?.("MMLU")).toBe(false);
  });

  test("高亮计划保留整句与各单词，排除词与空查询不产生高亮", () => {
    expect(getSearchHighlightPlan("Harvey Legal Agent")?.tokens).toEqual([
      "Harvey Legal Agent",
      "Harvey",
      "Legal",
      "Agent"
    ]);
    // 引号短语只保留去掉引号后的检索词，不把原始带引号 token 塞进高亮计划
    expect(getSearchHighlightPlan('"Math 500"')?.tokens).toEqual(["Math 500"]);
    expect(getSearchHighlightPlan("!internal")).toBeNull();
    expect(getSearchHighlightPlan("   ")).toBeNull();
  });

  test("类正则排除匹配：!internal 排除包含 internal 的项", () => {
    const matcher = createSearchMatcher("!internal");
    expect(matcher).not.toBeNull();

    expect(matcher?.("GSM8K")).toBe(true);
    expect(matcher?.("Internal-Bench")).toBe(false);
    expect(matcher?.("bench_internal_v2")).toBe(false);
    expect(matcher?.("SWE-bench")).toBe(true);
    expect(matcher?.(["SWE-bench", "Coding"])).toBe(true);
    expect(matcher?.(["Internal-Bench", "Coding"])).toBe(false);
    expect(matcher?.(["SWE-bench", "Internal Evaluation"])).toBe(false);
    expect(matcher?.(null)).toBe(false);
  });

  test("全角中文感叹号 ！等价于 ! 排除修饰符，且不参与高亮", () => {
    const halfWidth = createSearchMatcher("!internal")!;
    const fullWidth = createSearchMatcher("！internal")!;
    expect(fullWidth).not.toBeNull();

    const targets = [
      "GSM8K",
      "Internal-Bench",
      "bench_internal_v2",
      ["SWE-bench", "Coding"],
      ["SWE-bench", "Internal Evaluation"],
      ["", ""],
      null
    ] as const;
    for (const target of targets) {
      expect(fullWidth(target)).toBe(halfWidth(target));
    }

    expect(fullWidth("GSM8K")).toBe(true);
    expect(fullWidth("Internal-Bench")).toBe(false);
    expect(fullWidth(["", ""])).toBe(true);
    expect(getSearchHighlightPlan("！internal")).toBeNull();
    expect(getSearchHighlightPlan("^GSM ！internal")?.tokens).toEqual(["GSM"]);
  });

  test("全角 ！可与 ^ / $ 组合，转义与未完成输入语义不变", () => {
    const queryPairs = [
      ["！^internal", "!^internal"],
      ["^！internal", "^!internal"],
      ["！internal$", "!internal$"],
      ["！^internal$", "!^internal$"],
      ["^GSM ！internal", "^GSM !internal"]
    ] as const;
    const targets = [
      "internal-bench",
      "my-internal-bench",
      "GSM8K",
      "GSM-Internal",
      "internal"
    ] as const;

    for (const [fullWidthQuery, halfWidthQuery] of queryPairs) {
      const fullWidth = createSearchMatcher(fullWidthQuery);
      const halfWidth = createSearchMatcher(halfWidthQuery);
      expect(fullWidth).not.toBeNull();
      expect(halfWidth).not.toBeNull();
      for (const target of targets) {
        expect(fullWidth?.(target)).toBe(halfWidth?.(target));
      }
    }

    // 转义后的 ！按字面量匹配，不再作为排除符
    const literal = createSearchMatcher("\\！internal");
    expect(literal?.("！internal")).toBe(true);
    expect(literal?.("internal")).toBe(false);
    // 非开头的 ！仍是普通字符
    expect(createSearchMatcher("in！ternal")?.("in！ternal")).toBe(true);

    expect(createSearchMatcher("！")).toBeNull();
    expect(createSearchMatcher("！^")).toBeNull();
    expect(createSearchMatcher("！   ")).toBeNull();
  });

  test("类正则前缀匹配：^internal 筛选以 internal 开头的项", () => {
    const matcher = createSearchMatcher("^internal");
    expect(matcher).not.toBeNull();

    expect(matcher?.("internal-bench")).toBe(true);
    expect(matcher?.("Internal_v2")).toBe(true);
    expect(matcher?.("my-internal-bench")).toBe(false);
    expect(matcher?.("bench_internal")).toBe(false);
    expect(matcher?.(["internal-test", "General"])).toBe(true);
    expect(matcher?.(["General-Bench", "Internal Category"])).toBe(true);
    expect(matcher?.(["Other-Bench", "Other Category"])).toBe(false);
  });

  test("前缀排除组合：!^internal 排除以 internal 开头的项，但保留包含在中间的项", () => {
    const matcher = createSearchMatcher("!^internal");
    expect(matcher).not.toBeNull();

    expect(matcher?.("internal-bench")).toBe(false);
    expect(matcher?.("Internal_v2")).toBe(false);
    expect(matcher?.("my-internal-bench")).toBe(true);
    expect(matcher?.("bench_internal")).toBe(true);
  });

  test("多规则组合：^GSM !internal 必须以 GSM 开头且不能含有 internal", () => {
    const matcher = createSearchMatcher("^GSM !internal");
    expect(matcher).not.toBeNull();

    expect(matcher?.("GSM8K")).toBe(true);
    expect(matcher?.("GSM-Internal")).toBe(false);
    expect(matcher?.("Math-GSM8K")).toBe(false);
    expect(matcher?.(["GSM8K", "Reasoning"])).toBe(true);
    expect(matcher?.(["GSM8K-Internal", "Reasoning"])).toBe(false);
    expect(matcher?.(["GSM8K", "Internal Review"])).toBe(false);
  });

  test("未完成的修饰符不作为有效过滤，避免打字中断流", () => {
    expect(createSearchMatcher("!")).toBeNull();
    expect(createSearchMatcher("^")).toBeNull();
    expect(createSearchMatcher("!^")).toBeNull();
    expect(createSearchMatcher("!   ")).toBeNull();
  });

  test("转义支持：\\!internal 视为普通字面量搜索", () => {
    const matcher = createSearchMatcher("\\!internal");
    expect(matcher).not.toBeNull();
    expect(matcher?.("!internal")).toBe(true);
    expect(matcher?.("internal")).toBe(false);
  });

  test("转义在任意位置生效：\\$ 不会被当作后缀修饰符", () => {
    const literalDollar = createSearchMatcher("100\\$");
    expect(literalDollar).not.toBeNull();
    expect(literalDollar?.("USD 100$")).toBe(true);
    expect(literalDollar?.("USD 100")).toBe(false);

    expect(createSearchMatcher("foo\\$bar")?.("foo$bar")).toBe(true);
    expect(createSearchMatcher("\\^internal")?.("^internal")).toBe(true);
  });

  test("未闭合引号按普通空白降级，不吞掉后续检索词", () => {
    expect(createSearchMatcher('"math')?.("MATH-500")).toBe(true);
    expect(createSearchMatcher('"math 500')?.("MATH-500")).toBe(true);
    expect(createSearchMatcher('"math 500')?.("HumanEval")).toBe(false);
  });

  test("后缀与完全匹配：term$ 按字段结尾命中，^term$ 要求字段完全一致", () => {
    const suffix = createSearchMatcher("500$");
    expect(suffix).not.toBeNull();
    expect(suffix?.("MATH-500")).toBe(true);
    expect(suffix?.("500-MATH")).toBe(false);
    expect(suffix?.(["GSM8K", "Pass@500"])).toBe(true);

    const exact = createSearchMatcher("^MATH-500$");
    expect(exact).not.toBeNull();
    expect(exact?.("MATH-500")).toBe(true);
    expect(exact?.("MATH-500 (CoT)")).toBe(false);
    expect(exact?.(["MATH-500", "Reasoning"])).toBe(true);
    expect(exact?.(["MATH", "500"])).toBe(false);
  });

  test("纯否定查询保留空字段行，含正向规则时不命中", () => {
    const exclude = createSearchMatcher("!internal");
    expect(exclude?.(["", ""])).toBe(true);
    expect(exclude?.(["", null])).toBe(true);
    expect(exclude?.([])).toBe(true);
    expect(exclude?.(["", "Internal Review"])).toBe(false);

    expect(createSearchMatcher("^gsm")?.(["", ""])).toBe(false);
    expect(createSearchMatcher("!internal ^gsm")?.(["", ""])).toBe(false);
  });

  test("多字段按「任一字段」匹配，引号短语不跨字段拼接", () => {
    // 未加引号的多词查询会拆成多条规则，可以分别命中名称与分类
    expect(createSearchMatcher("math 500")?.(["Math", "500"])).toBe(true);
    // 引号短语是单条规则，必须完整落在某个字段内
    expect(createSearchMatcher('"Math 500"')?.(["Math", "500"])).toBe(false);
    expect(createSearchMatcher('"Math 500"')?.(["Math 500", "Reasoning"])).toBe(true);
    // ^x$ 表示某个字段完全匹配
    expect(createSearchMatcher("^foo$")?.(["Foo", "Bar"])).toBe(true);
    expect(createSearchMatcher("^foo$")?.(["Foo Bar", "Baz"])).toBe(false);
  });
});

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
    expect(getSearchHighlightPlan("math 500")?.tokens).toEqual(["math 500", "math", "500"]);

    const { container } = render(<HighlightText text="MATH-500 (CoT)" query="math cot" />);
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThanOrEqual(2);
    const markTexts = Array.from(marks).map((m) => m.textContent);
    expect(markTexts).toContain("MATH");
    expect(markTexts).toContain("CoT");

    const { container: escapedContainer } = render(<HighlightText text="C++ (Math)" query="C++" />);
    expect(escapedContainer.querySelector("mark")?.textContent).toBe("C++");
  });

  test("排除语法 !internal 不产生任何高亮标记，保持纯文本", () => {
    const { container } = render(<HighlightText text="Internal-Bench" query="!internal" />);
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("Internal-Bench");
  });

  test("前缀语法 ^GSM 正确提取关键词并高亮对应前缀内容", () => {
    const { container } = render(<HighlightText text="GSM8K" query="^GSM" />);
    const mark = container.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe("GSM");
  });

  test("锚点语法只高亮字段边界上的匹配，不高亮中间片段", () => {
    const { container: prefix } = render(<HighlightText text="My GSM Bench" query="^GSM" />);
    expect(prefix.querySelector("mark")).toBeNull();

    const { container: suffix } = render(<HighlightText text="MATH-500 Pro" query="500$" />);
    expect(suffix.querySelector("mark")).toBeNull();

    const { container: exact } = render(
      <HighlightText text="MATH-500 (CoT)" query="^MATH-500$" />
    );
    expect(exact.querySelector("mark")).toBeNull();

    const { container: hit } = render(<HighlightText text="MATH-500" query="500$" />);
    expect(hit.querySelector("mark")?.textContent).toBe("500");

    const { container: exactHit } = render(
      <HighlightText text="MATH-500" query="^MATH-500$" />
    );
    expect(exactHit.querySelector("mark")?.textContent).toBe("MATH-500");
  });

  test("组合语法 ^GSM !internal 仅对正向关键词 GSM 高亮，不包含 internal", () => {
    const { container } = render(<HighlightText text="GSM8K-Internal" query="^GSM !internal" />);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("GSM");
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

  test("在表格中输入 !math 进行排除：MATH-500 被排除，保留 HumanEval，且不产生任何高亮 mark", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:S1"]}
        rows={rows}
      />
    );

    const searchInput = screen.getByPlaceholderText("筛选 Benchmark");
    fireEvent.change(searchInput, { target: { value: "!math" } });
    act(() => {
      vi.advanceTimersByTime(300);
      vi.runAllTicks();
    });

    // MATH-500 被排除，HumanEval 保留
    expect(screen.queryByText("MATH-500")).not.toBeInTheDocument();
    expect(screen.getByText("HumanEval")).toBeInTheDocument();

    // 排除搜索不应对保留的行产生任何高亮 mark
    expect(document.querySelectorAll("mark.matrix-search-highlight")).toHaveLength(0);
  });

  test("在表格中输入 ^Human 筛选前缀：HumanEval 命中并高亮 Human 前缀，MATH-500 被排除", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:S1"]}
        rows={rows}
      />
    );

    const searchInput = screen.getByPlaceholderText("筛选 Benchmark");
    fireEvent.change(searchInput, { target: { value: "^Human" } });
    act(() => {
      vi.advanceTimersByTime(300);
      vi.runAllTicks();
    });

    expect(screen.getByText("HumanEval")).toBeInTheDocument();
    expect(screen.queryByText("MATH-500")).not.toBeInTheDocument();

    const marks = document.querySelectorAll("mark.matrix-search-highlight");
    expect(marks.length).toBeGreaterThan(0);
    expect(Array.from(marks).some((m) => m.textContent === "Human")).toBe(true);
  });

  test("搜索语法帮助可展开、关闭，并展示关键语法", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:S1"]}
        rows={rows}
      />
    );

    const trigger = screen.getByRole("button", { name: "查看搜索语法" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: "搜索语法" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const dialog = screen.getByRole("dialog", { name: "搜索语法" });
    expect(dialog).toHaveTextContent("完全匹配");
    expect(dialog).toHaveTextContent("^GSM !internal");
    expect(dialog).toHaveTextContent("！internal");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "搜索语法" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test("在表格中输入 500$：只保留以 500 结尾的行，并高亮结尾片段", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:S1"]}
        rows={rows}
      />
    );

    const searchInput = screen.getByPlaceholderText("筛选 Benchmark");
    fireEvent.change(searchInput, { target: { value: "500$" } });
    act(() => {
      vi.advanceTimersByTime(300);
      vi.runAllTicks();
    });

    expect(screen.getByText("MATH-500")).toBeInTheDocument();
    expect(screen.queryByText("HumanEval")).not.toBeInTheDocument();

    const markTexts = Array.from(document.querySelectorAll("mark.matrix-search-highlight")).map(
      (mark) => mark.textContent
    );
    expect(markTexts).toContain("500");
  });

  test("引号短语按连续子串筛选，并整段高亮命中的单元格", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:S1"]}
        rows={rows}
      />
    );

    const searchInput = screen.getByPlaceholderText("筛选 Benchmark");
    fireEvent.change(searchInput, { target: { value: '"math-500"' } });
    act(() => {
      vi.advanceTimersByTime(300);
      vi.runAllTicks();
    });

    expect(screen.getByText("MATH-500")).toBeInTheDocument();
    expect(screen.queryByText("HumanEval")).not.toBeInTheDocument();

    const markTexts = Array.from(document.querySelectorAll("mark.matrix-search-highlight")).map(
      (mark) => mark.textContent
    );
    expect(markTexts).toEqual(["MATH-500"]);
  });

  test("benchmarkType 为空时按展示值 General 参与筛选与高亮", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:S1"]}
        rows={[
          {
            providerName: "OpenAI",
            modelName: "GPT-4o",
            benchmarkName: "custom-bench",
            benchmarkType: "",
            benchmarkCanonicalKey: "custom-bench:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:S1"
          }
        ]}
      />
    );

    const searchInput = screen.getByPlaceholderText("筛选 Benchmark");
    fireEvent.change(searchInput, { target: { value: "^general" } });
    act(() => {
      vi.advanceTimersByTime(300);
      vi.runAllTicks();
    });

    expect(screen.getByText("custom-bench")).toBeInTheDocument();

    const markTexts = Array.from(document.querySelectorAll("mark.matrix-search-highlight")).map(
      (mark) => mark.textContent
    );
    expect(markTexts).toContain("General");
  });
});
