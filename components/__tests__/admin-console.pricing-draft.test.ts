import { describe, expect, test } from "vitest";
import type { ModelPricingRow } from "@/components/admin-console/types";
import {
  buildPricingUpdatePayload,
  countDirtyPricingDrafts,
  isPricingDraftDirty,
  toPricingDraft
} from "@/components/admin-console/utils/pricing-draft";

function createRow(overrides: Partial<ModelPricingRow> = {}): ModelPricingRow {
  return {
    modelId: 1,
    modelName: "GPT-4o",
    providerName: "OpenAI",
    modelCreatedAt: "2024-05-13T00:00:00.000Z",
    source: "models.dev",
    sourceProviderId: "openai",
    sourceProviderName: "OpenAI",
    sourceModelId: "gpt-4o",
    sourceModelName: "GPT-4o",
    releaseDate: "2024-05-13",
    inputCost: 5,
    outputCost: 15,
    reasoningCost: null,
    cacheReadCost: 2.5,
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
    updatedAt: "2024-05-13T00:00:00.000Z",
    ...overrides
  };
}

describe("pricing-draft utils", () => {
  test("toPricingDraft 正确提取 releaseDate", () => {
    const row = createRow({ releaseDate: "2024-05-13" });
    const draft = toPricingDraft(row);

    expect(draft.releaseDate).toBe("2024-05-13");
    expect(draft.inputCost).toBe("5");
    expect(draft.outputCost).toBe("15");

    const emptyDateRow = createRow({ releaseDate: null });
    expect(toPricingDraft(emptyDateRow).releaseDate).toBe("");
  });

  test("isPricingDraftDirty 能正确感知 releaseDate 的修改", () => {
    const row = createRow({ releaseDate: "2024-05-13" });
    const draft = toPricingDraft(row);

    expect(isPricingDraftDirty(row, draft)).toBe(false);

    const updatedDraft = { ...draft, releaseDate: "2024-06-01" };
    expect(isPricingDraftDirty(row, updatedDraft)).toBe(true);

    const clearedDraft = { ...draft, releaseDate: "" };
    expect(isPricingDraftDirty(row, clearedDraft)).toBe(true);

    // 纯空格与 null 视为未改动
    const emptyRow = createRow({ releaseDate: null });
    const emptyDraft = { ...toPricingDraft(emptyRow), releaseDate: "   " };
    expect(isPricingDraftDirty(emptyRow, emptyDraft)).toBe(false);
  });

  test("countDirtyPricingDrafts 统计包含 releaseDate 改动的脏草稿数量", () => {
    const row1 = createRow({ modelId: 1, releaseDate: "2024-05-13" });
    const row2 = createRow({ modelId: 2, releaseDate: null });

    const drafts = {
      1: { ...toPricingDraft(row1), releaseDate: "2024-06-01" },
      2: toPricingDraft(row2)
    };

    expect(countDirtyPricingDrafts([row1, row2], drafts)).toBe(1);
  });

  test("buildPricingUpdatePayload 包含规范化后的 releaseDate", () => {
    const row = createRow({ modelId: 1 });
    const draft = { ...toPricingDraft(row), releaseDate: "  2024-06-01  " };

    const payload = buildPricingUpdatePayload(row.modelId, draft, row);
    expect(payload.releaseDate).toBe("2024-06-01");
    expect(payload.modelId).toBe(1);

    const emptyDraft = { ...toPricingDraft(row), releaseDate: "   " };
    const emptyPayload = buildPricingUpdatePayload(row.modelId, emptyDraft, row);
    expect(emptyPayload.releaseDate).toBeNull();
  });
});

