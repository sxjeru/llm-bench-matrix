import { NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/data-maintenance/import-batches/route";
import { GET as GET_PREVIEW } from "@/app/api/admin/data-maintenance/import-batches/preview/route";
import { requireAdmin } from "@/lib/admin-auth";
import { deleteImportBatch, listImportBatches, previewImportBatch } from "@/lib/import-batch-service";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/import-batch-service", () => ({
  listImportBatches: vi.fn(),
  previewImportBatch: vi.fn(),
  deleteImportBatch: vi.fn()
}));

describe("import-batches routes", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(listImportBatches).mockReset();
    vi.mocked(previewImportBatch).mockReset();
    vi.mocked(deleteImportBatch).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue(null);
  });

  describe("GET /api/admin/data-maintenance/import-batches", () => {
    test("未授权时被拦截", async () => {
      vi.mocked(requireAdmin).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
      const response = await GET(new Request("https://example.com/api/admin/data-maintenance/import-batches"));
      expect(response.status).toBe(401);
    });

    test("获取批次列表成功", async () => {
      vi.mocked(listImportBatches).mockResolvedValue([
        {
          batchKey: "2026-10-23T15:10:25.000Z::text:test",
          batchTime: "2026-10-23T15:10:25.000Z",
          displayTime: "2026-10-23 15:10:25",
          source: "text:test",
          sourceLabel: "text:test",
          recordCount: 42,
          modelCount: 5,
          benchmarkCount: 3,
          minBenchTime: null,
          maxBenchTime: null,
          minCreatedAt: "2026-10-23T15:10:25.100Z",
          maxCreatedAt: "2026-10-23T15:10:25.200Z"
        }
      ]);

      const response = await GET(new Request("https://example.com/api/admin/data-maintenance/import-batches?limit=10"));
      expect(response.status).toBe(200);
      expect(listImportBatches).toHaveBeenCalledWith({ limit: 10 });
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.batches).toHaveLength(1);
    });
  });

  describe("GET /api/admin/data-maintenance/import-batches/preview", () => {
    test("缺少 batchTime 返回 400", async () => {
      const response = await GET_PREVIEW(new Request("https://example.com/api/admin/data-maintenance/import-batches/preview"));
      expect(response.status).toBe(400);
    });

    test("预览成功", async () => {
      vi.mocked(previewImportBatch).mockResolvedValue({
        batchKey: "2026-10-23T15:10:25.000Z::text:test",
        batchTime: "2026-10-23T15:10:25.000Z",
        displayTime: "2026-10-23 15:10:25",
        source: "text:test",
        sourceLabel: "text:test",
        totalRecords: 1,
        modelCount: 1,
        benchmarkCount: 1,
        models: ["Model A"],
        benchmarks: ["Bench A"],
        orphanSourceMetaCount: 0,
        sampleRecords: []
      });

      const response = await GET_PREVIEW(
        new Request("https://example.com/api/admin/data-maintenance/import-batches/preview?batchTime=2026-10-23T15:10:25.000Z&source=text:test")
      );
      expect(response.status).toBe(200);
      expect(previewImportBatch).toHaveBeenCalledWith({
        batchTime: "2026-10-23T15:10:25.000Z",
        source: "text:test",
        matchAllSources: undefined,
        sampleLimit: 1000
      });
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.preview.totalRecords).toBe(1);
    });

    test("预览未标注来源批次（显式传入空 source 参数）成功", async () => {
      vi.mocked(previewImportBatch).mockResolvedValue({
        batchKey: "2026-10-23T15:10:25.000Z::__EMPTY__",
        batchTime: "2026-10-23T15:10:25.000Z",
        displayTime: "2026-10-23 15:10:25",
        source: null,
        sourceLabel: "未标注",
        totalRecords: 2,
        modelCount: 2,
        benchmarkCount: 2,
        models: ["Model A", "Model B"],
        benchmarks: ["Bench A", "Bench B"],
        orphanSourceMetaCount: 0,
        sampleRecords: []
      });

      const response = await GET_PREVIEW(
        new Request("https://example.com/api/admin/data-maintenance/import-batches/preview?batchTime=2026-10-23T15:10:25.000Z&sampleLimit=1000&source=")
      );
      expect(response.status).toBe(200);
      expect(previewImportBatch).toHaveBeenCalledWith({
        batchTime: "2026-10-23T15:10:25.000Z",
        source: "",
        matchAllSources: undefined,
        sampleLimit: 1000
      });
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.preview.totalRecords).toBe(2);
      expect(data.preview.sourceLabel).toBe("未标注");
    });
  });

  describe("POST /api/admin/data-maintenance/import-batches", () => {
    test("缺少 batchTime 返回 400", async () => {
      const response = await POST(new Request("https://example.com/api/admin/data-maintenance/import-batches", {
        method: "POST",
        body: JSON.stringify({})
      }));
      expect(response.status).toBe(400);
    });

    test("删除批次成功", async () => {
      vi.mocked(deleteImportBatch).mockResolvedValue({
        ok: true,
        deleted: 42,
        prunedSourceMeta: 2,
        batchTime: "2026-10-23T15:10:25.000Z",
        source: "text:test",
        cacheInvalidated: true
      });

      const response = await POST(new Request("https://example.com/api/admin/data-maintenance/import-batches", {
        method: "POST",
        body: JSON.stringify({
          batchTime: "2026-10-23T15:10:25.000Z",
          source: "text:test"
        })
      }));

      expect(response.status).toBe(200);
      expect(deleteImportBatch).toHaveBeenCalledWith({
        batchTime: "2026-10-23T15:10:25.000Z",
        source: "text:test",
        matchAllSources: undefined
      });
      const data = await response.json();
      expect(data.deleted).toBe(42);
      expect(data.prunedSourceMeta).toBe(2);
      expect(data.cacheInvalidated).toBe(true);
    });

    test("删除批次成功但缓存失效失败时，返回 200 且包含 warning 与 cacheInvalidated=false，而不是 500 错误", async () => {
      vi.mocked(deleteImportBatch).mockResolvedValue({
        ok: true,
        deleted: 15,
        prunedSourceMeta: 1,
        batchTime: "2026-10-23T15:10:25.000Z",
        source: "text:test",
        cacheInvalidated: false,
        warning: "批次数据已成功删除，但缓存刷新失败: Redis connection error"
      });

      const response = await POST(new Request("https://example.com/api/admin/data-maintenance/import-batches", {
        method: "POST",
        body: JSON.stringify({
          batchTime: "2026-10-23T15:10:25.000Z",
          source: "text:test"
        })
      }));

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.deleted).toBe(15);
      expect(data.cacheInvalidated).toBe(false);
      expect(data.warning).toContain("缓存刷新失败");
    });

    test("底层删除失败（事务未提交）时，返回 500 错误", async () => {
      vi.mocked(deleteImportBatch).mockRejectedValue(new Error("数据库连接超时"));

      const response = await POST(new Request("https://example.com/api/admin/data-maintenance/import-batches", {
        method: "POST",
        body: JSON.stringify({
          batchTime: "2026-10-23T15:10:25.000Z",
          source: "text:test"
        })
      }));

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("数据库连接超时");
    });
  });
});

