import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "@/app/api/public/records/route";
import { getDashboardRows } from "@/lib/db/queries";

vi.mock("@/lib/db/queries", () => ({
  getDashboardRows: vi.fn()
}));

describe("GET /api/public/records", () => {
  beforeEach(() => {
    vi.mocked(getDashboardRows).mockReset();
  });

  test("默认 limit=300，并返回缓存头", async () => {
    vi.mocked(getDashboardRows).mockResolvedValue([]);

    const response = await GET(new Request("https://example.com/api/public/records"));

    expect(getDashboardRows).toHaveBeenCalledWith(300);
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=10, stale-while-revalidate=60");
    expect(response.headers.get("ETag")).toBe('"records:300:300:0:0:empty"');
  });

  test("limit 会被限制到 1000", async () => {
    vi.mocked(getDashboardRows).mockResolvedValue([]);

    await GET(new Request("https://example.com/api/public/records?limit=99999"));

    expect(getDashboardRows).toHaveBeenCalledWith(1000);
  });

  test("limit 会收敛到固定缓存档位并按请求值裁剪", async () => {
    vi.mocked(getDashboardRows).mockResolvedValue([
      { id: 1, updatedAt: "2026-05-01T00:00:00.000Z" },
      { id: 2, updatedAt: "2026-05-02T00:00:00.000Z" },
      { id: 3, updatedAt: "2026-05-03T00:00:00.000Z" }
    ] as Awaited<ReturnType<typeof getDashboardRows>>);

    const response = await GET(new Request("https://example.com/api/public/records?limit=2"));
    const payload = await response.json();

    expect(getDashboardRows).toHaveBeenCalledWith(100);
    expect(payload.rows).toHaveLength(2);
    expect(response.headers.get("ETag")).toBe('"records:2:100:2:2:2026-05-02T00:00:00.000Z"');
  });

  test("If-None-Match 命中时返回 304", async () => {
    vi.mocked(getDashboardRows).mockResolvedValue([]);

    const response = await GET(new Request("https://example.com/api/public/records", {
      headers: { "If-None-Match": '"records:300:300:0:0:empty"' }
    }));

    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe('"records:300:300:0:0:empty"');
  });
});
