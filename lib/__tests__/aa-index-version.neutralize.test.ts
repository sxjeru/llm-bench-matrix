import { describe, expect, test } from "vitest";
import {
  applyOutdatedAaScores,
  type AaVersionTrackingState
} from "@/lib/benchmark-versions/aa-index-version";

describe("applyOutdatedAaScores - 中性化改写", () => {
  const trackingState: AaVersionTrackingState = {
    enabled: true,
    forceNewVersionMetricKeys: [],
    benchmarks: {
      "evaluations.artificial_analysis_intelligence_index": {
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        versionNumber: 2,
        startedAt: "2026-09-01T00:00:00.000Z",
        triggerReason: "检测到新版本",
        activeModelNames: ["GPT-5", "Claude 3.7 Sonnet"],
        previous: null
      }
    }
  };

  test("中性化陈旧行：valueNum 为 null，valueNum2 为 null，valueRaw 为空串，并在 valueNote 保留旧分与说明", () => {
    const rows = [
      {
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        modelName: "GPT-4o", // 未在当前版本 activeModelNames
        valueRaw: "62.4",
        valueNum: 62.4,
        valueNum2: null,
        valueNote: null,
        source: "text:Artificial Analysis"
      }
    ];

    const { rows: processed, hiddenModelCount } = applyOutdatedAaScores(rows, trackingState);

    expect(hiddenModelCount).toBe(1);
    expect(processed[0].valueNum).toBeNull();
    expect(processed[0].valueNum2).toBeNull();
    expect(processed[0].valueRaw).toBe("");
    expect(processed[0].valueNote).toContain("该模型未参与 AA 当前版本（第 2 版）评测");
    expect(processed[0].valueNote).toContain("旧版本得分 62.4");
  });

  test("当前版本的活跃模型数据原样保留，不被中性化", () => {
    const rows = [
      {
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        modelName: "GPT-5", // 在 activeModelNames 中
        valueRaw: "88.2",
        valueNum: 88.2,
        valueNum2: null,
        valueNote: "official run",
        source: "Artificial Analysis"
      }
    ];

    const { rows: processed, hiddenModelCount } = applyOutdatedAaScores(rows, trackingState);

    expect(hiddenModelCount).toBe(0);
    expect(processed[0].valueNum).toBe(88.2);
    expect(processed[0].valueRaw).toBe("88.2");
    expect(processed[0].valueNote).toBe("official run");
  });

  test("只中性化 AA 来源的数据行，手工录入或其他来源的同名指标不受影响", () => {
    const rows = [
      {
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        modelName: "GPT-4o", // 未在 activeModelNames
        valueRaw: "65.0",
        valueNum: 65.0,
        valueNum2: null,
        valueNote: "人工校对",
        source: "text:Manual Entry" // 非 AA 来源
      },
      {
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        modelName: "GPT-4o",
        valueRaw: "62.4",
        valueNum: 62.4,
        valueNum2: null,
        valueNote: null,
        source: "text:Artificial Analysis" // AA 来源
      }
    ];

    const { rows: processed, hiddenModelCount } = applyOutdatedAaScores(rows, trackingState);

    expect(hiddenModelCount).toBe(1);
    // 手工行未被中性化
    expect(processed[0].valueNum).toBe(65.0);
    expect(processed[0].valueRaw).toBe("65.0");
    expect(processed[0].valueNote).toBe("人工校对");

    // AA 来源行被中性化
    expect(processed[1].valueNum).toBeNull();
    expect(processed[1].valueRaw).toBe("");
    expect(processed[1].valueNote).toContain("旧版本得分 62.4");
  });

  test("未被追踪的 benchmark 不受影响", () => {
    const rows = [
      {
        benchmarkName: "MMLU-Pro",
        benchmarkType: "general",
        modelName: "GPT-4o",
        valueRaw: "72.5",
        valueNum: 72.5,
        valueNum2: null,
        valueNote: null,
        source: "text:Artificial Analysis"
      }
    ];

    const { rows: processed, hiddenModelCount } = applyOutdatedAaScores(rows, trackingState);

    expect(hiddenModelCount).toBe(0);
    expect(processed[0].valueNum).toBe(72.5);
    expect(processed[0].valueRaw).toBe("72.5");
  });

  test("版本追踪未启用（enabled: false）时直接返回原数据，不隐藏任何模型", () => {
    const disabledState: AaVersionTrackingState = {
      ...trackingState,
      enabled: false
    };

    const rows = [
      {
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        modelName: "GPT-4o",
        valueRaw: "62.4",
        valueNum: 62.4,
        valueNum2: null,
        valueNote: null,
        source: "text:Artificial Analysis"
      }
    ];

    const { rows: processed, hiddenModelCount } = applyOutdatedAaScores(rows, disabledState);

    expect(hiddenModelCount).toBe(0);
    expect(processed[0].valueNum).toBe(62.4);
    expect(processed[0].valueRaw).toBe("62.4");
  });
});

