import { describe, expect, test } from "vitest";
import {
  syncVersionTrackingEntityChange,
  type VersionTrackingEntityChangeEvent
} from "@/lib/benchmark-versions/aa-index-version";
import type { AaVersionTrackingState } from "@/lib/benchmark-versions/aa-index-version";

describe("syncVersionTrackingEntityChange - 实体改名与合并级联同步", () => {
  const baseState: AaVersionTrackingState = {
    enabled: true,
    forceNewVersionMetricKeys: [],
    benchmarks: {
      "evaluations.artificial_analysis_intelligence_index": {
        benchmarkId: 10,
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        versionNumber: 2,
        startedAt: "2026-09-01T00:00:00.000Z",
        triggerReason: "检测到新版本",
        activeModelNames: ["Claude 3.5 Sonnet", "GPT-4o"],
        activeModelIds: [100, 200],
        previous: {
          benchmarkId: 10,
          benchmarkName: "Intelligence Index",
          benchmarkType: "composite",
          versionNumber: 1,
          startedAt: "2026-08-01T00:00:00.000Z",
          triggerReason: "初始版本",
          activeModelNames: ["Claude 3.5 Sonnet", "GPT-4"],
          activeModelIds: [100, 199]
        }
      }
    }
  };

  test("模型改名：应将 activeModelNames 和 previous.activeModelNames 中的旧名替换为新名", () => {
    const event: VersionTrackingEntityChangeEvent = {
      type: "model-renamed",
      modelId: 100,
      previousName: "Claude 3.5 Sonnet",
      nextName: "Claude 3.5 Sonnet (20241022)"
    };

    const { state: next, changed } = syncVersionTrackingEntityChange(baseState, event);

    expect(changed).toBe(true);
    const tracked = next.benchmarks["evaluations.artificial_analysis_intelligence_index"];
    expect(tracked.activeModelNames).toContain("Claude 3.5 Sonnet (20241022)");
    expect(tracked.activeModelNames).not.toContain("Claude 3.5 Sonnet");
    expect(tracked.previous?.activeModelNames).toContain("Claude 3.5 Sonnet (20241022)");
    expect(tracked.previous?.activeModelNames).not.toContain("Claude 3.5 Sonnet");
  });

  test("模型合并：源模型应被替换为目标模型，ID 也同步更新", () => {
    const event: VersionTrackingEntityChangeEvent = {
      type: "model-merged",
      sourceId: 200,
      sourceName: "GPT-4o",
      targetId: 300,
      targetName: "GPT-4o-Unified"
    };

    const { state: next, changed } = syncVersionTrackingEntityChange(baseState, event);

    expect(changed).toBe(true);
    const tracked = next.benchmarks["evaluations.artificial_analysis_intelligence_index"];
    expect(tracked.activeModelNames).toContain("GPT-4o-Unified");
    expect(tracked.activeModelNames).not.toContain("GPT-4o");
    expect(tracked.activeModelIds).toContain(300);
    expect(tracked.activeModelIds).not.toContain(200);
  });

  test("指标改名与改类别：benchmarkName 与 benchmarkType 应级联更新", () => {
    const event: VersionTrackingEntityChangeEvent = {
      type: "benchmark-renamed",
      benchmarkId: 10,
      previousName: "Intelligence Index",
      previousType: "composite",
      nextName: "AA Intelligence Index",
      nextType: "Overall"
    };

    const { state: next, changed } = syncVersionTrackingEntityChange(baseState, event);

    expect(changed).toBe(true);
    const tracked = next.benchmarks["evaluations.artificial_analysis_intelligence_index"];
    expect(tracked.benchmarkName).toBe("AA Intelligence Index");
    expect(tracked.benchmarkType).toBe("Overall");
    expect(tracked.previous?.benchmarkName).toBe("AA Intelligence Index");
    expect(tracked.previous?.benchmarkType).toBe("Overall");
  });

  test("指标合并：源指标追踪状态应更新为目标指标的名称、类别与 ID", () => {
    const event: VersionTrackingEntityChangeEvent = {
      type: "benchmark-merged",
      sourceId: 10,
      sourceName: "Intelligence Index",
      sourceType: "composite",
      targetId: 999,
      targetName: "Unified Intelligence Score",
      targetType: "General"
    };

    const { state: next, changed } = syncVersionTrackingEntityChange(baseState, event);

    expect(changed).toBe(true);
    const tracked = next.benchmarks["evaluations.artificial_analysis_intelligence_index"];
    expect(tracked.benchmarkId).toBe(999);
    expect(tracked.benchmarkName).toBe("Unified Intelligence Score");
    expect(tracked.benchmarkType).toBe("General");
  });

  test("无关实体的事件：不会引起任何状态变动", () => {
    const event: VersionTrackingEntityChangeEvent = {
      type: "model-renamed",
      previousName: "Non-Existent Model",
      nextName: "Still Non-Existent"
    };

    const { state: next, changed } = syncVersionTrackingEntityChange(baseState, event);

    expect(changed).toBe(false);
    expect(next).toBe(baseState);
  });
});
