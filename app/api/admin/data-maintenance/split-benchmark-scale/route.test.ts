import { beforeEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/admin/data-maintenance/split-benchmark-scale/route";
import { requireAdmin } from "@/lib/admin-auth";
import { splitBenchmarkScaleByMode } from "@/lib/admin-service";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/admin-service", () => ({
  splitBenchmarkScaleByMode: vi.fn()
}));

describe("POST /api/admin/data-maintenance/split-benchmark-scale", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(splitBenchmarkScaleByMode).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue(null);
  });

  test("同一规范实体的拆分名校验失败返回 400", async () => {
    vi.mocked(splitBenchmarkScaleByMode).mockRejectedValue(
      new Error("原 benchmark 与 Elo benchmark 名称/type 不能指向同一实体")
    );

    const response = await POST(
      new Request("https://example.com/api/admin/data-maintenance/split-benchmark-scale", {
        method: "POST",
        body: JSON.stringify({
          benchmarkId: 21,
          splitMode: "hundred-vs-elo",
          baseBenchmarkName: "Arena Hard",
          eloBenchmarkName: "Arena Hard"
        }),
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "原 benchmark 与 Elo benchmark 名称/type 不能指向同一实体"
    });
  });
});