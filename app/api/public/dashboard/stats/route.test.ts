import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "@/app/api/public/dashboard/stats/route";
import { getDashboardStats } from "@/lib/db/queries";
import { getCacheVersion } from "@/lib/cache-versions";

vi.mock("@/lib/db/queries", () => ({
  getDashboardStats: vi.fn()
}));

vi.mock("@/lib/cache-versions", () => ({
  getCacheVersion: vi.fn()
}));

const STATS = {
  providerCount: 9,
  modelCount: 18,
  benchmarkCount: 27,
  totalRecords: 36
};

describe("GET /api/public/dashboard/stats", () => {
  beforeEach(() => {
    vi.mocked(getDashboardStats).mockReset();
    vi.mocked(getCacheVersion).mockReset();
    vi.mocked(getCacheVersion).mockImplementation(async (domain) => `${domain}-version`);
    vi.mocked(getDashboardStats).mockResolvedValue(STATS);
  });

  test("返回 4 个统计数字、缓存头与版本号", async () => {
    const response = await GET(new Request("https://example.com/api/public/dashboard/stats"));
    const payload = await response.json();

    expect(payload).toEqual({ stats: STATS });
    expect(getDashboardStats).toHaveBeenCalledWith(null, "dashboard-version");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    expect(response.headers.get("CDN-Cache-Control")).toBe("public, s-maxage=300, stale-while-revalidate=3600");
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe("public, s-maxage=900, stale-while-revalidate=86400");
    expect(response.headers.get("X-Dashboard-Version")).toBe("dashboard-version");
    expect(response.headers.get("ETag")).toBe('"dashboard-stats:dashboard-version"');
  });

  test("只探 dashboard 版本域，价格与设置的变动不参与失效", async () => {
    await GET(new Request("https://example.com/api/public/dashboard/stats"));

    expect(getCacheVersion).toHaveBeenCalledTimes(1);
    expect(getCacheVersion).toHaveBeenCalledWith("dashboard");
  });

  test("If-None-Match 命中时返回 304 且不查询统计", async () => {
    const first = await GET(new Request("https://example.com/api/public/dashboard/stats"));
    const etag = first.headers.get("ETag");
    vi.mocked(getDashboardStats).mockClear();

    const response = await GET(new Request("https://example.com/api/public/dashboard/stats", {
      headers: { "If-None-Match": etag ?? "" }
    }));

    expect(response.status).toBe(304);
    expect(getDashboardStats).not.toHaveBeenCalled();
  });

  test("限流响应明确不进入公共缓存", async () => {
    let response = await GET(new Request("https://example.com/api/public/dashboard/stats", {
      headers: { "x-forwarded-for": "203.0.113.431" }
    }));

    for (let index = 1; index < 61; index += 1) {
      response = await GET(new Request("https://example.com/api/public/dashboard/stats", {
        headers: { "x-forwarded-for": "203.0.113.431" }
      }));
    }

    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, no-cache, must-revalidate, max-age=0");
    expect(response.headers.get("CDN-Cache-Control")).toBeNull();
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBeNull();
  });
});
