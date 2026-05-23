import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

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

describe("BenchmarkMatrix 重名 benchmark 合并", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockReplace.mockClear();
    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  test("显示重名列默认关闭时，按 canonicalKey 冒号前缀合并重名 benchmark", () => {
    render(<BenchmarkMatrix rows={[...duplicateBenchmarkRows]} />);

    expect(screen.getAllByText("MMLU-Pro")).toHaveLength(1);
    expect(screen.getByText("Knowledge / Knowledge123")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.queryByText("80")).not.toBeInTheDocument();
  });

  test("开启显示重名列后，重名 benchmark 恢复为多行展示", () => {
    render(<BenchmarkMatrix rows={[...duplicateBenchmarkRows]} />);

    fireEvent.click(screen.getByRole("button", { name: /显示重名行|显示重名列/ }));

    expect(screen.getAllByText("MMLU-Pro")).toHaveLength(2);
    expect(screen.queryByText("Knowledge / Knowledge123")).not.toBeInTheDocument();
    expect(screen.getByText("Knowledge")).toBeInTheDocument();
    expect(screen.getByText("Knowledge123")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
  });

  test("括号语义不同的 benchmark 不应被误合并", () => {
    render(
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

  test("全部页签不显示 Source 原值开关，切换到具体 source 后才显示", async () => {
    const user = userEvent.setup();

    render(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

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

    render(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

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

  test("Source 差值徽标仅在修饰键点击时出现，且方向和文案与底层数值一致", async () => {
    const user = userEvent.setup();

    render(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

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

    render(<BenchmarkMatrix rows={[...duplicateSourceCompareRows]} sourceOptions={["text:S1", "text:S2"]} />);

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

  test("关闭 Source 原值后恢复最大值展示", async () => {
    const user = userEvent.setup();

    render(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

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

    render(<BenchmarkMatrix rows={[...duplicateSourceRows]} sourceOptions={["text:S1", "text:S2"]} />);

    await user.click(screen.getByRole("tab", { name: "S1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "显示原始值" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: "全部" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "显示原始值" })).not.toBeInTheDocument();
    });
  });

  test("没有 source 数据时不显示原始值按钮", () => {
    render(
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
});
