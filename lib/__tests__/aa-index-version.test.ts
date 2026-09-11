import { describe, expect, test } from "vitest";
import {
  AA_VERSION_THRESHOLDS,
  buildOutdatedNote,
  evaluateVersionChange,
  parseVersionTrackingState,
  type TrackedVersionState
} from "@/lib/benchmark-versions/aa-index-version";

describe("aa-index-version", () => {
  describe("parseVersionTrackingState", () => {
    test("解析合法状态对象", () => {
      const valid = {
        enabled: true,
        forceNewVersionMetricKeys: ["evaluations.artificial_analysis_intelligence_index"],
        benchmarks: {
          "evaluations.artificial_analysis_intelligence_index": {
            benchmarkName: "Intelligence Index",
            benchmarkType: "composite",
            versionNumber: 2,
            startedAt: "2026-09-01T00:00:00.000Z",
            triggerReason: "检测到新版本",
            activeModelNames: ["GPT-5", "Claude 3.7"],
            upstreamIndexVersion: 2,
            lastStats: {
              overlapCount: 10,
              changedCount: 6,
              changedRatio: 0.6,
              meanDelta: 3.5
            },
            previous: {
              benchmarkName: "Intelligence Index",
              benchmarkType: "composite",
              versionNumber: 1,
              startedAt: "2026-08-01T00:00:00.000Z",
              triggerReason: "初始版本",
              activeModelNames: ["GPT-4o", "GPT-5"],
              upstreamIndexVersion: 1,
              lastStats: null
            }
          }
        }
      };

      const parsed = parseVersionTrackingState(valid);
      expect(parsed.enabled).toBe(true);
      expect(parsed.forceNewVersionMetricKeys).toEqual([
        "evaluations.artificial_analysis_intelligence_index"
      ]);
      expect(parsed.benchmarks["evaluations.artificial_analysis_intelligence_index"].versionNumber).toBe(2);
      expect(parsed.benchmarks["evaluations.artificial_analysis_intelligence_index"].previous?.versionNumber).toBe(1);
    });

    test("空值或非对象输入返回安全默认值（未启用）", () => {
      expect(parseVersionTrackingState(null)).toEqual({
        enabled: false,
        forceNewVersionMetricKeys: [],
        benchmarks: {}
      });
      expect(parseVersionTrackingState(undefined)).toEqual({
        enabled: false,
        forceNewVersionMetricKeys: [],
        benchmarks: {}
      });
      expect(parseVersionTrackingState("invalid-string")).toEqual({
        enabled: false,
        forceNewVersionMetricKeys: [],
        benchmarks: {}
      });
      expect(parseVersionTrackingState([1, 2, 3])).toEqual({
        enabled: false,
        forceNewVersionMetricKeys: [],
        benchmarks: {}
      });
    });

    test("损坏的 settings blob 安全降级为未启用状态，绝不抛 TypeError", () => {
      const corruptedBlobs = [
        { enabled: "yes", benchmarks: "not-an-object" },
        { enabled: true, benchmarks: { metric: { versionNumber: "not-a-number" } } },
        { enabled: true, benchmarks: { metric: { versionNumber: -1 } } },
        { enabled: true, benchmarks: { metric: { activeModelNames: "not-an-array" } } },
        { enabled: true, forceNewVersionMetricKeys: "not-an-array" }
      ];

      for (const blob of corruptedBlobs) {
        const result = parseVersionTrackingState(blob);
        expect(result.enabled).toBe(false);
        expect(result.forceNewVersionMetricKeys).toEqual([]);
        expect(result.benchmarks).toEqual({});
      }
    });
  });

  describe("evaluateVersionChange - 初始版本", () => {
    test("初始版本（currentState 为 null）不隐藏任何模型，取 baseline 与 incoming 的并集", () => {
      const baseline = [
        { modelName: "Legacy-Model-A", score: 60 },
        { modelName: "Overlap-Model", score: 70 }
      ];
      const incoming = [
        { modelName: "Overlap-Model", score: 71 },
        { modelName: "New-Model-B", score: 85 }
      ];

      const decision = evaluateVersionChange({
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        currentState: null,
        incoming,
        baseline,
        upstreamIndexVersion: 1
      });

      expect(decision.type).toBe("initial");
      expect(decision.detectedVersionNumber).toBe(1);
      expect(decision.activeModelCount).toBe(3);
      expect(decision.nextState.activeModelNames).toEqual([
        "Legacy-Model-A",
        "New-Model-B",
        "Overlap-Model"
      ]);
      expect(decision.nextState.previous).toBeNull();
      expect(decision.nextState.upstreamIndexVersion).toBe(1);
    });
  });

  describe("evaluateVersionChange - 统计判定换版", () => {
    test("统计判定全部满足时触发换版（overlap >= 8, changed >= 5, ratio >= 0.3, meanAbsDelta >= 1.5）", () => {
      const currentState: TrackedVersionState = {
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        versionNumber: 1,
        startedAt: "2026-08-01T00:00:00.000Z",
        triggerReason: "初始版本",
        activeModelNames: [
          "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10", "Old-Dropped-Model"
        ],
        previous: null
      };

      // 10 个重叠模型，基线分数均为 60
      const baseline = currentState.activeModelNames.map((m) => ({ modelName: m, score: 60 }));

      // 10 个模型中有 6 个变化 >= 2.0，且平均变化 >= 1.5
      const incoming = [
        { modelName: "M1", score: 66 }, // +6
        { modelName: "M2", score: 65 }, // +5
        { modelName: "M3", score: 64 }, // +4
        { modelName: "M4", score: 63 }, // +3
        { modelName: "M5", score: 63 }, // +3
        { modelName: "M6", score: 62 }, // +2 (第 6 个变动 >= 2.0)
        { modelName: "M7", score: 60.5 }, // +0.5
        { modelName: "M8", score: 60 }, // 0
        { modelName: "M9", score: 60 }, // 0
        { modelName: "M10", score: 60 }, // 0
        { modelName: "Brand-New-Model", score: 90 } // 新模型，不在 overlap 中
      ];

      const decision = evaluateVersionChange({
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        currentState,
        incoming,
        baseline
      });

      expect(decision.type).toBe("new_version");
      expect(decision.detectedVersionNumber).toBe(2);
      expect(decision.stats?.overlapCount).toBe(10);
      expect(decision.stats?.changedCount).toBe(6);
      expect(decision.stats?.changedRatio).toBe(0.6);
      expect(decision.stats?.meanDelta).toBeGreaterThanOrEqual(1.5);

      // 换版后 activeModelNames 仅包含 incoming 模型，Old-Dropped-Model 不再收录
      expect(decision.nextState.activeModelNames).not.toContain("Old-Dropped-Model");
      expect(decision.nextState.activeModelNames).toContain("Brand-New-Model");
      expect(decision.nextState.activeModelNames.length).toBe(11);

      // previous 记录上一版快照
      expect(decision.nextState.previous).not.toBeNull();
      expect(decision.nextState.previous?.versionNumber).toBe(1);
      expect(decision.nextState.previous?.activeModelNames).toContain("Old-Dropped-Model");
    });
  });

  describe("evaluateVersionChange - 同版本小幅更新", () => {
    test("小幅变动保持同版本，模型集取并集，版本号不变", () => {
      const currentState: TrackedVersionState = {
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        versionNumber: 2,
        startedAt: "2026-08-01T00:00:00.000Z",
        triggerReason: "版本 2",
        activeModelNames: ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"],
        previous: {
          benchmarkName: "Intelligence Index",
          benchmarkType: "composite",
          versionNumber: 1,
          startedAt: "2026-07-01T00:00:00.000Z",
          triggerReason: "版本 1",
          activeModelNames: ["OldModel"]
        }
      };

      const baseline = currentState.activeModelNames.map((m) => ({ modelName: m, score: 70 }));

      // 仅 1 个模型发生微调 0.5 分，其余未变；另新增 1 个新模型
      const incoming = [
        ...currentState.activeModelNames.map((m, i) => ({ modelName: m, score: i === 0 ? 70.5 : 70 })),
        { modelName: "New-Model-C", score: 80 }
      ];

      const decision = evaluateVersionChange({
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        currentState,
        incoming,
        baseline
      });

      expect(decision.type).toBe("intra_version");
      expect(decision.detectedVersionNumber).toBe(2);
      expect(decision.nextState.versionNumber).toBe(2);
      // 模型集合并
      expect(decision.nextState.activeModelNames).toContain("New-Model-C");
      expect(decision.nextState.activeModelNames.length).toBe(9);
      // 原有的 previous 快照保留
      expect(decision.nextState.previous?.versionNumber).toBe(1);
    });

    test("连续多次小幅更新不触发换版，模型持续合并", () => {
      let state: TrackedVersionState = {
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        versionNumber: 1,
        startedAt: "2026-08-01T00:00:00.000Z",
        triggerReason: "初始版本",
        activeModelNames: ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"],
        previous: null
      };

      const baseline = state.activeModelNames.map((m) => ({ modelName: m, score: 70 }));

      for (let i = 1; i <= 5; i++) {
        const incoming = [
          ...state.activeModelNames.map((m) => ({ modelName: m, score: 70.2 })),
          { modelName: `Incremental-Model-${i}`, score: 75 }
        ];

        const decision = evaluateVersionChange({
          benchmarkName: "Intelligence Index",
          benchmarkType: "composite",
          currentState: state,
          incoming,
          baseline
        });

        expect(decision.type).toBe("intra_version");
        expect(decision.detectedVersionNumber).toBe(1);
        state = decision.nextState;
      }

      expect(state.versionNumber).toBe(1);
      expect(state.activeModelNames.length).toBe(8 + 5);
    });
  });

  describe("evaluateVersionChange - 无法解析数值的行处理", () => {
    test("NaN 或非有限数值被完全跳过，不计入统计也不计入 activeModelNames，绝不按 0 处理", () => {
      const currentState: TrackedVersionState = {
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        versionNumber: 1,
        startedAt: "2026-08-01T00:00:00.000Z",
        triggerReason: "初始版本",
        activeModelNames: ["M1", "M2"],
        previous: null
      };

      const baseline = [
        { modelName: "M1", score: 80 },
        { modelName: "M2", score: 80 }
      ];

      // 带有 NaN、Infinity 等异常值
      const incoming = [
        { modelName: "M1", score: 80.1 },
        { modelName: "M2", score: Number.NaN },
        { modelName: "M3", score: Number.POSITIVE_INFINITY }
      ];

      const decision = evaluateVersionChange({
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        currentState,
        incoming,
        baseline
      });

      // M2 和 M3 被跳过，重叠模型仅 M1（1 个），绝对不会触发由于把 NaN 当作 0 产生的假换版
      expect(decision.type).toBe("intra_version");
      expect(decision.stats?.overlapCount).toBe(1);
      expect(decision.nextState.activeModelNames).toEqual(["M1", "M2"]);
      expect(decision.nextState.activeModelNames).not.toContain("M3");
    });
  });

  describe("evaluateVersionChange - 阈值边界", () => {
    const baseModels = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"];
    const baseState: TrackedVersionState = {
      benchmarkName: "Intelligence Index",
      benchmarkType: "composite",
      versionNumber: 1,
      startedAt: "2026-08-01T00:00:00.000Z",
      triggerReason: "v1",
      activeModelNames: baseModels,
      previous: null
    };
    const baseline = baseModels.map((m) => ({ modelName: m, score: 50 }));

    test("重叠模型恰好 8 个且变动恰好 5 个且比例恰好 0.3 (5/8=0.625) 且平均变动 >= 1.5 -> 命中新版本", () => {
      // 5 个变动 3.0，3 个变动 0 -> sumDelta = 15, meanAbsDelta = 15/8 = 1.875 >= 1.5
      const incoming = baseModels.map((m, idx) => ({
        modelName: m,
        score: idx < 5 ? 53 : 50
      }));

      const decision = evaluateVersionChange({
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        currentState: baseState,
        incoming,
        baseline
      });

      expect(decision.type).toBe("new_version");
      expect(decision.stats?.overlapCount).toBe(8);
      expect(decision.stats?.changedCount).toBe(5);
    });

    test("若重叠模型只有 7 个（即使变动 5 个）-> 不命中", () => {
      const incoming = baseModels.slice(0, 7).map((m, idx) => ({
        modelName: m,
        score: idx < 5 ? 53 : 50
      }));

      const decision = evaluateVersionChange({
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        currentState: baseState,
        incoming,
        baseline
      });

      expect(decision.type).toBe("intra_version");
      expect(decision.stats?.overlapCount).toBe(7);
    });

    test("若变动模型只有 4 个（即使重叠 8 个）-> 不命中", () => {
      const incoming = baseModels.map((m, idx) => ({
        modelName: m,
        score: idx < 4 ? 55 : 50 // 4 个变动
      }));

      const decision = evaluateVersionChange({
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        currentState: baseState,
        incoming,
        baseline
      });

      expect(decision.type).toBe("intra_version");
      expect(decision.stats?.changedCount).toBe(4);
    });

    test("若平均变动不足 1.5（即使 5 个模型达到 2.0 阈值）-> 不命中", () => {
      // 5 个模型恰好达到 2.0，其余 5 个为 0 -> sum = 10, overlap = 10 -> mean = 1.0 < 1.5
      const tenModels = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10"];
      const tenState: TrackedVersionState = {
        ...baseState,
        activeModelNames: tenModels
      };
      const tenBaseline = tenModels.map((m) => ({ modelName: m, score: 50 }));
      const incoming = tenModels.map((m, idx) => ({
        modelName: m,
        score: idx < 5 ? 52 : 50 // delta = 2.0 for 5 models, 0 for 5 models
      }));

      const decision = evaluateVersionChange({
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        currentState: tenState,
        incoming,
        baseline: tenBaseline
      });

      expect(decision.type).toBe("intra_version");
      expect(decision.stats?.meanDelta).toBe(1.0);
    });

    test("forceNewVersion 为 true 时无视统计直接触发换版", () => {
      const incoming = baseModels.map((m) => ({ modelName: m, score: 50 })); // 0 变动

      const decision = evaluateVersionChange({
        benchmarkName: "Intelligence Index",
        benchmarkType: "composite",
        currentState: baseState,
        incoming,
        baseline,
        forceNewVersion: true
      });

      expect(decision.type).toBe("new_version");
      expect(decision.detectedVersionNumber).toBe(2);
      expect(decision.reason).toContain("管理员手动触发新版本");
    });
  });

  describe("buildOutdatedNote", () => {
    test("格式化输出说明文案，包含版本号与旧分数", () => {
      const note = buildOutdatedNote({
        versionNumber: 2,
        previousValueRaw: "62.4"
      });

      expect(note).toBe(
        "该模型未参与 AA 当前版本（第 2 版）评测；旧版本得分 62.4，与当前版本不可比，已从表格与排名中移除。"
      );
    });

    test("原有 valueNote 存在时追加保留", () => {
      const note = buildOutdatedNote({
        versionNumber: 3,
        previousValueRaw: "78.9",
        existingNote: "厂商自测复现"
      });

      expect(note).toBe(
        "该模型未参与 AA 当前版本（第 3 版）评测；旧版本得分 78.9，与当前版本不可比，已从表格与排名中移除。（原备注：厂商自测复现）"
      );
    });
  });
});

