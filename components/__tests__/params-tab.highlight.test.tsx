import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import type { ModelParamsDraft, ModelParamsRow } from "@/components/admin-console/types";
import { toParamsDraft } from "@/components/admin-console/utils/params-draft";
import {
  isClosedSourceFrontierModel,
  isParamsDraftFilled,
  ParamsTab,
  shouldHighlightParamsRow
} from "@/components/admin-console/views/params-tab";

function createParamsRow(overrides: Partial<ModelParamsRow> = {}): ModelParamsRow {
  return {
    modelId: 1,
    modelName: "Llama-3-70B",
    providerName: "Meta",
    modelCreatedAt: "2026-05-26T00:00:00.000Z",
    totalParamsB: null,
    activatedParamsB: null,
    isEstimated: false,
    note: null,
    suggestion: null,
    ...overrides
  };
}

describe("闭源模型判定 isClosedSourceFrontierModel", () => {
  test("主流闭源模型（GPT, Claude, Gemini, o1, o3）判定为闭源", () => {
    expect(isClosedSourceFrontierModel("GPT-4o")).toBe(true);
    expect(isClosedSourceFrontierModel("gpt-4-turbo")).toBe(true);
    expect(isClosedSourceFrontierModel("ChatGPT-4o")).toBe(true);
    expect(isClosedSourceFrontierModel("Claude 3.5 Sonnet")).toBe(true);
    expect(isClosedSourceFrontierModel("claude-opus-4.6")).toBe(true);
    expect(isClosedSourceFrontierModel("Gemini 1.5 Pro")).toBe(true);
    expect(isClosedSourceFrontierModel("gemini-2.0-flash")).toBe(true);
    expect(isClosedSourceFrontierModel("o1")).toBe(true);
    expect(isClosedSourceFrontierModel("o1-mini")).toBe(true);
    expect(isClosedSourceFrontierModel("o1-preview")).toBe(true);
    expect(isClosedSourceFrontierModel("o3-mini")).toBe(true);
    expect(isClosedSourceFrontierModel("o4-mini")).toBe(true);
  });

  test("名称含 oss 的开源变体（如 gpt-oss）不应被视作闭源", () => {
    expect(isClosedSourceFrontierModel("gpt-oss-120b")).toBe(false);
    expect(isClosedSourceFrontierModel("GPT-4-OSS")).toBe(false);
    expect(isClosedSourceFrontierModel("gpt-oss:20b")).toBe(false);
  });

  test("开源模型（Llama, DeepSeek, Qwen, Mistral 等）不被误判为闭源", () => {
    expect(isClosedSourceFrontierModel("Llama-3-70B")).toBe(false);
    expect(isClosedSourceFrontierModel("DeepSeek-V3")).toBe(false);
    expect(isClosedSourceFrontierModel("DeepSeek-R1")).toBe(false);
    expect(isClosedSourceFrontierModel("Qwen2.5-72B")).toBe(false);
    expect(isClosedSourceFrontierModel("Mistral-Large")).toBe(false);
    expect(isClosedSourceFrontierModel("Olmo-3-7B-Think")).toBe(false);
  });
});

describe("参数草稿填写判定 isParamsDraftFilled & shouldHighlightParamsRow", () => {
  test("草稿未填且非闭源时应当高亮", () => {
    const openRow = createParamsRow({ modelName: "Llama-3-70B", totalParamsB: null });
    const draft = toParamsDraft(openRow);

    expect(isParamsDraftFilled(openRow, draft)).toBe(false);
    expect(shouldHighlightParamsRow(openRow, draft)).toBe(true);
  });

  test("草稿已填值不高亮", () => {
    const openRow = createParamsRow({ modelName: "Llama-3-70B", totalParamsB: 70 });
    const draft = toParamsDraft(openRow);

    expect(isParamsDraftFilled(openRow, draft)).toBe(true);
    expect(shouldHighlightParamsRow(openRow, draft)).toBe(false);
  });

  test("闭源模型即使未填值也不高亮", () => {
    const gptRow = createParamsRow({ modelName: "GPT-4o", totalParamsB: null });
    const claudeRow = createParamsRow({ modelName: "Claude 3.5 Sonnet", totalParamsB: null });
    const geminiRow = createParamsRow({ modelName: "Gemini 2.0 Flash", totalParamsB: null });
    const o1Row = createParamsRow({ modelName: "o1-preview", totalParamsB: null });

    expect(shouldHighlightParamsRow(gptRow, toParamsDraft(gptRow))).toBe(false);
    expect(shouldHighlightParamsRow(claudeRow, toParamsDraft(claudeRow))).toBe(false);
    expect(shouldHighlightParamsRow(geminiRow, toParamsDraft(geminiRow))).toBe(false);
    expect(shouldHighlightParamsRow(o1Row, toParamsDraft(o1Row))).toBe(false);
  });

  test("含 oss 的开源衍生模型未填值时应当高亮", () => {
    const gptOssRow = createParamsRow({ modelName: "gpt-oss-120b", totalParamsB: null });
    expect(shouldHighlightParamsRow(gptOssRow, toParamsDraft(gptOssRow))).toBe(true);
  });
});

function ParamsTabTestHarness({ initialRows }: { initialRows: ModelParamsRow[] }) {
  const [params] = useState(initialRows);
  const [drafts, setDrafts] = useState<Record<number, ModelParamsDraft>>(() =>
    initialRows.reduce<Record<number, ModelParamsDraft>>((acc, row) => {
      acc[row.modelId] = toParamsDraft(row);
      return acc;
    }, {})
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "filled" | "missing" | "suggested">("all");

  return (
    <ParamsTab
      params={params}
      loadingParams={false}
      applyingSuggestions={false}
      savingParamsModelId={null}
      savingAllParams={false}
      dirtyParamsCount={0}
      paramsSearchQuery={query}
      setParamsSearchQuery={setQuery}
      paramsStatusFilter={filter}
      setParamsStatusFilter={setFilter}
      paramsDrafts={drafts}
      updateParamsDraft={(modelId, updater) =>
        setDrafts((prev) => ({
          ...prev,
          [modelId]: updater(prev[modelId] ?? toParamsDraft(params.find((p) => p.modelId === modelId)!))
        }))
      }
      onLoadParams={vi.fn()}
      onSaveParams={vi.fn()}
      onSaveAllParams={vi.fn()}
      onDiscardParamsDrafts={vi.fn()}
      onApplyAllSuggestions={vi.fn()}
      onApplySuggestion={vi.fn()}
    />
  );
}

describe("ParamsTab 表格未填值行高亮渲染", () => {
  test("开源未填值模型轻微高亮，闭源模型不高亮，已填值模型不高亮", () => {
    const rows: ModelParamsRow[] = [
      createParamsRow({ modelId: 1, modelName: "Llama-3-70B", totalParamsB: null }),
      createParamsRow({ modelId: 2, modelName: "GPT-4o", totalParamsB: null }),
      createParamsRow({ modelId: 3, modelName: "Claude 3.5 Sonnet", totalParamsB: null }),
      createParamsRow({ modelId: 4, modelName: "Gemini 2.0 Flash", totalParamsB: null }),
      createParamsRow({ modelId: 5, modelName: "o1-preview", totalParamsB: null }),
      createParamsRow({ modelId: 6, modelName: "gpt-oss-120b", totalParamsB: null }),
      createParamsRow({ modelId: 7, modelName: "Qwen2.5-72B", totalParamsB: 72 })
    ];

    render(<ParamsTabTestHarness initialRows={rows} />);

    // Llama-3-70B: 开源未填值 -> 应高亮
    const llamaRow = screen.getByText("Llama-3-70B").closest("tr");
    expect(llamaRow).toHaveClass("bg-warning/10");
    expect(llamaRow).toHaveAttribute("title", "未填写模型参数量");

    // GPT-4o: 闭源未填值 -> 不高亮
    const gptRow = screen.getByText("GPT-4o").closest("tr");
    expect(gptRow).not.toHaveClass("bg-warning/10");
    expect(gptRow).not.toHaveAttribute("title", "未填写模型参数量");

    // Claude 3.5 Sonnet: 闭源未填值 -> 不高亮
    const claudeRow = screen.getByText("Claude 3.5 Sonnet").closest("tr");
    expect(claudeRow).not.toHaveClass("bg-warning/10");

    // Gemini 2.0 Flash: 闭源未填值 -> 不高亮
    const geminiRow = screen.getByText("Gemini 2.0 Flash").closest("tr");
    expect(geminiRow).not.toHaveClass("bg-warning/10");

    // o1-preview: 闭源未填值 -> 不高亮
    const o1Row = screen.getByText("o1-preview").closest("tr");
    expect(o1Row).not.toHaveClass("bg-warning/10");

    // gpt-oss-120b: 开源衍生未填值 -> 应高亮
    const gptOssRow = screen.getByText("gpt-oss-120b").closest("tr");
    expect(gptOssRow).toHaveClass("bg-warning/10");

    // Qwen2.5-72B: 已填值 -> 不高亮
    const qwenRow = screen.getByText("Qwen2.5-72B").closest("tr");
    expect(qwenRow).not.toHaveClass("bg-warning/10");
  });

  test("输入参数量时高亮即时消失，清空时即时恢复", async () => {
    const user = userEvent.setup();
    const rows: ModelParamsRow[] = [
      createParamsRow({ modelId: 1, modelName: "DeepSeek-V3", totalParamsB: null })
    ];

    render(<ParamsTabTestHarness initialRows={rows} />);

    const row = screen.getByText("DeepSeek-V3").closest("tr");
    expect(row).toHaveClass("bg-warning/10");

    // 找到总参数量输入框并输入 671
    const totalInput = screen.getByPlaceholderText("--");
    expect(totalInput).toHaveClass("border-warning/40");

    await user.type(totalInput, "671");

    // 输入后高亮立即解除
    expect(row).not.toHaveClass("bg-warning/10");
    expect(totalInput).not.toHaveClass("border-warning/40");

    // 清空输入框后高亮恢复
    await user.clear(totalInput);
    expect(row).toHaveClass("bg-warning/10");
    expect(totalInput).toHaveClass("border-warning/40");
  });
});

