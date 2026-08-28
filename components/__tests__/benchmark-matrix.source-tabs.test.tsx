import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { flushQueuedStateUpdates, renderReady } from "@/tests/flush-microtasks";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { formatTooltipTime } from "@/components/benchmark-matrix/formatters";
import { HOME_PATH, SCATTER_PATH } from "@/lib/public-routes";
import * as selectors from "@/components/benchmark-matrix/selectors";

const mockSearchParams = new URLSearchParams();
const pathnameState = vi.hoisted(() => ({ value: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.value,
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => mockSearchParams
}));

describe("BenchmarkMatrix source tabs", () => {
  beforeEach(() => {
    pathnameState.value = HOME_PATH;
    window.history.replaceState(null, "", HOME_PATH);
    window.localStorage.clear();
    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  test("切换 source 仅更新浏览器地址，不发起路由导航", async () => {
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:Claude Opus 4.7"]}
        rows={[
          {
            providerName: "Anthropic",
            modelName: "Claude Opus 4.7",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            source: "text:Claude Opus 4.7"
          }
        ]}
      />
    );

    replaceStateSpy.mockClear();
    fireEvent.click(screen.getByRole("tab", { name: "Claude Opus 4.7" }));

    await waitFor(() => {
      expect(replaceStateSpy).toHaveBeenCalledWith(
        null,
        "",
        "/?source=text%3AClaude+Opus+4.7"
      );
    });
  });

  test("urlSyncEnabled=false 时仍切换页签，但不改写地址栏", async () => {
    pathnameState.value = SCATTER_PATH;
    window.history.replaceState(null, "", SCATTER_PATH);
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    await renderReady(
      <BenchmarkMatrix
        urlSyncEnabled={false}
        sourceOptions={["text:Claude Opus 4.7"]}
        rows={[
          {
            providerName: "Anthropic",
            modelName: "Claude Opus 4.7",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            source: "text:Claude Opus 4.7"
          }
        ]}
      />
    );

    replaceStateSpy.mockClear();
    fireEvent.click(screen.getByRole("tab", { name: "Claude Opus 4.7" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Claude Opus 4.7" })).toHaveAttribute("aria-selected", "true");
    });
    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(SCATTER_PATH);
  });

  test("非首页默认仍同步 source 到当前路径", async () => {
    pathnameState.value = "/admin";
    window.history.replaceState(null, "", "/admin");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:Claude Opus 4.7"]}
        rows={[
          {
            providerName: "Anthropic",
            modelName: "Claude Opus 4.7",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            source: "text:Claude Opus 4.7"
          }
        ]}
      />
    );

    replaceStateSpy.mockClear();
    fireEvent.click(screen.getByRole("tab", { name: "Claude Opus 4.7" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Claude Opus 4.7" })).toHaveAttribute("aria-selected", "true");
      expect(replaceStateSpy).toHaveBeenCalledWith(
        null,
        "",
        "/admin?source=text%3AClaude+Opus+4.7"
      );
    });
  });

  test("同系列 source 页签按新版本优先排序（如 Qwen3.6 在 Qwen3.5 前，Claude Sonnet 5 在 Opus 4.8 前）", async () => {
    const benchTime = "2026-04-06T00:00:00.000Z";
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={[
          "text:Qwen3.5",
          "text:Qwen3.6",
          "text:Qwen3.4",
          "text:Gemini-2.5-Pro",
          "text:Claude Opus 4.7",
          "text:Claude Opus 4.8",
          "text:Claude Sonnet 5"
        ]}
        rows={[
          {
            providerName: "Qwen",
            modelName: "Qwen Model",
            benchmarkName: "Bench-Q",
            benchmarkType: "General",
            benchTime,
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Qwen3.5"
          },
          {
            providerName: "Qwen",
            modelName: "Qwen Model 3.6",
            benchmarkName: "Bench-Q",
            benchmarkType: "General",
            benchTime,
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Qwen3.6"
          },
          {
            providerName: "Qwen",
            modelName: "Qwen Model 3.4",
            benchmarkName: "Bench-Q",
            benchmarkType: "General",
            benchTime,
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Qwen3.4"
          }
        ]}
      />
    );

    const qwenTabs = screen
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.trim() ?? "")
      .filter((label) => label.startsWith("Qwen3."));

    expect(qwenTabs).toEqual(["Qwen3.6", "Qwen3.5", "Qwen3.4"]);

    const claudeTabs = screen
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.trim() ?? "")
      .filter((label) => label.startsWith("Claude"));

    expect(claudeTabs).toEqual(["Claude Sonnet 5", "Claude Opus 4.8", "Claude Opus 4.7"]);
  });

  test("同系列 source 页签中带版本的 Muse Spark 1.1 排在无版本 Muse Spark 前面", async () => {
    const benchTime = "2026-04-06T00:00:00.000Z";
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={[
          "text:Muse Spark",
          "text:Muse Spark Thinking",
          "text:Muse Spark 1.1"
        ]}
        rows={[
          {
            providerName: "Muse",
            modelName: "Muse Spark",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime,
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Muse Spark"
          },
          {
            providerName: "Muse",
            modelName: "Muse Spark 1.1",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime,
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Muse Spark 1.1"
          },
          {
            providerName: "Muse",
            modelName: "Muse Spark Thinking",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime,
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Muse Spark Thinking"
          }
        ]}
      />
    );

    const museTabs = screen
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.trim() ?? "")
      .filter((label) => label.startsWith("Muse Spark"));

    expect(museTabs).toEqual(["Muse Spark 1.1", "Muse Spark", "Muse Spark Thinking"]);
  });

  test("Nemotron 组内页签按 ultra > super > nano 顺序排序", async () => {
    const benchTime = "2026-04-06T00:00:00.000Z";
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={[
          "text:Nemotron 3 Nano",
          "text:Nemotron 3 Ultra",
          "text:Nemotron 3 Super"
        ]}
        rows={[
          {
            providerName: "NVIDIA",
            modelName: "Nemotron 3 Nano",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime,
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Nemotron 3 Nano"
          },
          {
            providerName: "NVIDIA",
            modelName: "Nemotron 3 Ultra",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime,
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Nemotron 3 Ultra"
          },
          {
            providerName: "NVIDIA",
            modelName: "Nemotron 3 Super",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime,
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Nemotron 3 Super"
          }
        ]}
      />
    );

    const nemotronTabs = screen
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.trim() ?? "")
      .filter((label) => label.startsWith("Nemotron 3"));

    expect(nemotronTabs).toEqual(["Nemotron 3 Ultra", "Nemotron 3 Super", "Nemotron 3 Nano"]);
  });

  test("同版本 source 页签按 xxB 大小降序排序", async () => {
    const benchTime = "2026-04-06T00:00:00.000Z";
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={[
          "text:Ornith-1.0-9B",
          "text:Ornith-1.0-27B",
          "text:Ornith-1.0-3B"
        ]}
        rows={[
          {
            providerName: "Ornith",
            modelName: "Ornith-1.0-9B",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime,
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Ornith-1.0-9B"
          },
          {
            providerName: "Ornith",
            modelName: "Ornith-1.0-27B",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime,
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Ornith-1.0-27B"
          },
          {
            providerName: "Ornith",
            modelName: "Ornith-1.0-3B",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime,
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Ornith-1.0-3B"
          }
        ]}
      />
    );

    const ornithTabs = screen
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.trim() ?? "")
      .filter((label) => label.startsWith("Ornith-1.0"));

    expect(ornithTabs).toEqual(["Ornith-1.0-27B", "Ornith-1.0-9B", "Ornith-1.0-3B"]);
  });

  test("source 页签文本使用 provider 颜色，首字符加粗，选中后恢复白色加粗", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:Claude Opus 4.7"]}
        rows={[
          {
            providerName: "Anthropic",
            providerBrandColor: "#f0f0f0",
            modelName: "Claude Opus 4.7",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Claude Opus 4.7"
          }
        ]}
      />
    );

    const sourceTab = screen.getByRole("tab", { name: "Claude Opus 4.7" });
    const coloredLabel = sourceTab.querySelector(".source-tab-label") as HTMLElement;
    const visibleText = sourceTab.querySelector(".source-tab-label-text");
    const firstCharacter = sourceTab.querySelector("span.font-bold");

    expect(sourceTab.parentElement).toHaveClass("tabs");
    expect(coloredLabel).toHaveTextContent("Claude Opus 4.7");
    expect(coloredLabel).toHaveClass("text-sm");
    expect(coloredLabel).toHaveStyle({ color: "rgb(240, 240, 240)" });
    expect(visibleText).toHaveClass("font-medium");
    expect(firstCharacter).toHaveTextContent("C");

    fireEvent.click(sourceTab);

    await waitFor(() => {
      expect(sourceTab).toHaveClass("tab-active");
    });

    expect(coloredLabel.style.color).toBe("");
    expect(visibleText).toHaveClass("font-bold");
  });

  test("未配置自定义 provider 颜色的 source 页签不使用 fallback 颜色", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:Claude Opus 4.7"]}
        rows={[
          {
            providerName: "Anthropic",
            modelName: "Claude Opus 4.7",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Claude Opus 4.7"
          }
        ]}
      />
    );

    const sourceTab = screen.getByRole("tab", { name: "Claude Opus 4.7" });
    const label = sourceTab.querySelector(".source-tab-label") as HTMLElement;

    expect(label.style.color).toBe("");
  });

  test("同一模型重复多行不改变页签配色，且同 rank 取先出现的那行", async () => {
    // 配色候选按 (modelName, provider, brandColor, sourceKey) 去重后再匹配。
    // 这里让同一组合重复 200 行，并在后面放一个同 rank 的竞争者：
    // 去重必须保持首次出现的顺序，否则先遇到的那行就不再胜出。
    const repeated = Array.from({ length: 200 }, (_, index) => ({
      providerName: "Anthropic",
      providerDisplayName: "Anthropic",
      providerBrandColor: "#f0f0f0",
      modelName: "Claude Opus 4.7",
      benchmarkName: `Bench-${index}`,
      benchmarkType: "General",
      benchTime: "2026-04-06T00:00:00.000Z",
      valueRaw: "80",
      valueNum: 80,
      valueNote: null,
      source: "text:Claude Opus 4.7"
    }));

    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:Claude Opus 4.7"]}
        rows={[
          ...repeated,
          {
            providerName: "Anthropic",
            providerDisplayName: "Anthropic Later",
            providerBrandColor: "#0a0a0a",
            modelName: "Claude Opus 4.7 Extra",
            benchmarkName: "Bench-late",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "81",
            valueNum: 81,
            valueNote: null,
            source: "text:Claude Opus 4.7"
          }
        ]}
      />
    );

    const sourceTab = screen.getByRole("tab", { name: "Claude Opus 4.7" });
    const coloredLabel = sourceTab.querySelector(".source-tab-label") as HTMLElement;

    expect(coloredLabel).toHaveStyle({ color: "rgb(240, 240, 240)" });
  });

  test("非全部 source 页签优先展示 source 同系列模型，再按系列覆盖率和模型名排序", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:Claude Opus 4.7"]}
        rows={[
          {
            providerName: "MiniMax",
            modelName: "MiniMax M2.7",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchmarkCanonicalKey: "bench-1:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "79",
            valueNum: 79,
            valueNote: null,
            source: "text:Claude Opus 4.7"
          },
          {
            providerName: "MiniMax",
            modelName: "MiniMax M2.7",
            benchmarkName: "Bench-2",
            benchmarkType: "General",
            benchmarkCanonicalKey: "bench-2:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Claude Opus 4.7"
          },
          {
            providerName: "Anthropic",
            modelName: "Claude Haiku 4.7",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchmarkCanonicalKey: "bench-1:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "70",
            valueNum: 70,
            valueNote: null,
            source: "text:Claude Opus 4.7"
          },
          {
            providerName: "Anthropic",
            modelName: "Claude Sonnet 4.6",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchmarkCanonicalKey: "bench-1:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Claude Opus 4.7"
          },
          {
            providerName: "Anthropic",
            modelName: "Claude Sonnet 4.7",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchmarkCanonicalKey: "bench-1:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "82",
            valueNum: 82,
            valueNote: null,
            source: "text:Claude Opus 4.7"
          },
          {
            providerName: "Anthropic",
            modelName: "Claude Opus 4.7",
            benchmarkName: "Bench-2",
            benchmarkType: "General",
            benchmarkCanonicalKey: "bench-2:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "87",
            valueNum: 87,
            valueNote: null,
            source: "text:Claude Opus 4.7"
          },
          {
            providerName: "GPT",
            modelName: "GPT-5.5",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchmarkCanonicalKey: "bench-1:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "85",
            valueNum: 85,
            valueNote: null,
            source: "text:Claude Opus 4.7"
          },
          {
            providerName: "GPT",
            modelName: "GPT-5.5",
            benchmarkName: "Bench-2",
            benchmarkType: "General",
            benchmarkCanonicalKey: "bench-2:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "86",
            valueNum: 86,
            valueNote: null,
            source: "text:Claude Opus 4.7"
          },
          {
            providerName: "GPT",
            modelName: "GPT-5.5",
            benchmarkName: "Bench-3",
            benchmarkType: "General",
            benchmarkCanonicalKey: "bench-3:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "87",
            valueNum: 87,
            valueNote: null,
            source: "text:Claude Opus 4.7"
          }
        ]}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Claude Opus 4.7" }));

    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent?.trim() ?? "")
      .filter((text) => [
        "Claude Opus 4.7",
        "Claude Sonnet 4.7",
        "Claude Haiku 4.7",
        "Claude Sonnet 4.6",
        "GPT-5.5",
        "MiniMax M2.7"
      ].includes(text));

    expect(headers).toEqual([
      "Claude Opus 4.7",
      "Claude Sonnet 4.7",
      "Claude Haiku 4.7",
      "Claude Sonnet 4.6",
      "GPT-5.5",
      "MiniMax M2.7"
    ]);
  });

  test("非全部 source 页签会把同模型家族放在一起", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:MiniMax M3"]}
        rows={[
          {
            providerName: "MiniMax",
            modelName: "MiniMax M3",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchmarkCanonicalKey: "bench-1:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "81",
            valueNum: 81,
            valueNote: null,
            source: "text:MiniMax M3"
          },
          {
            providerName: "Claude",
            modelName: "Claude Sonnet 4.6",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchmarkCanonicalKey: "bench-1:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:MiniMax M3"
          },
          {
            providerName: "Claude",
            modelName: "Claude Sonnet 4.6",
            benchmarkName: "Bench-2",
            benchmarkType: "General",
            benchmarkCanonicalKey: "bench-2:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "82",
            valueNum: 82,
            valueNote: null,
            source: "text:MiniMax M3"
          },
          {
            providerName: "MiniMax",
            modelName: "MiniMax M2.7",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchmarkCanonicalKey: "bench-1:general",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "79",
            valueNum: 79,
            valueNote: null,
            source: "text:MiniMax M3"
          }
        ]}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "MiniMax M3" }));

    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent?.trim() ?? "")
      .filter((text) => ["MiniMax M3", "MiniMax M2.7", "Claude Sonnet 4.6"].includes(text));

    expect(headers).toEqual(["MiniMax M3", "MiniMax M2.7", "Claude Sonnet 4.6"]);
  });

  test("当 rows 仅有单一 source 时，也会按 sourceOptions 展示全部页签", async () => {
    await renderReady(
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

    expect(screen.getByRole("tab", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Model A" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Qwen3.5-27B" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Gemini-2.5-Pro" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "未标注" })).toBeInTheDocument();

    const tablist = screen.getByRole("tablist");
    expect(tablist.className).toContain("overflow-hidden");
  });

  test("从 Gemma 4 切回全部时，模型选择会恢复到全量 allRows", async () => {
    await renderReady(
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
    fireEvent.click(screen.getByRole("tab", { name: "All" }));

    await waitFor(() => {
      expect(screen.getByText("已选模型 2/2")).toBeInTheDocument();
    });
    expect(screen.getByText("Bench-S")).toBeInTheDocument();
  });

  test("带 source 参数时优先使用当前 source 结果里的 benchmark 类型", async () => {
    mockSearchParams.set("source", "text:Seed2.0-0428");

    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:Seed2.0-0428"]}
        rows={[
          {
            providerName: "Seed",
            modelName: "Seed2.0 Pro",
            benchmarkName: "Claw-Eval",
            benchmarkType: "Agentic",
            benchmarkCanonicalKey: "claw-eval:agentic",
            benchTime: "2026-05-06T00:00:00.000Z",
            valueRaw: "77",
            valueNum: 77,
            valueNote: null,
            source: "text:Seed2.0-0428"
          }
        ]}
        allRows={[
          {
            providerName: "Seed",
            modelName: "Seed2.0 Pro",
            benchmarkName: "Claw-Eval",
            benchmarkType: "Coding Agent",
            benchmarkCanonicalKey: "claw-eval:codingagent",
            benchTime: "2026-05-06T00:00:00.000Z",
            valueRaw: "77",
            valueNum: 77,
            valueNote: null,
            source: "text:Seed2.0-0428"
          }
        ]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Seed2.0-0428" })).toHaveClass("tab-active");
    });
    expect(screen.getByText("Agentic")).toBeInTheDocument();
    expect(screen.queryByText("Coding Agent")).not.toBeInTheDocument();
  });

  test("根据 updatedAt / benchTime 仅为正确 source 页签展示 new 标记", async () => {
    const referenceTime = new Date("2026-05-10T12:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(referenceTime.getTime());

    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:Alpha", "text:Beta", "text:Gamma"]}
        rows={[
          {
            providerName: "Provider A",
            modelName: "Model A",
            benchmarkName: "Bench-A",
            benchmarkType: "General",
            benchTime: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-09T10:00:00.000Z",
            valueRaw: "81",
            valueNum: 81,
            valueNote: null,
            source: "text:Alpha"
          },
          {
            providerName: "Provider B",
            modelName: "Model B",
            benchmarkName: "Bench-B",
            benchmarkType: "General",
            benchTime: "2026-05-02T00:00:00.000Z",
            valueRaw: "79",
            valueNum: 79,
            valueNote: null,
            source: "text:Beta"
          },
          {
            providerName: "Provider C",
            modelName: "Model C",
            benchmarkName: "Bench-C",
            benchmarkType: "General",
            benchTime: "2026-05-03T00:00:00.000Z",
            valueRaw: "78",
            valueNum: 78,
            valueNote: null,
            source: "text:Gamma"
          }
        ]}
      />
    );

    await waitFor(() => {
      const alphaTab = screen.getByRole("tab", { name: "Alpha" });
      expect(alphaTab.querySelector("span.bg-emerald-300")).not.toBeNull();
    });

    const alphaTab = screen.getByRole("tab", { name: "Alpha" });
    const betaTab = screen.getByRole("tab", { name: "Beta" });
    const gammaTab = screen.getByRole("tab", { name: "Gamma" });

    expect(alphaTab.querySelector("span.bg-emerald-300")).not.toBeNull();
    expect(betaTab.querySelector("span.bg-emerald-300")).toBeNull();
    expect(gammaTab.querySelector("span.bg-emerald-300")).not.toBeNull();

    nowSpy.mockRestore();
  });

  test("有近期更新时 source 页签 title 包含“模型名 + 格式化时间 + 最近更新”", async () => {
    const referenceTime = new Date("2026-05-10T12:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(referenceTime.getTime());

    const latestUpdatedAt = "2026-05-09T18:08:00.000Z";

    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:Delta"]}
        rows={[
          {
            providerName: "Provider D",
            modelName: "Model D",
            benchmarkName: "Bench-D",
            benchmarkType: "General",
            benchTime: "2026-05-04T00:00:00.000Z",
            updatedAt: latestUpdatedAt,
            valueRaw: "88",
            valueNum: 88,
            valueNote: null,
            source: "text:Delta"
          }
        ]}
      />
    );

    await waitFor(() => {
      const deltaTab = screen.getByRole("tab", { name: "Delta" });
      expect(deltaTab).toHaveAttribute(
        "title",
        `Delta · ${formatTooltipTime(latestUpdatedAt)} · 最近更新`
      );
    });

    nowSpy.mockRestore();
  });

  test("缺少时间戳时不展示 new 标记与最近更新提示", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(new Date("2026-05-10T12:00:00.000Z").getTime());

    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:NoTime-A", "text:NoTime-B"]}
        rows={[
          {
            providerName: "Provider N1",
            modelName: "Model N1",
            benchmarkName: "Bench-N1",
            benchmarkType: "General",
            benchTime: "",
            valueRaw: "70",
            valueNum: 70,
            valueNote: null,
            source: "text:NoTime-A"
          },
          {
            providerName: "Provider N2",
            modelName: "Model N2",
            benchmarkName: "Bench-N2",
            benchmarkType: "General",
            benchTime: "",
            valueRaw: "71",
            valueNum: 71,
            valueNote: null,
            source: "text:NoTime-B"
          }
        ]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "NoTime-A" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "NoTime-B" })).toBeInTheDocument();
    });

    const tabA = screen.getByRole("tab", { name: "NoTime-A" });
    const tabB = screen.getByRole("tab", { name: "NoTime-B" });

    expect(tabA.querySelector("span.bg-emerald-300")).toBeNull();
    expect(tabB.querySelector("span.bg-emerald-300")).toBeNull();
    expect(tabA.getAttribute("title") ?? "").not.toContain("最近更新");
    expect(tabB.getAttribute("title") ?? "").not.toContain("最近更新");

    nowSpy.mockRestore();
  });

  test("非近期更新的 source 页签 title 显示模型名与最后更新时间，但不显示最近更新", async () => {
    const referenceTime = new Date("2026-05-10T12:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(referenceTime.getTime());

    const olderUpdatedAt = "2026-04-01T08:30:00.000Z";
    const secondLatestUpdatedAt = "2026-05-08T12:00:00.000Z";
    const latestUpdatedAt = "2026-05-09T18:08:00.000Z";

    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:Epsilon", "text:Eta", "text:Zeta"]}
        rows={[
          {
            providerName: "Provider E",
            modelName: "Model E",
            benchmarkName: "Bench-E",
            benchmarkType: "General",
            benchTime: olderUpdatedAt,
            valueRaw: "73",
            valueNum: 73,
            valueNote: null,
            source: "text:Epsilon"
          },
          {
            providerName: "Provider H",
            modelName: "Model H",
            benchmarkName: "Bench-H",
            benchmarkType: "General",
            benchTime: secondLatestUpdatedAt,
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Eta"
          },
          {
            providerName: "Provider Z",
            modelName: "Model Z",
            benchmarkName: "Bench-Z",
            benchmarkType: "General",
            benchTime: "2026-05-04T00:00:00.000Z",
            updatedAt: latestUpdatedAt,
            valueRaw: "88",
            valueNum: 88,
            valueNote: null,
            source: "text:Zeta"
          }
        ]}
      />
    );

    await waitFor(() => {
      const epsilonTab = screen.getByRole("tab", { name: "Epsilon" });
      expect(epsilonTab).toHaveAttribute(
        "title",
        `Epsilon · ${formatTooltipTime(olderUpdatedAt)}`
      );
    });

    const epsilonTab = screen.getByRole("tab", { name: "Epsilon" });
    expect(epsilonTab.getAttribute("title") ?? "").not.toContain("最近更新");
    expect(epsilonTab.querySelector("span.bg-emerald-300")).toBeNull();

    nowSpy.mockRestore();
  });

  test("超出近期窗口时仍为最后两个更新的 source 页签展示 new 标记", async () => {
    const referenceTime = new Date("2026-06-10T12:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(referenceTime.getTime());

    await renderReady(
      <BenchmarkMatrix
        sourceOptions={["text:Alpha", "text:Beta", "text:Gamma"]}
        rows={[
          {
            providerName: "Provider A",
            modelName: "Model A",
            benchmarkName: "Bench-A",
            benchmarkType: "General",
            benchTime: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-05-09T10:00:00.000Z",
            valueRaw: "81",
            valueNum: 81,
            valueNote: null,
            source: "text:Alpha"
          },
          {
            providerName: "Provider B",
            modelName: "Model B",
            benchmarkName: "Bench-B",
            benchmarkType: "General",
            benchTime: "2026-04-02T00:00:00.000Z",
            valueRaw: "79",
            valueNum: 79,
            valueNote: null,
            source: "text:Beta"
          },
          {
            providerName: "Provider C",
            modelName: "Model C",
            benchmarkName: "Bench-C",
            benchmarkType: "General",
            benchTime: "2026-05-03T00:00:00.000Z",
            valueRaw: "78",
            valueNum: 78,
            valueNote: null,
            source: "text:Gamma"
          }
        ]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Alpha" }).querySelector("span.bg-emerald-300")).not.toBeNull();
    });

    expect(screen.getByRole("tab", { name: "Alpha" }).querySelector("span.bg-emerald-300")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Beta" }).querySelector("span.bg-emerald-300")).toBeNull();
    expect(screen.getByRole("tab", { name: "Gamma" }).querySelector("span.bg-emerald-300")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("title") ?? "").toContain("最近更新");
    expect(screen.getByRole("tab", { name: "Gamma" }).getAttribute("title") ?? "").toContain("最近更新");
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("title") ?? "").not.toContain("最近更新");

    nowSpy.mockRestore();
  });

  test("溢出 source 页签保持 tab 语义，不暴露 menu 角色", async () => {
    vi.stubGlobal("ResizeObserver", undefined);

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const element = this as HTMLElement;

      const makeRect = (width: number, height: number) =>
        ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: width,
          bottom: height,
          width,
          height,
          toJSON: () => ({})
        }) as DOMRect;

      if (element.dataset.sourceTabMeasure === "item") {
        return makeRect(100, 36);
      }

      if (element.dataset.sourceTabMeasure === "more") {
        return makeRect(28, 36);
      }

      return makeRect(120, 36);
    });

    const { container } = await renderReady(
      <BenchmarkMatrix
        sourceOptions={[
          "text:S1",
          "text:S2",
          "text:S3",
          "text:S4"
        ]}
        rows={[
          {
            providerName: "OpenAI",
            modelName: "Model A",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:S1"
          },
          {
            providerName: "OpenAI",
            modelName: "Model B",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "79",
            valueNum: 79,
            valueNote: null,
            source: "text:S2"
          },
          {
            providerName: "OpenAI",
            modelName: "Model C",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "78",
            valueNum: 78,
            valueNote: null,
            source: "text:S3"
          },
          {
            providerName: "OpenAI",
            modelName: "Model D",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "77",
            valueNum: 77,
            valueNote: null,
            source: "text:S4"
          }
        ]}
      />
    );

    const viewport = container.querySelector('[data-source-tabs-viewport="1"]') as HTMLElement | null;
    expect(viewport).not.toBeNull();

    Object.defineProperty(viewport!, "clientWidth", {
      configurable: true,
      value: 120
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "展开溢出页签" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "展开溢出页签" }));

    const tablist = screen.getByRole("tablist");
    expect(within(tablist).queryByRole("menu")).toBeNull();
    expect(screen.getByRole("tab", { name: "S4" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
  });

  test("从溢出下拉选择 source 后，在下拉原位置显示占位符", async () => {
    vi.stubGlobal("ResizeObserver", undefined);

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const element = this as HTMLElement;

      const makeRect = (width: number, height: number) =>
        ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: width,
          bottom: height,
          width,
          height,
          toJSON: () => ({})
        }) as DOMRect;

      if (element.dataset.sourceTabMeasure === "item") {
        return makeRect(100, 36);
      }

      if (element.dataset.sourceTabMeasure === "more") {
        return makeRect(28, 36);
      }

      return makeRect(120, 36);
    });

    const { container } = await renderReady(
      <BenchmarkMatrix
        sourceOptions={[
          "text:S1",
          "text:S2",
          "text:S3",
          "text:S4"
        ]}
        rows={[
          {
            providerName: "OpenAI",
            modelName: "Model A",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:S1"
          },
          {
            providerName: "OpenAI",
            modelName: "Model B",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "79",
            valueNum: 79,
            valueNote: null,
            source: "text:S2"
          },
          {
            providerName: "OpenAI",
            modelName: "Model C",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "78",
            valueNum: 78,
            valueNote: null,
            source: "text:S3"
          },
          {
            providerName: "OpenAI",
            modelName: "Model D",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "77",
            valueNum: 77,
            valueNote: null,
            source: "text:S4"
          }
        ]}
      />
    );

    const viewport = container.querySelector('[data-source-tabs-viewport="1"]') as HTMLElement | null;
    expect(viewport).not.toBeNull();

    Object.defineProperty(viewport!, "clientWidth", {
      configurable: true,
      value: 270
    });

    window.dispatchEvent(new Event("resize"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "展开溢出页签" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "展开溢出页签" }));
    fireEvent.click(screen.getByRole("tab", { name: "S1" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "S1" })).toHaveAttribute("aria-selected", "true");
    });

    await waitFor(() => {
      const placeholder = container.querySelector('[data-source-tab-placeholder="text:S1"]');
      expect(placeholder).toHaveTextContent("S1");
    });
  });

  test("首屏要等 enqueueStateUpdate 刷完才渲染页签", async () => {
    const row = {
      providerName: "Anthropic",
      modelName: "Claude Opus 4.7",
      benchmarkName: "Bench-1",
      benchmarkType: "General",
      benchTime: "2026-04-06T00:00:00.000Z",
      valueRaw: "80",
      valueNum: 80,
      source: "text:Claude Opus 4.7"
    };

    render(
      <BenchmarkMatrix
        sourceOptions={["text:Claude Opus 4.7"]}
        rows={[row]}
      />
    );

    expect(screen.queryByRole("tab", { name: "Claude Opus 4.7" })).not.toBeInTheDocument();

    await flushQueuedStateUpdates();

    expect(screen.getByRole("tab", { name: "Claude Opus 4.7" })).toBeInTheDocument();
  });

  test("省略可选数组时父组件重渲染不会让 buildSourceOptions 再算一遍", async () => {
    const row = {
      providerName: "Anthropic",
      modelName: "Claude Opus 4.7",
      benchmarkName: "Bench-1",
      benchmarkType: "General",
      benchTime: "2026-04-06T00:00:00.000Z",
      valueRaw: "80",
      valueNum: 80,
      source: "text:Claude Opus 4.7"
    };
    const rows = [row];
    const spy = vi.spyOn(selectors, "buildSourceOptions");

    function Parent({ tick }: { tick: number }) {
      return (
        <div data-tick={tick}>
          <BenchmarkMatrix rows={rows} />
        </div>
      );
    }

    const { rerender } = await renderReady(<Parent tick={0} />);
    const callsAfterReady = spy.mock.calls.length;
    expect(callsAfterReady).toBeGreaterThan(0);

    rerender(<Parent tick={1} />);
    await flushQueuedStateUpdates();

    expect(spy.mock.calls.length).toBe(callsAfterReady);
    expect(screen.getByRole("tab", { name: "Claude Opus 4.7" })).toBeInTheDocument();
  });

  test("首页页签第一行保留 All 与 Artificial Analysis 为第一第二，后面放置最近添加的 source", async () => {
    await renderReady(
      <BenchmarkMatrix
        sourceOptions={[
          "text:Beta",
          "text:Artificial Analysis",
          "text:Alpha",
          "text:Gamma"
        ]}
        rows={[
          {
            providerName: "Provider AA",
            modelName: "Model AA",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-01T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Artificial Analysis"
          },
          {
            providerName: "Provider Alpha",
            modelName: "Model Alpha",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-05-10T00:00:00.000Z",
            valueRaw: "85",
            valueNum: 85,
            valueNote: null,
            source: "text:Alpha"
          },
          {
            providerName: "Provider Gamma",
            modelName: "Model Gamma",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-05-05T00:00:00.000Z",
            valueRaw: "82",
            valueNum: 82,
            valueNote: null,
            source: "text:Gamma"
          },
          {
            providerName: "Provider Beta",
            modelName: "Model Beta",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-10T00:00:00.000Z",
            valueRaw: "78",
            valueNum: 78,
            valueNote: null,
            source: "text:Beta"
          }
        ]}
      />
    );

    const tabs = screen
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.trim() ?? "");

    expect(tabs).toEqual(["All", "Artificial Analysis", "Alpha", "Gamma", "Beta"]);
  });

  test("首页页签溢出时第一行优先展示 All、Artificial Analysis 和最近添加的 source，展开的下拉框按首字母排序", async () => {
    vi.stubGlobal("ResizeObserver", undefined);

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const element = this as HTMLElement;

      const makeRect = (width: number, height: number) =>
        ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: width,
          bottom: height,
          width,
          height,
          toJSON: () => ({})
        }) as DOMRect;

      if (element.dataset.sourceTabMeasure === "item") {
        return makeRect(100, 36);
      }

      if (element.dataset.sourceTabMeasure === "more") {
        return makeRect(28, 36);
      }

      return makeRect(350, 36);
    });

    const { container } = await renderReady(
      <BenchmarkMatrix
        sourceOptions={[
          "text:Zeta_Old",
          "text:Beta_Recent",
          "text:Artificial Analysis",
          "text:Alpha_Old",
          "text:Gamma_VeryRecent"
        ]}
        rows={[
          {
            providerName: "AA",
            modelName: "Model AA",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-03-01T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Artificial Analysis"
          },
          {
            providerName: "Gamma",
            modelName: "Model Gamma",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-05-10T00:00:00.000Z",
            valueRaw: "85",
            valueNum: 85,
            valueNote: null,
            source: "text:Gamma_VeryRecent"
          },
          {
            providerName: "Beta",
            modelName: "Model Beta",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-05-08T00:00:00.000Z",
            valueRaw: "82",
            valueNum: 82,
            valueNote: null,
            source: "text:Beta_Recent"
          },
          {
            providerName: "Alpha",
            modelName: "Model Alpha",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-01T00:00:00.000Z",
            valueRaw: "75",
            valueNum: 75,
            valueNote: null,
            source: "text:Alpha_Old"
          },
          {
            providerName: "Zeta",
            modelName: "Model Zeta",
            benchmarkName: "Bench-1",
            benchmarkType: "General",
            benchTime: "2026-04-02T00:00:00.000Z",
            valueRaw: "74",
            valueNum: 74,
            valueNote: null,
            source: "text:Zeta_Old"
          }
        ]}
      />
    );

    const viewport = container.querySelector('[data-source-tabs-viewport="1"]') as HTMLElement | null;
    expect(viewport).not.toBeNull();

    // 容纳 3 个页签（All, Artificial Analysis, Gamma_VeryRecent）+ overflow 按钮
    Object.defineProperty(viewport!, "clientWidth", {
      configurable: true,
      value: 340
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "展开溢出页签" })).toBeInTheDocument();
    });

    // 第一行仅包含 All, Artificial Analysis, Gamma_VeryRecent
    const firstRowTabs = container
      .querySelectorAll('.tabs.flex.flex-1 [role="tab"]');
    const firstRowLabels = Array.from(firstRowTabs).map((el) => el.textContent?.trim() ?? "");
    expect(firstRowLabels).toEqual(["All", "Artificial Analysis", "Gamma_VeryRecent"]);

    // 展开下拉框
    fireEvent.click(screen.getByRole("button", { name: "展开溢出页签" }));

    // 下拉框内的溢出页签按首字母/版本排序 (Alpha_Old, Beta_Recent, Zeta_Old)
    const overflowTabs = container
      .querySelectorAll('#benchmark-matrix-source-tabs-overflow [role="tab"]');
    const overflowLabels = Array.from(overflowTabs).map((el) => el.textContent?.trim() ?? "");
    expect(overflowLabels).toEqual(["Alpha_Old", "Beta_Recent", "Zeta_Old"]);
  });

});
