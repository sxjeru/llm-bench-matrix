import { NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET, POST } from "@/app/api/admin/records/split-pair-values/route";
import { requireAdmin } from "@/lib/admin-auth";
import { getRecordDualValueCandidates, splitDualValueRecords } from "@/lib/admin-records-service";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/admin-records-service", () => ({
  getRecordDualValueCandidates: vi.fn(),
  splitDualValueRecords: vi.fn()
}));

function jsonRequest(body: unknown) {
  return new Request("https://example.com/api/admin/records/split-pair-values", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("/api/admin/records/split-pair-values", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(getRecordDualValueCandidates).mockReset();
    vi.mocked(splitDualValueRecords).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.mocked(getRecordDualValueCandidates).mockResolvedValue({
      generatedAt: "2026-04-01T00:00:00.000Z",
      candidates: [
        {
          benchmarkId: 11,
          benchmarkName: "Bench-1",
          benchmarkType: "general",
          dualValueCount: 2,
          totalCount: 2,
          sampleValues: ["77 / 88"],
          valueDetails: []
        }
      ]
    });
    vi.mocked(splitDualValueRecords).mockResolvedValue({
      ok: true,
      sourceBenchmarkId: 11,
      sourceBenchmarkLabel: "Bench-1 (general)",
      firstBenchmarkId: 11,
      firstBenchmarkLabel: "Bench-1 (general)",
      secondBenchmarkId: 12,
      secondBenchmarkLabel: "Bench-1 (2) (general)",
      splitCount: 2,
      createdCount: 2,
      skipped: 0
    });
  });

  describe("GET", () => {
    test("未授权时不加载候选", async () => {
      const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      vi.mocked(requireAdmin).mockResolvedValue(denied);

      const response = await GET(
        new Request("https://example.com/api/admin/records/split-pair-values")
      );

      expect(response.status).toBe(401);
      expect(getRecordDualValueCandidates).not.toHaveBeenCalled();
    });

    test("非法 sourceMode 返回 400", async () => {
      const response = await GET(
        new Request("https://example.com/api/admin/records/split-pair-values?sourceMode=other")
      );

      expect(response.status).toBe(400);
      expect(getRecordDualValueCandidates).not.toHaveBeenCalled();
    });

    test("解析筛选并返回双值候选", async () => {
      const response = await GET(
        new Request(
          "https://example.com/api/admin/records/split-pair-values?sourceMode=empty&modelIds=1&benchmarkIds=11,12"
        )
      );

      expect(response.status).toBe(200);
      expect(getRecordDualValueCandidates).toHaveBeenCalledWith({
        sourceMode: "empty",
        source: null,
        modelIds: [1],
        benchmarkIds: [11, 12]
      });
    });
  });

  describe("POST", () => {
    test("未授权时不拆分", async () => {
      const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      vi.mocked(requireAdmin).mockResolvedValue(denied);

      const response = await POST(
        jsonRequest({
          benchmarkId: 11,
          first: { benchmarkId: 11 },
          second: { benchmarkName: "Bench-1 (Elo)" }
        })
      );

      expect(response.status).toBe(401);
      expect(splitDualValueRecords).not.toHaveBeenCalled();
    });

    test("缺少拆分目标返回 400", async () => {
      const response = await POST(
        jsonRequest({
          benchmarkId: 11,
          first: {},
          second: { benchmarkId: 12 }
        })
      );

      expect(response.status).toBe(400);
      expect(splitDualValueRecords).not.toHaveBeenCalled();
    });

    test("鉴权通过时调用 splitDualValueRecords", async () => {
      const payload = {
        benchmarkId: 11,
        first: { benchmarkId: 11 },
        second: { benchmarkName: "Bench-1 (Elo)", benchmarkType: "Type-A" },
        scope: { modelIds: [1] }
      };

      const response = await POST(jsonRequest(payload));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        sourceBenchmarkId: 11,
        sourceBenchmarkLabel: "Bench-1 (general)",
        firstBenchmarkId: 11,
        firstBenchmarkLabel: "Bench-1 (general)",
        secondBenchmarkId: 12,
        secondBenchmarkLabel: "Bench-1 (2) (general)",
        splitCount: 2,
        createdCount: 2,
        skipped: 0
      });
      expect(splitDualValueRecords).toHaveBeenCalledWith(payload);
    });

    test("不能指向同一目标映射 400", async () => {
      vi.mocked(splitDualValueRecords).mockRejectedValue(
        new Error("拆分目标不能指向同一 benchmark")
      );

      const response = await POST(
        jsonRequest({
          benchmarkId: 11,
          first: { benchmarkId: 11 },
          second: { benchmarkId: 11 }
        })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "拆分目标不能指向同一 benchmark"
      });
    });
  });
});
