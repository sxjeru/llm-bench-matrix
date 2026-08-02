import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExternalImportTab } from "@/components/admin-console/views/external-import-tab";
import type { ExternalImportSnapshot, ExternalMappingDraft } from "@/components/admin-console/types";

function makeSnapshot(overrides: Partial<ExternalImportSnapshot> = {}): ExternalImportSnapshot {
  return {
    apiKeyConfigured: true,
    fetchedAt: "2026-08-02T00:00:00.000Z",
    sourceLabel: "Artificial Analysis",
    catalog: [
      {
        key: "mmlu_pro",
        group: "evaluation",
        label: "MMLU-Pro",
        benchmarkType: "Knowledge",
        unit: "%",
        higherIsBetter: true,
        modalities: ["Text"],
        valueScale: "fraction",
        modelCount: 120,
        minValue: 0.4,
        maxValue: 0.92,
        sampleValues: [0.791]
      },
      {
        key: "median_time_to_first_token_seconds",
        group: "performance",
        label: "Time To First Token",
        unit: "s",
        benchmarkType: "Performance",
        higherIsBetter: false,
        modalities: ["Text"],
        valueScale: "absolute",
        modelCount: 300,
        minValue: 0.38,
        maxValue: 20,
        sampleValues: [14.939]
      }
    ],
    config: { selectedMetrics: ["mmlu_pro"], metricOverrides: {} },
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
        modelName: "某个自研模型",
        providerName: "Internal",
        externalModelId: null,
        externalModelName: null,
        externalCreator: null,
        reasoningEffort: null,
        matchStatus: "unmatched",
        matchConfidence: 0,
        matchReason: "no-match",
        manualOverride: false,
        externalMissing: false
      }
    ],
    upstreamOnly: [
      {
        externalModelId: "aa-new",
        externalModelName: "Kimi K3 (max)",
        externalModelSlug: "kimi-k3-max",
        externalCreator: "Kimi"
      }
    ],
    conflicts: [],
    upstreamOptions: [
      {
        externalModelId: "aa-xhigh",
        externalModelName: "GPT 5.4 (xhigh)",
        externalModelSlug: "gpt-5-4-xhigh",
        externalCreator: "OpenAI"
      },
      {
        externalModelId: "aa-high",
        externalModelName: "GPT 5.4 (high)",
        externalModelSlug: "gpt-5-4-high",
        externalCreator: "OpenAI"
      }
    ],
    ...overrides
  };
}

function renderTab(overrides: Partial<Parameters<typeof ExternalImportTab>[0]> = {}) {
  const snapshot = overrides.snapshot === undefined ? makeSnapshot() : overrides.snapshot;
  const drafts: Record<number, ExternalMappingDraft> = {};
  for (const row of snapshot?.mappings ?? []) {
    drafts[row.modelId] = {
      externalModelId: row.externalModelId,
      reasoningEffort: row.reasoningEffort,
      ignored: row.matchStatus === "ignored",
      manualOverride: row.manualOverride
    };
  }

  const props = {
    snapshot,
    loading: false,
    savingMappings: false,
    savingConfig: false,
    previewing: false,
    importing: false,
    summary: null,
    mappingDrafts: drafts,
    selectedMetrics: snapshot?.config.selectedMetrics ?? [],
    metricOverrides: {},
    createExternalModelIds: [],
    searchQuery: "",
    setSearchQuery: vi.fn(),
    statusFilter: "all" as const,
    setStatusFilter: vi.fn(),
    dirtyMappingCount: 0,
    configDirty: false,
    onLoadSnapshot: vi.fn(),
    onUpdateMappingDraft: vi.fn(),
    onDiscardMappingDrafts: vi.fn(),
    onToggleMetric: vi.fn(),
    onSetAllMetrics: vi.fn(),
    onUpdateMetricOverride: vi.fn(),
    onToggleCreateModel: vi.fn(),
    onSaveMappings: vi.fn(),
    onSaveConfig: vi.fn(),
    onPreviewImport: vi.fn(),
    onRunImport: vi.fn(),
    ...overrides
  };

  render(<ExternalImportTab {...props} />);
}

describe("ExternalImportTab", () => {
  test("渲染指标目录，并标出需要 ×100 的小数量纲", () => {
    renderTab();

    expect(screen.getByText("mmlu_pro")).toBeInTheDocument();
    expect(screen.getByDisplayValue("MMLU-Pro")).toBeInTheDocument();
    expect(screen.getByText(/上游 0-1，导入时 ×100/)).toBeInTheDocument();
  });

  test("勾选数据项会回调 onToggleMetric", async () => {
    const user = userEvent.setup();
    const onToggleMetric = vi.fn();
    renderTab({ onToggleMetric });

    await user.click(screen.getByLabelText("选择数据项 Time To First Token"));

    expect(onToggleMetric).toHaveBeenCalledWith("median_time_to_first_token_seconds");
  });

  test("把「默认取上游最高强度」的匹配来源翻译成中文说明", () => {
    renderTab();

    expect(screen.getByText("本地未标强度，默认取上游最高档")).toBeInTheDocument();
  });

  test("统计里单独给出「默认取最高强度」的条数", () => {
    renderTab();

    const card = screen.getByText("默认取最高强度").parentElement!;
    expect(card).toHaveTextContent("1");
  });

  test("手动改绑上游条目会回调 onUpdateMappingDraft", async () => {
    const user = userEvent.setup();
    const onUpdateMappingDraft = vi.fn();
    renderTab({ onUpdateMappingDraft });

    await user.selectOptions(screen.getByLabelText("GPT 5.4 的上游条目"), "aa-high");

    expect(onUpdateMappingDraft).toHaveBeenCalled();
    const [modelId, updater] = onUpdateMappingDraft.mock.calls[0]!;
    expect(modelId).toBe(1);
    expect(
      updater({ externalModelId: "aa-xhigh", reasoningEffort: "xhigh", ignored: false, manualOverride: false })
    ).toEqual({
      externalModelId: "aa-high",
      reasoningEffort: "xhigh",
      ignored: false,
      manualOverride: true
    });
  });

  test("上游独有模型默认不勾选，勾选后回调 onToggleCreateModel", async () => {
    const user = userEvent.setup();
    const onToggleCreateModel = vi.fn();
    renderTab({ onToggleCreateModel });

    const checkbox = screen.getByLabelText("创建 Kimi K3 (max)");
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(onToggleCreateModel).toHaveBeenCalledWith("aa-new");
  });

  test("未配置 API key 时给出提示并禁用预览/导入", () => {
    renderTab({ snapshot: makeSnapshot({ apiKeyConfigured: false }) });

    expect(screen.getByText(/未配置/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /预览导入/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /执行导入/ })).toBeDisabled();
  });

  test("上游条目被多个本地模型绑定时给出冲突告警", () => {
    renderTab({
      snapshot: makeSnapshot({
        conflicts: [{ externalModelId: "aa-xhigh", externalModelName: "GPT 5.4 (xhigh)", modelIds: [1, 2] }]
      })
    });

    expect(screen.getByText(/被多个本地模型同时绑定/)).toBeInTheDocument();
  });

  test("预览结果按新增/追加/覆盖分别统计", () => {
    renderTab({
      summary: {
        source: "text:Artificial Analysis",
        total: 3,
        inserted: 1,
        appended: 1,
        unchanged: 1,
        skipped: 0,
        createdBenchmarks: ["MMLU-Pro"],
        createdModels: [],
        matchedModelCount: 1,
        metricCount: 1,
        benchTime: "2026-08-02T00:00:00.000Z",
        dryRun: true,
        preview: [
          {
            modelName: "GPT 5.4",
            benchmarkName: "MMLU-Pro",
            benchmarkType: "Knowledge",
            rawValue: "79.1",
            previousValue: null,
            outcome: "inserted"
          },
          {
            modelName: "Claude Opus 5",
            benchmarkName: "MMLU-Pro",
            benchmarkType: "Knowledge",
            rawValue: "83",
            previousValue: "83",
            outcome: "unchanged"
          }
        ]
      }
    });

    expect(screen.getByText("预览结果（未落库）")).toBeInTheDocument();
    expect(screen.getByText("将新建 benchmark：MMLU-Pro")).toBeInTheDocument();
    expect(screen.getByText("覆盖（值未变）")).toBeInTheDocument();
  });

  test("尚未拉取上游时给出引导文案", () => {
    renderTab({ snapshot: null });

    expect(screen.getByText(/点击「拉取上游」后在这里选择要导入的数据项/)).toBeInTheDocument();
    expect(screen.getByText("尚未拉取上游数据")).toBeInTheDocument();
  });
});
