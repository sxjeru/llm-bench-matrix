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

  test("支持 sourceBenchmarkType 覆盖类别匹配：当 benchmarkType 为 General 但 sourceBenchmarkType 为 composite 时能够正确命中", () => {
    const rows = [
      {
        benchmarkName: "Intelligence Index",
        benchmarkType: "General", // 数据库原始实体为 General
        sourceBenchmarkType: "composite", // AA 来源覆盖为 composite
        modelName: "GPT-4o", // 未在 activeModelNames
        valueRaw: "62.4",
        valueNum: 62.4,
        valueNum2: null,
        valueNote: null,
        source: "Artificial Analysis"
      }
    ];

    const { rows: processed, hiddenModelCount } = applyOutdatedAaScores(rows, trackingState);

    expect(hiddenModelCount).toBe(1);
    expect(processed[0].valueNum).toBeNull();
    expect(processed[0].valueRaw).toBe("");
    expect(processed[0].valueNote).toContain("该模型未参与 AA 当前版本（第 2 版）评测");
  });

  test("支持 modelId 匹配：模型在数据库改名后（modelName 变为新名），依然可通过 activeModelIds 判定为活跃而不被中性化", () => {
    const stateWithIds: AaVersionTrackingState = {
      enabled: true,
      forceNewVersionMetricKeys: [],
      benchmarks: {
        "evaluations.artificial_analysis_intelligence_index": {
          benchmarkName: "Intelligence Index",
          benchmarkType: "composite",
          versionNumber: 2,
          startedAt: "2026-09-01T00:00:00.000Z",
          triggerReason: "检测到新版本",
          activeModelNames: ["GPT-5"], // 记录的是旧名
          activeModelIds: [101], // 记录的数据库 modelId
          previous: null
        }
      }
    };

    const rows = [
      {
        modelId: 101, // 数据库 ID 一致
        modelName: "GPT-5 (2025-New-Name)", // 后台改名后的新名称
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        valueRaw: "92.0",
        valueNum: 92.0,
        valueNum2: null,
        valueNote: null,
        source: "Artificial Analysis"
      }
    ];

    const { rows: processed, hiddenModelCount } = applyOutdatedAaScores(rows, stateWithIds);

    expect(hiddenModelCount).toBe(0);
    expect(processed[0].valueNum).toBe(92.0);
    expect(processed[0].valueRaw).toBe("92.0");
  });

  test("支持 modelId 防借壳：其他模型改名为旧活跃名但 modelId 不同，依然会被判定为陈旧行中性化", () => {
    const stateWithIds: AaVersionTrackingState = {
      enabled: true,
      forceNewVersionMetricKeys: [],
      benchmarks: {
        "evaluations.artificial_analysis_intelligence_index": {
          benchmarkName: "Intelligence Index",
          benchmarkType: "composite",
          versionNumber: 2,
          startedAt: "2026-09-01T00:00:00.000Z",
          triggerReason: "检测到新版本",
          activeModelNames: ["GPT-5"],
          activeModelIds: [101],
          previous: null
        }
      }
    };

    const rows = [
      {
        modelId: 202, // 借壳模型：另一个模型的 ID
        modelName: "GPT-5", // 改名为了旧活跃模型相同的名称，但 modelId 不同
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        valueRaw: "62.4",
        valueNum: 62.4,
        valueNum2: null,
        valueNote: null,
        source: "Artificial Analysis"
      }
    ];

    const { rows: processed, hiddenModelCount } = applyOutdatedAaScores(rows, stateWithIds);

    expect(hiddenModelCount).toBe(1);
    expect(processed[0].valueNum).toBeNull();
  });

  test("支持 benchmarkId 匹配：指标改名后（benchmarkName 变动），依然可通过 benchmarkId 命中版本隔离", () => {
    const stateWithBenchmarkId: AaVersionTrackingState = {
      enabled: true,
      forceNewVersionMetricKeys: [],
      benchmarks: {
        "evaluations.artificial_analysis_intelligence_index": {
          benchmarkId: 99,
          benchmarkName: "Intelligence Index (Old Name)",
          benchmarkType: "composite",
          versionNumber: 2,
          startedAt: "2026-09-01T00:00:00.000Z",
          triggerReason: "检测到新版本",
          activeModelNames: ["GPT-5"],
          previous: null
        }
      }
    };

    const rows = [
      {
        benchmarkId: 99,
        benchmarkName: "Intelligence Index (Renamed by Admin)", // 指标已改名
        benchmarkType: "composite",
        modelName: "GPT-4o",
        valueRaw: "62.4",
        valueNum: 62.4,
        valueNum2: null,
        valueNote: null,
        source: "Artificial Analysis"
      }
    ];

    const { rows: processed, hiddenModelCount } = applyOutdatedAaScores(rows, stateWithBenchmarkId);

    expect(hiddenModelCount).toBe(1);
    expect(processed[0].valueNum).toBeNull();
    expect(processed[0].valueRaw).toBe("");
  });
});

