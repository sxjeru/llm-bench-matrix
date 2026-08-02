import { describe, expect, test } from "vitest";
import {
  buildMetricCatalog,
  buildImportRows,
  formatMetricValue,
  normalizeImportConfig,
  resolveModelMatches,
  type ArtificialAnalysisModel,
  type LocalModelInput,
  type ModelMatchResult
} from "@/lib/external-providers/artificial-analysis";

/**
 * fixture 结构对齐 https://artificialanalysis.ai/api-reference 的
 * `GET /api/v2/data/llms/models` 响应示例，模型命名沿用 artificialanalysis.ai/models
 * 上的真实写法（`(max)` / `(Adaptive Reasoning, Max Effort)` / `(Non-reasoning)`）。
 */
function upstream(
  id: string,
  name: string,
  creator: string,
  evaluations: Record<string, number | null> = {},
  extra: Partial<ArtificialAnalysisModel> = {}
): ArtificialAnalysisModel {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    model_creator: { id: creator.toLowerCase(), name: creator, slug: creator.toLowerCase() },
    evaluations,
    ...extra
  };
}

function local(
  id: number,
  modelName: string,
  providerName: string,
  sourceModelId: string | null = null
): LocalModelInput {
  return {
    id,
    modelName,
    sourceModelId,
    providerName,
    providerSlug: providerName.toLowerCase(),
    providerDisplayName: null
  };
}

function findMatch(matches: ModelMatchResult[], modelId: number) {
  return matches.find((match) => match.modelId === modelId)!;
}

describe("resolveModelMatches", () => {
  test("本地未标推理强度时，默认绑定上游同族里最高的档位", () => {
    const upstreamModels = [
      upstream("aa-low", "GPT 5.4 (low)", "OpenAI"),
      upstream("aa-medium", "GPT 5.4 (medium)", "OpenAI"),
      upstream("aa-high", "GPT 5.4 (high)", "OpenAI"),
      upstream("aa-xhigh", "GPT 5.4 (xhigh)", "OpenAI")
    ];

    const { matches } = resolveModelMatches([local(1, "GPT 5.4", "OpenAI")], upstreamModels);
    const match = findMatch(matches, 1);

    expect(match.externalModelId).toBe("aa-xhigh");
    expect(match.matchReason).toBe("highest-effort-default");
    expect(match.matchStatus).toBe("matched");
    expect(match.reasoningEffort).toBe("xhigh");
  });

  test("max 档存在时优先于 xhigh", () => {
    const upstreamModels = [
      upstream("aa-high", "Claude Opus 5 (Adaptive Reasoning, High Effort)", "Anthropic"),
      upstream("aa-xhigh", "Claude Opus 5 (Adaptive Reasoning, Xhigh Effort)", "Anthropic"),
      upstream("aa-max", "Claude Opus 5 (Adaptive Reasoning, Max Effort)", "Anthropic")
    ];

    const { matches } = resolveModelMatches([local(1, "Claude Opus 5", "Anthropic")], upstreamModels);

    expect(findMatch(matches, 1).externalModelId).toBe("aa-max");
  });

  test("本地标了强度就精确命中该档，不会被更高档抢走", () => {
    const upstreamModels = [
      upstream("aa-high", "Gemini 3.1 Pro (high)", "Google"),
      upstream("aa-max", "Gemini 3.1 Pro (max)", "Google")
    ];

    const { matches } = resolveModelMatches([local(1, "Gemini 3.1 Pro High", "Google")], upstreamModels);
    const match = findMatch(matches, 1);

    expect(match.externalModelId).toBe("aa-high");
    expect(match.matchReason).toBe("effort-exact");
  });

  test("两边都没标强度也算精确命中", () => {
    const upstreamModels = [upstream("aa-base", "Grok 4.1 Fast", "SpaceXAI")];
    const { matches } = resolveModelMatches([local(1, "Grok 4.1 Fast", "SpaceXAI")], upstreamModels);

    expect(findMatch(matches, 1).matchReason).toBe("effort-exact");
  });

  test("本地标的档位上游没有时，就近往上回退", () => {
    const upstreamModels = [
      upstream("aa-low", "Kimi K3 (low)", "Kimi"),
      upstream("aa-max", "Kimi K3 (max)", "Kimi")
    ];

    const { matches } = resolveModelMatches([local(1, "Kimi K3 High", "Kimi")], upstreamModels);
    const match = findMatch(matches, 1);

    expect(match.externalModelId).toBe("aa-max");
    expect(match.matchReason).toBe("effort-fallback");
    expect(match.matchConfidence).toBe(76);
  });

  test("source_model_id 命中优先于名称匹配", () => {
    const upstreamModels = [
      upstream("aa-pinned", "Totally Different Name", "OpenAI"),
      upstream("aa-byname", "GPT 5.4 (max)", "OpenAI")
    ];

    const { matches } = resolveModelMatches(
      [local(1, "GPT 5.4", "OpenAI", "aa-pinned")],
      upstreamModels
    );
    const match = findMatch(matches, 1);

    expect(match.externalModelId).toBe("aa-pinned");
    expect(match.matchConfidence).toBe(100);
    expect(match.matchReason).toBe("source-model-id");
  });

  test("同名不同 creator 时按 provider 消歧", () => {
    const upstreamModels = [
      upstream("aa-openai", "Nova Pro", "OpenAI"),
      upstream("aa-amazon", "Nova Pro", "Amazon")
    ];

    const { matches } = resolveModelMatches([local(1, "Nova Pro", "Amazon")], upstreamModels);

    expect(findMatch(matches, 1).externalModelId).toBe("aa-amazon");
  });

  test("完全找不到候选时判未匹配", () => {
    const upstreamModels = [upstream("aa-x", "Claude Opus 5 (max)", "Anthropic")];
    const { matches } = resolveModelMatches([local(1, "某个自研模型", "Internal")], upstreamModels);
    const match = findMatch(matches, 1);

    expect(match.matchStatus).toBe("unmatched");
    expect(match.externalModelId).toBeNull();
    expect(match.matchConfidence).toBe(0);
  });

  test("已勾手动覆盖的映射跳过自动匹配", () => {
    const upstreamModels = [upstream("aa-auto", "GPT 5.4 (max)", "OpenAI")];
    const pinned = new Map<number, ModelMatchResult>([
      [
        1,
        {
          modelId: 1,
          externalModelId: "aa-manual",
          externalModelName: "手动绑定的条目",
          externalModelSlug: null,
          externalCreator: null,
          reasoningEffort: "low",
          matchStatus: "manual",
          matchConfidence: 100,
          matchReason: "manual"
        }
      ]
    ]);

    const { matches } = resolveModelMatches([local(1, "GPT 5.4", "OpenAI")], upstreamModels, pinned);

    expect(findMatch(matches, 1).externalModelId).toBe("aa-manual");
  });

  test("多个本地模型抢同一个上游条目时报冲突", () => {
    const upstreamModels = [upstream("aa-shared", "GPT 5.4 (max)", "OpenAI")];
    const { conflicts } = resolveModelMatches(
      [local(1, "GPT 5.4", "OpenAI", "aa-shared"), local(2, "GPT 5.4 Max", "OpenAI", "aa-shared")],
      upstreamModels
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.externalModelId).toBe("aa-shared");
    expect(conflicts[0]!.modelIds).toEqual([1, 2]);
  });
});

describe("buildMetricCatalog", () => {
  const models = [
    upstream(
      "m1",
      "o3-mini",
      "OpenAI",
      {
        artificial_analysis_intelligence_index: 62.9,
        mmlu_pro: 0.791,
        gpqa: 0.748,
        hle: 0.087,
        some_new_upstream_eval: 41.2,
        response_latency_seconds: 3.2
      },
      {
        pricing: { price_1m_input_tokens: 1.1, price_1m_output_tokens: 4.4 },
        median_output_tokens_per_second: 153.831,
        median_time_to_first_token_seconds: 14.939
      }
    ),
    upstream(
      "m2",
      "GPT-5.6 Sol (max)",
      "OpenAI",
      { artificial_analysis_intelligence_index: 59, mmlu_pro: 0.88 },
      { median_output_tokens_per_second: 90.2 }
    )
  ];

  const catalog = buildMetricCatalog(models);
  const byKey = new Map(catalog.map((entry) => [entry.key, entry]));

  test("已知指标带上固定标签与类别", () => {
    expect(byKey.get("mmlu_pro")?.label).toBe("MMLU-Pro");
    expect(byKey.get("gpqa")?.benchmarkType).toBe("Reasoning");
    expect(byKey.get("artificial_analysis_intelligence_index")?.label).toBe("AA Intelligence Index");
  });

  test("未知指标用 humanize 兜底，不会因为上游新增字段而漏掉", () => {
    expect(byKey.get("some_new_upstream_eval")?.label).toBe("Some New Upstream Eval");
    expect(byKey.get("some_new_upstream_eval")?.benchmarkType).toBe("General");
  });

  test("全部取值落在 0-1 的指标判为小数量纲，index 类保持绝对量纲", () => {
    expect(byKey.get("mmlu_pro")?.valueScale).toBe("fraction");
    expect(byKey.get("hle")?.valueScale).toBe("fraction");
    expect(byKey.get("artificial_analysis_intelligence_index")?.valueScale).toBe("absolute");
  });

  test("延迟类指标判为越低越好", () => {
    expect(byKey.get("response_latency_seconds")?.higherIsBetter).toBe(false);
    expect(byKey.get("median_time_to_first_token_seconds")?.higherIsBetter).toBe(false);
    expect(byKey.get("median_output_tokens_per_second")?.higherIsBetter).toBe(true);
  });

  test("性能指标进目录，价格指标不进（由既有价格管理负责）", () => {
    expect(byKey.get("median_output_tokens_per_second")?.group).toBe("performance");
    expect(byKey.has("price_1m_input_tokens")).toBe(false);
    expect(byKey.has("price_1m_output_tokens")).toBe(false);
  });

  test("统计覆盖模型数与值域", () => {
    expect(byKey.get("artificial_analysis_intelligence_index")?.modelCount).toBe(2);
    expect(byKey.get("gpqa")?.modelCount).toBe(1);
    expect(byKey.get("mmlu_pro")?.minValue).toBeCloseTo(0.791);
    expect(byKey.get("mmlu_pro")?.maxValue).toBeCloseTo(0.88);
  });
});

describe("formatMetricValue", () => {
  test("小数量纲换算成百分制且不留浮点尾巴", () => {
    expect(formatMetricValue(0.791, "fraction")).toBe("79.1");
    expect(formatMetricValue(0.087, "fraction")).toBe("8.7");
  });

  test("绝对量纲原样保留", () => {
    expect(formatMetricValue(62.9, "absolute")).toBe("62.9");
    expect(formatMetricValue(153.831, "absolute")).toBe("153.831");
  });
});

describe("normalizeImportConfig", () => {
  test("非法输入收敛成空配置", () => {
    expect(normalizeImportConfig(null)).toEqual({ selectedMetrics: [], metricOverrides: {} });
    expect(normalizeImportConfig("nope")).toEqual({ selectedMetrics: [], metricOverrides: {} });
  });

  test("过滤空值并去重", () => {
    const config = normalizeImportConfig({
      selectedMetrics: ["mmlu_pro", "mmlu_pro", "", 7],
      metricOverrides: {
        mmlu_pro: { benchmarkName: " MMLU-Pro ", higherIsBetter: true, valueScale: "fraction" },
        gpqa: { unknownField: 1 }
      }
    });

    expect(config.selectedMetrics).toEqual(["mmlu_pro"]);
    expect(config.metricOverrides.mmlu_pro).toEqual({
      benchmarkName: "MMLU-Pro",
      higherIsBetter: true,
      valueScale: "fraction"
    });
    expect(config.metricOverrides.gpqa).toBeUndefined();
  });
});

describe("buildImportRows", () => {
  const upstreamModels = [
    upstream("aa-1", "GPT 5.4 (max)", "OpenAI", { mmlu_pro: 0.791, gpqa: null }),
    upstream("aa-2", "Claude Opus 5 (max)", "Anthropic", { mmlu_pro: 0.83 })
  ];
  const catalog = buildMetricCatalog(upstreamModels);
  const localModelsById = new Map([
    [1, { modelName: "GPT 5.4", providerName: "OpenAI" }],
    [2, { modelName: "Claude Opus 5", providerName: "Anthropic" }],
    [3, { modelName: "被忽略的模型", providerName: "Internal" }]
  ]);

  function match(modelId: number, externalModelId: string | null, status: ModelMatchResult["matchStatus"]) {
    return {
      modelId,
      externalModelId,
      externalModelName: externalModelId,
      externalModelSlug: null,
      externalCreator: null,
      reasoningEffort: null,
      matchStatus: status,
      matchConfidence: 100,
      matchReason: "manual"
    } satisfies ModelMatchResult;
  }

  test("只对已匹配模型 × 已勾选指标产出行，并按量纲换算", () => {
    const rows = buildImportRows({
      upstreamModels,
      catalog,
      config: { selectedMetrics: ["mmlu_pro"], metricOverrides: {} },
      matches: [match(1, "aa-1", "matched"), match(2, "aa-2", "manual"), match(3, null, "ignored")],
      localModelsById
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      modelName: "GPT 5.4",
      providerName: "OpenAI",
      benchmarkName: "MMLU-Pro",
      rawValue: "79.1",
      source: "Artificial Analysis",
      sourceModelId: "aa-1",
      sourceBenchmarkId: "mmlu_pro"
    });
    expect(rows[1]!.rawValue).toBe("83");
  });

  test("上游为 null 的指标不产出空行", () => {
    const rows = buildImportRows({
      upstreamModels,
      catalog,
      config: { selectedMetrics: ["gpqa"], metricOverrides: {} },
      matches: [match(1, "aa-1", "matched")],
      localModelsById
    });

    expect(rows).toHaveLength(0);
  });

  test("metricOverrides 能改名、改类别与方向，用于复用库里已有的 benchmark", () => {
    const rows = buildImportRows({
      upstreamModels,
      catalog,
      config: {
        selectedMetrics: ["mmlu_pro"],
        metricOverrides: {
          mmlu_pro: { benchmarkName: "MMLU Pro (中文库已有名)", benchmarkType: "综合", higherIsBetter: false }
        }
      },
      matches: [match(1, "aa-1", "matched")],
      localModelsById
    });

    expect(rows[0]).toMatchObject({
      benchmarkName: "MMLU Pro (中文库已有名)",
      benchmarkType: "综合",
      higherIsBetter: false
    });
  });

  test("未勾选的指标不会被导入", () => {
    const rows = buildImportRows({
      upstreamModels,
      catalog,
      config: { selectedMetrics: [], metricOverrides: {} },
      matches: [match(1, "aa-1", "matched")],
      localModelsById
    });

    expect(rows).toHaveLength(0);
  });
});
