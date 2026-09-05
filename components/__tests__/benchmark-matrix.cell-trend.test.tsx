import { fireEvent, screen } from "@testing-library/react";
import { flushQueuedStateUpdates, renderReady } from "@/tests/flush-microtasks";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import {
  buildCellTrendData,
  getCellTrendPopoverPosition,
  calculateVisibleTickIndices,
  ESTIMATED_TREND_POPOVER_HEIGHT,
  isCellTrendEligible
} from "@/components/benchmark-matrix/cell-trend";
import type { MatrixCell } from "@/components/benchmark-matrix/types";

const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => mockSearchParams
}));

describe("cell-trend helper functions", () => {
  test("isCellTrendEligible returns false when cell has fewer than 2 valid entries", () => {
    const cell: Partial<MatrixCell> = {
      allEntries: [
        {
          valueRaw: "80",
          valueNum: 80,
          valueNum2: null,
          valueNote: null,
          source: "text:S1",
          benchTime: "2026-01-01T00:00:00.000Z"
        }
      ]
    };
    expect(isCellTrendEligible(cell as MatrixCell)).toBe(false);
  });

  test("isCellTrendEligible returns false when entries have different sources", () => {
    const cell: Partial<MatrixCell> = {
      allEntries: [
        {
          valueRaw: "80",
          valueNum: 80,
          valueNum2: null,
          valueNote: null,
          source: "text:S1",
          benchTime: "2026-01-01T00:00:00.000Z"
        },
        {
          valueRaw: "85",
          valueNum: 85,
          valueNum2: null,
          valueNote: null,
          source: "text:S2",
          benchTime: "2026-02-01T00:00:00.000Z"
        }
      ]
    };
    expect(isCellTrendEligible(cell as MatrixCell)).toBe(false);
  });

  test("isCellTrendEligible returns true when multiple entries belong to same source", () => {
    const cell: Partial<MatrixCell> = {
      allEntries: [
        {
          valueRaw: "80",
          valueNum: 80,
          valueNum2: null,
          valueNote: null,
          source: "text:S1",
          benchTime: "2026-01-01T00:00:00.000Z"
        },
        {
          valueRaw: "85",
          valueNum: 85,
          valueNum2: null,
          valueNote: null,
          source: "text:S1",
          benchTime: "2026-02-01T00:00:00.000Z"
        }
      ]
    };
    expect(isCellTrendEligible(cell as MatrixCell)).toBe(true);
  });

  test("isCellTrendEligible handles activeSource scoping correctly", () => {
    const mixedCell: Partial<MatrixCell> = {
      allEntries: [
        {
          valueRaw: "80",
          valueNum: 80,
          valueNum2: null,
          valueNote: null,
          source: "text:S1",
          benchTime: "2026-01-01T00:00:00.000Z"
        },
        {
          valueRaw: "85",
          valueNum: 85,
          valueNum2: null,
          valueNote: null,
          source: "text:S1",
          benchTime: "2026-02-01T00:00:00.000Z"
        },
        {
          valueRaw: "90",
          valueNum: 90,
          valueNum2: null,
          valueNote: null,
          source: "text:S2",
          benchTime: "2026-03-01T00:00:00.000Z"
        }
      ]
    };

    // ALL 视图下多源混杂，不应触发折线
    expect(isCellTrendEligible(mixedCell as MatrixCell, "__all__")).toBe(false);
    // 限定 S1 时，S1 有 2 条合法记录，应当支持折线
    expect(isCellTrendEligible(mixedCell as MatrixCell, "text:S1")).toBe(true);
    // 限定 S2 时，S2 仅有 1 条记录，不应支持折线
    expect(isCellTrendEligible(mixedCell as MatrixCell, "text:S2")).toBe(false);
    // 限定 S3 时，S3 无记录，不应支持折线
    expect(isCellTrendEligible(mixedCell as MatrixCell, "text:S3")).toBe(false);
  });

  test("buildCellTrendData correctly sorts points and computes delta", () => {
    const cell: Partial<MatrixCell> = {
      allEntries: [
        {
          valueRaw: "85",
          valueNum: 85,
          valueNum2: null,
          valueNote: "v2",
          source: "text:S1",
          benchTime: "2026-03-01T00:00:00.000Z"
        },
        {
          valueRaw: "75",
          valueNum: 75,
          valueNum2: null,
          valueNote: "v1",
          source: "text:S1",
          benchTime: "2026-01-01T00:00:00.000Z"
        }
      ]
    };

    const data = buildCellTrendData(
      { benchmark: "MMLU", category: "General", higherIsBetter: true },
      "Model X",
      cell as MatrixCell
    );

    expect(data).not.toBeNull();
    expect(data!.points).toHaveLength(2);
    expect(data!.firstPoint.score).toBe(75);
    expect(data!.latestPoint.score).toBe(85);
    expect(data!.minScore).toBe(75);
    expect(data!.maxScore).toBe(85);
    expect(data!.scoreDelta).toBe(10);
  });

  test("buildCellTrendData formats timeLabel with hours and minutes when multiple records fall on the same day", () => {
    const cell: Partial<MatrixCell> = {
      allEntries: [
        {
          valueRaw: "80",
          valueNum: 80,
          valueNum2: null,
          valueNote: "run-1",
          source: "text:S1",
          benchTime: "2026-04-06T10:00:00.000Z"
        },
        {
          valueRaw: "85",
          valueNum: 85,
          valueNum2: null,
          valueNote: "run-2",
          source: "text:S1",
          benchTime: "2026-04-06T15:30:00.000Z"
        }
      ]
    };

    const data = buildCellTrendData(
      { benchmark: "MMLU", category: "General", higherIsBetter: true },
      "Model X",
      cell as MatrixCell
    );

    expect(data).not.toBeNull();
    expect(data!.points).toHaveLength(2);
    // Both points fall on 2026-04-06, so timeLabel must include hours and minutes to avoid collision
    expect(data!.points[0].timeLabel).not.toBe(data!.points[1].timeLabel);
    expect(data!.points[0].timeLabel).toContain(":");
    expect(data!.points[1].timeLabel).toContain(":");
  });

  test("getCellTrendPopoverPosition places popover above when space below is less than ESTIMATED_TREND_POPOVER_HEIGHT (440)", () => {
    expect(ESTIMATED_TREND_POPOVER_HEIGHT).toBe(440);

    // Viewport: 1024x800, anchorRect bottom = 450 (spaceBelow = 350 < 440), anchorRect top = 420 (spaceAbove = 420 > 350)
    // Previously with 330, 350 >= 330 resulted in "below", causing layout jump when real height > 400.
    // Now with 440, it should place "above".
    const anchorRect = {
      left: 300,
      right: 320,
      top: 420,
      bottom: 450,
      width: 20,
      height: 30
    } as DOMRect;

    const pos = getCellTrendPopoverPosition(anchorRect);
    expect(pos.placement).toBe("above");
  });

  describe("calculateVisibleTickIndices", () => {
    test("handles boundary cases (<= 1 point and 2 points)", () => {
      expect(calculateVisibleTickIndices(1, 400, false)).toEqual([0]);
      expect(calculateVisibleTickIndices(2, 400, false)).toEqual([0, 1]);
    });

    test("guarantees last tick and second-to-last tick do not overlap for 22 points", () => {
      const ticksWide = calculateVisibleTickIndices(22, 512, false);
      const lastTickWide = ticksWide[ticksWide.length - 1];
      const secondToLastWide = ticksWide[ticksWide.length - 2];

      expect(lastTickWide).toBe(21);
      // Ensure the gap is at least 2 indices (never 1, preventing physical text overlap)
      expect(lastTickWide - secondToLastWide).toBeGreaterThanOrEqual(2);
      expect(ticksWide).not.toContain(20);

      const ticksNarrow = calculateVisibleTickIndices(22, 400, false);
      const lastTickNarrow = ticksNarrow[ticksNarrow.length - 1];
      const secondToLastNarrow = ticksNarrow[ticksNarrow.length - 2];

      expect(lastTickNarrow).toBe(21);
      expect(lastTickNarrow - secondToLastNarrow).toBeGreaterThanOrEqual(3);
    });

    test("ensures all adjacent visible ticks maintain minimum pixel distance across various datasets", () => {
      for (const len of [5, 12, 20, 22, 35, 50]) {
        for (const width of [360, 440, 520]) {
          for (const spansMultipleYears of [false, true]) {
            const ticks = calculateVisibleTickIndices(len, width, spansMultipleYears);
            const minDistance = spansMultipleYears ? 58 : 46;
            const lastIdx = len - 1;

            expect(ticks[0]).toBe(0);
            expect(ticks[ticks.length - 1]).toBe(lastIdx);

            for (let i = 0; i < ticks.length - 1; i++) {
              expect(ticks[i + 1]).toBeGreaterThan(ticks[i]);
              if (ticks.length > 2) {
                const pixelDistance = ((ticks[i + 1] - ticks[i]) * width) / lastIdx;
                expect(pixelDistance).toBeGreaterThanOrEqual(minDistance - 1);
              }
            }
          }
        }
      }
    });
  });
});

describe("BenchmarkMatrix question mark trend chart interaction", () => {
  beforeEach(() => {
    window.localStorage.clear();
    for (const key of Array.from(mockSearchParams.keys())) {
      mockSearchParams.delete(key);
    }
  });

  test("clicking question mark on single-source multi-record cell opens trend chart popover", async () => {
    const rows = [
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-Trend",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-trend:general",
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "70",
        valueNum: 70,
        valueNote: null,
        source: "text:S1"
      },
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-Trend",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-trend:general",
        benchTime: "2026-03-01T00:00:00.000Z",
        valueRaw: "85",
        valueNum: 85,
        valueNote: "checkpoint-2",
        source: "text:S1"
      }
    ];

    const { container } = await renderReady(
      <BenchmarkMatrix rows={[...rows]} allRows={[...rows]} />
    );

    // 存在问号且具备 trend-trigger 属性
    const trigger = container.querySelector('[data-cell-trend-trigger="1"]');
    expect(trigger).not.toBeNull();
    expect(trigger).toHaveTextContent("?");

    // 点击问号
    fireEvent.click(trigger!);

    // 应弹出对应 benchmark 的趋势面板
    const panel = container.querySelector('[data-cell-trend-panel="Bench-Trend"]');
    expect(panel).not.toBeNull();

    // 面板内显示模型名称与变化量
    expect(panel).toHaveTextContent("Model A");
    expect(panel).toHaveTextContent("Bench-Trend");
    expect(panel).not.toHaveTextContent("Source: S1");
    expect(panel).toHaveTextContent("70");
    expect(panel).toHaveTextContent("85");
    expect(panel).toHaveTextContent("+15");

    // 点击关闭按钮可正常关闭面板
    const closeBtn = screen.getByRole("button", { name: "关闭趋势浮窗" });
    fireEvent.click(closeBtn);
    expect(container.querySelector('[data-cell-trend-panel="Bench-Trend"]')).toBeNull();
  });

  test("question mark on multi-source cell does not trigger trend chart", async () => {
    const rows = [
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-MultiSource",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-multisource:general",
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "70",
        valueNum: 70,
        valueNote: null,
        source: "text:S1"
      },
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-MultiSource",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-multisource:general",
        benchTime: "2026-03-01T00:00:00.000Z",
        valueRaw: "85",
        valueNum: 85,
        valueNote: null,
        source: "text:S2"
      }
    ];

    const { container } = await renderReady(
      <BenchmarkMatrix rows={[...rows]} allRows={[...rows]} />
    );

    // 存在问号（因为有多值），但不可点击触发时序折线图
    const trigger = container.querySelector('[data-cell-trend-trigger="1"]');
    expect(trigger).toBeNull();

    // 普通问号仍存在
    const questionMarks = Array.from(container.querySelectorAll("td span")).filter(
      (el) => el.textContent?.trim() === "?"
    );
    expect(questionMarks.length).toBeGreaterThan(0);

    // 点击该问号不弹出图表面板
    fireEvent.click(questionMarks[0]!);
    expect(container.querySelector('[data-cell-trend-panel]')).toBeNull();
  });

  test("ESC key closes open trend chart popover", async () => {
    const rows = [
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-ESC",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-esc:general",
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "60",
        valueNum: 60,
        valueNote: null,
        source: "text:S1"
      },
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-ESC",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-esc:general",
        benchTime: "2026-02-01T00:00:00.000Z",
        valueRaw: "80",
        valueNum: 80,
        valueNote: null,
        source: "text:S1"
      }
    ];

    const { container } = await renderReady(
      <BenchmarkMatrix rows={[...rows]} allRows={[...rows]} />
    );

    const trigger = container.querySelector('[data-cell-trend-trigger="1"]');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);

    expect(container.querySelector('[data-cell-trend-panel="Bench-ESC"]')).not.toBeNull();

    // 按下 ESC 键关闭
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector('[data-cell-trend-panel="Bench-ESC"]')).toBeNull();
  });

  test("negative score delta displays minus sign in trend panel", async () => {
    const rows = [
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-Down",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-down:general",
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "90",
        valueNum: 90,
        valueNote: null,
        source: "text:S1"
      },
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-Down",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-down:general",
        benchTime: "2026-02-01T00:00:00.000Z",
        valueRaw: "70",
        valueNum: 70,
        valueNote: null,
        source: "text:S1"
      }
    ];

    const { container } = await renderReady(
      <BenchmarkMatrix rows={[...rows]} allRows={[...rows]} />
    );

    const trigger = container.querySelector('[data-cell-trend-trigger="1"]');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);

    const panel = container.querySelector('[data-cell-trend-panel="Bench-Down"]');
    expect(panel).not.toBeNull();
    // 应当渲染负号 -20 而非无符号的 20
    expect(panel).toHaveTextContent("-20");
  });

  test("trigger responds to Enter and Space keydown events", async () => {
    const rows = [
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-KB",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-kb:general",
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "60",
        valueNum: 60,
        valueNote: null,
        source: "text:S1"
      },
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-KB",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-kb:general",
        benchTime: "2026-02-01T00:00:00.000Z",
        valueRaw: "80",
        valueNum: 80,
        valueNote: null,
        source: "text:S1"
      }
    ];

    const { container } = await renderReady(
      <BenchmarkMatrix rows={[...rows]} allRows={[...rows]} />
    );

    const trigger = container.querySelector('[data-cell-trend-trigger="1"]');
    expect(trigger).not.toBeNull();

    // Enter 打开
    fireEvent.keyDown(trigger!, { key: "Enter" });
    expect(container.querySelector('[data-cell-trend-panel="Bench-KB"]')).not.toBeNull();

    // ESC 关闭
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector('[data-cell-trend-panel="Bench-KB"]')).toBeNull();

    // Space 打开
    fireEvent.keyDown(trigger!, { key: " " });
    expect(container.querySelector('[data-cell-trend-panel="Bench-KB"]')).not.toBeNull();
  });

  test("switching source tab cleanly closes trend popover and does not auto-reopen when switching back", async () => {
    const rows = [
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-TabSwitch",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-tabswitch:general",
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "60",
        valueNum: 60,
        valueNote: null,
        source: "text:S1"
      },
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-TabSwitch",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-tabswitch:general",
        benchTime: "2026-02-01T00:00:00.000Z",
        valueRaw: "80",
        valueNum: 80,
        valueNote: null,
        source: "text:S1"
      },
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-TabSwitch",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-tabswitch:general",
        benchTime: "2026-03-01T00:00:00.000Z",
        valueRaw: "85",
        valueNum: 85,
        valueNote: null,
        source: "text:S2"
      }
    ];

    const { container } = await renderReady(
      <BenchmarkMatrix
        rows={[...rows]}
        allRows={[...rows]}
        sourceOptions={["text:S1", "text:S2"]}
      />
    );

    // 切换至 S1 tab
    const s1Tab = screen.getByRole("tab", { name: "S1" });
    fireEvent.click(s1Tab);
    await flushQueuedStateUpdates();

    // S1 tab 下有 2 条记录，问号应当具备 trend trigger
    const trigger = container.querySelector('[data-cell-trend-trigger="1"]');
    expect(trigger).not.toBeNull();

    // 点击打开趋势弹窗
    fireEvent.click(trigger!);
    await flushQueuedStateUpdates();
    expect(container.querySelector('[data-cell-trend-panel="Bench-TabSwitch"]')).not.toBeNull();

    // 切换至 ALL tab（因为有 S1 和 S2 混杂，ALL 下不合格）
    const allTab = screen.getByRole("tab", { name: "All" });
    fireEvent.click(allTab);
    await flushQueuedStateUpdates();

    // 弹窗应已关闭
    expect(container.querySelector('[data-cell-trend-panel="Bench-TabSwitch"]')).toBeNull();

    // 再切回 S1 tab
    fireEvent.click(screen.getByRole("tab", { name: "S1" }));
    await flushQueuedStateUpdates();

    // 切回 S1 后，弹窗不应自动重新弹出（没有假关闭现象）
    expect(container.querySelector('[data-cell-trend-panel="Bench-TabSwitch"]')).toBeNull();
  });

  test("trend popover automatically closes when the model column disappears via search/filtering", async () => {
    const rows = [
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-Filter",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-filter:general",
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "60",
        valueNum: 60,
        valueNote: null,
        source: "text:S1"
      },
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-Filter",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-filter:general",
        benchTime: "2026-02-01T00:00:00.000Z",
        valueRaw: "80",
        valueNum: 80,
        valueNote: null,
        source: "text:S1"
      },
      {
        providerName: "Anthropic",
        modelName: "Model B",
        benchmarkName: "Bench-Filter",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-filter:general",
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "75",
        valueNum: 75,
        valueNote: null,
        source: "text:S1"
      }
    ];

    const { container } = await renderReady(
      <BenchmarkMatrix rows={[...rows]} allRows={[...rows]} />
    );

    // Open trend popover for Model A
    const trigger = container.querySelector('[data-cell-trend-trigger="1"]');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);
    await flushQueuedStateUpdates();

    expect(container.querySelector('[data-cell-trend-panel="Bench-Filter"]')).not.toBeNull();

    // Now click "清空模型", which deselects all models including Model A
    const clearBtn = screen.getByRole("button", { name: "清空模型" });
    fireEvent.click(clearBtn);
    await flushQueuedStateUpdates();

    // Model A is now filtered out from modelColumns -> trend popover must be closed!
    expect(container.querySelector('[data-cell-trend-panel="Bench-Filter"]')).toBeNull();
  });

  test("cell trend panel does not render bottom footer and displays multiline timestamp in stat cards", async () => {
    const rows = [
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-Adjustments",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-adj:general",
        benchTime: "2026-08-04T17:53:00.000Z",
        valueRaw: "68.72",
        valueNum: 68.72,
        valueNote: null,
        source: "text:S1"
      },
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-Adjustments",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-adj:general",
        benchTime: "2026-09-02T11:20:00.000Z",
        valueRaw: "74.50",
        valueNum: 74.5,
        valueNote: null,
        source: "text:S1"
      }
    ];

    const { container } = await renderReady(
      <BenchmarkMatrix rows={[...rows]} allRows={[...rows]} />
    );

    const trigger = container.querySelector('[data-cell-trend-trigger="1"]');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);
    await flushQueuedStateUpdates();

    const panel = container.querySelector('[data-cell-trend-panel="Bench-Adjustments"]');
    expect(panel).not.toBeNull();

    // 1. 去掉底行文字“横轴为评测记录时序，纵轴为评测分值”
    expect(panel!.textContent).not.toContain("横轴为评测记录时序，纵轴为评测分值");
    expect(panel!.textContent).not.toContain("按 ESC 或点击外部可关闭");

    // 2. 起始记录与数值展示（换行显示时间）
    expect(panel!.textContent).toContain("起始记录");
    expect(panel!.textContent).toContain("68.72");
    expect(panel!.textContent).toContain("最新记录");
    expect(panel!.textContent).toContain("74.50");
  });

  test("renders safely without collapsing YAxis domain when entries have identical tiny scores", async () => {
    const rows = [
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-Tiny",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-tiny:general",
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "0.001",
        valueNum: 0.001,
        valueNote: "very-long-note-string-without-spaces-to-verify-break-words-behavior",
        source: "text:S1"
      },
      {
        providerName: "OpenAI",
        modelName: "Model A",
        benchmarkName: "Bench-Tiny",
        benchmarkType: "General",
        benchmarkCanonicalKey: "bench-tiny:general",
        benchTime: "2026-02-01T00:00:00.000Z",
        valueRaw: "0.001",
        valueNum: 0.001,
        valueNote: null,
        source: "text:S1"
      }
    ];

    const { container } = await renderReady(
      <BenchmarkMatrix rows={[...rows]} allRows={[...rows]} />
    );

    const trigger = container.querySelector('[data-cell-trend-trigger="1"]');
    expect(trigger).not.toBeNull();
    expect(trigger).toHaveClass("cursor-pointer");

    fireEvent.click(trigger!);
    await flushQueuedStateUpdates();

    const panel = container.querySelector('[data-cell-trend-panel="Bench-Tiny"]');
    expect(panel).not.toBeNull();
    expect(panel).toHaveTextContent("0.001");
    expect(panel).toHaveTextContent("0"); // delta is 0
  });
});


