import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useImportPreviewState } from "@/components/admin-console/hooks/use-import-preview-state";
import type {
  BenchmarkOption,
  ModelOption,
  ProviderOption,
  TextImportPreviewRow,
  ModelDedupeRule
} from "@/components/admin-console/types";

const defaultModelDedupeRule: ModelDedupeRule = {
  lowercase: true,
  removeHyphen: false,
  removeSpace: false,
  removeDot: false
};

function createMockOptions(overrides: Partial<Parameters<typeof useImportPreviewState>[0]> = {}) {
  return {
    benchmarks: [],
    textImportDraftRows: [],
    textImportPreviewRows: [],
    textImportPreviewVisibleCount: 10,
    csvSource: "",
    ignoredBenchmarkKeys: {},
    parenthesesModes: {},
    parenthesesCustomNames: {},
    modelParenthesesModes: {},
    modelParenthesesCustomNames: {},
    modelMergeTargets: {},
    benchmarkMergeTargets: {},
    modelById: new Map<number, ModelOption>(),
    providerById: new Map<number, ProviderOption>(),
    benchmarkById: new Map<number, BenchmarkOption>(),
    modelDedupeRule: defaultModelDedupeRule,
    existingModelExactMap: new Map<string, ModelOption>(),
    existingModelByCanonicalKey: new Map<string, ModelOption>(),
    existingModelByNameMap: new Map<string, ModelOption[]>(),
    existingModelByCompareKey: new Map<string, ModelOption[]>(),
    existingBenchmarkExactMap: new Map<string, BenchmarkOption>(),
    existingBenchmarkByNameMap: new Map<string, BenchmarkOption[]>(),
    existingBenchmarkModalitiesMap: new Map<string, string[]>(),
    ...overrides
  };
}

describe("useImportPreviewState Hook - benchmarkPreviewValueOverlapPayload", () => {
  test("导入 >100 数值且库内同名 benchmark 值均大于 100 时不显示缺失 Elo 警告", () => {
    const draftRow: TextImportPreviewRow = {
      rowNumber: 1,
      providerName: "OpenAI",
      modelName: "QwenVision2Code",
      benchmarkName: "QwenVision2Code",
      benchmarkType: "Multimodal Reasoning",
      rawValue: "1215",
      valueNum: 1215,
      valueNum2: null,
      valueNote: null,
      source: null,
      valid: true
    };

    const benchmark: BenchmarkOption = {
      id: 101,
      benchmarkName: "QwenVision2Code",
      benchmarkType: "Multimodal Reasoning",
      modalities: ["Vision"],
      valueCount: 3,
      overHundredValueCount: 3
    };

    const options = createMockOptions({
      benchmarks: [benchmark],
      textImportDraftRows: [draftRow],
      existingBenchmarkExactMap: new Map([["qwenvision2code@@multimodal reasoning", benchmark]]),
      existingBenchmarkByNameMap: new Map([["qwenvision2code", [benchmark]]])
    });

    const { result } = renderHook(() => useImportPreviewState(options));

    expect(result.current.benchmarkWarnings).toEqual([]);
  });

  test("导入 >100 数值但库内同名 benchmark 存在 <=100 值时仍显示缺失 Elo 警告", () => {
    const draftRow: TextImportPreviewRow = {
      rowNumber: 1,
      providerName: "OpenAI",
      modelName: "QwenVision2Code",
      benchmarkName: "QwenVision2Code",
      benchmarkType: "Multimodal Reasoning",
      rawValue: "1215",
      valueNum: 1215,
      valueNum2: null,
      valueNote: null,
      source: null,
      valid: true
    };

    const benchmark: BenchmarkOption = {
      id: 101,
      benchmarkName: "QwenVision2Code",
      benchmarkType: "Multimodal Reasoning",
      modalities: ["Vision"],
      valueCount: 3,
      overHundredValueCount: 2
    };

    const options = createMockOptions({
      benchmarks: [benchmark],
      textImportDraftRows: [draftRow],
      existingBenchmarkExactMap: new Map([["qwenvision2code@@multimodal reasoning", benchmark]]),
      existingBenchmarkByNameMap: new Map([["qwenvision2code", [benchmark]]])
    });

    const { result } = renderHook(() => useImportPreviewState(options));

    expect(result.current.benchmarkWarnings).toHaveLength(1);
    expect(result.current.benchmarkWarnings[0].reasons).toContain(
      "检测到 >100 Elo 数值，但库内不存在 QwenVision2Code (Elo)"
    );
  });

  test("在没有输入行或 benchmarks 时，返回空的 overlap 负载", () => {
    const options = createMockOptions({
      benchmarks: [],
      textImportDraftRows: []
    });

    const { result } = renderHook(() => useImportPreviewState(options));

    expect(result.current.benchmarkPreviewValueOverlapPayload).toEqual({
      key: "",
      items: []
    });
  });

  test("当输入行不匹配任何 benchmarks 时，返回空的 overlap 负载", () => {
    const draftRow: TextImportPreviewRow = {
      rowNumber: 1,
      providerName: "OpenAI",
      modelName: "GPT-4",
      benchmarkName: "NonExistentBench",
      benchmarkType: "Multiple Choice",
      rawValue: "0.85",
      valueNum: 0.85,
      valueNum2: null,
      valueNote: null,
      source: null,
      valid: true
    };

    const benchmark: BenchmarkOption = {
      id: 1,
      benchmarkName: "MMLU",
      benchmarkType: "Multiple Choice",
      modalities: ["Text"]
    };

    const options = createMockOptions({
      benchmarks: [benchmark],
      textImportDraftRows: [draftRow]
    });

    const { result } = renderHook(() => useImportPreviewState(options));

    expect(result.current.benchmarkPreviewValueOverlapPayload).toEqual({
      key: "",
      items: []
    });
  });

  test("当输入行和 benchmark 名称、类型完全一致时，能高优先级匹配且正确输出 cells 信息", () => {
    const draftRow: TextImportPreviewRow = {
      rowNumber: 1,
      providerName: "OpenAI",
      modelName: "GPT-4",
      benchmarkName: "MMLU",
      benchmarkType: "Multiple Choice",
      rawValue: "0.85",
      valueNum: 0.85,
      valueNum2: null,
      valueNote: null,
      source: null,
      valid: true
    };

    const benchmark: BenchmarkOption = {
      id: 101,
      benchmarkName: "MMLU",
      benchmarkType: "Multiple Choice",
      modalities: ["Text"]
    };

    const options = createMockOptions({
      benchmarks: [benchmark],
      textImportDraftRows: [draftRow],
      // 忽略此 benchmark 的 merge candidate 计算，完全依靠 search candidate 逻辑
      ignoredBenchmarkKeys: { "MMLU@@Multiple Choice": true }
    });

    const { result } = renderHook(() => useImportPreviewState(options));

    expect(result.current.benchmarkPreviewValueOverlapPayload.items).toHaveLength(1);
    const item = result.current.benchmarkPreviewValueOverlapPayload.items[0];
    expect(item.previewBenchmarkKey).toBe("MMLU@@Multiple Choice");
    expect(item.candidateBenchmarkIds).toEqual([101]);
    expect(item.cells).toEqual([
      { modelName: "GPT-4", rawValue: "0.85" }
    ]);
  });

  test("模型名变化时会更新重复率重算触发 key", () => {
    const draftRow: TextImportPreviewRow = {
      rowNumber: 1,
      providerName: "OpenAI",
      modelName: "GPT-4",
      benchmarkName: "MMLU",
      benchmarkType: "Multiple Choice",
      rawValue: "0.85",
      valueNum: 0.85,
      valueNum2: null,
      valueNote: null,
      source: null,
      valid: true
    };

    const benchmark: BenchmarkOption = {
      id: 101,
      benchmarkName: "MMLU",
      benchmarkType: "Multiple Choice",
      modalities: ["Text"]
    };

    const { result, rerender } = renderHook(
      ({ rows }) => useImportPreviewState(createMockOptions({ benchmarks: [benchmark], textImportDraftRows: rows })),
      { initialProps: { rows: [draftRow] } }
    );

    const initialTriggerKey = result.current.benchmarkPreviewValueOverlapTriggerKey;

    rerender({ rows: [{ ...draftRow, modelName: "GPT-4o" }] });

    expect(result.current.benchmarkPreviewValueOverlapPayload.items[0].cells).toEqual([
      { modelName: "GPT-4o", rawValue: "0.85" }
    ]);
    expect(result.current.benchmarkPreviewValueOverlapTriggerKey).not.toBe(initialTriggerKey);
  });

  test("评分排序：完全匹配名称及类型 > 完全匹配名称不同类型 > 部分匹配且类型匹配 > 部分匹配且类型不匹配", () => {
    const draftRow: TextImportPreviewRow = {
      rowNumber: 1,
      providerName: "OpenAI",
      modelName: "GPT-4",
      benchmarkName: "MMLU-v1",
      benchmarkType: "Multiple Choice",
      rawValue: "0.85",
      valueNum: 0.85,
      valueNum2: null,
      valueNote: null,
      source: null,
      valid: true
    };

    const benchmarks: BenchmarkOption[] = [
      {
        id: 3,
        benchmarkName: "MMLU-v1-Other", // 部分匹配且类型不匹配 -> 120 分
        benchmarkType: "Chat",
        modalities: ["Text"]
      },
      {
        id: 2,
        benchmarkName: "MMLU-v1-Part", // 部分匹配且类型匹配 -> 130 分
        benchmarkType: "Multiple Choice",
        modalities: ["Text"]
      },
      {
        id: 1,
        benchmarkName: "MMLU-v1", // 完全匹配名称且类型匹配 -> 310 分
        benchmarkType: "Multiple Choice",
        modalities: ["Text"]
      }
    ];

    const options = createMockOptions({
      benchmarks,
      textImportDraftRows: [draftRow],
      // 设置 exact map 以避免 warnings，同时忽略 merge map 计算以防干扰排序
      existingBenchmarkExactMap: new Map([["mmlu-v1@@multiple choice", benchmarks[2]]]),
      ignoredBenchmarkKeys: { "MMLU-v1@@Multiple Choice": true }
    });

    const { result } = renderHook(() => useImportPreviewState(options));

    expect(result.current.benchmarkPreviewValueOverlapPayload.items).toHaveLength(1);
    const item = result.current.benchmarkPreviewValueOverlapPayload.items[0];
    
    // 应该按照打分从高到低排序：
    // id 1 (310) > id 2 (130) > id 3 (120)
    expect(item.candidateBenchmarkIds).toEqual([1, 2, 3]);
  });

  test("匹配结果限制在最多 30 个 candidates 内", () => {
    const draftRow: TextImportPreviewRow = {
      rowNumber: 1,
      providerName: "OpenAI",
      modelName: "GPT-4",
      benchmarkName: "MMLU",
      benchmarkType: "Multiple Choice",
      rawValue: "0.85",
      valueNum: 0.85,
      valueNum2: null,
      valueNote: null,
      source: null,
      valid: true
    };

    // 构造 35 个能匹配上 "MMLU" 的候选
    const benchmarks: BenchmarkOption[] = Array.from({ length: 35 }, (_, index) => ({
      id: index + 1,
      benchmarkName: `MMLU-${index + 1}`,
      benchmarkType: "Multiple Choice",
      modalities: ["Text"]
    }));

    const options = createMockOptions({
      benchmarks,
      textImportDraftRows: [draftRow],
      // 忽略 merge map 计算以保证完全由搜索模块限制 30 个结果
      ignoredBenchmarkKeys: { "MMLU@@Multiple Choice": true }
    });

    const { result } = renderHook(() => useImportPreviewState(options));

    expect(result.current.benchmarkPreviewValueOverlapPayload.items).toHaveLength(1);
    const item = result.current.benchmarkPreviewValueOverlapPayload.items[0];
    expect(item.candidateBenchmarkIds).toHaveLength(30);
  });

  test("benchmark 搜索候选会忽略横杠差异", () => {
    const draftRow: TextImportPreviewRow = {
      rowNumber: 1,
      providerName: "OpenAI",
      modelName: "GPT-4",
      benchmarkName: "Deep-Planning",
      benchmarkType: "Agentic",
      rawValue: "0.85",
      valueNum: 0.85,
      valueNum2: null,
      valueNote: null,
      source: null,
      valid: true
    };

    const benchmark: BenchmarkOption = {
      id: 42,
      benchmarkName: "DeepPlanning",
      benchmarkType: "Agentic",
      modalities: ["Text"]
    };

    const options = createMockOptions({
      benchmarks: [benchmark],
      textImportDraftRows: [draftRow],
      ignoredBenchmarkKeys: { "Deep-Planning@@Agentic": true }
    });

    const { result } = renderHook(() => useImportPreviewState(options));

    expect(result.current.benchmarkPreviewValueOverlapPayload.items).toHaveLength(1);
    expect(result.current.benchmarkPreviewValueOverlapPayload.items[0].candidateBenchmarkIds).toEqual([42]);
  });

  test("benchmark 搜索候选会忽略空格差异", () => {
    const draftRow: TextImportPreviewRow = {
      rowNumber: 1,
      providerName: "OpenAI",
      modelName: "GPT-4",
      benchmarkName: "AutomationBench",
      benchmarkType: "General",
      rawValue: "0.85",
      valueNum: 0.85,
      valueNum2: null,
      valueNote: null,
      source: null,
      valid: true
    };

    const benchmark: BenchmarkOption = {
      id: 42,
      benchmarkName: "Automation Bench",
      benchmarkType: "General",
      modalities: ["Text"]
    };

    const options = createMockOptions({
      benchmarks: [benchmark],
      textImportDraftRows: [draftRow],
      ignoredBenchmarkKeys: { "AutomationBench@@General": true }
    });

    const { result } = renderHook(() => useImportPreviewState(options));

    expect(result.current.benchmarkPreviewValueOverlapPayload.items).toHaveLength(1);
    expect(result.current.benchmarkPreviewValueOverlapPayload.items[0].candidateBenchmarkIds).toEqual([42]);
  });

  test("空输入或空 compare key 时不返回候选 id", () => {
    const draftRow: TextImportPreviewRow = {
      rowNumber: 1,
      providerName: "OpenAI",
      modelName: "GPT-4",
      benchmarkName: " ", // 空格
      benchmarkType: "Multiple Choice",
      rawValue: "0.85",
      valueNum: 0.85,
      valueNum2: null,
      valueNote: null,
      source: null,
      valid: true
    };

    const benchmark: BenchmarkOption = {
      id: 1,
      benchmarkName: "MMLU",
      benchmarkType: "Multiple Choice",
      modalities: ["Text"]
    };

    const options = createMockOptions({
      benchmarks: [benchmark],
      textImportDraftRows: [draftRow]
    });

    const { result } = renderHook(() => useImportPreviewState(options));

    expect(result.current.benchmarkPreviewValueOverlapPayload).toEqual({
      key: "",
      items: []
    });
  });

  test("正确合并警告候选（benchmarkWarnings）、自定义合并候选（benchmarkMergeCandidateMap）与搜索候选", () => {
    const draftRow: TextImportPreviewRow = {
      rowNumber: 1,
      providerName: "OpenAI",
      modelName: "GPT-4",
      benchmarkName: "MMLU-v1",
      benchmarkType: "Multiple Choice",
      rawValue: "0.85",
      valueNum: 0.85,
      valueNum2: null,
      valueNote: null,
      source: null,
      valid: true
    };

    const benchmarks: BenchmarkOption[] = [
      {
        id: 101,
        benchmarkName: "MMLU-v1-Part", // 属于搜索候选且评分 > 0
        benchmarkType: "Multiple Choice",
        modalities: ["Text"]
      },
      {
        id: 201,
        benchmarkName: "MMLU v1", // CompareKey 匹配 (将产生 warning 候选与 merge candidate)
        benchmarkType: "Multiple Choice",
        modalities: ["Text"]
      }
    ];

    const options = createMockOptions({
      benchmarks,
      textImportDraftRows: [draftRow]
    });

    const { result } = renderHook(() => useImportPreviewState(options));

    expect(result.current.benchmarkPreviewValueOverlapPayload.items).toHaveLength(1);
    const item = result.current.benchmarkPreviewValueOverlapPayload.items[0];
    
    // 预期：
    // 1. 由于 "MMLU-v1" 的 compareKey 与 "MMLU v1" 一致，会生成警告及合并候选 id 201
    // 2. 搜索模块会因为部分包含匹配到 "MMLU-v1-Part" (id 101)，以及 "MMLU v1" (id 201)
    // 3. 最终返回的所有候选 id 集合中去重合并包含 101 和 201
    expect(item.candidateBenchmarkIds).toContain(101);
    expect(item.candidateBenchmarkIds).toContain(201);
    expect(item.candidateBenchmarkIds.length).toBe(2);
  });
});
