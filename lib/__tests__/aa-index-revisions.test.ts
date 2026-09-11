import { describe, expect, test } from "vitest";
import {
  clusterEntriesByTime,
  detectAdaptiveMajorThreshold,
  groupBatchesIntoMajorRevisions,
  isAaMajorIndexBenchmark,
  resolveLatestAaRevisionValues
} from "@/lib/aa-index-revisions";
import type { MatrixCellEntry } from "@/components/benchmark-matrix/types";

describe("lib/aa-index-revisions", () => {
  describe("isAaMajorIndexBenchmark", () => {
    test("识别显式 AA 三大指数及数学指数", () => {
      expect(isAaMajorIndexBenchmark("AA Intelligence Index")).toBe(true);
      expect(isAaMajorIndexBenchmark("AA Coding Index")).toBe(true);
      expect(isAaMajorIndexBenchmark("AA Agentic Index")).toBe(true);
      expect(isAaMajorIndexBenchmark("AA Math Index")).toBe(true);
    });

    test("识别 AA 源的其他 Index 复合指数", () => {
      expect(isAaMajorIndexBenchmark("AA Openness Index", "text:Artificial Analysis")).toBe(true);
      expect(isAaMajorIndexBenchmark("AA Multilingual Index", "Artificial Analysis")).toBe(true);
    });

    test("排除 Cost 后缀指标与普通评测", () => {
      expect(isAaMajorIndexBenchmark("AA Intelligence Index Cost per Task")).toBe(false);
      expect(isAaMajorIndexBenchmark("AA Intelligence Index Total Cost")).toBe(false);
      expect(isAaMajorIndexBenchmark("MMLU-Pro", "text:Artificial Analysis")).toBe(false);
      expect(isAaMajorIndexBenchmark("GPQA Diamond")).toBe(false);
    });
  });

  describe("clusterEntriesByTime", () => {
    test("按时间窗口聚类并按升序排列", () => {
      const items = [
        { benchTime: "2026-03-01T10:00:00Z", modelName: "Model-B" },
        { benchTime: "2026-01-01T12:00:00Z", modelName: "Model-A" },
        { benchTime: "2026-01-01T13:00:00Z", modelName: "Model-B" }
      ];
      const batches = clusterEntriesByTime(items);
      expect(batches).toHaveLength(2);
      expect(batches[0].modelNames.has("Model-A")).toBe(true);
      expect(batches[0].modelNames.has("Model-B")).toBe(true);
      expect(batches[1].modelNames.has("Model-B")).toBe(true);
      expect(batches[0].timestamp).toBeLessThan(batches[1].timestamp);
    });
  });

  describe("detectAdaptiveMajorThreshold", () => {
    test("处理用户样例序列 111, 130, 120, 20, 110: 20 自适应判为小变动", () => {
      const counts = [111, 130, 120, 20, 110];
      const threshold = detectAdaptiveMajorThreshold(counts);
      // 阈值应落在 20 与 110 之间
      expect(threshold).toBeGreaterThan(20);
      expect(threshold).toBeLessThanOrEqual(110);
      expect(threshold).toBe(65);
    });

    test("齐次序列 110, 115, 120 全部视为主要变动", () => {
      const counts = [110, 115, 120];
      const threshold = detectAdaptiveMajorThreshold(counts);
      expect(threshold).toBe(110);
    });

    test("空或单元素序列返回有效基线", () => {
      expect(detectAdaptiveMajorThreshold([])).toBe(0);
      expect(detectAdaptiveMajorThreshold([42])).toBe(42);
    });

    test("小规模基准序列 (如 5, 4, 6) 不误判为小变动", () => {
      const threshold = detectAdaptiveMajorThreshold([5, 4, 6]);
      expect(threshold).toBe(4);
    });

    test("多批次小更新 [100, 5, 4, 110, 8]", () => {
      const threshold = detectAdaptiveMajorThreshold([100, 5, 4, 110, 8]);
      expect(threshold).toBeGreaterThan(8);
      expect(threshold).toBeLessThanOrEqual(100);
      expect(threshold).toBe(54);
    });
  });

  describe("groupBatchesIntoMajorRevisions", () => {
    test("样例序列 111 -> 130 -> 120 -> 20 -> 110: 20 自动合并入 120", () => {
      const makeBatch = (timeStr: string, count: number, prefix: string) => {
        const modelNames = new Set<string>();
        const entries: { modelName: string; benchTime: string; value: number }[] = [];
        for (let i = 0; i < count; i += 1) {
          const modelName = `${prefix}_m${i}`;
          modelNames.add(modelName);
          entries.push({ modelName, benchTime: timeStr, value: i });
        }
        return {
          timestamp: new Date(timeStr).getTime(),
          modelNames,
          entries,
          modelCount: count
        };
      };

      const b1 = makeBatch("2026-01-01T00:00:00.000Z", 111, "b1");
      const b2 = makeBatch("2026-02-01T00:00:00.000Z", 130, "b2");
      const b3 = makeBatch("2026-03-01T00:00:00.000Z", 120, "b3");
      const b4 = makeBatch("2026-03-15T00:00:00.000Z", 20, "b4");
      const b5 = makeBatch("2026-04-01T00:00:00.000Z", 110, "b5");

      const groups = groupBatchesIntoMajorRevisions([b1, b2, b3, b4, b5]);

      // 应划分为 4 个主要变动组：b1(111), b2(130), b3+b4(120+20), b5(110)
      expect(groups).toHaveLength(4);
      expect(groups[0]!.batches).toHaveLength(1);
      expect(groups[0]!.entryByModel.size).toBe(111);

      expect(groups[1]!.batches).toHaveLength(1);
      expect(groups[1]!.entryByModel.size).toBe(130);

      // 第 3 组应包含 b3 和合并的 b4
      expect(groups[2]!.batches).toHaveLength(2);
      expect(groups[2]!.entryByModel.size).toBe(140); // 120 + 20

      // 第 4 组是最新主要变动 b5
      expect(groups[3]!.batches).toHaveLength(1);
      expect(groups[3]!.entryByModel.size).toBe(110);
    });

    test("主要变动与后续小变动重复模型时，取最新值", () => {
      const bMajor = {
        timestamp: new Date("2026-04-01T00:00:00.000Z").getTime(),
        modelNames: new Set(["modelA", "modelB"]),
        entries: [
          { modelName: "modelA", benchTime: "2026-04-01T00:00:00.000Z", value: 80 },
          { modelName: "modelB", benchTime: "2026-04-01T00:00:00.000Z", value: 70 }
        ],
        modelCount: 100 // 模拟大批次
      };

      const bMinor = {
        timestamp: new Date("2026-04-10T00:00:00.000Z").getTime(),
        modelNames: new Set(["modelA", "modelC"]),
        entries: [
          { modelName: "modelA", benchTime: "2026-04-10T00:00:00.000Z", value: 95 }, // 更新
          { modelName: "modelC", benchTime: "2026-04-10T00:00:00.000Z", value: 85 }  // 新增
        ],
        modelCount: 2 // 模拟小补丁
      };

      const groups = groupBatchesIntoMajorRevisions([bMajor, bMinor], 50);
      expect(groups).toHaveLength(1);
      const latestMap = groups[0]!.entryByModel;

      // modelA 应为小变动的最新值 95
      expect(latestMap.get("modelA")?.value).toBe(95);
      expect(latestMap.get("modelA")?.benchTime).toBe("2026-04-10T00:00:00.000Z");
      // modelB 保留 70
      expect(latestMap.get("modelB")?.value).toBe(70);
      // modelC 包含进合并 85
      expect(latestMap.get("modelC")?.value).toBe(85);
    });
  });

  describe("resolveLatestAaRevisionValues", () => {
    test("仅返回最新一次主要变动及其后续小变动的模型", () => {
      const makeEntry = (modelName: string, time: string, val: number): MatrixCellEntry & { modelName: string } => ({
        modelName,
        recordId: 1,
        valueRaw: String(val),
        valueNum: val,
        valueNum2: null,
        valueNote: null,
        source: "text:Artificial Analysis",
        benchTime: time
      });

      const entries: (MatrixCellEntry & { modelName: string })[] = [];

      // V3 (老主要变动): 100 个模型
      for (let i = 0; i < 100; i += 1) {
        entries.push(makeEntry(`v3_only_${i}`, "2026-02-01T00:00:00.000Z", 60 + i));
      }
      // V3 中也包含 shared_model
      entries.push(makeEntry("shared_model", "2026-02-01T00:00:00.000Z", 75));

      // V4 (最新主要变动): 90 个模型
      for (let i = 0; i < 90; i += 1) {
        entries.push(makeEntry(`v4_model_${i}`, "2026-05-01T00:00:00.000Z", 80 + i));
      }
      entries.push(makeEntry("shared_model", "2026-05-01T00:00:00.000Z", 88));

      // V4.1 (后续小补丁): 5 个模型
      entries.push(makeEntry("shared_model", "2026-05-15T00:00:00.000Z", 92));
      entries.push(makeEntry("patch_only_model", "2026-05-15T00:00:00.000Z", 89));

      const result = resolveLatestAaRevisionValues(entries);

      // 老版本独有的模型不应存在于最新主要变动映射中
      expect(result.latestEntriesByModel.has("v3_only_0")).toBe(false);
      expect(result.latestEntriesByModel.has("v3_only_99")).toBe(false);

      // 最新主要变动的模型应存在
      expect(result.latestEntriesByModel.has("v4_model_0")).toBe(true);
      expect(result.latestEntriesByModel.get("v4_model_0")?.valueNum).toBe(80);

      // 后续小补丁模型应存在
      expect(result.latestEntriesByModel.has("patch_only_model")).toBe(true);
      expect(result.latestEntriesByModel.get("patch_only_model")?.valueNum).toBe(89);

      // shared_model 重合，应取最新补丁值 92
      expect(result.latestEntriesByModel.get("shared_model")?.valueNum).toBe(92);
      expect(result.latestEntriesByModel.get("shared_model")?.benchTime).toBe("2026-05-15T00:00:00.000Z");
    });
  });
});
