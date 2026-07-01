import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { formatTooltipTime } from "@/components/benchmark-matrix/formatters";

const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => mockSearchParams
}));

describe("BenchmarkMatrix source tabs", () => {
  beforeEach(() => {
    window.localStorage.clear();
    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  test("同系列 source 页签按新版本优先排序（如 Qwen3.6 在 Qwen3.5 前，Claude Sonnet 5 在 Opus 4.8 前）", () => {
    render(
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

    const claudeTabs = screen
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.trim() ?? "")
      .filter((label) => label.startsWith("Claude"));

    expect(claudeTabs).toEqual(["Claude Sonnet 5", "Claude Opus 4.8", "Claude Opus 4.7"]);
  });

  test("Nemotron 组内页签按 ultra > super > nano 顺序排序", () => {
    render(
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
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "80",
            valueNum: 80,
            valueNote: null,
            source: "text:Nemotron 3 Nano"
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

  test("source 页签文本使用 provider 颜色，首字符加粗，选中后恢复白色加粗", async () => {
    render(
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

    expect(coloredLabel).toHaveTextContent("Claude Opus 4.7");
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

  test("未配置自定义 provider 颜色的 source 页签不使用 fallback 颜色", () => {
    render(
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

  test("非全部 source 页签优先展示 source 同系列模型，再按系列覆盖率和模型名排序", () => {
    render(
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

  test("非全部 source 页签会把同模型家族放在一起", () => {
    render(
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

    expect(screen.getByRole("tab", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Model A" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Qwen3.5-27B" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Gemini-2.5-Pro" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "未标注" })).toBeInTheDocument();

    const tablist = screen.getByRole("tablist");
    expect(tablist.className).toContain("overflow-hidden");
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
    fireEvent.click(screen.getByRole("tab", { name: "All" }));

    await waitFor(() => {
      expect(screen.getByText("已选模型 2/2")).toBeInTheDocument();
    });
    expect(screen.getByText("Bench-S")).toBeInTheDocument();
  });

  test("带 source 参数时优先使用当前 source 结果里的 benchmark 类型", async () => {
    mockSearchParams.set("source", "text:Seed2.0-0428");

    render(
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

    render(
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
    expect(gammaTab.querySelector("span.bg-emerald-300")).toBeNull();

    nowSpy.mockRestore();
  });

  test("有近期更新时 source 页签 title 包含“模型名 + 格式化时间 + 最近更新”", async () => {
    const referenceTime = new Date("2026-05-10T12:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(referenceTime.getTime());

    const latestUpdatedAt = "2026-05-09T18:08:00.000Z";

    render(
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

    render(
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
    const latestUpdatedAt = "2026-05-09T18:08:00.000Z";

    render(
      <BenchmarkMatrix
        sourceOptions={["text:Epsilon", "text:Zeta"]}
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

    const { container } = render(
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

    const { container } = render(
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

});
