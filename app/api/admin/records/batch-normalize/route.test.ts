import { NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/admin/records/batch-normalize/route";
import { requireAdmin } from "@/lib/admin-auth";
import { batchNormalizeRecordScale } from "@/lib/admin-records-service";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/admin-records-service", () => ({
  batchNormalizeRecordScale: vi.fn()
}));

function jsonRequest(body: unknown) {
  return new Request("https://example.com/api/admin/records/batch-normalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/admin/records/batch-normalize", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(batchNormalizeRecordScale).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.mocked(batchNormalizeRecordScale).mockResolvedValue({
      ok: true,
      targetScale: 1,
      updated: 2,
      unchanged: 1
    });
  });

  test("未授权时不归一化", async () => {
    const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    vi.mocked(requireAdmin).mockResolvedValue(denied);

    const response = await POST(jsonRequest({ targetScale: 1, scope: { modelIds: [1] } }));

    expect(response.status).toBe(401);
    expect(batchNormalizeRecordScale).not.toHaveBeenCalled();
  });

  test("缺少或非法 targetScale 返回 400", async () => {
    const missing = await POST(jsonRequest({ scope: { modelIds: [1] } }));
    expect(missing.status).toBe(400);
    expect(batchNormalizeRecordScale).not.toHaveBeenCalled();

    const invalid = await POST(jsonRequest({ targetScale: 10, scope: { modelIds: [1] } }));
    expect(invalid.status).toBe(400);
    expect(batchNormalizeRecordScale).not.toHaveBeenCalled();
  });

  test("鉴权通过时调用 batchNormalizeRecordScale", async () => {
    const payload = {
      targetScale: 100 as const,
      scope: { benchmarkIds: [11], sourceMode: "empty" as const }
    };

    const response = await POST(jsonRequest(payload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      targetScale: 1,
      updated: 2,
      unchanged: 1
    });
    expect(batchNormalizeRecordScale).toHaveBeenCalledWith(payload);
  });

  test("必须限定筛选范围映射 400", async () => {
    vi.mocked(batchNormalizeRecordScale).mockRejectedValue(
      new Error("批量归一化必须限定筛选范围（模型 / 指标 / source 至少一项）")
    );

    const response = await POST(jsonRequest({ targetScale: 1 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "批量归一化必须限定筛选范围（模型 / 指标 / source 至少一项）"
    });
  });
});
