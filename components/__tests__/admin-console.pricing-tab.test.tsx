import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { PricingTab } from "@/components/admin-console/views/pricing-tab";
import type { ModelPricingRow } from "@/components/admin-console/types";
import { countDirtyPricingDrafts, toPricingDraft } from "@/components/admin-console/utils/pricing-draft";

const prices: ModelPricingRow[] = Array.from({ length: 1000 }, (_, index) => ({
  modelId: index + 1,
  modelName: `Model ${String(index + 1).padStart(4, "0")}`,
  providerName: "OpenAI",
  modelCreatedAt: new Date(Date.UTC(2026, 0, 1) - index * 1000).toISOString(),
  source: "models.dev",
  sourceProviderId: "openai",
  sourceProviderName: "OpenAI",
  sourceModelId: `model-${index + 1}`,
  sourceModelName: null,
  releaseDate: "2026-01-01",
  inputCost: 1,
  outputCost: 3,
  reasoningCost: null,
  cacheReadCost: 0.5,
  cacheWriteCost: null,
  inputAudioCost: null,
  outputAudioCost: null,
  currency: "USD",
  unit: "per_1m_tokens",
  matchConfidence: 100,
  matchStatus: "matched",
  manualOverride: false,
  note: null,
  lastSyncedAt: null,
  updatedAt: "2026-01-01T00:00:00.000Z"
}));

function renderTab(overrides: Partial<Parameters<typeof PricingTab>[0]> = {}) {
  const props = {
    prices,
    loadingPrices: false,
    syncingPrices: false,
    savingPriceModelId: null,
    savingAllPrices: false,
    dirtyPricingCount: 0,
    pricingSearchQuery: "",
    setPricingSearchQuery: vi.fn(),
    pricingStatusFilter: "all" as const,
    setPricingStatusFilter: vi.fn(),
    pricingDrafts: Object.fromEntries(prices.map((price) => [price.modelId, toPricingDraft(price)])),
    updatePricingDraft: vi.fn(),
    onLoadPrices: vi.fn(),
    onSyncPrices: vi.fn(),
    onSavePrice: vi.fn(),
    onSaveAllPrices: vi.fn(),
    onDiscardPricingDrafts: vi.fn(),
    syncResult: null,
    ...overrides
  };

  function Harness({ query = "", loading = false }) {
    const [drafts, setDrafts] = useState(props.pricingDrafts);
    return <PricingTab {...props}
      pricingSearchQuery={query}
      loadingPrices={loading}
      pricingDrafts={drafts}
      dirtyPricingCount={countDirtyPricingDrafts(prices, drafts)}
      updatePricingDraft={(modelId, updater) => setDrafts((current) => ({ ...current, [modelId]: updater(current[modelId]) }))}
    />;
  }

  return { ...render(<Harness />), props, Harness };
}

describe("PricingTab virtual scrolling", () => {
  test("1000 个模型仅挂载可视窗口的行，滚动可到达中间及最后一行", () => {
    renderTab();
    const viewport = screen.getByRole("region", { name: "价格管理" });
    const table = screen.getByRole("table", { name: "模型价格" });
    expect(table).toHaveAttribute("aria-rowcount", "1001");
    expect(screen.getByText("Model 0001")).toBeInTheDocument();
    expect(table.querySelectorAll("[data-pricing-row]").length).toBeLessThan(30);
    expect(screen.queryByText("Model 0501")).not.toBeInTheDocument();

    fireEvent.scroll(viewport, { target: { scrollTop: 500 * 104 } });
    expect(screen.getByText("Model 0501")).toBeInTheDocument();
    expect(screen.queryByText("Model 0001")).not.toBeInTheDocument();
    expect(table.querySelectorAll("[data-pricing-row]").length).toBeLessThan(30);

    fireEvent.scroll(viewport, { target: { scrollTop: 1000 * 104 + 40 - 560 } });
    expect(screen.getByText("Model 1000")).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader")).toHaveLength(8);
  });

  test("编辑后滚出和滚回不会丢失草稿，保存全部仍包含未挂载的改动", () => {
    const { props } = renderTab();
    const viewport = screen.getByRole("region", { name: "价格管理" });
    const row = screen.getByText("Model 0001").closest("tr")!;
    fireEvent.change(within(row).getAllByRole("textbox")[2], { target: { value: "9.99" } });
    expect(within(row).getByText("未保存")).toBeInTheDocument();

    fireEvent.scroll(viewport, { target: { scrollTop: 500 * 104 } });
    expect(screen.queryByText("Model 0001")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /保存全部修改（1）/ }));
    expect(props.onSaveAllPrices).toHaveBeenCalledOnce();

    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    const restoredRow = screen.getByText("Model 0001").closest("tr")!;
    expect(within(restoredRow).getAllByRole("textbox")[2]).toHaveValue("9.99");
    expect(within(restoredRow).getByRole("checkbox")).toBeChecked();
    fireEvent.click(within(restoredRow).getByRole("button", { name: "保存" }));
    expect(props.onSavePrice).toHaveBeenCalledWith(1);
  });

  test("从列表底部搜索或清空搜索时回到顶部，空结果也可正常恢复", () => {
    const { rerender, Harness } = renderTab();
    const viewport = screen.getByRole("region", { name: "价格管理" });
    fireEvent.scroll(viewport, { target: { scrollTop: 990 * 104 } });

    rerender(<Harness query="Model 1000" />);
    expect(viewport.scrollTop).toBe(0);
    expect(screen.getByText("Model 1000")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "2");

    rerender(<Harness query="no matching model" />);
    expect(screen.getByText("无匹配价格记录")).toBeInTheDocument();
    rerender(<Harness />);
    expect(screen.getByText("Model 0001")).toBeInTheDocument();
    expect(screen.queryByText("Model 1000")).not.toBeInTheDocument();
  });

  test("视口高度变化和加载后重新挂载时重新测量，日期编辑行卸载后不抢焦点", () => {
    let resize = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const { rerender, Harness } = renderTab();
    const viewport = screen.getByRole("region", { name: "价格管理" });
    const initialCount = viewport.querySelectorAll("[data-pricing-row]").length;
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 1400 });
    act(() => resize());
    expect(viewport.querySelectorAll("[data-pricing-row]").length).toBeGreaterThan(initialCount);

    fireEvent.click(screen.getByRole("button", { name: "修改 Model 0001 发布日期" }));
    expect(screen.getByRole("textbox", { name: "输入 Model 0001 发布日期" })).toHaveFocus();
    fireEvent.scroll(viewport, { target: { scrollTop: 500 * 104 } });
    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    expect(screen.queryByRole("textbox", { name: "输入 Model 0001 发布日期" })).not.toBeInTheDocument();

    rerender(<Harness loading />);
    expect(screen.getByText("正在加载价格…")).toBeInTheDocument();
    expect(disconnect).toHaveBeenCalled();
    rerender(<Harness />);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Model 0001")).toBeInTheDocument();
  });
});
