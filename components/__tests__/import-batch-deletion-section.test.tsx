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

  test("如果在预览请求完成前切换选中批次，旧批次的响应不会覆盖或保存为预览结果", async () => {
    const user = userEvent.setup();

    const mockBatches = [
      {
        batchKey: "batch-1",
        batchTime: "2026-10-24T10:00:00.000Z",
        displayTime: "2026-10-24 10:00:00",
        source: "src-1",
        sourceLabel: "来源1",
        recordCount: 10,
        modelCount: 1,
        benchmarkCount: 1,
        minBenchTime: null,
        maxBenchTime: null,
        minCreatedAt: "2026-10-24T10:00:00.000Z",
        maxCreatedAt: "2026-10-24T10:00:00.000Z"
      },
      {
        batchKey: "batch-2",
        batchTime: "2026-10-24T11:00:00.000Z",
        displayTime: "2026-10-24 11:00:00",
        source: "src-2",
        sourceLabel: "来源2",
        recordCount: 20,
        modelCount: 2,
        benchmarkCount: 2,
        minBenchTime: null,
        maxBenchTime: null,
        minCreatedAt: "2026-10-24T11:00:00.000Z",
        maxCreatedAt: "2026-10-24T11:00:00.000Z"
      }
    ];

    let resolveBatch1Preview!: (value: any) => void;
    const batch1PreviewPromise = new Promise((resolve) => {
      resolveBatch1Preview = resolve;
    });

    vi.spyOn(api, "getJson").mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/data-maintenance/import-batches?")) {
        return { ok: true, batches: mockBatches };
      }
      if (url.includes("/api/admin/data-maintenance/import-batches/preview?")) {
        if (url.includes("batchTime=2026-10-24T10%3A00%3A00.000Z")) {
          return batch1PreviewPromise;
        }
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
    expect(await screen.findByText(/来源1/)).toBeInTheDocument();

    // 点击批次 1 的预览
    const previewBtn = screen.getByRole("button", { name: /预览待删除数据/ });
    await user.click(previewBtn);

    // 此时预览正在加载中
    expect(screen.getByRole("button", { name: /解析预览中\.\.\./ })).toBeInTheDocument();

    // 管理员切换到了批次 2
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "batch-2");

    // 切换后，加载状态应已被重置
    expect(screen.getByRole("button", { name: /预览待删除数据/ })).toBeInTheDocument();

    // 批次 1 的旧预览响应返回
    resolveBatch1Preview({
      ok: true,
      preview: {
        batchKey: "batch-1",
        batchTime: "2026-10-24T10:00:00.000Z",
        displayTime: "2026-10-24 10:00:00",
        source: "src-1",
        sourceLabel: "来源1",
        totalRecords: 10,
        modelCount: 1,
        benchmarkCount: 1,
        models: ["Model 1"],
        benchmarks: ["Bench 1"],
        orphanSourceMetaCount: 0,
        sampleRecords: []
      }
    });

    // 等待所有微任务执行完毕，确认页面上绝不会展示旧批次 1 的预览卡片
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("待删除批次数据概览")).not.toBeInTheDocument();
    expect(screen.queryByText(/共 10 条记录/)).not.toBeInTheDocument();
  });
});

