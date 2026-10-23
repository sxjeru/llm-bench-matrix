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
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.preview.totalRecords).toBe(1);
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
        source: "text:test"
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
      expect(data.deleted).toBe(42);
      expect(data.prunedSourceMeta).toBe(2);
    });
  });
});

