import { render, screen, waitFor, within } from "@testing-library/react";
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
      { id: 11, benchmarkName: "Bench-1", benchmarkType: "Type-A", modalities: ["Text"] }
    ],
    sourceOptions: ["text:sample"],
    mergedRecords: [],
    initialSettings: {}
  };
}

describe("AdminConsole 矩阵预览 Type 可编辑", () => {
  test("修改 Type 后导入 payload 使用新类型", async () => {
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
      warningCount: 0,
      warnings: []
    };

    const fetchMock = mockFetchSequence(previewResponse, importResponse);
    render(<AdminConsole {...buildProps()} />);

    const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
    if (!textarea) {
      throw new Error("CSV textarea not found");
    }

    await user.clear(textarea);
    await user.type(textarea, "dummy");
    await user.click(screen.getByRole("button", { name: "预览导入结果" }));

    const matrixHeading = await screen.findByRole("heading", { name: "矩阵预览（可编辑）" });
    const matrixContainer = matrixHeading.parentElement;
    if (!matrixContainer) {
      throw new Error("Matrix preview container not found");
    }

    const matrixTable = matrixContainer.querySelector("table") as HTMLTableElement | null;
    if (!matrixTable) {
      throw new Error("Matrix preview table not found");
    }

    const typeInput = within(matrixTable).getByDisplayValue("Type-A") as HTMLInputElement;
    await user.clear(typeInput);
    await user.type(typeInput, "Video");

    await user.click(screen.getByRole("button", { name: "执行导入" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1];
    const secondPayload = JSON.parse(((secondCall[1] as RequestInit).body ?? "{}") as string) as {
      csvText?: string;
    };

    expect(secondPayload.csvText).toContain("Bench-1,Video,70.1");
  });
});
