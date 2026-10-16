import { NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/admin/data-maintenance/migrate-merged-values/route";
import { requireAdmin } from "@/lib/admin-auth";
import { migrateOrphanedMergedEntityValues } from "@/lib/admin-service";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/admin-service", () => ({
  migrateOrphanedMergedEntityValues: vi.fn()
}));

describe("POST /api/admin/data-maintenance/migrate-merged-values", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(migrateOrphanedMergedEntityValues).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue(null);
  });

  test("未授权时返回 401/403 阻断", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const response = await POST(new Request("https://example.com/api/admin/data-maintenance/migrate-merged-values", { method: "POST" }));
    expect(response.status).toBe(401);
  });

  test("成功时返回迁移统计", async () => {
    vi.mocked(migrateOrphanedMergedEntityValues).mockResolvedValue({
      migratedModels: 5,
      migratedBenchmarks: 2
    });

    const response = await POST(new Request("https://example.com/api/admin/data-maintenance/migrate-merged-values", { method: "POST" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      migratedModels: 5,
      migratedBenchmarks: 2
    });
  });
});

