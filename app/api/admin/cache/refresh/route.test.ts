import { NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/admin/cache/refresh/route";
import { requireAdmin } from "@/lib/admin-auth";
import { invalidateAllCaches } from "@/lib/db/queries";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/db/queries", () => ({
  invalidateAllCaches: vi.fn()
}));

describe("POST /api/admin/cache/refresh", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(invalidateAllCaches).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.mocked(invalidateAllCaches).mockResolvedValue(undefined);
  });

  test("鉴权通过时会更新缓存", async () => {
    const response = await POST(
      new Request("https://example.com/api/admin/cache/refresh", {
        method: "POST"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      message: "缓存已更新"
    });
    expect(invalidateAllCaches).toHaveBeenCalledTimes(1);
  });

  test("未授权请求不会更新缓存", async () => {
    const deniedResponse = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    vi.mocked(requireAdmin).mockResolvedValue(deniedResponse);

    const response = await POST(
      new Request("https://example.com/api/admin/cache/refresh", {
        method: "POST"
      })
    );

    expect(response.status).toBe(401);
    expect(invalidateAllCaches).not.toHaveBeenCalled();
  });

  test("更新缓存失败时返回 500", async () => {
    vi.mocked(invalidateAllCaches).mockRejectedValue(new Error("refresh failed"));

    const response = await POST(
      new Request("https://example.com/api/admin/cache/refresh", {
        method: "POST"
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "refresh failed" });
  });
});
