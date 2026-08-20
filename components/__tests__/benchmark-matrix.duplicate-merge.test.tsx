import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderReady } from "@/tests/flush-microtasks";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { SHOW_SOURCE_VALUES_STORAGE_KEY } from "@/components/benchmark-matrix/constants";
import { BenchmarkMatrix } from "@/components/benchmark-matrix";

const mockSearchParams = new URLSearchParams();
const mockReplace = vi.fn((url?: string) => {
  for (const key of Array.from(mockSearchParams.keys())) {
    mockSearchParams.delete(key);
  }

  if (!url) return;

  const queryIndex = url.indexOf("?");
  if (queryIndex < 0) return;

  const nextParams = new URLSearchParams(url.slice(queryIndex + 1));
  nextParams.forEach((value, key) => {
    mockSearchParams.set(key, value);
  });
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: mockReplace
  }),
  useSearchParams: () => mockSearchParams
}));

const duplicateBenchmarkRows = [
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    benchmarkCanonicalKey: "mmlu-pro:knowledge",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "80",
    valueNum: 80,
    valueNote: null,
    source: "text:demo"
  },
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge123",
    benchmarkCanonicalKey: "mmlu-pro:knowledge123",
    benchTime: "2026-04-06T01:00:00.000Z",
    valueRaw: "82",
    valueNum: 82,
    valueNote: null,
    source: "text:demo"
  }
] as const;

const duplicateSourceRows = [
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    benchmarkCanonicalKey: "mmlu-pro:knowledge",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "80 raw",
    valueNum: 80,
    valueNote: null,
    source: "text:S1"
  },
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge123",
    benchmarkCanonicalKey: "mmlu-pro:knowledge123",
    benchTime: "2026-04-06T01:00:00.000Z",
    valueRaw: "82 raw",
    valueNum: 82,
    valueNote: null,
    source: "text:S2"
  }
] as const;

const duplicateSourceCompareRows = [
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    benchmarkCanonicalKey: "mmlu-pro:knowledge",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "80 raw",
    valueNum: 80,
    valueNote: null,
    source: "text:S1"
  },
  {
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge123",
    benchmarkCanonicalKey: "mmlu-pro:knowledge123",
    benchTime: "2026-04-06T01:00:00.000Z",
    valueRaw: "82 raw",
    valueNum: 82,
    valueNote: null,
    source: "text:S2"
  },
  {
    providerName: "OpenAI",
    modelName: "Model B",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    benchmarkCanonicalKey: "mmlu-pro:knowledge",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "76 raw",
    valueNum: 76,
    valueNote: null,
    source: "text:S1"
  },
  {
    providerName: "OpenAI",
    modelName: "Model B",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge123",
    benchmarkCanonicalKey: "mmlu-pro:knowledge123",
    benchTime: "2026-04-06T01:00:00.000Z",
    valueRaw: "78 raw",
    valueNum: 78,
    valueNote: null,
    source: "text:S2"
  }
] as const;

// 同一 source（S1）下两次导入，较新的一次分数更低；另有一个 source 作为对照
const repeatedSourceImportRows = [
  {
    recordId: 3,
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    benchmarkCanonicalKey: "mmlu-pro:knowledge",
    benchTime: "2026-06-01T00:00:00.000Z",
    valueRaw: "70",
    valueNum: 70,
    valueNote: null,
    source: "text:S2"
  },
  {
    recordId: 2,
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    benchmarkCanonicalKey: "mmlu-pro:knowledge",
    benchTime: "2026-05-01T00:00:00.000Z",
    valueRaw: "80",
    valueNum: 80,
    valueNote: null,
    source: "text:S1"
  },
  {
    recordId: 1,
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    benchmarkCanonicalKey: "mmlu-pro:knowledge",
    benchTime: "2026-04-01T00:00:00.000Z",
    valueRaw: "85",
    valueNum: 85,
    valueNote: null,
    source: "text:S1"
  }
] as const;

const medianDeltaRows = [
  {
    recordId: 4,
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    benchmarkCanonicalKey: "mmlu-pro:knowledge",
    benchTime: "2026-06-01T00:00:00.000Z",
    valueRaw: "60",
    valueNum: 60,
    valueNote: null,
    source: "text:S2"
  },
  {
    recordId: 3,
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    benchmarkCanonicalKey: "mmlu-pro:knowledge",
    benchTime: "2026-05-01T00:00:00.000Z",
    valueRaw: "75",
    valueNum: 75,
    valueNote: null,
    source: "text:S1"
  },
  {
    recordId: 2,
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    benchmarkCanonicalKey: "mmlu-pro:knowledge",
    benchTime: "2026-04-01T00:00:00.000Z",
    valueRaw: "80",
    valueNum: 80,
    valueNote: null,
    source: "text:S2"
  },
  {
    recordId: 1,
    providerName: "OpenAI",
    modelName: "Model A",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    benchmarkCanonicalKey: "mmlu-pro:knowledge",
    benchTime: "2026-03-01T00:00:00.000Z",
    valueRaw: "85",
    valueNum: 85,
    valueNote: null,
    source: "text:S1"
  }
] as const;

describe("BenchmarkMatrix 重名 benchmark 合并", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockReplace.mockClear();
    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  test("显示重名列默认关闭时，按 canonicalKey 冒号前缀合并重名 benchmark", async () => {
    await renderReady(<BenchmarkMatrix rows={[...duplicateBenchmarkRows]} />);

    expect(screen.getAllByText("MMLU-Pro")).toHaveLength(1);
    expect(screen.getByText("Knowledge / Knowledge123")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.queryByText("80")).not.toBeInTheDocument();
  });

  test("偶数条单值记录默认展示更优的中间值", async () => {
    await renderReady(
      <BenchmarkMatrix
        rows={[70, 80, 82, 100].map((value, index) => ({
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "MMLU-Pro",
          benchmarkType: `Knowledge${index}`,
          benchmarkCanonicalKey: `mmlu-pro:knowledge${index}`,
          benchTime: `2026-04-06T0${index}:00:00.000Z`,
          valueRaw: String(value),
          valueNum: value,
          valueNote: null,
          source: `text:S${index}`
        }))}
      />
    );

    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.queryByText("81")).not.toBeInTheDocument();
    expect(screen.queryByText("100")).not.toBeInTheDocument();
  });

  test("单双值混合时单元格展示中位数，双值只拿前值参与", async () => {
    await renderReady(
      <BenchmarkMatrix
        rows={[
          { value: 44, source: "text:Grok", benchTime: "2026-07-09T07:59:00.000Z" },
          { value: 46.2, source: "text:Kimi", benchTime: "2026-07-17T07:32:00.000Z" },
          { value: 54.9, source: "text:Macaron", benchTime: "2026-07-21T22:35:00.000Z" },
          {
            value: 46.2,
            valueNum2: 42.5,
            valueRaw: "46.2 / 42.5*",
            source: "text:Hy3",
            benchTime: "2026-07-06T20:38:00.000Z"
          }
        ].map((item, index) => ({
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "MMLU-Pro",
          benchmarkType: `Knowledge${index}`,
          benchmarkCanonicalKey: `mmlu-pro:knowledge${index}`,
          benchTime: item.benchTime,
          valueRaw: item.valueRaw ?? String(item.value),
          valueNum: item.value,
          valueNum2: item.valueNum2 ?? null,
          valueNote: null,
          source: item.source
        }))}
      />
    );

    expect(screen.getByText("46.2")).toBeInTheDocument();
    expect(screen.queryByText("54.9")).not.toBeInTheDocument();
  });

  test("开启显示重名列后，重名 benchmark 恢复为多行展示", async () => {
    await renderReady(<BenchmarkMatrix rows={[...duplicateBenchmarkRows]} />);

    fireEvent.click(screen.getByRole("button", { name: /显示重名行|显示重名列/ }));

    expect(screen.getAllByText("MMLU-Pro")).toHaveLength(2);
    expect(screen.queryByText("Knowledge / Knowledge123")).not.toBeInTheDocument();
    expect(screen.getByText("Knowledge")).toBeInTheDocument();
    expect(screen.getByText("Knowledge123")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
  });

  test("括号语义不同的 benchmark 不应被误合并", async () => {
    await renderReady(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "Model A",
            benchmarkName: "MMMU Pro (no tools)",
            benchmarkType: "Coding",
            benchmarkCanonicalKey: "mmmupro(notools):coding",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "76.9",
            valueNum: 76.9,
            valueNote: null,
            source: "text:demo"
          },
          {
            providerName: "OpenAI",
            modelName: "Model A",
            benchmarkName: "MMMU Pro (with tools)",
            benchmarkType: "Coding",
            benchmarkCanonicalKey: "mmmupro(withtools):coding",
            benchTime: "2026-04-06T01:00:00.000Z",
            valueRaw: "81.2",
            valueNum: 81.2,
            valueNote: null,
            source: "text:demo"
          }
        ]}
      />
    );

    expect(screen.getByText("MMMU Pro (no tools)")).toBeInTheDocument();
    expect(screen.getByText("MMMU Pro (with tools)")).toBeInTheDocument();
    expect(screen.getByText("76.9")).toBeInTheDocument();
    expect(screen.getByText("81.2")).toBeInTheDocument();
  });

  test("识别 @ 和 ^ 符号的语义差异，不应被误合并", async () => {
    await renderReady(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "Model A",
            benchmarkName: "Claw-Eval (Pass@3)",
            benchmarkType: "Coding",
            benchmarkCanonicalKey: "claw-eval(pass@3):coding",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "76.9",
            valueNum: 76.9,
            valueNote: null,
            source: "text:demo"
          },
          {
            providerName: "OpenAI",
            modelName: "Model A",
            benchmarkName: "Claw-Eval (Pass^3)",
            benchmarkType: "Coding",
            benchmarkCanonicalKey: "claw-eval(pass^3):coding",
            benchTime: "2026-04-06T01:00:00.000Z",
            valueRaw: "81.2",
            valueNum: 81.2,
            valueNote: null,
            source: "text:demo"
          }
        ]}
      />
    );

    expect(screen.getByText("Claw-Eval (Pass@3)")).toBeInTheDocument();
    expect(screen.getByText("Claw-Eval (Pass^3)")).toBeInTheDocument();
    expect(screen.getByText("76.9")).toBeInTheDocument();
    expect(screen.getByText("81.2")).toBeInTheDocument();
  });

  test("全部页签不显示 Source 原值开关，切换到具体 source 后才显示", async () => {
    const user = userEvent.setup();

    await renderReady(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

    expect(screen.queryByRole("button", { name: "显示原始值" })).not.toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.queryByTitle("text:S1: 80 raw")).not.toBeInTheDocument();
    expect(screen.queryByTitle("text:S2: 82 raw")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "S1" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });
  });

  test("开启 Source 原值后，合并单元格展示当前 source 的原始值", async () => {
    const user = userEvent.setup();

    await renderReady(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    const mergedCell = screen.getByText("82").closest("td")!;

    await user.click(screen.getByRole("button", { name: "显示原始值" }));

    expect(screen.getByText("80")).toBeInTheDocument();
    expect(mergedCell).toHaveTextContent("80");

    await user.click(screen.getByRole("tab", { name: "S2" }));

    expect(screen.getByText("82")).toBeInTheDocument();
    expect(mergedCell).toHaveTextContent("82");
  });

  test("同一 source 多次导入时，原始值取最新一次而非该 source 的最优值", async () => {
    const user = userEvent.setup();

    await renderReady(<BenchmarkMatrix rows={[...repeatedSourceImportRows]} sourceOptions={["text:S1", "text:S2"]} />);

    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    // 三条记录 70、80、85 的默认聚合值是中间值 80
    expect(screen.getByText("80")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "显示原始值" }));

    // S1 最近一次导入是 80，历史更优的 85 不再顶替它
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.queryByText("85")).not.toBeInTheDocument();

    const mergedCell = screen.getByText("80").closest("td")!;
    fireEvent.click(screen.getByRole("button", { name: "显示原始值" }), { ctrlKey: true });

    const deltaBadge = mergedCell.querySelector('[data-source-delta-badge="1"]') as HTMLElement | null;
    expect(deltaBadge).toBeNull();
  });

  test("按住 Shift 点击原始值后，显示当前 source 多条记录中的最大值", async () => {
    const user = userEvent.setup();

    await renderReady(<BenchmarkMatrix rows={[...repeatedSourceImportRows]} sourceOptions={["text:S1", "text:S2"]} />);

    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "显示原始值" }), { shiftKey: true });

    expect(screen.getByRole("button", { name: "显示最大值" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "显示最大值" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.queryByText("80")).not.toBeInTheDocument();
  });

  test("开启原始值后，同 source 多条记录仍保留问号与 tooltip", async () => {
    const user = userEvent.setup();

    await renderReady(<BenchmarkMatrix rows={[...medianDeltaRows]} sourceOptions={["text:S1", "text:S2"]} />);

    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "显示原始值" }));

    const mergedCell = screen.getByText("75").closest("td")!;
    const questionMark = within(mergedCell).getByText("?");

    fireEvent.mouseEnter(questionMark);

    const tooltipBox = (await screen.findByText("存在多条记录")).parentElement!;
    expect(tooltipBox).toHaveTextContent("85");
    expect(tooltipBox).toHaveTextContent("text:S1");
    // 开启原始值后 tooltip 收敛到当前 source，不再列出 S2 的记录
    expect(tooltipBox).not.toHaveTextContent("text:S2");
    expect(tooltipBox).not.toHaveTextContent("60");

    // 差值徽标与问号共用单元格右侧同一位置，徽标出现时问号让位
    fireEvent.mouseLeave(questionMark);
    fireEvent.click(screen.getByRole("button", { name: "显示原始值" }), { ctrlKey: true });

    expect(mergedCell.querySelector('[data-source-delta-badge="1"]')).not.toBeNull();
    expect(within(mergedCell).queryByText("?")).not.toBeInTheDocument();
  });

  test("开启原始值后，当前 source 只有一条记录时不显示问号", async () => {
    const user = userEvent.setup();

    await renderReady(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

    // 关闭原始值时跨 source 存在多个取值，问号可见
    const defaultCell = screen.getByText("82").closest("td")!;
    expect(within(defaultCell).getByText("?")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "显示原始值" }));

    // S1 下只有一条记录，展示的就是它本身，无需提示
    const sourceCell = screen.getByText("80").closest("td")!;
    expect(within(sourceCell).queryByText("?")).not.toBeInTheDocument();
  });

  test("开启 Source 原值后，双值单元格仍按解析后的数值对分段展示", async () => {
    const user = userEvent.setup();

    await renderReady(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "Model A",
            benchmarkName: "Pair Bench",
            benchmarkType: "Reasoning",
            benchmarkCanonicalKey: "pair-bench:reasoning",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "22 / 33",
            valueNum: 22,
            valueNum2: 33,
            valueNote: null,
            source: "text:S1"
          },
          {
            providerName: "OpenAI",
            modelName: "Model A",
            benchmarkName: "Pair Bench",
            benchmarkType: "Reasoning",
            benchmarkCanonicalKey: "pair-bench:reasoning",
            benchTime: "2026-04-06T01:00:00.000Z",
            valueRaw: "44 / 55",
            valueNum: 44,
            valueNum2: 55,
            valueNote: null,
            source: "text:S2"
          }
        ]}
        sourceOptions={["text:S1", "text:S2"]}
      />
    );

    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "显示原始值" }));

    const valueCell = screen.getByText("22").closest("td");
    expect(valueCell).not.toBeNull();
    expect(valueCell).toHaveTextContent("22/33");
    expect(screen.getByText("33")).toBeInTheDocument();
  });

  test("Source 差值徽标仅在修饰键点击时出现，且方向和文案与底层数值一致", async () => {
    const user = userEvent.setup();

    await renderReady(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "显示原始值" }));

    const mergedCell = screen.getByText("80").closest("td")!;
    expect(mergedCell.querySelector('[data-source-delta-badge="1"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "显示原始值" }), { ctrlKey: true });

    const sourceDeltaBadge = mergedCell.querySelector('[data-source-delta-badge="1"]') as HTMLElement | null;
    expect(sourceDeltaBadge).not.toBeNull();
    expect(sourceDeltaBadge).toHaveAttribute("data-compare-direction", "down");
    expect(sourceDeltaBadge).toHaveAttribute("title", "相对表格默认取值的差值");
    expect(sourceDeltaBadge).toHaveTextContent("▼2");

    await user.click(screen.getByRole("tab", { name: "S2" }));

    expect(mergedCell.querySelector('[data-source-delta-badge="1"]')).toBeNull();
    expect(mergedCell).toHaveTextContent("82");
  });

  test("Compare 模式下 compare 徽标优先于 source 差值徽标，且不会重复显示", async () => {
    const user = userEvent.setup();

    await renderReady(<BenchmarkMatrix rows={[...duplicateSourceCompareRows]} sourceOptions={["text:S1", "text:S2"]} />);

    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "显示原始值" }));
    fireEvent.click(screen.getByRole("button", { name: "显示原始值" }), { ctrlKey: true });

    const modelBCell = screen.getByText("76").closest("td")!;
    expect(modelBCell.querySelector('[data-source-delta-badge="1"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("columnheader", { name: /Model A/ }), { ctrlKey: true });
    fireEvent.click(screen.getByRole("columnheader", { name: /Model B/ }), { ctrlKey: true });

    const compareBadge = modelBCell.querySelector('[data-compare-delta-badge="1"]') as HTMLElement | null;
    expect(compareBadge).not.toBeNull();
    expect(compareBadge).toHaveAttribute("data-compare-direction", "down");
    expect(compareBadge).toHaveAttribute("title", "相对基准 Model A 的差值");
    expect(compareBadge).toHaveTextContent("▼4");
    expect(modelBCell.querySelector('[data-source-delta-badge="1"]')).toBeNull();
  });

  test("关闭 Source 原值后恢复默认聚合值展示", async () => {
    const user = userEvent.setup();

    await renderReady(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    const toggle = screen.getByRole("button", { name: "显示原始值" });
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.queryByTitle("text:S1: 80 raw")).not.toBeInTheDocument();
    expect(screen.queryByTitle("text:S2: 82 raw")).not.toBeInTheDocument();
  });

  test("切回全部页签后隐藏 Source 原值开关", async () => {
    const user = userEvent.setup();

    await renderReady(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: "All" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "显示原始值" })).not.toBeInTheDocument();
    });
  });

  test("没有 source 数据时不显示原始值按钮", async () => {
    await renderReady(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "Model A",
            benchmarkName: "MMLU-Pro",
            benchmarkType: "Knowledge",
            benchmarkCanonicalKey: "mmlu-pro:knowledge",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: null
          }
        ]}
      />
    );

    expect(screen.queryByRole("button", { name: "显示原始值" })).not.toBeInTheDocument();
  });

  test("Ctrl+点击 Source 原值按钮会开启差值视图并显示 delta 徽标", async () => {
    const user = userEvent.setup();
    await renderReady(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

    // 切换到 S1 页签以显示按钮
    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    const button = screen.getByRole("button", { name: "显示原始值" });

    // 使用 Ctrl+点击 开启差值视图
    fireEvent.click(button, { ctrlKey: true });

    // 断言：差值徽标出现 (S1 值为 80，默认值为 82，差值为 -2，显示为 ▼2)
    const mergedCell = screen.getByText("80").closest("td")!;
    const sourceDeltaBadge = mergedCell.querySelector('[data-source-delta-badge="1"]') as HTMLElement | null;
    expect(sourceDeltaBadge).not.toBeNull();
    expect(sourceDeltaBadge).toHaveTextContent("▼2");
  });

  test("从 localStorage 中读取 Source 原值设置", async () => {
    const user = userEvent.setup();
    // 预先将开关状态写入 localStorage
    window.localStorage.setItem(SHOW_SOURCE_VALUES_STORAGE_KEY, "1");

    await renderReady(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

    // 两条记录取更优侧的中间值，越大越优所以是 82
    expect(screen.getByText("82")).toBeInTheDocument();

    // 切换到 S1 页签
    await user.click(screen.getByRole("tab", { name: "S1" }));

    // 因为开启了 Source 原值，所以应该直接显示 S1 的原始值 80
    await waitFor(() => {
      expect(screen.getByText("80")).toBeInTheDocument();
    });
    const mergedCell = screen.getByText("80").closest("td")!;
    expect(mergedCell).toHaveTextContent("80");
  });

  test("切换 Source 原值按钮会将设置持久化到 localStorage", async () => {
    const user = userEvent.setup();
    // 初始为关闭状态
    window.localStorage.setItem(SHOW_SOURCE_VALUES_STORAGE_KEY, "0");

    await renderReady(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

    // 切换到 S1 页签以显示按钮
    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    const button = screen.getByRole("button", { name: "显示原始值" });

    // 点击一次：打开
    await user.click(button);
    await waitFor(() => {
      expect(window.localStorage.getItem(SHOW_SOURCE_VALUES_STORAGE_KEY)).toBe("1");
    });

    // 再点击一次：关闭
    await user.click(button);
    await waitFor(() => {
      expect(window.localStorage.getItem(SHOW_SOURCE_VALUES_STORAGE_KEY)).toBe("0");
    });
  });

  test("higherIsBetter=false 时取更优侧的中位数，并按该基线计算 source delta", async () => {
    const user = userEvent.setup();

    // 注意：benchmarkType 不能用 "Performance"，「全部」页签下该分类会被覆盖率裁剪整行剔除，
    // 三条记录就凑不齐了
    const lowerIsBetterRows = [
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Latency",
        benchmarkType: "Performance1",
        benchmarkCanonicalKey: "latency:performance1",
        benchTime: "2026-04-06T00:00:00.000Z",
        valueRaw: "120 ms",
        valueNum: 120,
        valueNote: null,
        source: "text:S1",
        higherIsBetter: false
      },
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Latency",
        benchmarkType: "Performance2",
        benchmarkCanonicalKey: "latency:performance2",
        benchTime: "2026-04-06T01:00:00.000Z",
        valueRaw: "95 ms",
        valueNum: 95,
        valueNote: null,
        source: "text:S1",
        higherIsBetter: false
      },
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Latency",
        benchmarkType: "Performance3",
        benchmarkCanonicalKey: "latency:performance3",
        benchTime: "2026-04-06T02:00:00.000Z",
        valueRaw: "150 ms",
        valueNum: 150,
        valueNote: null,
        source: "text:S2",
        higherIsBetter: false
      }
    ] as const;

    const { container } = await renderReady(
      <BenchmarkMatrix
        rows={[...lowerIsBetterRows]}
        sourceOptions={["text:S1", "text:S2"]}
      />
    );

    // 奇数条时方向不影响取值：95、120、150 的中位数为 120
    const defaultCell = container.querySelector('td[data-model-name="Model A"]');
    expect(defaultCell).not.toBeNull();
    expect(defaultCell).toHaveTextContent("120");

    // 切换到 S1 页签
    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    // 开启 Source 原值
    await user.click(screen.getByRole("button", { name: "显示原始值" }));

    // Source 原值仍保持现有策略：S1 最新一条为 95
    const mergedCell = screen.getByText("95").closest("td")!;
    expect(mergedCell).toHaveTextContent("95");

    // 用 Ctrl+点击开启差值视图
    fireEvent.click(screen.getByRole("button", { name: "显示原始值" }), { ctrlKey: true });

    // 默认聚合值为 120，S1 原值 95 的差值为 -25
    const s1DeltaBadge = mergedCell.querySelector('[data-source-delta-badge="1"]');
    expect(s1DeltaBadge).not.toBeNull();
    expect(s1DeltaBadge).toHaveAttribute("data-compare-direction", "down");
    expect(s1DeltaBadge).toHaveTextContent("▼25");

    // 切换到 S2 页签 (S2 只有一个 entry: 150 ms)
    await user.click(screen.getByRole("tab", { name: "S2" }));

    // S2 应该显示 150
    expect(screen.getByText("150")).toBeInTheDocument();
    const mergedCellS2 = screen.getByText("150").closest("td")!;

    // S2 值为 150 ms，默认聚合值为 120，差值是 30
    const sourceDeltaBadge = mergedCellS2.querySelector('[data-source-delta-badge="1"]') as HTMLElement | null;
    expect(sourceDeltaBadge).not.toBeNull();
    expect(sourceDeltaBadge).toHaveAttribute("data-compare-direction", "up");
    expect(sourceDeltaBadge).toHaveTextContent("▲30");
  });
});
