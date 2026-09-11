import { beforeEach, describe, expect, test, vi } from "vitest";
import { PATCH, POST } from "./route";
import { requireAdmin } from "@/lib/admin-auth";
import { invalidateAllCaches } from "@/lib/db/queries";
import {
  getAaVersionTrackingState,
  saveAaVersionTrackingState
} from "@/lib/benchmark-versions/aa-index-version-store";
import type { AaVersionTrackingState } from "@/lib/benchmark-versions/aa-index-version";

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: vi.fn()
}));

vi.mock("@/lib/db/queries", () => ({
  invalidateAllCaches: vi.fn()
}));

vi.mock("@/lib/benchmark-versions/aa-index-version-store", () => ({
  getAaVersionTrackingState: vi.fn(),
  saveAaVersionTrackingState: vi.fn()
}));

describe("/api/admin/external-import/artificial-analysis/versions", () => {
  let mockState: AaVersionTrackingState;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.mocked(invalidateAllCaches).mockResolvedValue(undefined);
    vi.mocked(saveAaVersionTrackingState).mockResolvedValue(undefined);

    mockState = {
      enabled: false,
      forceNewVersionMetricKeys: [],
      benchmarks: {
        "evaluations.artificial_analysis_intelligence_index": {
          benchmarkName: "AA Intelligence Index",
          benchmarkType: "Overall",
          versionNumber: 2,
          startedAt: "2026-09-10T00:00:00.000Z",
          triggerReason: "检测到新版本",
          activeModelNames: ["GPT-4o", "Claude 3.7"],
          upstreamIndexVersion: 2,
          lastStats: {
            overlapCount: 10,
            changedCount: 6,
            changedRatio: 0.6,
            meanDelta: 3.5
          },
          previous: {
            benchmarkName: "AA Intelligence Index",
            benchmarkType: "Overall",
            versionNumber: 1,
            startedAt: "2026-08-01T00:00:00.000Z",
            triggerReason: "初始版本",
            activeModelNames: ["GPT-4o", "GPT-3.5-Turbo"],
            upstreamIndexVersion: 1,
            lastStats: null
          }
        }
      }
    };

    vi.mocked(getAaVersionTrackingState).mockImplementation(async () => JSON.parse(JSON.stringify(mockState)));
  });

  describe("PATCH", () => {
    test("开启或关闭跨版本隔离开关，保存状态并失效缓存", async () => {
      const request = new Request("https://example.com/api/admin/external-import/artificial-analysis/versions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true })
      });

      const response = await PATCH(request);
      expect(response.status).toBe(200);

      const payload = await response.json();
      expect(payload.ok).toBe(true);
      expect(payload.state.enabled).toBe(true);

      expect(saveAaVersionTrackingState).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true })
      );
      expect(invalidateAllCaches).toHaveBeenCalled();
    });

    test("参数非法时返回 400", async () => {
      const request = new Request("https://example.com/api/admin/external-import/artificial-analysis/versions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: "not-a-boolean" })
      });

      const response = await PATCH(request);
      expect(response.status).toBe(400);
      expect(saveAaVersionTrackingState).not.toHaveBeenCalled();
    });
  });

  describe("POST - force-new-version", () => {
    test("将 metricKey 加入 forceNewVersionMetricKeys", async () => {
      const request = new Request("https://example.com/api/admin/external-import/artificial-analysis/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "force-new-version",
          metricKey: "evaluations.artificial_analysis_agentic_index"
        })
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const payload = await response.json();
      expect(payload.ok).toBe(true);
      expect(payload.state.forceNewVersionMetricKeys).toContain(
        "evaluations.artificial_analysis_agentic_index"
      );
      expect(saveAaVersionTrackingState).toHaveBeenCalledWith(
        expect.objectContaining({
          forceNewVersionMetricKeys: ["evaluations.artificial_analysis_agentic_index"]
        })
      );
    });
  });

  describe("POST - undo", () => {
    test("撤销换版判定：还原版本号并合并活跃模型集合，不产生幽灵隐藏模型", async () => {
      const request = new Request("https://example.com/api/admin/external-import/artificial-analysis/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "undo",
          metricKey: "evaluations.artificial_analysis_intelligence_index"
        })
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const payload = await response.json();
      expect(payload.ok).toBe(true);

      const restored = payload.state.benchmarks["evaluations.artificial_analysis_intelligence_index"];
      // 版本号回退为 1
      expect(restored.versionNumber).toBe(1);
      expect(restored.startedAt).toBe("2026-08-01T00:00:00.000Z");
      expect(restored.triggerReason).toContain("恢复为第 1 版同版本更新");
      // 活跃模型为上一版(GPT-4o, GPT-3.5-Turbo)与当前版(GPT-4o, Claude 3.7)的并集
      expect(restored.activeModelNames).toEqual(["Claude 3.7", "GPT-3.5-Turbo", "GPT-4o"]);
      // previous 快照清空
      expect(restored.previous).toBeNull();

      expect(saveAaVersionTrackingState).toHaveBeenCalledWith(
        expect.objectContaining({
          benchmarks: expect.objectContaining({
            "evaluations.artificial_analysis_intelligence_index": expect.objectContaining({
              versionNumber: 1,
              activeModelNames: ["Claude 3.7", "GPT-3.5-Turbo", "GPT-4o"]
            })
          })
        })
      );
      expect(invalidateAllCaches).toHaveBeenCalled();
    });

    test("没有上一版本记录时返回 400", async () => {
      mockState.benchmarks["evaluations.artificial_analysis_intelligence_index"].previous = null;

      const request = new Request("https://example.com/api/admin/external-import/artificial-analysis/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "undo",
          metricKey: "evaluations.artificial_analysis_intelligence_index"
        })
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const payload = await response.json();
      expect(payload.error).toContain("没有可撤销的上一版本记录");
      expect(saveAaVersionTrackingState).not.toHaveBeenCalled();
    });
  });
});

