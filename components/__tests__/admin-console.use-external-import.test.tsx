import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExternalImport } from "@/components/admin-console/hooks/use-external-import";
import * as api from "@/components/admin-console/api";
import type { ExternalImportSnapshot } from "@/components/admin-console/types";

vi.mock("@/components/admin-console/api", () => ({
  getJson: vi.fn(),
  postJson: vi.fn()
}));

function makeSnapshot(): ExternalImportSnapshot {
  return {
    apiKeyConfigured: true,
    fetchedAt: "2026-08-02T00:00:00.000Z",
    sourceLabel: "Artificial Analysis",
    attributionUrl: "https://artificialanalysis.ai/",
    catalog: [],
    config: { selectedMetrics: [], metricOverrides: {} },
    mappings: [
      {
        modelId: 1,
        modelName: "GPT 5.4",
        providerName: "OpenAI",
        externalModelId: "aa-xhigh",
        externalModelName: "GPT 5.4 (xhigh)",
        externalCreator: "OpenAI",
        reasoningEffort: "xhigh",
        matchStatus: "matched",
        matchConfidence: 88,
        matchReason: "highest-effort-default",
        manualOverride: false,
        externalMissing: false
      },
      {
        modelId: 2,
        modelName: "Claude Opus 5",
        providerName: "Anthropic",
        externalModelId: "aa-opus",
        externalModelName: "Claude Opus 5",
        externalCreator: "Anthropic",
        reasoningEffort: null,
        matchStatus: "matched",
        matchConfidence: 95,
        matchReason: "fuzzy-model-name",
        manualOverride: false,
        externalMissing: false
      }
    ],
    upstreamOnly: [],
    conflicts: [],
    upstreamOptions: [],
    intelligenceIndexVersion: 4.1,
    freePageCount: 1,
    legacyWarning: null
  };
}

describe("useExternalImport - saveMappings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("设为（不绑定）时保存提交 matchStatus: 'unmatched' 且 manualOverride: true", async () => {
    const snapshot = makeSnapshot();
    vi.mocked(api.getJson).mockResolvedValue(snapshot);
    vi.mocked(api.postJson).mockResolvedValue({ ok: true, updatedCount: 1 });

    const notifySuccess = vi.fn();
    const notifyError = vi.fn();

    const { result } = renderHook(() => useExternalImport({ notifySuccess, notifyError }));

    // 1. 先加载快照
    await act(async () => {
      await result.current.loadSnapshot();
    });

    // 2. 将模型 1 设为（不绑定）：externalModelId 为 null，ignored 为 false
    act(() => {
      result.current.updateMappingDraft(1, (current) => ({
        ...current,
        externalModelId: null,
        reasoningEffort: null,
        ignored: false,
        manualOverride: true
      }));
    });

    expect(result.current.dirtyMappingCount).toBe(1);

    // 3. 点击保存匹配
    await act(async () => {
      await result.current.saveMappings();
    });

    expect(api.postJson).toHaveBeenCalledWith(
      "/api/admin/external-import/artificial-analysis/mappings",
      {
        updates: [
          {
            modelId: 1,
            externalModelId: null,
            reasoningEffort: null,
            matchStatus: "unmatched",
            manualOverride: true
          }
        ]
      },
      "PATCH"
    );
  });

  test("勾选忽略时保存提交 matchStatus: 'ignored' 且 manualOverride: false", async () => {
    const snapshot = makeSnapshot();
    vi.mocked(api.getJson).mockResolvedValue(snapshot);
    vi.mocked(api.postJson).mockResolvedValue({ ok: true, updatedCount: 1 });

    const notifySuccess = vi.fn();
    const notifyError = vi.fn();

    const { result } = renderHook(() => useExternalImport({ notifySuccess, notifyError }));

    // 1. 加载快照
    await act(async () => {
      await result.current.loadSnapshot();
    });

    // 2. 勾选模型 2 为忽略
    act(() => {
      result.current.updateMappingDraft(2, (current) => ({
        ...current,
        ignored: true,
        manualOverride: false
      }));
    });

    expect(result.current.dirtyMappingCount).toBe(1);

    // 3. 点击保存匹配
    await act(async () => {
      await result.current.saveMappings();
    });

    expect(api.postJson).toHaveBeenCalledWith(
      "/api/admin/external-import/artificial-analysis/mappings",
      {
        updates: [
          {
            modelId: 2,
            externalModelId: null,
            reasoningEffort: null,
            matchStatus: "ignored",
            manualOverride: false
          }
        ]
      },
      "PATCH"
    );
  });
});
