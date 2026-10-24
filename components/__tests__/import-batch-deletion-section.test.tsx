import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ImportBatchDeletionSection } from "../admin-console/views/import-batch-deletion-section";
import * as api from "../admin-console/api";

describe("ImportBatchDeletionSection", () => {
  const notifySuccess = vi.fn();
  const notifyError = vi.fn();
  const onRefreshCaches = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("当选中的批次 source 为 null 时，点击预览会显式传入空的 source 查询参数", async () => {
    const user = userEvent.setup();

    const mockBatches = [
      {
        batchKey: "2026-10-24T10:00:00.000Z::__EMPTY__",
        batchTime: "2026-10-24T10:00:00.000Z",
        displayTime: "2026-10-24 10:00:00",
        source: null,
        sourceLabel: "未标注",
        recordCount: 2,
        modelCount: 2,
        benchmarkCount: 1,
        minBenchTime: null,
        maxBenchTime: null,
        minCreatedAt: "2026-10-24T10:00:00.100Z",
        maxCreatedAt: "2026-10-24T10:00:00.200Z"
      }
    ];

    const getJsonSpy = vi.spyOn(api, "getJson").mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/data-maintenance/import-batches?")) {
        return { ok: true, batches: mockBatches };
      }
      if (url.includes("/api/admin/data-maintenance/import-batches/preview?")) {
        return {
          ok: true,
          preview: {
            batchKey: "2026-10-24T10:00:00.000Z::__EMPTY__",
            batchTime: "2026-10-24T10:00:00.000Z",
            displayTime: "2026-10-24 10:00:00",
            source: null,
            sourceLabel: "未标注",
            totalRecords: 2,
            modelCount: 2,
            benchmarkCount: 1,
            models: ["Model A", "Model B"],
            benchmarks: ["MMLU"],
            orphanSourceMetaCount: 0,
            sampleRecords: [
              {
                id: 1,
                modelId: 101,
                modelName: "Model A",
                benchmarkId: 201,
                benchmarkName: "MMLU",
                benchmarkType: "general",
                valueRaw: "88.5",
                valueNum: 88.5,
                valueNum2: null,
                valueNote: null,
                benchTime: "2026-10-24T10:00:00.000Z",
                source: null
              }
            ]
          }
        };
      }
      return {};
    });

    render(
      <ImportBatchDeletionSection
        notifySuccess={notifySuccess}
        notifyError={notifyError}
        onRefreshCaches={onRefreshCaches}
      />
    );

    // 等待批次列表加载完成
    expect(await screen.findByText(/未标注/)).toBeInTheDocument();

    // 点击“预览待删除数据”
    const previewBtn = screen.getByRole("button", { name: /预览待删除数据/ });
    await user.click(previewBtn);

    await waitFor(() => {
      expect(getJsonSpy).toHaveBeenCalledTimes(2);
    });

    const previewCallUrl = getJsonSpy.mock.calls[1][0];
    const parsedUrl = new URL(previewCallUrl, "https://example.com");

    expect(parsedUrl.pathname).toBe("/api/admin/data-maintenance/import-batches/preview");
    expect(parsedUrl.searchParams.get("batchTime")).toBe("2026-10-24T10:00:00.000Z");
    expect(parsedUrl.searchParams.get("sampleLimit")).toBe("1000");
    // 验证 source 参数被显式传入且为空字符串，而不是被省略
    expect(parsedUrl.searchParams.has("source")).toBe(true);
    expect(parsedUrl.searchParams.get("source")).toBe("");
  });

  test("当选中的批次具有具体 source 时，预览会正常携带该 source 参数", async () => {
    const user = userEvent.setup();

    const mockBatches = [
      {
        batchKey: "2026-10-24T10:00:00.000Z::text:report",
        batchTime: "2026-10-24T10:00:00.000Z",
        displayTime: "2026-10-24 10:00:00",
        source: "text:report",
        sourceLabel: "text:report",
        recordCount: 5,
        modelCount: 2,
        benchmarkCount: 2,
        minBenchTime: null,
        maxBenchTime: null,
        minCreatedAt: "2026-10-24T10:00:00.100Z",
        maxCreatedAt: "2026-10-24T10:00:00.200Z"
      }
    ];

    const getJsonSpy = vi.spyOn(api, "getJson").mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/data-maintenance/import-batches?")) {
        return { ok: true, batches: mockBatches };
      }
      if (url.includes("/api/admin/data-maintenance/import-batches/preview?")) {
        return {
          ok: true,
          preview: {
            batchKey: "2026-10-24T10:00:00.000Z::text:report",
            batchTime: "2026-10-24T10:00:00.000Z",
            displayTime: "2026-10-24 10:00:00",
            source: "text:report",
            sourceLabel: "text:report",
            totalRecords: 5,
            modelCount: 2,
            benchmarkCount: 2,
            models: ["Model A"],
            benchmarks: ["MMLU"],
            orphanSourceMetaCount: 0,
            sampleRecords: []
          }
        };
      }
      return {};
    });

    render(
      <ImportBatchDeletionSection
        notifySuccess={notifySuccess}
        notifyError={notifyError}
        onRefreshCaches={onRefreshCaches}
      />
    );

    expect(await screen.findByText(/text:report/)).toBeInTheDocument();

    const previewBtn = screen.getByRole("button", { name: /预览待删除数据/ });
    await user.click(previewBtn);

    await waitFor(() => {
      expect(getJsonSpy).toHaveBeenCalledTimes(2);
    });

    const previewCallUrl = getJsonSpy.mock.calls[1][0];
    const parsedUrl = new URL(previewCallUrl, "https://example.com");

    expect(parsedUrl.searchParams.get("source")).toBe("text:report");
  });
});

