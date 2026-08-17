import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "@/app/api/public/dashboard/stats/route";
import { getDashboardStats } from "@/lib/db/queries";

vi.mock("@/lib/db/queries", () => ({
  getDashboardStats: vi.fn()
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
    vi.mocked(getDashboardStats).mockResolvedValue(STATS);
  });

  test("返回 4 个统计数字与缓存头", async () => {
    const response = await GET(new Request("https://example.com/api/public/dashboard/stats"));
    const payload = await response.json();

    expect(payload).toEqual({ stats: STATS });
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    expect(response.headers.get("CDN-Cache-Control")).toBe("public, s-maxage=300, stale-while-revalidate=3600");
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe("public, s-maxage=900, stale-while-revalidate=86400");
    expect(response.headers.get("ETag")).toBe('"dashboard-stats:9-18-27-36"');
  });

  test("不自己探测缓存版本，避免多一次远程往返", async () => {
    await GET(new Request("https://example.com/api/public/dashboard/stats"));

    // 不传 forceVersion，交给 withVersionedCache 按自己的 TTL 决定是否回源；
    // 命中进程内缓存时这个端点零数据库往返。
    expect(getDashboardStats).toHaveBeenCalledWith();
  });

  test("统计未变时 If-None-Match 命中返回 304", async () => {
    const first = await GET(new Request("https://example.com/api/public/dashboard/stats"));
    const etag = first.headers.get("ETag");

    const response = await GET(new Request("https://example.com/api/public/dashboard/stats", {
      headers: { "If-None-Match": etag ?? "" }
    }));

    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe(etag);
  });

  test("统计变动后旧 ETag 不再命中", async () => {
    const first = await GET(new Request("https://example.com/api/public/dashboard/stats"));
    const staleEtag = first.headers.get("ETag");

    vi.mocked(getDashboardStats).mockResolvedValue({ ...STATS, totalRecords: 37 });
    const response = await GET(new Request("https://example.com/api/public/dashboard/stats", {
      headers: { "If-None-Match": staleEtag ?? "" }
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stats: { ...STATS, totalRecords: 37 } });
    expect(response.headers.get("ETag")).toBe('"dashboard-stats:9-18-27-37"');
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
