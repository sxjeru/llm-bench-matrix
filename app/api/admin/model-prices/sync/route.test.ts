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

  test("价格未变化时不失效公开页面", async () => {
    vi.mocked(syncModelsDevPricing).mockResolvedValue(baseResult);

    const response = await POST(new Request("https://example.com/api/admin/model-prices/sync", {
      method: "POST"
    }));

    expect(response.status).toBe(200);
    expect(invalidateAllCaches).not.toHaveBeenCalled();
  });

  test("价格变化时失效公开页面且不重复 bump pricing 版本", async () => {
    vi.mocked(syncModelsDevPricing).mockResolvedValue({
      ...baseResult,
      changedCount: 1,
      changedModels: ["GPT-5"]
    });

    const response = await POST(new Request("https://example.com/api/admin/model-prices/sync", {
      method: "POST"
    }));

    expect(response.status).toBe(200);
    expect(invalidateAllCaches).toHaveBeenCalledWith({ skipVersionBump: ["pricing"] });
  });
});