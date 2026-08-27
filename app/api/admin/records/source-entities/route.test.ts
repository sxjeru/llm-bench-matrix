import { NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "@/app/api/admin/records/source-entities/route";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRecordSourceEntities } from "@/lib/admin-records-service";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/admin-records-service", () => ({
  getAdminRecordSourceEntities: vi.fn()
}));

describe("/api/admin/records/source-entities", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(getAdminRecordSourceEntities).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.mocked(getAdminRecordSourceEntities).mockResolvedValue({
      modelIds: [1, 2],
      benchmarkIds: [11, 12]
    });
  });

  test("未授权时返回 401", async () => {
    const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    vi.mocked(requireAdmin).mockResolvedValue(denied);

    const response = await GET(
      new Request("https://example.com/api/admin/records/source-entities")
    );

    expect(response.status).toBe(401);
    expect(getAdminRecordSourceEntities).not.toHaveBeenCalled();
  });

  test("非法 sourceMode 返回 400", async () => {
    const response = await GET(
      new Request("https://example.com/api/admin/records/source-entities?sourceMode=invalid")
    );

    expect(response.status).toBe(400);
    expect(getAdminRecordSourceEntities).not.toHaveBeenCalled();
  });

  test("sourceMode=all 返回 400", async () => {
    const response = await GET(
      new Request("https://example.com/api/admin/records/source-entities?sourceMode=all")
    );

    expect(response.status).toBe(400);
    expect(getAdminRecordSourceEntities).not.toHaveBeenCalled();
  });

  test("返回 source 对应的实体列表", async () => {
    const response = await GET(
      new Request("https://example.com/api/admin/records/source-entities?sourceMode=specific&source=text:sample")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      modelIds: [1, 2],
      benchmarkIds: [11, 12]
    });
    expect(getAdminRecordSourceEntities).toHaveBeenCalledWith({
      sourceMode: "specific",
      source: "text:sample"
    });
  });
});
