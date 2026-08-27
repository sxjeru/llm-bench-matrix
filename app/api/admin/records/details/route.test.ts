import { NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/admin/records/details/route";
import { requireAdmin } from "@/lib/admin-auth";
import { updateAdminRecordDetails } from "@/lib/admin-records-service";

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin-records-service", () => ({ updateAdminRecordDetails: vi.fn() }));

function request(body: unknown) {
  return new Request("https://example.com/api/admin/records/details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("/api/admin/records/details", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset().mockResolvedValue(null);
    vi.mocked(updateAdminRecordDetails).mockReset().mockResolvedValue({
      ok: true,
      updated: 1,
      deleted: 0,
      nonNumeric: []
    });
  });

  test("鉴权通过时保存记录详情", async () => {
    const record = {
      id: 101,
      modelId: 1,
      benchmarkId: 11,
      valueRaw: "88",
      source: "text:src",
      benchTime: "2026-04-01T00:00:00.000Z",
      valueNote: "note"
    };
    const response = await POST(request({ records: [record] }));

    expect(response.status).toBe(200);
    expect(updateAdminRecordDetails).toHaveBeenCalledWith({ records: [record] });
  });

  test("未授权时不更新", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const response = await POST(request({ records: [] }));

    expect(response.status).toBe(401);
    expect(updateAdminRecordDetails).not.toHaveBeenCalled();
  });
});
