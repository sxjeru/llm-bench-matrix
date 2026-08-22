import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { renderReady } from "@/tests/flush-microtasks";

const mockSearchParams = new URLSearchParams();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: mockReplace
  }),
  useSearchParams: () => mockSearchParams
}));

vi.mock("html2canvas-pro", () => {
  return {
    default: (_element: unknown, options?: { onclone?: (doc: Document) => void }) => {
      if (options && typeof options.onclone === "function") {
        options.onclone(document);
      }
      const canvas = document.createElement("canvas");
      canvas.toBlob = (callback) => {
        if (callback) {
          callback(new Blob([], { type: "image/png" }));
        }
      };
      return Promise.resolve(canvas);
    }
  };
});

const rows = [
  // Bench-High (all 5 models have it, coverage = 100%)
  { providerName: "OpenAI", modelName: "Model A", benchmarkName: "Bench-High", benchmarkType: "General", benchmarkCanonicalKey: "bench-high:general", benchTime: "2026-04-06T00:00:00.000Z", valueRaw: "90", valueNum: 90, valueNote: null, source: "text:S1" },
  { providerName: "OpenAI", modelName: "Model B", benchmarkName: "Bench-High", benchmarkType: "General", benchmarkCanonicalKey: "bench-high:general", benchTime: "2026-04-06T00:00:00.000Z", valueRaw: "90", valueNum: 90, valueNote: null, source: "text:S1" },
  { providerName: "OpenAI", modelName: "Model C", benchmarkName: "Bench-High", benchmarkType: "General", benchmarkCanonicalKey: "bench-high:general", benchTime: "2026-04-06T00:00:00.000Z", valueRaw: "90", valueNum: 90, valueNote: null, source: "text:S1" },
  { providerName: "OpenAI", modelName: "Model D", benchmarkName: "Bench-High", benchmarkType: "General", benchmarkCanonicalKey: "bench-high:general", benchTime: "2026-04-06T00:00:00.000Z", valueRaw: "90", valueNum: 90, valueNote: null, source: "text:S1" },
  { providerName: "OpenAI", modelName: "Model E", benchmarkName: "Bench-High", benchmarkType: "General", benchmarkCanonicalKey: "bench-high:general", benchTime: "2026-04-06T00:00:00.000Z", valueRaw: "90", valueNum: 90, valueNote: null, source: "text:S1" },

  // Bench-Low (only 1 model has it, coverage = 20%)
  { providerName: "OpenAI", modelName: "Model A", benchmarkName: "Bench-Low", benchmarkType: "General", benchmarkCanonicalKey: "bench-low:general", benchTime: "2026-04-06T00:00:00.000Z", valueRaw: "50", valueNum: 50, valueNote: null, source: "text:S1" }
] as const;

async function renderMatrix() {
  return renderReady(
    <BenchmarkMatrix
      sourceOptions={["text:S1"]}
      rows={[...rows]}
    />
  );
}

describe("BenchmarkMatrix 搜索筛选与低覆盖率状态恢复", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockReplace.mockClear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("输入搜索关键字会过滤行，并在搜索时自动启用显示低覆盖率行，搜索清除后恢复原始隐藏状态", async () => {
    await renderMatrix();

    // 默认 showLowCoverageRows 为 false，全部视图下 Bench-Low (20% coverage) 应该被隐藏
    expect(screen.queryByText("Bench-Low")).not.toBeInTheDocument();
    expect(screen.getByText("Bench-High")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText("筛选 Benchmark");
    
    // 输入 Bench-Low
    fireEvent.change(searchInput, { target: { value: "Bench-Low" } });

    // 300ms 后触发搜索，并且应该启用 showLowCoverageRows
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      vi.runAllTicks();
    });

    // 此时 Bench-Low 应该被过滤出来并显示
    expect(screen.getByText("Bench-Low")).toBeInTheDocument();
    expect(screen.queryByText("Bench-High")).not.toBeInTheDocument();

    // 点击清除按钮
    const clearButton = screen.getByLabelText("清除搜索");
    fireEvent.click(clearButton);

    // 立即清除后，低覆盖率行重新被隐藏 (恢复为 false)
    expect(screen.queryByText("Bench-Low")).not.toBeInTheDocument();
    expect(screen.getByText("Bench-High")).toBeInTheDocument();
  });

  test("若搜索前低覆盖行已经是显示状态，搜索结束后应当保持显示", async () => {
    await renderMatrix();

    // 展开并手动勾选“显示低覆盖行”
    const toggleButton = screen.getByRole("button", { name: "显示低覆盖行" });
    fireEvent.click(toggleButton);

    // 此时 Bench-Low 应该出现
    expect(screen.getByText("Bench-Low")).toBeInTheDocument();
    expect(screen.getByText("Bench-High")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText("筛选 Benchmark");
    fireEvent.change(searchInput, { target: { value: "Bench-Low" } });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      vi.runAllTicks();
    });

    expect(screen.getByText("Bench-Low")).toBeInTheDocument();
    expect(screen.queryByText("Bench-High")).not.toBeInTheDocument();

    // 清除搜索
    const clearButton = screen.getByLabelText("清除搜索");
    fireEvent.click(clearButton);

    // 搜索结束后仍应保持显示低覆盖行，即 Bench-Low 应该存在（没有被过滤，但由于没有搜索词所以两者都显示）
    expect(screen.getByText("Bench-Low")).toBeInTheDocument();
    expect(screen.getByText("Bench-High")).toBeInTheDocument();
  });

  test("若输入包含单引号 ('), 不触发搜索", async () => {
    await renderMatrix();

    const searchInput = screen.getByPlaceholderText("筛选 Benchmark");
    fireEvent.change(searchInput, { target: { value: "Bench'" } });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      vi.runAllTicks();
    });

    // 包含单引号，不应触发搜索过滤 (Bench-High 仍然存在)
    expect(screen.getByText("Bench-High")).toBeInTheDocument();
    expect(screen.queryByText("Bench-Low")).not.toBeInTheDocument();
  });

  test("在搜索中手动修改低覆盖状态，清除搜索后应保持手动修改后的状态", async () => {
    await renderMatrix();

    // 初始：隐藏低覆盖行 (Bench-Low 不存在)
    expect(screen.queryByText("Bench-Low")).not.toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText("筛选 Benchmark");
    fireEvent.change(searchInput, { target: { value: "Bench" } });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      vi.runAllTicks();
    });

    // 搜索启动，开启低覆盖，两者都匹配且显示
    expect(screen.getByText("Bench-Low")).toBeInTheDocument();
    expect(screen.getByText("Bench-High")).toBeInTheDocument();

    // 搜索时手动将低覆盖行隐藏
    const toggleButton = screen.getByRole("button", { name: "隐藏低覆盖行" });
    fireEvent.click(toggleButton);

    // 此时 Bench-Low 应该消失
    expect(screen.queryByText("Bench-Low")).not.toBeInTheDocument();

    // 清除搜索
    const clearButton = screen.getByLabelText("清除搜索");
    fireEvent.click(clearButton);

    // 恢复后由于被手动修改为隐藏，Bench-Low 仍保持隐藏
    expect(screen.queryByText("Bench-Low")).not.toBeInTheDocument();
    expect(screen.getByText("Bench-High")).toBeInTheDocument();
  });

  test("脚注占位符替换：当前日期 {time} 格式为 YYYY-MM-DD，source 最后更新日期 {source_time} 正确计算并替换", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-06T12:00:00.000Z"));

    const customRows = [
      { providerName: "OpenAI", modelName: "Model A", benchmarkName: "Bench-1", benchmarkType: "General", benchmarkCanonicalKey: "bench-1:general", benchTime: "2026-01-10T00:00:00.000Z", valueRaw: "90", valueNum: 90, valueNote: null, source: "text:S1" },
      { providerName: "OpenAI", modelName: "Model A", benchmarkName: "Bench-2", benchmarkType: "General", benchmarkCanonicalKey: "bench-2:general", benchTime: "2026-01-20T00:00:00.000Z", valueRaw: "80", valueNum: 80, valueNote: null, source: "text:S1" },
      { providerName: "OpenAI", modelName: "Model A", benchmarkName: "Bench-3", benchmarkType: "General", benchmarkCanonicalKey: "bench-3:general", benchTime: "2026-01-15T00:00:00.000Z", valueRaw: "70", valueNum: 70, valueNote: null, source: "text:S2" }
    ] as const;

    const footnoteText = "制表时间：{time} | 数据更新时间：{source_time} | 数据源：{data_source} | 原始：{origin_source}";
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:S1", "text:S2"]}
        rows={[...customRows]}
        exportFootnoteText={footnoteText}
      />
    );

    const readExportFootnote = () => document.querySelector('[data-export-footnote-element="true"]')?.textContent ?? "";
    const exportButton = screen.getByRole("button", { name: "导出图片" });
    fireEvent.click(exportButton);

    // 默认是全部页签，因此数据源占位符是“全数据源”，原始数据源是 __ALL__
    expect(readExportFootnote()).toBe("制表时间：2026-06-06 | 数据更新时间：2026-01-20 | 数据源：全数据源 | 原始：__ALL__");
    await waitFor(() => {
      expect(exportButton).not.toBeDisabled();
    });

    // 切换到 S2 页签
    const s2Tab = screen.getByRole("tab", { name: "S2" });
    fireEvent.click(s2Tab);

    // 再次点击导出
    fireEvent.click(exportButton);

    // 切换后，数据更新日期应该是 S2 的最大更新日期 2026-01-15，数据源是 S2，原始数据源是 text:S2
    expect(readExportFootnote()).toBe("制表时间：2026-06-06 | 数据更新时间：2026-01-15 | 数据源：S2 | 原始：text:S2");
  });
});
