import { NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/admin/records/batch-delete/route";
import { requireAdmin } from "@/lib/admin-auth";
import { batchDeleteRecords } from "@/lib/admin-records-service";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/admin-records-service", () => ({
  batchDeleteRecords: vi.fn()
}));

function jsonRequest(body: unknown) {
  return new Request("https://example.com/api/admin/records/batch-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/admin/records/batch-delete", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(batchDeleteRecords).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.mocked(batchDeleteRecords).mockResolvedValue({ deleted: 3 });
  });

  test("未授权时不删除", async () => {
    const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    vi.mocked(requireAdmin).mockResolvedValue(denied);

    const response = await POST(jsonRequest({ scope: { modelIds: [1] } }));

    expect(response.status).toBe(401);
    expect(batchDeleteRecords).not.toHaveBeenCalled();
  });

  test("非法 body 返回 400", async () => {
    const response = await POST(jsonRequest({ scope: { modelIds: [0] } }));

    expect(response.status).toBe(400);
    expect(batchDeleteRecords).not.toHaveBeenCalled();
  });

  test("把 scope 和 allowUnfiltered 交给服务层", async () => {
    const payload = {
      scope: { modelIds: [1], benchmarkIds: [11], sourceMode: "specific" as const, source: "text:src" },
      allowUnfiltered: false
    };

    const response = await POST(jsonRequest(payload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: 3 });
    expect(batchDeleteRecords).toHaveBeenCalledWith(payload);
  });

  test("未设置筛选条件映射 400", async () => {
    vi.mocked(batchDeleteRecords).mockRejectedValue(
      new Error("未设置任何筛选条件：如需清空全部数据请显式传 allowUnfiltered")
    );

    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "未设置任何筛选条件：如需清空全部数据请显式传 allowUnfiltered"
    });
  });
});
