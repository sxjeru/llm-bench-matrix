import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { AdminConsole } from "@/components/admin-console";
import type { ModelPricingRow } from "@/components/admin-console/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}));

type AdminConsoleProps = Parameters<typeof AdminConsole>[0];

type PreviewResponse = {
  format: string;
  total: number;
  skipped: number;
  warningCount: number;
  previewRows: Array<{
    rowNumber: number;
    providerName: string;
    modelName: string;
    benchmarkName: string;
    benchmarkType: string;
      benchmarkTypeProvided?: boolean;
    modalities?: string[];
    rawValue: string;
    valueNum: number | null;
    valueNum2: number | null;
    valueNote: string | null;
    source: string | null;
    valid: boolean;
  }>;
};

function createJsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload
  } as Response;
}

function mockFetchSequence(...payloads: unknown[]) {
  const queuedPayloads = [...payloads];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void init;
    if (url.startsWith("/api/admin/benchmarks/value-overlap")) {
      return createJsonResponse({ conflictCount: 0, overlapCount: 0 });
    }
    return createJsonResponse(queuedPayloads.shift() ?? {});
  });

  const globalFetchWrapper = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url === "/api/admin/benchmarks/preview-value-overlap") {
      return createJsonResponse({ stats: [] });
    }

    return fetchMock(url, init);
  };

  vi.stubGlobal("fetch", globalFetchWrapper);
  return fetchMock;
}

function buildProps(): AdminConsoleProps {
  return {
    providers: [
      { id: 1, name: "OpenAI", slug: "openai" },
      { id: 2, name: "Google", slug: "google" }
    ],
    models: [
      { id: 1, providerId: 1, modelName: "Model A", canonicalKey: "model-a" },
      { id: 2, providerId: 1, modelName: "Model B", canonicalKey: "model-b" }
    ],
    benchmarks: [
      { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] },
      { id: 12, benchmarkName: "Bench-2", benchmarkType: "Type-B", modalities: ["Vision"] }
    ],
    sourceOptions: ["text:sample"],
    mergedRecords: [],
    initialSettings: {}
  };
}

function buildPropsWithDisplayName(): AdminConsoleProps {
  return {
    ...buildProps(),
    providers: [
      { id: 1, name: "OpenAI", slug: "openai", config: { displayName: "OpenAI Official" } },
      { id: 2, name: "Google", slug: "google" }
    ],
    models: [
      { id: 1, providerId: 1, modelName: "GPT-4.1", canonicalKey: "gpt-41" },
      { id: 2, providerId: 1, modelName: "Model B", canonicalKey: "model-b" }
    ]
  };
}

function buildPropsWithDisplayNameAndPrefixRule(): AdminConsoleProps {
  return {
    ...buildPropsWithDisplayName(),
    providers: [
      {
        id: 1,
        name: "OpenAI",
        slug: "openai",
        config: {
          displayName: "OpenAI Official",
          prefixRules: [{ prefix: "gpt", enabled: true }]
        }
      },
      { id: 2, name: "Google", slug: "google" }
    ]
  };
}

function buildPriceRow(overrides: Partial<ModelPricingRow> = {}): ModelPricingRow {
  return {
    modelId: 1,
    modelName: "Model A",
    providerName: "OpenAI",
    source: "models.dev",
    sourceProviderId: "openai",
    sourceProviderName: "OpenAI",
    sourceModelId: "model-a",
    sourceModelName: "Model A",
    inputCost: 1,
    outputCost: 2,
    reasoningCost: null,
    cacheReadCost: 0.1,
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
    updatedAt: "2026-05-26T00:00:00.000Z",
    ...overrides
  };
}

async function fillCsvText(user: ReturnType<typeof userEvent.setup>, value: string) {
  const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
  if (!textarea) {
    throw new Error("CSV textarea not found");
  }

  await user.clear(textarea);
  await user.type(textarea, value);
}

async function triggerPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "预览导入结果" }));
}

async function findMatrixPreviewTable() {
  const matrixHeading = await screen.findByRole("heading", { name: "矩阵预览（可编辑）" });
  const matrixContainer = matrixHeading.parentElement;
  if (!matrixContainer) {
    throw new Error("Matrix preview container not found");
  }

  const matrixTable = matrixContainer.querySelector("table") as HTMLTableElement | null;
  if (!matrixTable) {
    throw new Error("Matrix preview table not found");
  }

  return matrixTable;
}

async function openMergeTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "实体去重" }));
}

function buildDuplicateDetectionResponse() {
  return {
    generatedAt: "2026-04-09T12:34:56.000Z",
    modelCandidates: [
      {
        sourceId: 1,
        sourceName: "Model A",
        sourceProviderName: "OpenAI",
        sourceValueCount: 10,
        targetId: 2,
        targetName: "Model B",
        targetProviderName: "OpenAI",
        targetValueCount: 12,
        confidence: "high",
        similarity: 0.98,
        characterRepeatScore: 0.97,
        reasons: ["normalized-name-equal"]
      }
    ],
    benchmarkCandidates: [
      {
        sourceId: 11,
        sourceName: "Bench-1",
        sourceType: "Type-A",
        sourceSourceSummary: "text:old-source",
        sourceValueCount: 8,
        targetId: 12,
        targetName: "Bench-2",
        targetType: "Type-B",
        targetSourceSummary: "text:new-source",
        targetValueCount: 13,
        confidence: "medium",
        similarity: 0.93,
        characterRepeatScore: 0.92,
        reasons: ["char-similarity-0.930"]
      }
    ]
  };
}

if (typeof Element !== "undefined") {
  const elementPrototype = Element.prototype as unknown as Record<string, unknown>;
  const hasScrollIntoView = typeof Reflect.get(elementPrototype, "scrollIntoView") === "function";

  if (!hasScrollIntoView) {
    Object.defineProperty(elementPrototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: () => {}
    });
  }
}

describe("AdminConsole text import", () => {
  test("价格管理在空结果已加载后不应因重复切换标签再次请求", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchSequence({ prices: [] });

    render(<AdminConsole {...buildProps()} />);

    await user.click(screen.getByRole("tab", { name: "价格管理" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled();
    });

    await user.click(screen.getByRole("tab", { name: "导入中心" }));
    await user.click(screen.getByRole("tab", { name: "价格管理" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  test("价格管理状态筛选应响应未保存的手动覆盖草稿", async () => {
    const user = userEvent.setup();
    mockFetchSequence({
      prices: [
        buildPriceRow({ modelId: 1, modelName: "Auto Model", sourceModelId: "auto-model", manualOverride: false, matchStatus: "matched" }),
        buildPriceRow({ modelId: 2, modelName: "Manual Model", sourceModelId: "manual-model", manualOverride: true, matchStatus: "manual" })
      ]
    });

    render(<AdminConsole {...buildProps()} />);

    await user.click(screen.getByRole("tab", { name: "价格管理" }));
    expect(await screen.findByText("Auto Model")).toBeInTheDocument();
    expect(screen.getByText("Manual Model")).toBeInTheDocument();

    const statusFilter = screen.getByDisplayValue("全部");
    await user.selectOptions(statusFilter, "matched");
    expect(screen.getByText("Auto Model")).toBeInTheDocument();
    expect(screen.queryByText("Manual Model")).not.toBeInTheDocument();

    const autoRow = screen.getByText("Auto Model").closest("tr");
    if (!autoRow) throw new Error("Auto Model row not found");
    await user.click(within(autoRow).getByRole("checkbox"));
    await waitFor(() => {
      expect(screen.queryByText("Auto Model")).not.toBeInTheDocument();
    });

    await user.selectOptions(statusFilter, "manual");
    expect(await screen.findByText("Auto Model")).toBeInTheDocument();
    expect(screen.getByText("Manual Model")).toBeInTheDocument();

    const manualRow = screen.getByText("Manual Model").closest("tr");
    if (!manualRow) throw new Error("Manual Model row not found");
    await user.click(within(manualRow).getByRole("checkbox"));
    await waitFor(() => {
      expect(screen.queryByText("Manual Model")).not.toBeInTheDocument();
    });

    await user.selectOptions(statusFilter, "matched");
    expect(await screen.findByText("Manual Model")).toBeInTheDocument();
    expect(screen.queryByText("Auto Model")).not.toBeInTheDocument();
  });

  test("价格管理修改价格后保存应自动开启手动覆盖", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchSequence({ prices: [buildPriceRow({ modelId: 1, modelName: "Model A", inputCost: 1 })] });

    render(<AdminConsole {...buildProps()} />);

    await user.click(screen.getByRole("tab", { name: "价格管理" }));
    expect(await screen.findByText("Model A")).toBeInTheDocument();

    const row = screen.getByText("Model A").closest("tr");
    if (!row) throw new Error("Model A row not found");

    const manualOverrideCheckbox = within(row).getByRole("checkbox");
    expect(manualOverrideCheckbox).not.toBeChecked();

    const inputCost = within(row).getByPlaceholderText("$1");
    await user.clear(inputCost);
    await user.type(inputCost, "1.5");

    expect(manualOverrideCheckbox).toBeChecked();

    await user.click(within(row).getByRole("button", { name: /保存/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/model-prices",
        expect.objectContaining({
          method: "PATCH",
          body: expect.any(String)
        })
      );
    });

    const patchCall = fetchMock.mock.calls.find(([input, init]) => input === "/api/admin/model-prices" && init?.method === "PATCH");
    expect(patchCall).toBeDefined();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual(
      expect.objectContaining({
        modelId: 1,
        inputCost: 1.5,
        manualOverride: true,
        matchStatus: "manual"
      })
    );
  });

  test("价格管理保存时应拒绝部分数字字符串", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchSequence({ prices: [buildPriceRow({ modelId: 1, modelName: "Model A", inputCost: 1 })] });

    render(<AdminConsole {...buildProps()} />);

    await user.click(screen.getByRole("tab", { name: "价格管理" }));
    expect(await screen.findByText("Model A")).toBeInTheDocument();

    const row = screen.getByText("Model A").closest("tr");
    if (!row) throw new Error("Model A row not found");

    const inputCost = within(row).getByPlaceholderText("$1");
    await user.clear(inputCost);
    await user.type(inputCost, "1abc");
    await user.click(within(row).getByRole("button", { name: /保存/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  test("矩阵预览表头显示 Benchmark/Type 计数", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 3,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "Bench-1",
          benchmarkType: "Type-A",
          rawValue: "70.1",
          valueNum: 70.1,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        },
        {
          rowNumber: 2,
          providerName: "OpenAI",
          modelName: "Model B",
          benchmarkName: "Bench-1",
          benchmarkType: "Type-A",
          rawValue: "71.2",
          valueNum: 71.2,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        },
        {
          rowNumber: 3,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "Bench-2",
          benchmarkType: "Type-B",
          rawValue: "80.3",
          valueNum: 80.3,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    mockFetchSequence(previewResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const matrixTable = await findMatrixPreviewTable();
    const matrixHeaders = within(matrixTable).getAllByRole("columnheader");

    const benchmarkHeader = matrixHeaders[1];
    expect(benchmarkHeader).toHaveTextContent("Benchmark");
    expect(benchmarkHeader).toHaveTextContent("(2)");
    expect(benchmarkHeader).not.toHaveTextContent("Benchmark 2");

    const typeHeader = matrixHeaders[2];
    expect(typeHeader).toHaveTextContent("Type");
    expect(typeHeader).toHaveTextContent("(2)");
    expect(typeHeader).not.toHaveTextContent("Type 2");
  });

  test("导入 >100 数值且缺少同名 Elo benchmark 时高亮告警", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "GDPval-AA",
          benchmarkType: "General",
          rawValue: "1215",
          valueNum: 1215,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    mockFetchSequence(previewResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const matrixTable = await findMatrixPreviewTable();
    const benchmarkInput = within(matrixTable).getByDisplayValue("GDPval-AA");
    const benchmarkCell = benchmarkInput.closest("th");

    expect(benchmarkCell).toHaveClass("bg-warning/15");
    expect(await screen.findByText("检测到 >100 Elo 数值，但库内不存在 GDPval-AA (Elo)")).toBeInTheDocument();
  });

  test("可批量把同一注释应用到所有星号数值", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 3,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "MathKangaroo",
          benchmarkType: "Math",
          rawValue: "84.4*",
          valueNum: 84.4,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        },
        {
          rowNumber: 2,
          providerName: "OpenAI",
          modelName: "Model B",
          benchmarkName: "MathKangaroo",
          benchmarkType: "Math",
          rawValue: "83.1*",
          valueNum: 83.1,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        },
        {
          rowNumber: 3,
          providerName: "OpenAI",
          modelName: "Model B",
          benchmarkName: "MathKangaroo",
          benchmarkType: "Math",
          rawValue: "82.0",
          valueNum: 82,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    mockFetchSequence(previewResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const globalInput = await screen.findByPlaceholderText("为全部 * 数值设置同一注释");
    await user.type(globalInput, "data.from.the.technical.report.");
    await user.click(screen.getByRole("button", { name: "应用到全部 *" }));

    const starInputs = screen.getAllByPlaceholderText("可选补充注释");
    expect(starInputs).toHaveLength(2);
    expect(starInputs[0]).toHaveValue("data.from.the.technical.report.");
    expect(starInputs[1]).toHaveValue("data.from.the.technical.report.");
  });

  test("星号注释输入支持句号并写入历史下拉", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "MathKangaroo",
          benchmarkType: "Math",
          rawValue: "84.4*",
          valueNum: 84.4,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    mockFetchSequence(previewResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const starInput = (await screen.findAllByPlaceholderText("可选补充注释"))[0];
    await user.clear(starInput);
    await user.type(starInput, "v1.2.3.");
    await user.tab();

    expect(starInput).toHaveValue("v1.2.3.");

    const historyOption = document.querySelector(
      '#star-note-history-options option[value="v1.2.3."]'
    );
    expect(historyOption).not.toBeNull();
  });

  test("预览返回 warningCount 时展示解析警告提示", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 2,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "Bench-1",
          benchmarkType: "Type-A",
          rawValue: "70.1",
          valueNum: 70.1,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    mockFetchSequence(previewResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    expect(await screen.findByText(/检测到 2 条解析警告/)).toBeInTheDocument();
  });

  test("导入返回 warningCount 时展示自动处理提示", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "Bench-1",
          benchmarkType: "Type-A",
          rawValue: "70.1",
          valueNum: 70.1,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    const importResponse = {
      format: "structured-csv",
      total: 1,
      skipped: 0,
      inserted: 1,
      warningCount: 1,
      warnings: [{ reason: "demo" }]
    };

    const fetchMock = mockFetchSequence(previewResponse, importResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);
    await user.click(screen.getByRole("button", { name: "执行导入" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText(/已自动处理 1 条解析警告/)).toBeInTheDocument();
  });

  test("同名 benchmark 导入时保留导入 type 与 modality", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "structured-csv",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "Bench-1",
          benchmarkType: "Type-New",
          modalities: ["Vision"],
          rawValue: "70.1",
          valueNum: 70.1,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    const importResponse = {
      format: "structured-csv",
      total: 1,
      skipped: 0,
      inserted: 1,
      warningCount: 0,
      warnings: []
    };

    const fetchMock = mockFetchSequence(previewResponse, importResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);
    await user.click(screen.getByRole("button", { name: "执行导入" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => input === "/api/admin/import-csv")).toBe(true);
    });

    const importCalls = fetchMock.mock.calls.filter(([input]) => input === "/api/admin/import-csv");
    expect(importCalls).toHaveLength(1);
    const importCsvCall = importCalls[0];
    const importPayload = JSON.parse(((importCsvCall[1] as RequestInit).body ?? "{}") as string) as {
      csvText?: string;
    };

    expect(importPayload.csvText).toContain("Bench-1,Type-New");
    expect(importPayload.csvText).toContain("Vision");
    expect(importPayload.csvText).not.toContain("Bench-1,Type-A");
  });

  test("未提供 type 的行会写入 benchmark_type_provided=0", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "matrix-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "Bench-1",
          benchmarkType: "General",
          benchmarkTypeProvided: false,
          modalities: ["Text"],
          rawValue: "70.1",
          valueNum: 70.1,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    const importResponse = {
      format: "structured-csv",
      total: 1,
      skipped: 0,
      inserted: 1,
      warningCount: 0,
      warnings: []
    };

    const fetchMock = mockFetchSequence(previewResponse, importResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);
    await user.click(screen.getByRole("button", { name: "执行导入" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => call[0] === "/api/admin/import-csv")).toBe(true);
    });

    const importCalls = fetchMock.mock.calls.filter((call) => call[0] === "/api/admin/import-csv");
    expect(importCalls).toHaveLength(1);
    const importCsvCall = importCalls[0];
    const importPayload = JSON.parse(((importCsvCall[1] as RequestInit).body ?? "{}") as string) as {
      csvText?: string;
    };

    expect(importPayload.csvText).toContain("Bench-1,General,0");
  });

  test("星号值支持 *:// 语法并自动回填注释输入", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "MathKangaroo",
          benchmarkType: "Math",
          rawValue: "84.4*://https://paper.example/alpha",
          valueNum: 84.4,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    mockFetchSequence(previewResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const starInput = (await screen.findAllByPlaceholderText("可选补充注释"))[0];
    expect(starInput).toHaveValue("https://paper.example/alpha");
  });

  test("成对数值在同 benchmark 下可自动补齐注释", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 2,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "MultiTask",
          benchmarkType: "General",
          rawValue: "70 / 80",
          valueNum: 70,
          valueNum2: 80,
          valueNote: null,
          source: "text:sample",
          valid: true
        },
        {
          rowNumber: 2,
          providerName: "OpenAI",
          modelName: "Model B",
          benchmarkName: "MultiTask",
          benchmarkType: "General",
          rawValue: "71/81",
          valueNum: 71,
          valueNum2: 81,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    mockFetchSequence(previewResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const pairInputs = Array.from(
      document.querySelectorAll('input[list="pair-note-history-options"]')
    ) as HTMLInputElement[];
    expect(pairInputs).toHaveLength(2);

    await user.clear(pairInputs[0]);
    await user.type(pairInputs[0], "paired.note.");
    await user.tab();

    await waitFor(() => {
      expect(pairInputs[1]).toHaveValue("paired.note.");
    });
  });

  test("执行导入时会把星号注释重组回 value_raw", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "MathKangaroo",
          benchmarkType: "Math",
          rawValue: "84.4*",
          valueNum: 84.4,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    const importResponse = {
      format: "structured-csv",
      total: 1,
      skipped: 0,
      inserted: 1,
      warningCount: 0,
      warnings: []
    };

    const fetchMock = mockFetchSequence(previewResponse, importResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const starInput = (await screen.findAllByPlaceholderText("可选补充注释"))[0];
    await user.clear(starInput);
    await user.type(starInput, "manual.note");

    await user.click(screen.getByRole("button", { name: "执行导入" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1];
    const secondPayload = JSON.parse(((secondCall[1] as RequestInit).body ?? "{}") as string) as {
      csvText?: string;
    };

    expect(secondPayload.csvText).toContain("84.4* manual.note");
  });

  test("执行导入时会把成对值注释重组回 value_raw", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "MultiTask",
          benchmarkType: "General",
          rawValue: "70/80",
          valueNum: 70,
          valueNum2: 80,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    const importResponse = {
      format: "structured-csv",
      total: 1,
      skipped: 0,
      inserted: 1,
      warningCount: 0,
      warnings: []
    };

    const fetchMock = mockFetchSequence(previewResponse, importResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const pairInput = document.querySelector(
      'input[list="pair-note-history-options"]'
    ) as HTMLInputElement | null;
    if (!pairInput) {
      throw new Error("Pair note input not found");
    }

    await user.clear(pairInput);
    await user.type(pairInput, "paired.note");
    await user.tab();

    await user.click(screen.getByRole("button", { name: "执行导入" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1];
    const secondPayload = JSON.parse(((secondCall[1] as RequestInit).body ?? "{}") as string) as {
      csvText?: string;
    };

    expect(secondPayload.csvText).toContain("70 / 80 paired.note");
  });

  test("矩阵 Model 输入编辑时保持焦点，失焦后才提交重命名", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 2,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "Bench-1",
          benchmarkType: "Type-A",
          rawValue: "70.1",
          valueNum: 70.1,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        },
        {
          rowNumber: 2,
          providerName: "OpenAI",
          modelName: "Model B",
          benchmarkName: "Bench-1",
          benchmarkType: "Type-A",
          rawValue: "71.2",
          valueNum: 71.2,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    const importResponse = {
      format: "structured-csv",
      total: 2,
      skipped: 0,
      inserted: 2,
      warningCount: 0,
      warnings: []
    };

    const fetchMock = mockFetchSequence(previewResponse, importResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const matrixTable = await findMatrixPreviewTable();
    const modelInput = within(matrixTable).getByDisplayValue("Model A") as HTMLInputElement;

    await user.click(modelInput);
    await user.type(modelInput, " Prime");

    expect(modelInput).toHaveFocus();
    expect(modelInput).toHaveValue("Model A Prime");

    await user.tab();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Model A Prime")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "执行导入" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1];
    const secondPayload = JSON.parse(((secondCall[1] as RequestInit).body ?? "{}") as string) as {
      csvText?: string;
    };

    expect(secondPayload.csvText).toContain("Model A Prime");
  });

  test("矩阵 Benchmark 输入编辑时保持焦点，失焦后才提交重命名", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 2,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "Bench-1",
          benchmarkType: "Type-A",
          rawValue: "70.1",
          valueNum: 70.1,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        },
        {
          rowNumber: 2,
          providerName: "OpenAI",
          modelName: "Model B",
          benchmarkName: "Bench-2",
          benchmarkType: "Type-B",
          rawValue: "71.2",
          valueNum: 71.2,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    const importResponse = {
      format: "structured-csv",
      total: 2,
      skipped: 0,
      inserted: 2,
      warningCount: 0,
      warnings: []
    };

    const fetchMock = mockFetchSequence(previewResponse, importResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const matrixTable = await findMatrixPreviewTable();
    const benchmarkInput = within(matrixTable).getByDisplayValue("Bench-1") as HTMLInputElement;

    await user.click(benchmarkInput);
    await user.type(benchmarkInput, "-Renamed");

    expect(benchmarkInput).toHaveFocus();
    expect(benchmarkInput).toHaveValue("Bench-1-Renamed");

    await user.tab();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Bench-1-Renamed")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "执行导入" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1];
    const secondPayload = JSON.parse(((secondCall[1] as RequestInit).body ?? "{}") as string) as {
      csvText?: string;
    };

    expect(secondPayload.csvText).toContain("Bench-1-Renamed");
  });

  test("矩阵预览中的重复嫌疑 benchmark 下拉候选不应为空", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "Bench 1",
          benchmarkType: "Type-C",
          rawValue: "70.1",
          valueNum: 70.1,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    mockFetchSequence(previewResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const matrixTable = await findMatrixPreviewTable();
    const benchmarkInput = within(matrixTable).getByDisplayValue("Bench 1") as HTMLInputElement;
    const benchmarkRow = benchmarkInput.closest("tr");
    if (!benchmarkRow) {
      throw new Error("Benchmark row not found");
    }

    await user.click(benchmarkInput);

    const optionButton = screen.getByRole("option", {
      name: /Bench-1 \[Type-A\] \[11\]/
    });

    expect(optionButton).toBeInTheDocument();
  });

  test("矩阵预览中的重复嫌疑 benchmark 候选显示重复率与冲突数", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 2,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "Bench 1",
          benchmarkType: "Type-C",
          rawValue: "70.1",
          valueNum: 70.1,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        },
        {
          rowNumber: 2,
          providerName: "OpenAI",
          modelName: "Model B",
          benchmarkName: "Bench 1",
          benchmarkType: "Type-C",
          rawValue: "71.2",
          valueNum: 71.2,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    const queuedPayloads: unknown[] = [previewResponse];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url === "/api/admin/benchmarks/preview-value-overlap") {
        return createJsonResponse({
          stats: [
            {
              previewBenchmarkKey: "Bench 1@@Type-C",
              candidateBenchmarkId: 11,
              previewTotal: 2,
              modelOverlapCount: 2,
              exactDuplicateCount: 1,
              conflictCount: 1,
              duplicateRate: 0.5
            }
          ]
        });
      }

      return createJsonResponse(queuedPayloads.shift() ?? {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const matrixTable = await findMatrixPreviewTable();
    const benchmarkInput = within(matrixTable).getByDisplayValue("Bench 1") as HTMLInputElement;
    const benchmarkRow = benchmarkInput.closest("tr");
    if (!benchmarkRow) {
      throw new Error("Benchmark row not found");
    }

    await user.click(benchmarkInput);

    expect(await screen.findByText("重复 1/2 (50%) · 重叠 2 · 冲突 1")).toBeInTheDocument();
  });

  test("矩阵预览中的 benchmark 候选无统计返回时也显示默认重复率", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "Bench 1",
          benchmarkType: "Type-C",
          rawValue: "70.1",
          valueNum: 70.1,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    const queuedPayloads: unknown[] = [previewResponse];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url === "/api/admin/benchmarks/preview-value-overlap") {
        return createJsonResponse({ stats: [] });
      }

      return createJsonResponse(queuedPayloads.shift() ?? {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const matrixTable = await findMatrixPreviewTable();
    const benchmarkInput = within(matrixTable).getByDisplayValue("Bench 1") as HTMLInputElement;

    await user.click(benchmarkInput);

    expect(await screen.findByText("重复 0")).toBeInTheDocument();
  });

  test("预览内 benchmark 快捷合并后仍优先保留导入 type", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "Bench 1",
          benchmarkType: "Professional",
          rawValue: "70.1",
          valueNum: 70.1,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    const importResponse = {
      format: "structured-csv",
      total: 1,
      skipped: 0,
      inserted: 1,
      warningCount: 0,
      warnings: []
    };

    const fetchMock = mockFetchSequence(previewResponse, importResponse);
    render(
      <AdminConsole
        {...{
          ...buildProps(),
          benchmarks: [
            { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] },
            { id: 12, benchmarkName: "Bench-2", benchmarkType: "Type-B", modalities: ["Vision"] }
          ]
        }}
      />
    );

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const matrixTable = await findMatrixPreviewTable();
    const benchmarkInput = within(matrixTable).getByDisplayValue("Bench 1") as HTMLInputElement;
    const benchmarkRow = benchmarkInput.closest("tr");
    if (!benchmarkRow) {
      throw new Error("Benchmark row not found");
    }

    await user.click(benchmarkInput);

    const optionButton = screen.getByRole("option", {
      name: /Bench-1 \[Type-A\] \[11\]/
    });
    await user.click(optionButton);

    await user.click(screen.getByRole("button", { name: "执行导入" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => call[0] === "/api/admin/import-csv")).toBe(true);
    });

    const importCall = fetchMock.mock.calls.find((call) => call[0] === "/api/admin/import-csv");
    const secondPayload = JSON.parse(((importCall?.[1] as RequestInit).body ?? "{}") as string) as {
      csvText?: string;
    };

    expect(secondPayload.csvText).toContain("Bench-1,Professional");
  });

  test("重复嫌疑与快捷合并按原始文本顺序展示", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 2,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model.B",
          benchmarkName: "Last Exam Beta",
          benchmarkType: "Type-X",
          rawValue: "70.1",
          valueNum: 70.1,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        },
        {
          rowNumber: 2,
          providerName: "OpenAI",
          modelName: "Model-A",
          benchmarkName: "Last Exam Alpha",
          benchmarkType: "Type-X",
          rawValue: "71.2",
          valueNum: 71.2,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    mockFetchSequence(previewResponse);
    render(<AdminConsole {...buildProps()} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const benchmarkHeading = await screen.findByRole("heading", { name: "重复嫌疑与快捷合并" });
    const benchmarkSection = benchmarkHeading.parentElement;
    if (!benchmarkSection) {
      throw new Error("benchmark warning section not found");
    }

    const benchmarkNames = Array.from(
      benchmarkSection.querySelectorAll("div.rounded-box.border.p-3 > div.mb-2 > span.font-semibold")
    )
      .map((node) => node.textContent?.trim())
      .filter((text): text is string => Boolean(text));

    expect(benchmarkNames.slice(0, 2)).toEqual(["Last Exam Beta", "Last Exam Alpha"]);

    const modelHeading = await screen.findByRole("heading", { name: "模型重名嫌疑与快捷合并" });
    const modelSection = modelHeading.parentElement;
    if (!modelSection) {
      throw new Error("model warning section not found");
    }

    const modelNames = Array.from(
      modelSection.querySelectorAll("div.rounded-box.border.p-3 > div.mb-2 > span.font-semibold")
    )
      .map((node) => node.textContent?.trim())
      .filter((text): text is string => Boolean(text));

    expect(modelNames.slice(0, 2)).toEqual(["Model.B", "Model-A"]);
  });

  test("XLSX 预览会同步到统一矩阵预览，且导入走结构化文本通道", async () => {
    const user = userEvent.setup();

    const workbookPreviewResponse = {
      sheetNames: ["Sheet1"],
      selectedSheet: "Sheet1",
      benchmarkColumn: "Benchmark",
      categoryColumn: "Category",
      modelColumns: ["Model A", "Model B"],
      parsedCount: 2,
      warningCount: 0,
      warnings: [],
      previewRows: [
        {
          rowNumber: 2,
          category: "Professional",
          benchmarkName: "GDPval",
          modelName: "Model A",
          rawValue: "83",
          valueNum: 83,
          valueNum2: null,
          valueNote: null,
          valid: true
        },
        {
          rowNumber: 3,
          category: null,
          benchmarkName: "FinanceAgent v1.1",
          modelName: "Model B",
          rawValue: "61.5",
          valueNum: 61.5,
          valueNum2: null,
          valueNote: null,
          valid: true
        }
      ]
    };

    const importResponse = {
      format: "structured-csv",
      total: 2,
      skipped: 0,
      inserted: 2,
      warningCount: 0,
      warnings: []
    };

    const fetchMock = mockFetchSequence(workbookPreviewResponse, importResponse);
    render(<AdminConsole {...buildProps()} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!fileInput) {
      throw new Error("Workbook file input not found");
    }

    const workbookFile = new File(["dummy"], "bench.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    fireEvent.change(fileInput, { target: { files: [workbookFile] } });
    expect(fileInput.files).toHaveLength(1);

    const previewButton = screen.getByRole("button", { name: "解析并预览" });
    const workbookForm = previewButton.closest("form") as HTMLFormElement | null;
    if (!workbookForm) {
      throw new Error("Workbook preview form not found");
    }

    fireEvent.submit(workbookForm);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const matrixTable = await findMatrixPreviewTable();
    const financeBenchmarkInput = within(matrixTable).getByDisplayValue("FinanceAgent v1.1");
    const financeRow = financeBenchmarkInput.closest("tr");
    if (!financeRow) {
      throw new Error("Finance benchmark row not found");
    }

    expect(within(financeRow).getByDisplayValue("Professional")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "导入当前工作表" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall[0]).toBe("/api/admin/import-csv");

    const secondPayload = JSON.parse(((secondCall[1] as RequestInit).body ?? "{}") as string) as {
      csvText?: string;
    };

    expect(secondPayload.csvText).toContain("GDPval");
    expect(secondPayload.csvText).toContain("FinanceAgent v1.1");
    expect(secondPayload.csvText).toContain("xlsm:Sheet1");
  });

  test("编辑预览模型名后导入会按新模型名更新 provider 划分", async () => {
    const user = userEvent.setup();

    const previewResponse = {
      format: "structured-csv",
      total: 1,
      skipped: 0,
      previewRows: [
        {
          rowNumber: 2,
          providerName: "OpenAI",
          modelName: "GPT-5-mini",
          benchmarkName: "SWE-bench",
          benchmarkType: "Agent",
          benchmarkTypeProvided: true,
          higherIsBetter: true,
          modalities: ["Text"],
          rawValue: "71.2",
          valueNum: 71.2,
          valueNum2: null,
          valueNote: null,
          source: "text:paste",
          valid: true
        }
      ]
    };

    const importResponse = {
      format: "structured-preview",
      total: 1,
      skipped: 0,
      inserted: 1,
      warningCount: 0,
      warnings: []
    };

    const fetchMock = mockFetchSequence(previewResponse, importResponse);
    render(<AdminConsole {...buildProps()} />);

    await user.type(screen.getByLabelText("粘贴 CSV / 文本"), "model,benchmark,value\nGPT-5-mini,SWE-bench,71.2");
    await user.click(screen.getByRole("button", { name: "预览导入结果" }));

    const modelInput = await screen.findByDisplayValue("GPT-5-mini");
    await user.clear(modelInput);
    await user.type(modelInput, "Claude 3.7 Sonnet");

    await user.click(screen.getByRole("button", { name: "执行导入" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall[0]).toBe("/api/admin/import-csv");

    const secondPayload = JSON.parse(((secondCall[1] as RequestInit).body ?? "{}") as string) as {
      rows?: Array<{ modelName: string; providerName: string }>;
    };

    expect(secondPayload.rows).toEqual([
      expect.objectContaining({
        modelName: "Claude 3.7 Sonnet",
        providerName: "Claude"
      })
    ]);
  });

  test("已有模型命中 displayName 时导入仍提交规范 provider 名", async () => {
    const user = userEvent.setup();

    const previewResponse = {
      format: "structured-csv",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI Official",
          providerDisplayName: "OpenAI Official",
          modelName: "GPT-4.1",
          benchmarkName: "SWE-bench",
          benchmarkType: "Agent",
          benchmarkTypeProvided: true,
          higherIsBetter: true,
          modalities: ["Text"],
          rawValue: "75.1",
          valueNum: 75.1,
          valueNum2: null,
          valueNote: null,
          source: "text:paste",
          valid: true
        }
      ]
    };

    const importResponse = {
      format: "structured-preview",
      total: 1,
      skipped: 0,
      inserted: 1,
      warningCount: 0,
      warnings: []
    };

    const fetchMock = mockFetchSequence(previewResponse, importResponse);
    render(<AdminConsole {...buildPropsWithDisplayName()} />);

    await user.type(screen.getByLabelText("粘贴 CSV / 文本"), "model,benchmark,value\nGPT-4.1,SWE-bench,75.1");
    await user.click(screen.getByRole("button", { name: "预览导入结果" }));

    await screen.findByDisplayValue("GPT-4.1");
    await user.click(screen.getByRole("button", { name: "执行导入" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1];
    const secondPayload = JSON.parse(((secondCall[1] as RequestInit).body ?? "{}") as string) as {
      rows?: Array<{ modelName: string; providerName: string; providerDisplayName?: string }>;
    };

    expect(secondPayload.rows).toEqual([
      expect.objectContaining({
        modelName: "GPT-4.1",
        providerName: "OpenAI",
        providerDisplayName: "OpenAI Official"
      })
    ]);
  });

  test("编辑预览模型名命中前缀规则时导入仍提交规范 provider 名", async () => {
    const user = userEvent.setup();

    const previewResponse = {
      format: "structured-csv",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "Other",
          modelName: "OtherModel",
          benchmarkName: "SWE-bench",
          benchmarkType: "Agent",
          benchmarkTypeProvided: true,
          higherIsBetter: true,
          modalities: ["Text"],
          rawValue: "72.3",
          valueNum: 72.3,
          valueNum2: null,
          valueNote: null,
          source: "text:paste",
          valid: true
        }
      ]
    };

    const importResponse = {
      format: "structured-preview",
      total: 1,
      skipped: 0,
      inserted: 1,
      warningCount: 0,
      warnings: []
    };

    const fetchMock = mockFetchSequence(previewResponse, importResponse);
    render(<AdminConsole {...buildPropsWithDisplayNameAndPrefixRule()} />);

    await user.type(screen.getByLabelText("粘贴 CSV / 文本"), "model,benchmark,value\nOtherModel,SWE-bench,72.3");
    await user.click(screen.getByRole("button", { name: "预览导入结果" }));

    const modelInput = await screen.findByDisplayValue("OtherModel");
    await user.clear(modelInput);
    await user.type(modelInput, "GPT-4.1-mini");
    await user.click(screen.getByRole("button", { name: "执行导入" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1];
    const secondPayload = JSON.parse(((secondCall[1] as RequestInit).body ?? "{}") as string) as {
      rows?: Array<{ modelName: string; providerName: string; providerDisplayName?: string }>;
    };

    expect(secondPayload.rows).toEqual([
      expect.objectContaining({
        modelName: "GPT-4.1-mini",
        providerName: "OpenAI",
        providerDisplayName: "OpenAI Official"
      })
    ]);
  });
});

describe("AdminConsole data maintenance", () => {
  test("可检测混合量纲并触发同化为 1 量纲", async () => {
    const user = userEvent.setup();

    const consistencyResponse = {
      generatedAt: "2026-04-18T10:00:00.000Z",
      issues: [
        {
          issueType: "mixed-scale-0-1-vs-100",
          recommendedAction: "normalize-scale",
          benchmarkId: 11,
          benchmarkName: "Bench-1",
          benchmarkType: "Type-A",
          valueCount: 12,
          smallValueCount: 4,
          largeValueCount: 8,
          zeroToHundredCount: 12,
          overHundredCount: 0,
          minValue: 0.12,
          maxValue: 87.4,
          segments: [
            {
              key: "small",
              label: "0-1",
              count: 4,
              minValue: 0.12,
              maxValue: 0.12
            },
            {
              key: "large",
              label: ">10",
              count: 8,
              minValue: 87.4,
              maxValue: 87.4
            }
          ],
          valueDetails: [
            {
              value: 0.12,
              field: "valueNum",
              modelName: "Model A",
              source: "text:seed",
              benchTime: "2026-04-18T09:00:00.000Z"
            },
            {
              value: 87.4,
              field: "valueNum",
              modelName: "Model B",
              source: "text:seed",
              benchTime: "2026-04-18T09:05:00.000Z"
            }
          ]
        }
      ]
    };

    const normalizeResponse = {
      ok: true,
      benchmarkId: 11,
      benchmarkName: "Bench-1",
      benchmarkType: "Type-A",
      targetScale: 1,
      updatedRows: 8,
      updatedCells: 8
    };

    const consistencyAfterNormalizedResponse = {
      generatedAt: "2026-04-18T10:05:00.000Z",
      issues: []
    };

    const fetchMock = mockFetchSequence(
      consistencyResponse,
      normalizeResponse,
      consistencyAfterNormalizedResponse
    );

    render(<AdminConsole {...buildProps()} />);

    await user.click(screen.getByRole("tab", { name: "数据维护" }));
    await user.click(screen.getByRole("button", { name: "开始一致性检测" }));

    expect(await screen.findByText("Bench-1")).toBeInTheDocument();
    expect(screen.getByText("总值 12")).toBeInTheDocument();
    expect(screen.getAllByText(/text:seed/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "同化为 1 量纲" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    const normalizeCall = fetchMock.mock.calls[1];
    expect(normalizeCall?.[0]).toBe("/api/admin/data-maintenance/normalize-scale");

    const normalizePayload = JSON.parse(((normalizeCall?.[1] as RequestInit).body ?? "{}") as string) as {
      benchmarkId?: number;
      targetScale?: number;
    };

    expect(normalizePayload).toEqual({
      benchmarkId: 11,
      targetScale: 1
    });

    expect(await screen.findByText("最近一次检测未发现混合量纲问题。")).toBeInTheDocument();
  });

  test("可检测 0-100 与 >100 的 Elo 混用并触发拆分", async () => {
    const user = userEvent.setup();

    const consistencyResponse = {
      generatedAt: "2026-04-18T10:00:00.000Z",
      issues: [
        {
          issueType: "mixed-scale-100-vs-elo",
          recommendedAction: "split-benchmark",
          benchmarkId: 21,
          benchmarkName: "Arena Hard",
          benchmarkType: "arena",
          valueCount: 6,
          smallValueCount: 0,
          largeValueCount: 6,
          zeroToHundredCount: 3,
          overHundredCount: 3,
          minValue: 72,
          maxValue: 1215,
          segments: [
            { key: "base", label: "0-100", count: 3, minValue: 72, maxValue: 92 },
            { key: "elo", label: ">100 (Elo)", count: 3, minValue: 1102, maxValue: 1215 }
          ],
          valueDetails: [
            {
              value: 87,
              field: "valueNum",
              modelName: "Model A",
              source: "text:seed",
              benchTime: "2026-04-18T09:00:00.000Z"
            },
            {
              value: 1215,
              field: "valueNum2",
              modelName: "Model A",
              source: "text:seed",
              benchTime: "2026-04-18T09:00:00.000Z"
            }
          ]
        }
      ]
    };

    const splitResponse = {
      ok: true,
      benchmarkId: 21,
      benchmarkName: "Arena Hard",
      benchmarkType: "arena",
      splitMode: "hundred-vs-elo",
      baseBenchmarkId: 21,
      baseBenchmarkName: "Arena Hard",
      baseBenchmarkType: "arena",
      eloBenchmarkId: 31,
      eloBenchmarkName: "Arena Hard (Elo)",
      eloBenchmarkType: "arena",
      movedRows: 1,
      splitRows: 1,
      createdRows: 1
    };

    const consistencyAfterSplitResponse = {
      generatedAt: "2026-04-18T10:05:00.000Z",
      issues: []
    };

    const fetchMock = mockFetchSequence(
      consistencyResponse,
      splitResponse,
      consistencyAfterSplitResponse
    );

    render(<AdminConsole {...buildProps()} />);

    await user.click(screen.getByRole("tab", { name: "数据维护" }));
    await user.click(screen.getByRole("button", { name: "开始一致性检测" }));

    expect(await screen.findByText("Arena Hard")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Arena Hard")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Arena Hard (Elo)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "拆分为原 benchmark + Elo" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    const splitCall = fetchMock.mock.calls[1];
    expect(splitCall?.[0]).toBe("/api/admin/data-maintenance/split-benchmark-scale");

    const splitPayload = JSON.parse(((splitCall?.[1] as RequestInit).body ?? "{}") as string) as {
      benchmarkId?: number;
      splitMode?: string;
      baseBenchmarkName?: string;
      eloBenchmarkName?: string;
    };

    expect(splitPayload).toEqual({
      benchmarkId: 21,
      splitMode: "hundred-vs-elo",
      baseBenchmarkName: "Arena Hard",
      eloBenchmarkName: "Arena Hard (Elo)"
    });

    expect(await screen.findByText("最近一次检测未发现混合量纲问题。")).toBeInTheDocument();
  });
});

describe("AdminConsole provider config", () => {
  async function openProviderConfigPanel(user: ReturnType<typeof userEvent.setup>, providerName: string) {
    await user.click(screen.getByRole("tab", { name: "Provider 配置" }));
    await user.click(screen.getByPlaceholderText("搜索或输入新 Provider 名称…"));

    const option = await screen.findByText(providerName);
    const optionButton = option.closest('[role="button"]') as HTMLElement | null;
    if (!optionButton) {
      throw new Error(`${providerName} provider option not found`);
    }

    await user.click(optionButton);

    const providerSlug = providerName.toLowerCase();
    const panel = await waitFor(() => {
      const slugBadge = screen.getByText(providerSlug);
      const matchedPanel = slugBadge.closest("section");
      if (!matchedPanel) {
        throw new Error(`${providerName} provider section not found`);
      }
      return matchedPanel;
    });

    if (!panel) {
      throw new Error(`${providerName} provider section not found`);
    }

    return panel;
  }

  test("删除前缀规则后其余输入值保持对应行", async () => {
    const user = userEvent.setup();

    render(
      <AdminConsole
        {...buildProps()}
        providers={[
          {
            id: 1,
            name: "OpenAI",
            slug: "openai",
            config: {
              prefixRules: [
                { prefix: "gpt-", enabled: true },
                { prefix: "o1-", enabled: true },
                { prefix: "o3-", enabled: true }
              ]
            }
          },
          { id: 2, name: "Google", slug: "google" }
        ]}
      />
    );

    const openAiSection = await openProviderConfigPanel(user, "OpenAI");

    const getPrefixInputs = () => within(openAiSection).getAllByPlaceholderText("例如 gpt-") as HTMLInputElement[];
    const getDeleteButtons = () =>
      within(openAiSection)
        .getAllByRole("button")
        .filter((button) => button.className.includes("btn-square"));

    expect(getPrefixInputs().map((input) => input.value)).toEqual(["gpt-", "o1-", "o3-"]);

    await user.click(getDeleteButtons()[0]!);

    expect(getPrefixInputs().map((input) => input.value)).toEqual(["o1-", "o3-"]);
  });

  test("清空展示名与品牌色时会发送 null，并在预览中回退默认值", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchSequence({ provider: { id: 1 } });

    render(
      <AdminConsole
        {...buildProps()}
        providers={[
          {
            id: 1,
            name: "OpenAI",
            slug: "openai",
            config: {
              displayName: "OpenAI Official",
              branding: { color: "#00d084" }
            }
          },
          { id: 2, name: "Google", slug: "google" }
        ]}
      />
    );

    const openAiSection = await openProviderConfigPanel(user, "OpenAI");

    const displayNameInput = within(openAiSection).getByDisplayValue("OpenAI Official");
    const brandingColorInput = within(openAiSection).getAllByDisplayValue("#00d084")[1] as HTMLInputElement;

    await user.clear(displayNameInput);
    await user.clear(brandingColorInput);

    const previewValue = within(openAiSection).getAllByText("OpenAI")[1] as HTMLElement;

    expect(previewValue).toHaveTextContent("OpenAI");
    expect(previewValue.getAttribute("style")).toContain("color:");

    await user.click(within(openAiSection).getByRole("button", { name: "保存配置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/providers");

    const payload = JSON.parse(((requestInit as RequestInit).body ?? "{}") as string) as {
      providerId?: number;
      config?: {
        displayName?: string | null;
        branding?: {
          color?: string | null;
        };
      };
    };

    expect(payload.providerId).toBe(1);
    expect(payload.config?.displayName).toBeNull();
    expect(payload.config?.branding?.color).toBeNull();
  });

  test("删除 provider 需二次确认，并携带迁移目标执行删除", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchSequence({ ok: true, providerId: 1, transferTargetProviderId: 2, transferredModelCount: 1 });

    render(
      <AdminConsole
        {...buildProps()}
        providers={[
          {
            id: 1,
            name: "OpenAI",
            slug: "openai",
            config: {
              displayName: "OpenAI Official",
              prefixRules: [{ prefix: "gpt-", enabled: true }],
              branding: { color: "#00d084" }
            }
          },
          { id: 2, name: "Google", slug: "google" }
        ]}
      />
    );

    const openAiSection = await openProviderConfigPanel(user, "OpenAI");
    const deleteButton = within(openAiSection).getByRole("button", { name: "删除 Provider" });
    const saveButton = within(openAiSection).getByRole("button", { name: "保存配置" });

    expect(deleteButton).toBeInTheDocument();
    expect(saveButton).toBeInTheDocument();

    await user.click(deleteButton);

    const confirmTitle = await screen.findByText("确认删除 Provider？");
    const confirmDialog = confirmTitle.closest("div.w-full.max-w-xl") as HTMLElement | null;
    if (!confirmDialog) {
      throw new Error("Provider delete confirm dialog not found");
    }

    const transferSelect = within(confirmDialog).getByRole("combobox") as HTMLSelectElement;
    await user.selectOptions(transferSelect, "2");

    await user.click(within(confirmDialog).getByRole("button", { name: "确认迁移并删除" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/providers");

    const payload = JSON.parse(((requestInit as RequestInit).body ?? "{}") as string) as {
      providerId?: number;
      config?: {
        displayName?: string | null;
        displayTargetProviderId?: number | null;
        prefixRules?: Array<{ prefix: string; enabled: boolean }>;
        branding?: {
          color?: string | null;
        };
      };
    };

    expect(payload).toEqual({
      providerId: 1,
      transferTargetProviderId: 2
    });
  });

  test("保存 provider 配置时保留 prefix rule 的 priority 与 note", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchSequence({ provider: { id: 1 } });

    render(
      <AdminConsole
        {...buildProps()}
        providers={[
          {
            id: 1,
            name: "OpenAI",
            slug: "openai",
            config: {
              prefixRules: [
                { prefix: "gpt-", enabled: true, priority: 1, note: "Primary" },
                { prefix: "o1-", enabled: false, note: "Legacy" }
              ]
            }
          },
          { id: 2, name: "Google", slug: "google" }
        ]}
      />
    );

    const openAiSection = await openProviderConfigPanel(user, "OpenAI");

    await user.click(within(openAiSection).getByRole("button", { name: "保存配置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/providers");

    const payload = JSON.parse(((requestInit as RequestInit).body ?? "{}") as string) as {
      config?: {
        prefixRules?: Array<{
          prefix: string;
          enabled: boolean;
          priority?: number;
          note?: string;
        }>;
      };
    };

    expect(payload.config?.prefixRules).toEqual([
      { prefix: "gpt-", enabled: true, priority: 1, note: "Primary" },
      { prefix: "o1-", enabled: false, note: "Legacy" }
    ]);
  });

  test("可设置展示归并目标并正确提交 payload", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchSequence({ provider: { id: 1 } });

    render(
      <AdminConsole
        {...buildPropsWithDisplayName()}
        providers={[
          { id: 1, name: "OpenAI", slug: "openai", config: { displayName: "OpenAI Official" } },
          { id: 2, name: "Google", slug: "google", config: { displayName: "Google Labs" } }
        ]}
      />
    );

    const openAiSection = await openProviderConfigPanel(user, "OpenAI");
    const mergeSelect = within(openAiSection).getByRole("combobox") as HTMLSelectElement;

    await user.selectOptions(mergeSelect, "2");

    expect(within(openAiSection).getByText("当前将归并展示到：Google Labs")).toBeInTheDocument();

    await user.click(within(openAiSection).getByRole("button", { name: "保存配置" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const payload = JSON.parse(((requestInit as RequestInit).body ?? "{}") as string) as {
      config?: {
        displayTargetProviderId?: number | null;
      };
    };

    expect(payload.config?.displayTargetProviderId).toBe(2);
  });

  test("展示归并目标列表隐藏已归并的 provider", async () => {
    const user = userEvent.setup();

    render(
      <AdminConsole
        {...buildPropsWithDisplayName()}
        providers={[
          { id: 1, name: "OpenAI", slug: "openai", config: { displayName: "OpenAI Official" } },
          { id: 2, name: "Google", slug: "google", config: { displayName: "Google Labs" } },
          { id: 3, name: "Anthropic", slug: "anthropic", config: { displayName: "Claude", displayTargetProviderId: 2 } }
        ]}
      />
    );

    const openAiSection = await openProviderConfigPanel(user, "OpenAI");
    const mergeSelect = within(openAiSection).getByRole("combobox") as HTMLSelectElement;
    const optionLabels = Array.from(mergeSelect.options).map((option) => option.textContent);

    expect(optionLabels).toContain("Google Labs (google)");
    expect(optionLabels).not.toContain("Claude (anthropic)");
  });

  test("Provider 搜索支持按 displayName 过滤并展示模型列表", async () => {
    const user = userEvent.setup();

    render(<AdminConsole {...buildPropsWithDisplayName()} />);

    await user.click(screen.getByRole("tab", { name: "Provider 配置" }));

    const searchInput = screen.getByPlaceholderText("搜索或输入新 Provider 名称…");
    await user.type(searchInput, "official");

    const option = await screen.findByText("OpenAI");
    const optionButton = option.closest('[role="button"]') as HTMLElement | null;
    expect(optionButton).toBeInTheDocument();
    expect(screen.queryByText("Google")).not.toBeInTheDocument();

    if (!optionButton) {
      throw new Error("OpenAI provider option not found");
    }

    await user.click(optionButton);

    expect(await screen.findByText("包含模型 (2)")).toBeInTheDocument();
    expect(screen.getByText("GPT-4.1")).toBeInTheDocument();
    expect(screen.getByText("model-b")).toBeInTheDocument();
  });
});

describe("AdminConsole merge interactions", () => {
  test("重复候选页签显示计数，点击填充可正确写入合并输入", async () => {
    const user = userEvent.setup();

    const duplicateResult = buildDuplicateDetectionResponse();
    mockFetchSequence(duplicateResult);

    render(<AdminConsole {...buildProps()} />);

    await openMergeTab(user);
    await user.click(screen.getByRole("button", { name: "检测重复候选" }));

    expect(await screen.findByRole("button", { name: "Model 候选（1）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Benchmark 候选（1）" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Benchmark 候选（1）" }));
    expect(await screen.findByText(/source text:old-source → text:new-source/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Model 候选（1）" }));

    const scrollSpy = vi.spyOn(
      HTMLElement.prototype as unknown as { scrollIntoView: () => void },
      "scrollIntoView"
    );

    await user.click(screen.getByRole("button", { name: "填充到合并表单" }));

    expect(screen.getByPlaceholderText("source：输入名称或ID")).toHaveValue("Model A [1]");
    expect(screen.getByPlaceholderText("target：输入名称或ID")).toHaveValue("Model B [2]");
    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled();
    });

    scrollSpy.mockRestore();
  });

  test("合并按钮状态变化，且成功后即时移除候选并更新合并记录", async () => {
    const user = userEvent.setup();

    const duplicateResult = buildDuplicateDetectionResponse();
    let resolveMergeResponse: (value: Response) => void = () => {
      throw new Error("merge response resolver not initialized");
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse(duplicateResult))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveMergeResponse = resolve;
          })
      );

    vi.stubGlobal("fetch", fetchMock);

    render(<AdminConsole {...buildProps()} />);

    await openMergeTab(user);
    await user.click(screen.getByRole("button", { name: "检测重复候选" }));
    await screen.findByRole("button", { name: "Model 候选（1）" });

    await user.click(screen.getByRole("button", { name: "填充到合并表单" }));

    await user.click(screen.getByRole("button", { name: "合并实体" }));
    expect(screen.getByRole("button", { name: "合并中..." })).toBeDisabled();

    resolveMergeResponse(createJsonResponse({ ok: true }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "已合并" })).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByText(/Model A \[1\]\s*→\s*Model B \[2\]/)).not.toBeInTheDocument();
    });

    const mergedRowSource = await screen.findByText("Model A [1]");
    const mergedRow = mergedRowSource.closest("tr");
    if (!mergedRow) {
      throw new Error("Merged record row not found");
    }

    expect(within(mergedRow).getByDisplayValue("Model B [2]")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("重复候选支持勾选并批量合并", async () => {
    const user = userEvent.setup();

    const duplicateResult = buildDuplicateDetectionResponse();
    duplicateResult.modelCandidates.push({
      sourceId: 3,
      sourceName: "Model C",
      sourceProviderName: "OpenAI",
      sourceValueCount: 4,
      targetId: 2,
      targetName: "Model B",
      targetProviderName: "OpenAI",
      targetValueCount: 12,
      confidence: "medium",
      similarity: 0.91,
      characterRepeatScore: 0.9,
      reasons: ["char-similarity-0.910"]
    });
    const fetchMock = mockFetchSequence(duplicateResult, { ok: true }, { ok: true });

    render(<AdminConsole {...buildProps()} />);

    await openMergeTab(user);
    await user.click(screen.getByRole("button", { name: "检测重复候选" }));
    await screen.findByRole("button", { name: "Model 候选（2）" });

    await user.click(screen.getByRole("checkbox", { name: "选择当前列表全部候选" }));
    expect(screen.getByText("已选 2 / 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "批量合并已选" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    expect(JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string)).toMatchObject({
      entityType: "model",
      sourceId: 1,
      targetId: 2
    });
    expect(JSON.parse((fetchMock.mock.calls[2]?.[1] as RequestInit).body as string)).toMatchObject({
      entityType: "model",
      sourceId: 3,
      targetId: 2
    });

    await waitFor(() => {
      expect(screen.queryByText(/Model A \[1\]\s*→\s*Model B \[2\]/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Model C \[3\]\s*→\s*Model B \[2\]/)).not.toBeInTheDocument();
    });
    expect(await screen.findByText("批量合并完成：2 条。")).toBeInTheDocument();
  });

  test("右上通知支持并列显示多条消息", async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ error: "重复检测失败-1" }, false, 500))
      .mockResolvedValueOnce(createJsonResponse({ error: "重复检测失败-2" }, false, 500));

    vi.stubGlobal("fetch", fetchMock);

    render(<AdminConsole {...buildProps()} />);

    await openMergeTab(user);

    await user.click(screen.getByRole("button", { name: "检测重复候选" }));
    expect(await screen.findByText("重复检测失败-1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "检测重复候选" }));
    expect(await screen.findByText("重复检测失败-2")).toBeInTheDocument();

    const errorNotices = screen.getAllByText(/重复检测失败-[12]/);
    expect(errorNotices).toHaveLength(2);
  });

  test("benchmark 合并时可同步修改 target benchmark 显示名", async () => {
    const user = userEvent.setup();

    const duplicateResult = buildDuplicateDetectionResponse();
    const fetchMock = mockFetchSequence(duplicateResult, { ok: true });

    render(<AdminConsole {...buildProps()} />);

    await openMergeTab(user);
    await user.click(screen.getByRole("button", { name: "检测重复候选" }));

    await user.click(screen.getByRole("button", { name: "Benchmark 候选（1）" }));
    await user.click(screen.getAllByRole("button", { name: "填充到合并表单" })[0]!);

    const renameInput = screen.getByPlaceholderText("可选：合并时同时修改 target benchmark 显示名称");
    await user.clear(renameInput);
    await user.type(renameInput, "Bench-2-Renamed");

    await user.click(screen.getByRole("button", { name: "合并实体" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    const mergeCall = fetchMock.mock.calls[2];
    const mergePayload = JSON.parse(((mergeCall?.[1] as RequestInit).body ?? "{}") as string) as {
      entityType?: string;
      targetBenchmarkName?: string;
    };

    expect(mergePayload.entityType).toBe("benchmark");
    expect(mergePayload.targetBenchmarkName).toBe("Bench-2-Renamed");

    const mergedRowSource = await screen.findByText(/Bench-1 \[Type-A\] \[11\]/);
    const mergedRow = mergedRowSource.closest("tr");
    if (!mergedRow) {
      throw new Error("Merged benchmark row not found");
    }

    expect(within(mergedRow).getByDisplayValue("Bench-2-Renamed [Type-B] [12]")).toBeInTheDocument();
  });
});

describe("AdminConsole rename tab", () => {
  test("可在名称维护页签搜索并提交 model 改名", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchSequence({
      ok: true,
      entityType: "model",
      entityId: 1,
      previousName: "Model A",
      nextName: "Model A Prime",
      action: "renamed"
    });

    render(<AdminConsole {...buildProps()} />);

    await user.click(screen.getByRole("tab", { name: "名称维护" }));

    const searchInput = screen.getByPlaceholderText("输入名称或 ID 关键字搜索实体");
    await user.clear(searchInput);
    await user.type(searchInput, "Model A");

    await user.click(await screen.findByText("Model A"));

    const renameInput = screen.getByPlaceholderText("输入新的 model 名称");
    await user.clear(renameInput);
    await user.type(renameInput, "Model A Prime");

    await user.click(screen.getByRole("button", { name: "保存名称变更" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/api/admin/rename-entity");

    const payload = JSON.parse(((call?.[1] as RequestInit).body ?? "{}") as string) as {
      entityType?: string;
      entityId?: number;
      nextName?: string;
      nextBenchmarkType?: string;
      mergeOnConflict?: boolean;
    };

    expect(payload).toMatchObject({
      entityType: "model",
      entityId: 1,
      nextName: "Model A Prime",
      mergeOnConflict: true
    });

    expect(await screen.findByText(/名称已更新并写入数据库/i)).toBeInTheDocument();
  });

  test("benchmark 改名时可一并维护 type", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchSequence({
      ok: true,
      entityType: "benchmark",
      entityId: 11,
      previousName: "Bench-1",
      previousBenchmarkType: "Type-A",
      nextName: "Bench-1 Prime",
      nextBenchmarkType: "Type-Z",
      action: "renamed"
    });

    render(<AdminConsole {...buildProps()} />);

    await user.click(screen.getByRole("tab", { name: "名称维护" }));
    await user.selectOptions(screen.getByRole("combobox"), "benchmark");

    const searchInput = screen.getByPlaceholderText("输入名称或 ID 关键字搜索实体");
    await user.clear(searchInput);
    await user.type(searchInput, "Bench-1");

    await user.click(await screen.findByText("Bench-1 [Type-A]"));

    const renameInput = screen.getByPlaceholderText("输入新的 benchmark 名称");
    await user.clear(renameInput);
    await user.type(renameInput, "Bench-1 Prime");

    const renameTypeInput = screen.getByPlaceholderText("输入新的 benchmark type");
    await user.clear(renameTypeInput);
    await user.type(renameTypeInput, "Type-Z");

    await user.click(screen.getByRole("button", { name: "保存名称变更" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/api/admin/rename-entity");

    const payload = JSON.parse(((call?.[1] as RequestInit).body ?? "{}") as string) as {
      entityType?: string;
      entityId?: number;
      nextName?: string;
      nextBenchmarkType?: string;
      mergeOnConflict?: boolean;
    };

    expect(payload).toMatchObject({
      entityType: "benchmark",
      entityId: 11,
      nextName: "Bench-1 Prime",
      nextBenchmarkType: "Type-Z",
      mergeOnConflict: true
    });

    expect(await screen.findByText(/名称已更新并写入数据库/i)).toBeInTheDocument();
  });

  test("benchmark 改名命中冲突时会提示自动合并并写入合并记录", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchSequence({
      ok: true,
      entityType: "benchmark",
      entityId: 11,
      previousName: "Bench-1",
      nextName: "Bench-2",
      action: "merged-and-renamed",
      mergedSourceId: 12,
      mergedSourceName: "Bench-2"
    });

    render(<AdminConsole {...buildProps()} />);

    await user.click(screen.getByRole("tab", { name: "名称维护" }));
    await user.selectOptions(screen.getByRole("combobox"), "benchmark");

    const searchInput = screen.getByPlaceholderText("输入名称或 ID 关键字搜索实体");
    await user.clear(searchInput);
    await user.type(searchInput, "Bench-1");

    await user.click(await screen.findByText("Bench-1 [Type-A]"));

    const renameInput = screen.getByPlaceholderText("输入新的 benchmark 名称");
    await user.clear(renameInput);
    await user.type(renameInput, "Bench-2");

    await user.click(screen.getByRole("button", { name: "保存名称变更" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText(/自动合并重名实体/i)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "实体去重" }));
    expect(await screen.findByText(/Bench-2 \[Type-B\] \[12\]/i)).toBeInTheDocument();
  });

  test("同名不同 type 的 benchmark 也会在候选中显示", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "Bench-1",
          benchmarkType: "Type-C",
          rawValue: "75.5",
          valueNum: 75.5,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    mockFetchSequence(previewResponse);
    const props = buildProps();
    props.benchmarks = [
      { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] },
      { id: 12, benchmarkName: "Bench-1", benchmarkType: "Type-B", modalities: ["Vision"] }
    ];

    render(<AdminConsole {...props} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const matrixTable = await findMatrixPreviewTable();
    const benchmarkInput = within(matrixTable).getByDisplayValue("Bench-1");
    
    await user.click(benchmarkInput);
    await waitFor(() => {
      const dropdown = document.body.querySelector('[role="listbox"]') as HTMLElement | null;
      expect(dropdown).toBeInTheDocument();
      if (dropdown) {
        expect(within(dropdown).getByText(/Bench-1 \[Type-A\] \[11\]/)).toBeInTheDocument();
        expect(within(dropdown).getByText(/Bench-1 \[Type-B\] \[12\]/)).toBeInTheDocument();
      }
    });
  });

  test("有 >100 Elo 值时会自动切换到库内 Elo 目标并显示警告", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "SomeBench",
          benchmarkType: "General",
          rawValue: "1200",
          valueNum: 1200,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    mockFetchSequence(previewResponse);
    const props = buildProps();
    props.benchmarks = [
      { id: 11, benchmarkName: "SomeBench (Elo)", benchmarkType: "General", modalities: ["Text"] }
    ];

    render(<AdminConsole {...props} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const matrixTable = await findMatrixPreviewTable();
    const benchmarkInput = within(matrixTable).getByDisplayValue("SomeBench (Elo)");
    const benchmarkCell = benchmarkInput.closest("th");

    expect(benchmarkCell).toHaveClass("bg-warning/15");
    expect(await screen.findByText("检测到 >100 Elo 数值，已按 SomeBench (Elo) 导入")).toBeInTheDocument();
    
    await user.click(benchmarkInput);
    await waitFor(() => {
      const dropdown = document.body.querySelector('[role="listbox"]') as HTMLElement | null;
      expect(dropdown).toBeInTheDocument();
      if (dropdown) {
        expect(within(dropdown).getByText(/SomeBench \(Elo\) \[General\] \[11\]/)).toBeInTheDocument();
      }
    });
  });

  test("矩阵 benchmark 输入时可搜索全量库内 benchmark", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "UnknownBench",
          benchmarkType: "General",
          rawValue: "75.5",
          valueNum: 75.5,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    mockFetchSequence(previewResponse);
    const props = buildProps();
    props.benchmarks = [
      { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] },
      { id: 12, benchmarkName: "Bench-2", benchmarkType: "Type-B", modalities: ["Vision"] },
      { id: 13, benchmarkName: "SearchableBench", benchmarkType: "General", modalities: ["Text"] }
    ];

    render(<AdminConsole {...props} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const matrixTable = await findMatrixPreviewTable();
    const benchmarkInput = within(matrixTable).getByDisplayValue("UnknownBench") as HTMLInputElement;
    
    await user.clear(benchmarkInput);
    await user.type(benchmarkInput, "search");

    await waitFor(() => {
      const dropdown = document.body.querySelector('[role="listbox"]') as HTMLElement | null;
      expect(dropdown).toBeInTheDocument();
      if (dropdown) {
        expect(within(dropdown).getByText(/SearchableBench \[General\] \[13\]/)).toBeInTheDocument();
      }
    });
  });

  test("输入 benchmark 名称后会自动打开候选下拉", async () => {
    const user = userEvent.setup();

    const previewResponse: PreviewResponse = {
      format: "paper-table",
      total: 1,
      skipped: 0,
      warningCount: 0,
      previewRows: [
        {
          rowNumber: 1,
          providerName: "OpenAI",
          modelName: "Model A",
          benchmarkName: "SomeBench",
          benchmarkType: "General",
          rawValue: "75.5",
          valueNum: 75.5,
          valueNum2: null,
          valueNote: null,
          source: "text:sample",
          valid: true
        }
      ]
    };

    mockFetchSequence(previewResponse);
    const props = buildProps();
    props.benchmarks = [
      { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] }
    ];

    render(<AdminConsole {...props} />);

    await fillCsvText(user, "dummy");
    await triggerPreview(user);

    const matrixTable = await findMatrixPreviewTable();
    const benchmarkInput = within(matrixTable).getByDisplayValue("SomeBench") as HTMLInputElement;
    
    await user.clear(benchmarkInput);
    await user.type(benchmarkInput, "Bench");

    await waitFor(() => {
      const dropdown = document.body.querySelector('[role="listbox"]') as HTMLElement | null;
      expect(dropdown).toBeInTheDocument();
    });
  });
});
