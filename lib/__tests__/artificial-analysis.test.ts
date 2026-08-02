import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildMetricCatalog,
  buildImportRows,
  fetchArtificialAnalysisModels,
  formatMetricValue,
  invalidateArtificialAnalysisSnapshotCache,
  normalizeImportConfig,
  resolveModelMatches,
  type ArtificialAnalysisModel,
  type LocalModelInput,
  type ModelMatchResult
} from "@/lib/external-providers/artificial-analysis";

/**
 * fixture 对齐两个上游端点的真实形状：
 *
 * - 新 API `/api/v2/language/models/free`：只给三个复合指数 + performance + cost
 * - 旧 API `/api/v2/data/llms/models`：给逐项 benchmark（免费档下只有它有）
 *
 * 模型命名沿用 artificialanalysis.ai/models 上的真实写法
 * （`(max)` / `(Adaptive Reasoning, Max Effort)` / `(Non-reasoning)`）。
 */
function upstream(
  id: string,
  name: string,
  creator: string,
  metrics: Record<string, number> = {},
  legacyMetricKeys: string[] = []
): ArtificialAnalysisModel {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    creatorName: creator,
    releaseDate: null,
    metrics,
    legacyMetricKeys
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
        "evaluations.artificial_analysis_intelligence_index": 62.9,
        "evaluations.mmlu_pro": 0.791,
        "evaluations.gpqa": 0.748,
        "evaluations.hle": 0.087,
        "evaluations.some_new_upstream_eval": 41.2,
        "evaluations.response_latency_seconds": 3.2,
        "performance.median_output_tokens_per_second": 153.831,
        "performance.median_time_to_first_token_seconds": 14.939,
        "cost.intelligence_index_cost_per_task": 0.0321
      },
      // 逐项 benchmark 在免费档下只有旧接口给
      ["evaluations.mmlu_pro", "evaluations.gpqa", "evaluations.hle"]
    ),
    upstream(
      "m2",
      "GPT-5.6 Sol (max)",
      "OpenAI",
      {
        "evaluations.artificial_analysis_intelligence_index": 59,
        "evaluations.mmlu_pro": 0.88,
        "performance.median_output_tokens_per_second": 90.2
      },
      ["evaluations.mmlu_pro"]
    )
  ];

  const catalog = buildMetricCatalog(models);
  const byKey = new Map(catalog.map((entry) => [entry.key, entry]));

  test("已知指标带上固定标签与类别", () => {
    expect(byKey.get("evaluations.mmlu_pro")?.label).toBe("MMLU-Pro");
    expect(byKey.get("evaluations.gpqa")?.benchmarkType).toBe("Reasoning");
    expect(byKey.get("evaluations.artificial_analysis_intelligence_index")?.label).toBe("AA Intelligence Index");
  });

  test("未知指标用 humanize 兜底，不会因为上游新增字段而漏掉", () => {
    expect(byKey.get("evaluations.some_new_upstream_eval")?.label).toBe("Some New Upstream Eval");
    expect(byKey.get("evaluations.some_new_upstream_eval")?.benchmarkType).toBe("General");
  });

  test("全部取值落在 0-1 的未知指标判为小数量纲，index 类显式声明为绝对量纲", () => {
    expect(byKey.get("evaluations.mmlu_pro")?.valueScale).toBe("fraction");
    expect(byKey.get("evaluations.hle")?.valueScale).toBe("fraction");
    expect(byKey.get("evaluations.artificial_analysis_intelligence_index")?.valueScale).toBe("absolute");
  });

  test("延迟与成本类指标判为越低越好", () => {
    expect(byKey.get("evaluations.response_latency_seconds")?.higherIsBetter).toBe(false);
    expect(byKey.get("performance.median_time_to_first_token_seconds")?.higherIsBetter).toBe(false);
    expect(byKey.get("cost.intelligence_index_cost_per_task")?.higherIsBetter).toBe(false);
    expect(byKey.get("performance.median_output_tokens_per_second")?.higherIsBetter).toBe(true);
  });

  test("按组前缀归组", () => {
    expect(byKey.get("performance.median_output_tokens_per_second")?.group).toBe("performance");
    expect(byKey.get("cost.intelligence_index_cost_per_task")?.group).toBe("cost");
    expect(byKey.get("evaluations.mmlu_pro")?.group).toBe("evaluation");
  });

  test("标出哪些指标只能从旧接口拿到", () => {
    expect(byKey.get("evaluations.mmlu_pro")?.legacyOnly).toBe(true);
    expect(byKey.get("evaluations.hle")?.legacyOnly).toBe(true);
    expect(byKey.get("evaluations.artificial_analysis_intelligence_index")?.legacyOnly).toBe(false);
    expect(byKey.get("performance.median_output_tokens_per_second")?.legacyOnly).toBe(false);
  });

  test("统计覆盖模型数与值域", () => {
    expect(byKey.get("evaluations.artificial_analysis_intelligence_index")?.modelCount).toBe(2);
    expect(byKey.get("evaluations.gpqa")?.modelCount).toBe(1);
    expect(byKey.get("evaluations.mmlu_pro")?.minValue).toBeCloseTo(0.791);
    expect(byKey.get("evaluations.mmlu_pro")?.maxValue).toBeCloseTo(0.88);
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
    upstream("aa-1", "GPT 5.4 (max)", "OpenAI", { "evaluations.mmlu_pro": 0.791 }),
    upstream("aa-2", "Claude Opus 5 (max)", "Anthropic", { "evaluations.mmlu_pro": 0.83 })
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
      config: { selectedMetrics: ["evaluations.mmlu_pro"], metricOverrides: {} },
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
      sourceBenchmarkId: "evaluations.mmlu_pro"
    });
    expect(rows[1]!.rawValue).toBe("83");
  });

  test("上游缺这一项的模型不产出空行", () => {
    const partial = [
      upstream("aa-1", "GPT 5.4 (max)", "OpenAI", { "evaluations.mmlu_pro": 0.791 }),
      // 这个模型上游没给 gpqa
      upstream("aa-2", "Claude Opus 5 (max)", "Anthropic", { "evaluations.gpqa": 0.9 })
    ];

    const rows = buildImportRows({
      upstreamModels: partial,
      catalog: buildMetricCatalog(partial),
      config: { selectedMetrics: ["evaluations.gpqa"], metricOverrides: {} },
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
        selectedMetrics: ["evaluations.mmlu_pro"],
        metricOverrides: {
          "evaluations.mmlu_pro": {
            benchmarkName: "MMLU Pro (中文库已有名)",
            benchmarkType: "综合",
            higherIsBetter: false
          }
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

// ---------------------------------------------------------------------------
// 抓取：新 API 分页 + 旧 API 补 evaluations
// ---------------------------------------------------------------------------

function freePage(page: number, hasMore: boolean, data: unknown[]) {
  return {
    tier: "free",
    intelligence_index_version: 4.1,
    pagination: { page, page_size: 2, total_pages: hasMore ? page + 1 : page, has_more: hasMore },
    data
  };
}

function freeModel(id: string, name: string, creator: string) {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    release_date: "2026-01-15",
    model_creator: { id: creator.toLowerCase(), name: creator },
    evaluations: {
      artificial_analysis_intelligence_index: 61,
      artificial_analysis_coding_index: 55,
      artificial_analysis_agentic_index: 48
    },
    artificial_analysis_intelligence_index_cost: { total_cost: 812.5, cost_per_task: { total_cost: 0.0321 } },
    pricing: { price_1m_input_tokens: 1.1, price_1m_output_tokens: 4.4 },
    performance: {
      median_output_tokens_per_second: 153.831,
      median_time_to_first_token_seconds: 14.939,
      median_time_to_first_answer_token_seconds: 20.1,
      median_end_to_end_response_time_seconds: 24.2
    }
  };
}

/** 按 URL 分派的 fetch mock，记录每次请求以便断言分页行为 */
function mockUpstream(handlers: { free: unknown[]; legacy?: unknown; legacyStatus?: number }) {
  const calls: string[] = [];
  let freeIndex = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);

      if (url.includes("/language/models/free")) {
        const body = handlers.free[freeIndex] ?? handlers.free[handlers.free.length - 1];
        freeIndex += 1;
        return jsonResponse(body);
      }

      if (handlers.legacyStatus && handlers.legacyStatus >= 400) {
        return { ok: false, status: handlers.legacyStatus, headers: { get: () => null } };
      }
      return jsonResponse(handlers.legacy ?? { data: [] });
    })
  );

  return calls;
}

function jsonResponse(body: unknown) {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    body: null,
    headers: { get: (name: string) => (name.toLowerCase() === "content-length" ? String(text.length) : null) },
    text: async () => text
  };
}

describe("fetchArtificialAnalysisModels", () => {
  beforeEach(() => {
    process.env.ARTIFICIAL_ANALYSIS_API_KEY = "test-key";
    invalidateArtificialAnalysisSnapshotCache();
  });

  afterEach(() => {
    delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
    vi.unstubAllGlobals();
  });

  test("枚举完新 API 的所有分页，直到 has_more 为 false", async () => {
    const calls = mockUpstream({
      free: [
        freePage(1, true, [freeModel("aa-1", "GPT 5.4 (max)", "OpenAI")]),
        freePage(2, true, [freeModel("aa-2", "Claude Opus 5 (max)", "Anthropic")]),
        freePage(3, false, [freeModel("aa-3", "Kimi K3 (max)", "Kimi")])
      ]
    });

    const result = await fetchArtificialAnalysisModels();

    expect(result.models.map((model) => model.id)).toEqual(["aa-1", "aa-2", "aa-3"]);
    expect(result.freePageCount).toBe(3);
    expect(result.intelligenceIndexVersion).toBe(4.1);
    expect(calls.filter((url) => url.includes("page=1"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("page=3"))).toHaveLength(1);
    expect(calls.some((url) => url.includes("page=4"))).toBe(false);
  });

  test("新 API 的指标带组前缀，pricing 不进指标表", async () => {
    mockUpstream({ free: [freePage(1, false, [freeModel("aa-1", "GPT 5.4 (max)", "OpenAI")])] });

    const { models } = await fetchArtificialAnalysisModels();
    const metrics = models[0]!.metrics;

    expect(metrics["evaluations.artificial_analysis_intelligence_index"]).toBe(61);
    expect(metrics["performance.median_end_to_end_response_time_seconds"]).toBe(24.2);
    expect(metrics["cost.intelligence_index_total_cost"]).toBe(812.5);
    expect(metrics["cost.intelligence_index_cost_per_task"]).toBe(0.0321);
    // token 单价由既有的「价格管理」负责
    expect(Object.keys(metrics).some((key) => key.includes("price_1m"))).toBe(false);
  });

  test("旧 API 补齐新 API 没有的逐项 benchmark，并标注来源", async () => {
    mockUpstream({
      free: [freePage(1, false, [freeModel("aa-1", "GPT 5.4 (max)", "OpenAI")])],
      legacy: {
        data: [
          {
            id: "aa-1",
            name: "GPT 5.4 (max)",
            slug: "gpt-5-4-max",
            evaluations: { mmlu_pro: 0.791, gpqa: 0.748, artificial_analysis_intelligence_index: 55 }
          }
        ]
      }
    });

    const { models } = await fetchArtificialAnalysisModels();
    const model = models[0]!;

    expect(model.metrics["evaluations.mmlu_pro"]).toBe(0.791);
    expect(model.metrics["evaluations.gpqa"]).toBe(0.748);
    expect(model.legacyMetricKeys).toEqual(
      expect.arrayContaining(["evaluations.mmlu_pro", "evaluations.gpqa"])
    );
    // 同名键不覆盖：复合指数以新 API 为准
    expect(model.metrics["evaluations.artificial_analysis_intelligence_index"]).toBe(61);
    expect(model.legacyMetricKeys).not.toContain("evaluations.artificial_analysis_intelligence_index");
  });

  test("id 对不上时退回 slug 对齐", async () => {
    mockUpstream({
      free: [freePage(1, false, [freeModel("new-id", "GPT 5.4 (max)", "OpenAI")])],
      legacy: {
        data: [{ id: "old-id", name: "GPT 5.4 (max)", slug: "gpt-5-4-max", evaluations: { mmlu_pro: 0.8 } }]
      }
    });

    const { models } = await fetchArtificialAnalysisModels();

    expect(models).toHaveLength(1);
    expect(models[0]!.metrics["evaluations.mmlu_pro"]).toBe(0.8);
  });

  test("旧 API 挂掉时降级而不是整体失败", async () => {
    mockUpstream({
      free: [freePage(1, false, [freeModel("aa-1", "GPT 5.4 (max)", "OpenAI")])],
      legacyStatus: 500
    });

    const result = await fetchArtificialAnalysisModels();

    expect(result.models).toHaveLength(1);
    expect(result.models[0]!.metrics["evaluations.artificial_analysis_intelligence_index"]).toBe(61);
    expect(result.legacyWarning).toContain("500");
  });

  test("旧 API 独有的模型也保留，不静默丢数据", async () => {
    mockUpstream({
      free: [freePage(1, false, [freeModel("aa-1", "GPT 5.4 (max)", "OpenAI")])],
      legacy: {
        data: [{ id: "retired", name: "已下架模型", slug: "retired-model", evaluations: { mmlu_pro: 0.5 } }]
      }
    });

    const { models } = await fetchArtificialAnalysisModels();

    expect(models.map((model) => model.id)).toEqual(["aa-1", "retired"]);
    expect(models[1]!.legacyMetricKeys).toEqual(["evaluations.mmlu_pro"]);
  });

  test("未配置 API key 时直接报错", async () => {
    delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
    await expect(fetchArtificialAnalysisModels()).rejects.toThrow("ARTIFICIAL_ANALYSIS_API_KEY");
  });
});
