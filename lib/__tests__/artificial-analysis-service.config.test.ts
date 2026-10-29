import { beforeEach, describe, expect, test, vi } from "vitest";
import { saveArtificialAnalysisConfig } from "@/lib/external-providers/artificial-analysis-service";
import { getSettings, saveSetting, invalidateAllCaches } from "@/lib/db/queries";

vi.mock("@/lib/db/client", () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn()
  }
}));

vi.mock("@/lib/db/queries", () => ({
  getSettings: vi.fn(),
  saveSetting: vi.fn(),
  invalidateAllCaches: vi.fn()
}));

vi.mock("@/lib/admin-service", () => ({}));

describe("saveArtificialAnalysisConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("保存配置时保留已有的 intelligenceIndexVersion 与 versionHistory", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      "external_import:artificial-analysis": {
        selectedMetrics: ["evaluations.mmlu_pro"],
        intelligenceIndexVersion: 5,
        intelligenceIndexVersionHistory: [
          { version: 4, effectiveFrom: "2026-08-01T00:00:00.000Z", note: "v4" },
          { version: 5, effectiveFrom: "2026-10-28T00:00:00.000Z", note: "v5" }
        ]
      }
    });

    const result = await saveArtificialAnalysisConfig({
      selectedMetrics: ["evaluations.gpqa"]
    });

    expect(result.selectedMetrics).toEqual(["evaluations.gpqa"]);
    expect(result.intelligenceIndexVersion).toBe(5);
    expect(result.intelligenceIndexVersionHistory).toHaveLength(2);

    expect(saveSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "external_import:artificial-analysis",
        valueJson: expect.objectContaining({
          selectedMetrics: ["evaluations.gpqa"],
          intelligenceIndexVersion: 5,
          intelligenceIndexVersionHistory: expect.arrayContaining([
            expect.objectContaining({ version: 5 })
          ])
        })
      })
    );
    expect(invalidateAllCaches).toHaveBeenCalled();
  });
});

