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
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=60, stale-while-revalidate=300");
  });

  test("limit 会被限制到 1000", async () => {
    vi.mocked(getDashboardRows).mockResolvedValue([]);

    await GET(new Request("https://example.com/api/public/records?limit=99999"));

    expect(getDashboardRows).toHaveBeenCalledWith(1000);
  });
});
