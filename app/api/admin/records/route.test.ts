import { NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET, POST } from "@/app/api/admin/records/route";
import { requireAdmin } from "@/lib/admin-auth";
import { batchSaveRecordDrafts, getAdminRecordMatrix } from "@/lib/admin-records-service";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/admin-records-service", () => ({
  getAdminRecordMatrix: vi.fn(),
  batchSaveRecordDrafts: vi.fn(),
  MAX_RECORD_DRAFTS_PER_SAVE: 2000
}));

const matrix = {
  generatedAt: "2026-04-01T00:00:00.000Z",
  models: [],
  benchmarks: [],
  cells: [],
  totalRecordCount: 0,
  visibleRecordCount: 0,
  modelTotalCount: 0,
  benchmarkTotalCount: 0,
  truncated: { models: false, benchmarks: false },
  limits: { modelLimit: 40, benchmarkLimit: 30 }
};

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("/api/admin/records", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(getAdminRecordMatrix).mockReset();
    vi.mocked(batchSaveRecordDrafts).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.mocked(getAdminRecordMatrix).mockResolvedValue(matrix);
    vi.mocked(batchSaveRecordDrafts).mockResolvedValue({
      ok: true,
      inserted: 0,
      updated: 1,
      deleted: 0,
      unchanged: 0,
      ignoredEmpty: 0,
      nonNumeric: [],
      prunedSourceMeta: 0
    });
  });

  describe("GET", () => {
    test("未授权时不加载矩阵", async () => {
      const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      vi.mocked(requireAdmin).mockResolvedValue(denied);

      const response = await GET(new Request("https://example.com/api/admin/records"));

      expect(response.status).toBe(401);
      expect(getAdminRecordMatrix).not.toHaveBeenCalled();
    });

    test("非法 sourceMode 返回 400", async () => {
      const response = await GET(
        new Request("https://example.com/api/admin/records?sourceMode=wildcard")
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "sourceMode 只能是 all / specific / empty"
      });
      expect(getAdminRecordMatrix).not.toHaveBeenCalled();
    });

    test("解析筛选参数并返回矩阵", async () => {
      const response = await GET(
        new Request(
          "https://example.com/api/admin/records?sourceMode=specific&source=text:src&modelIds=1,2,0&benchmarkIds=11&search=gpt&modelLimit=20&benchmarkLimit=10"
        )
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(matrix);
      expect(getAdminRecordMatrix).toHaveBeenCalledWith({
        sourceMode: "specific",
        source: "text:src",
        modelIds: [1, 2],
        benchmarkIds: [11],
        search: "gpt",
        modelLimit: 20,
        benchmarkLimit: 10
      });
    });

    test("缺省 sourceMode 视为 all，空 id 列表不传", async () => {
      const response = await GET(new Request("https://example.com/api/admin/records"));

      expect(response.status).toBe(200);
      expect(getAdminRecordMatrix).toHaveBeenCalledWith({
        sourceMode: "all",
        source: null,
        modelIds: undefined,
        benchmarkIds: undefined,
        search: null,
        modelLimit: undefined,
        benchmarkLimit: undefined
      });
    });

    test("服务层 not found 映射 404", async () => {
      vi.mocked(getAdminRecordMatrix).mockRejectedValue(new Error("model not found or merged: 1"));

      const response = await GET(new Request("https://example.com/api/admin/records"));

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "model not found or merged: 1"
      });
    });
  });

  describe("POST", () => {
    const draft = {
      modelId: 1,
      benchmarkId: 11,
      recordId: 101,
      recordIds: [101],
      valueRaw: "88",
      originalValueRaw: "77",
      source: "text:src"
    };

    test("未授权时不保存", async () => {
      const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      vi.mocked(requireAdmin).mockResolvedValue(denied);

      const response = await POST(
        jsonRequest("https://example.com/api/admin/records", { drafts: [draft] })
      );

      expect(response.status).toBe(401);
      expect(batchSaveRecordDrafts).not.toHaveBeenCalled();
    });

    test("缺少 drafts 或空数组返回 400", async () => {
      const missing = await POST(jsonRequest("https://example.com/api/admin/records", {}));
      expect(missing.status).toBe(400);
      expect(batchSaveRecordDrafts).not.toHaveBeenCalled();

      const empty = await POST(jsonRequest("https://example.com/api/admin/records", { drafts: [] }));
      expect(empty.status).toBe(400);
      expect(batchSaveRecordDrafts).not.toHaveBeenCalled();
    });

    test("非法 id 返回 400", async () => {
      const response = await POST(
        jsonRequest("https://example.com/api/admin/records", {
          drafts: [{ ...draft, modelId: 0 }]
        })
      );

      expect(response.status).toBe(400);
      expect(batchSaveRecordDrafts).not.toHaveBeenCalled();
    });

    test("鉴权通过时把草稿交给 batchSaveRecordDrafts", async () => {
      const response = await POST(
        jsonRequest("https://example.com/api/admin/records", { drafts: [draft] })
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        inserted: 0,
        updated: 1,
        deleted: 0,
        unchanged: 0,
        ignoredEmpty: 0,
        nonNumeric: [],
        prunedSourceMeta: 0
      });
      expect(batchSaveRecordDrafts).toHaveBeenCalledWith({ drafts: [draft] });
    });

    test("没有需要保存的改动映射 400", async () => {
      vi.mocked(batchSaveRecordDrafts).mockRejectedValue(new Error("没有需要保存的改动"));

      const response = await POST(
        jsonRequest("https://example.com/api/admin/records", { drafts: [draft] })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "没有需要保存的改动" });
    });
  });
});
