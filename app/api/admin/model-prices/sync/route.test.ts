import { beforeEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/admin/model-prices/sync/route";
import { requireAdmin } from "@/lib/admin-auth";
import { invalidateAllCaches } from "@/lib/db/queries";
import { syncModelsDevPricing } from "@/lib/model-pricing";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/db/queries", () => ({
  invalidateAllCaches: vi.fn()
}));

vi.mock("@/lib/model-pricing", () => ({
  syncModelsDevPricing: vi.fn()
}));

const baseResult = {
  providerCount: 1,
  sourceModelCount: 1,
  matchedCount: 1,
  unmatchedCount: 0,
  skippedManualCount: 0,
  changedCount: 0,
  changedModels: [],
  syncedAt: "2026-08-17T00:00:00.000Z"
};

describe("POST /api/admin/model-prices/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.mocked(invalidateAllCaches).mockResolvedValue(undefined);
  });

  test("价格未变化时由同步服务管理缓存失效，路由不重复失效", async () => {
    vi.mocked(syncModelsDevPricing).mockResolvedValue(baseResult);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await POST(new Request("https://example.com/api/admin/model-prices/sync", {
      method: "POST"
    }));

    expect(response.status).toBe(200);
    expect(invalidateAllCaches).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls.map(([entry]) => JSON.parse(entry as string))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: "info",
        event: "admin.model_prices.sync.completed",
        providerCount: 1,
        sourceModelCount: 1,
        matchedCount: 1,
        unmatchedCount: 0,
        changedCount: 0
      }),
      expect.objectContaining({
        level: "info",
        event: "api.admin.model-prices.sync",
        statusCode: 200
      })
    ]));
  });

  test("价格变化时由同步服务管理缓存失效，路由不重复失效", async () => {
    vi.mocked(syncModelsDevPricing).mockResolvedValue({
      ...baseResult,
      changedCount: 1,
      changedModels: ["GPT-5"]
    });

    const response = await POST(new Request("https://example.com/api/admin/model-prices/sync", {
      method: "POST"
    }));

    expect(response.status).toBe(200);
    expect(invalidateAllCaches).not.toHaveBeenCalled();
  });

  test("同步失败时记录安全错误信息并保留 HTTP 状态码", async () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(syncModelsDevPricing).mockRejectedValue(Object.assign(
      new Error("private database password"),
      { code: "ECONNRESET" }
    ));

    const response = await POST(new Request("https://example.com/api/admin/model-prices/sync", {
      method: "POST"
    }));

    expect(response.status).toBe(400);
    const failure = errorLog.mock.calls
      .map(([entry]) => JSON.parse(entry as string))
      .find((entry) => entry.event === "admin.model_prices.sync.failed");
    expect(failure).toMatchObject({
      level: "error",
      event: "admin.model_prices.sync.failed",
      errorName: "Error",
      errorCode: "ECONNRESET"
    });
    expect(JSON.stringify(failure)).not.toContain("private");
  });
});
