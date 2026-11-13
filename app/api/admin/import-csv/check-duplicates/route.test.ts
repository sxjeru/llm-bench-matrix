import { NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/admin/import-csv/check-duplicates/route";
import { requireAdmin } from "@/lib/admin-auth";
import { checkTextImportPreviewDuplicates } from "@/lib/admin-service";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/admin-service", () => ({
  checkTextImportPreviewDuplicates: vi.fn()
}));

function buildRequest(body: unknown) {
  return new Request("https://example.com/api/admin/import-csv/check-duplicates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/admin/import-csv/check-duplicates", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(checkTextImportPreviewDuplicates).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue(null);
  });

  test("未授权时阻断请求", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const response = await POST(buildRequest({ rows: [] }));

    expect(response.status).toBe(401);
    expect(checkTextImportPreviewDuplicates).not.toHaveBeenCalled();
  });

  test("请求体缺少合法的 rows 时返回 400", async () => {
    const response = await POST(buildRequest({ source: "paper-src", rows: "invalid" }));

    expect(response.status).toBe(400);
    expect(checkTextImportPreviewDuplicates).not.toHaveBeenCalled();
  });

  test("按当前矩阵内容返回逐行重复标记与总数", async () => {
    const rows = [
      { modelName: "Model A", benchmarkName: "MMLU", rawValue: "88.0" },
      { modelName: "Model B", benchmarkName: "MMLU", rawValue: "92.0" }
    ];
    vi.mocked(checkTextImportPreviewDuplicates).mockResolvedValue({
      checked: true,
      rows: [
        { isDuplicate: true, duplicateSlotKey: "model a::mmlu" },
        { isDuplicate: false }
      ],
      warnings: []
    });

    const response = await POST(buildRequest({ source: "paper-src", rows }));

    expect(response.status).toBe(200);
    expect(checkTextImportPreviewDuplicates).toHaveBeenCalledWith(rows, "paper-src");
    await expect(response.json()).resolves.toEqual({
      checked: true,
      rows: [
        { isDuplicate: true, duplicateSlotKey: "model a::mmlu" },
        { isDuplicate: false }
      ],
      duplicateCount: 1,
      warnings: []
    });
  });
});
