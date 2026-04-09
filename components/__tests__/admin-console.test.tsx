import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { AdminConsole } from "@/components/admin-console";

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
  const fetchMock = vi.fn();
  payloads.forEach((payload) => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(payload));
  });

  vi.stubGlobal("fetch", fetchMock);
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

describe("AdminConsole text import", () => {
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
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1];
    const secondPayload = JSON.parse(((secondCall[1] as RequestInit).body ?? "{}") as string) as {
      csvText?: string;
    };

    expect(secondPayload.csvText).toContain("Bench-1,Type-New");
    expect(secondPayload.csvText).toContain("Vision");
    expect(secondPayload.csvText).not.toContain("Bench-1,Type-A");
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
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1];
    const secondPayload = JSON.parse(((secondCall[1] as RequestInit).body ?? "{}") as string) as {
      csvText?: string;
    };

    expect(secondPayload.csvText).toContain("Bench-1,General,0");
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

    const optionButton = within(benchmarkRow).getByRole("option", {
      name: /Bench-1 \[Type-A\] \[11\]/
    });

    expect(optionButton).toBeInTheDocument();
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
});
