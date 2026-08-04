import { describe, expect, test } from "vitest";

import {
  MODEL_INFO_CATEGORY_LABEL,
  OVERALL_ROW_KEY,
  PARAMS_ACTIVE_RATIO_ROW_KEY,
  PARAMS_ROW_KEY,
  PRICE_CATEGORY_LABEL,
  PRICE_INPUT_ROW_KEY,
  PRICE_OUTPUT_ROW_KEY
} from "@/components/benchmark-matrix/constants";
import { buildParamsMatrixRows, buildPriceMatrixRows } from "@/components/benchmark-matrix/selectors";
import { getMatrixRowComparableScore } from "@/components/benchmark-matrix/scoring";
import type { MatrixCell, MatrixRow } from "@/components/benchmark-matrix/types";
import {
  buildScatterMetrics,
  findScatterMetric,
  formatScatterAxisTick,
  formatScatterValue,
  groupScatterMetrics,
  isMetricHigherBetter,
  resolveDefaultAxisKeys,
  toMetricSlug,
  toScatterMetric
} from "@/components/model-scatter/metrics";
import {
  buildScatterDataset,
  clampPannedDomain,
  computeAxisDomain,
  computeMedian,
  isDomainZoomed,
  panAxisDomain,
  zoomAxisDomain
} from "@/components/model-scatter/dataset";
import {
  buildPointProjections,
  computePlotArea,
  pixelToAxisRatio,
  projectToPixel
} from "@/components/model-scatter/projection";
import { OVERALL_METRIC_SLUG } from "@/components/model-scatter/constants";

function createCell(valueNum: number | null): MatrixCell {
  const displayValue = valueNum === null ? "--" : String(valueNum);
  return {
    valueRaw: displayValue,
    valueNum,
    valueNum2: null,
    valueNote: null,
    source: "test",
    benchTime: null,
    allEntries: [],
    hasMultipleValues: false,
    uniqueEntries: [],
    noteText: "",
    displayValue,
    hasMeaningfulMultipleValues: false,
    hasMultipleActiveSourceValues: false,
    shouldShowQuestionMark: false
  };
}

function createBenchmarkRow(
  overrides: Partial<MatrixRow> & { rowKey: string; benchmark: string },
  cellValues: Record<string, number | null> = {}
): MatrixRow {
  const cells = new Map<string, MatrixCell>();
  Object.entries(cellValues).forEach(([modelName, value]) => {
    cells.set(modelName, createCell(value));
  });

  return {
    category: "General",
    higherIsBetter: true,
    modalities: ["Text"],
    cells,
    firstSeenIndex: 0,
    sourceOrderKey: null,
    rowDataCount: cells.size,
    rowNumericCount: cells.size,
    minComparable: null,
    maxComparable: null,
    minComparable2: null,
    maxComparable2: null,
    minNum: null,
    maxNum: null,
    minNum2: null,
    maxNum2: null,
    ...overrides
  };
}

const modelPrices = [
  { modelName: "Alpha", inputCost: 1, outputCost: 4, cacheReadCost: 0.1 },
  { modelName: "Beta", inputCost: 3, outputCost: 12, cacheReadCost: 0.3 },
  { modelName: "Gamma", inputCost: 0.2, outputCost: 0.8, cacheReadCost: null }
];

const modelParams = [
  { modelName: "Alpha", totalParamsB: 397, activatedParamsB: 17, isEstimated: false, note: null },
  { modelName: "Beta", totalParamsB: 120, activatedParamsB: null, isEstimated: false, note: null },
  { modelName: "Gamma", totalParamsB: null, activatedParamsB: null, isEstimated: false, note: null }
];

const modelColumns = ["Alpha", "Beta", "Gamma"];

describe("isMetricHigherBetter", () => {
  test("方向判定与 getMatrixRowComparableScore 完全一致", () => {
    const rows: MatrixRow[] = [
      createBenchmarkRow({ rowKey: "merged::gpqa", benchmark: "GPQA", higherIsBetter: true }),
      createBenchmarkRow({ rowKey: "merged::wer", benchmark: "WER", higherIsBetter: false }),
      createBenchmarkRow({ rowKey: "merged::rmse", benchmark: "RMSE", category: "Regression", higherIsBetter: false }),
      ...buildPriceMatrixRows(modelColumns, modelPrices),
      ...buildParamsMatrixRows(modelColumns, modelParams)
    ];

    rows.forEach((row) => {
      // 探针法必须与真正的可比分函数同号，否则帕累托方向会与矩阵热力方向脱节
      const expected = getMatrixRowComparableScore(row, 1) > getMatrixRowComparableScore(row, 0);
      expect(isMetricHigherBetter(row)).toBe(expected);
    });
  });

  test("普通 benchmark 越大越好，越小越好的 benchmark 翻转", () => {
    expect(isMetricHigherBetter(createBenchmarkRow({ rowKey: "a", benchmark: "GPQA", higherIsBetter: true }))).toBe(true);
    expect(isMetricHigherBetter(createBenchmarkRow({ rowKey: "b", benchmark: "WER", higherIsBetter: false }))).toBe(false);
  });

  test("价格行与参数量行都是越小越好", () => {
    buildPriceMatrixRows(modelColumns, modelPrices).forEach((row) => {
      expect(isMetricHigherBetter(row)).toBe(false);
    });
    buildParamsMatrixRows(modelColumns, modelParams).forEach((row) => {
      expect(isMetricHigherBetter(row)).toBe(false);
    });
  });
});

describe("toMetricSlug", () => {
  test("合成行使用固定短名", () => {
    expect(toMetricSlug(OVERALL_ROW_KEY)).toBe(OVERALL_METRIC_SLUG);
    expect(toMetricSlug(PRICE_INPUT_ROW_KEY)).toBe("price-input");
    expect(toMetricSlug(PRICE_OUTPUT_ROW_KEY)).toBe("price-output");
    expect(toMetricSlug(PARAMS_ROW_KEY)).toBe("params");
    expect(toMetricSlug(PARAMS_ACTIVE_RATIO_ROW_KEY)).toBe("params-activated");
  });

  test("benchmark 行 slug 稳定且可读", () => {
    expect(toMetricSlug("merged::gpqa")).toBe(toMetricSlug("merged::gpqa"));
    expect(toMetricSlug("merged::gpqa")).toMatch(/^gpqa~[a-z0-9]+$/);
  });

  test("slug 化后会撞车的 rowKey 靠哈希后缀区分", () => {
    expect(toMetricSlug("raw::Coding::A/B")).not.toBe(toMetricSlug("raw::Coding::A-B"));
  });

  test("全中文名不会塌成空 slug", () => {
    const slug = toMetricSlug("raw::综合::中文理解");
    expect(slug).toMatch(/^metric~[a-z0-9]+$/);
    expect(slug).toBe(toMetricSlug("raw::综合::中文理解"));
  });

  test("URL 安全：只含字母数字与 - ~ 三类字符", () => {
    expect(toMetricSlug("raw::Coding::HumanEval+ (pass@1)")).toMatch(/^[a-z0-9~-]+$/);
  });
});

describe("toScatterMetric", () => {
  test("单元格数值汇总成 valueByModel，缺数被跳过", () => {
    const metric = toScatterMetric(
      createBenchmarkRow(
        { rowKey: "merged::gpqa", benchmark: "GPQA" },
        { Alpha: 88, Beta: 71, Gamma: null }
      )
    );

    expect(metric.valueByModel.get("Alpha")).toBe(88);
    expect(metric.valueByModel.get("Beta")).toBe(71);
    expect(metric.valueByModel.has("Gamma")).toBe(false);
  });

  test("价格行单位为 usd 且建议对数轴", () => {
    const [inputPrice] = buildPriceMatrixRows(modelColumns, modelPrices);
    const metric = toScatterMetric(inputPrice);

    expect(metric.kind).toBe("price");
    expect(metric.unit).toBe("usd");
    expect(metric.preferLogScale).toBe(true);
    expect(metric.category).toBe(PRICE_CATEGORY_LABEL);
  });

  test("参数量行单位为 billions、激活占比为 percent", () => {
    const [paramsRow, ratioRow] = buildParamsMatrixRows(modelColumns, modelParams);

    expect(toScatterMetric(paramsRow).unit).toBe("billions");
    expect(toScatterMetric(paramsRow).preferLogScale).toBe(true);
    expect(toScatterMetric(ratioRow).unit).toBe("percent");
    // 百分比本身量纲有限，不需要对数轴
    expect(toScatterMetric(ratioRow).preferLogScale).toBe(false);
    expect(toScatterMetric(paramsRow).category).toBe(MODEL_INFO_CATEGORY_LABEL);
  });

  test("参数量取总参数量而非激活量，与矩阵列排序口径一致", () => {
    const [paramsRow] = buildParamsMatrixRows(modelColumns, modelParams);
    const metric = toScatterMetric(paramsRow);

    expect(metric.valueByModel.get("Alpha")).toBe(397);
  });

  test("分类精确为 Cost / Performance 的指标默认建议对数轴", () => {
    expect(
      toScatterMetric(
        createBenchmarkRow({
          rowKey: "merged::cost-per-task",
          benchmark: "AA Intelligence Index Cost per Task",
          category: "Cost"
        })
      ).preferLogScale
    ).toBe(true);

    expect(
      toScatterMetric(
        createBenchmarkRow({
          rowKey: "merged::output-speed",
          benchmark: "Output Speed",
          category: "Performance"
        })
      ).preferLogScale
    ).toBe(true);

    // 仅全匹配，不把含词的分类也当成对数轴
    expect(
      toScatterMetric(
        createBenchmarkRow({
          rowKey: "merged::cost-ish",
          benchmark: "Something",
          category: "Cost Analysis"
        })
      ).preferLogScale
    ).toBe(false);
  });

  test("AA * Index 在下拉里归入 Summary，Cost 后缀项保持原分类", () => {
    expect(
      toScatterMetric(
        createBenchmarkRow({
          rowKey: "merged::aa-intelligence",
          benchmark: "AA Intelligence Index",
          category: "Overall"
        })
      ).category
    ).toBe("Summary");

    expect(
      toScatterMetric(
        createBenchmarkRow({
          rowKey: "merged::aa-coding",
          benchmark: "AA Coding Index",
          category: "Coding"
        })
      ).category
    ).toBe("Summary");

    expect(
      toScatterMetric(
        createBenchmarkRow({
          rowKey: "merged::aa-cost-per-task",
          benchmark: "AA Intelligence Index Cost per Task",
          category: "Cost"
        })
      ).category
    ).toBe("Cost");
  });
});

describe("buildScatterMetrics", () => {
  const benchmarkRows = [
    createBenchmarkRow({ rowKey: "merged::gpqa", benchmark: "GPQA", category: "Reasoning" }, { Alpha: 88, Beta: 71 }),
    createBenchmarkRow({ rowKey: "merged::aime", benchmark: "AIME", category: "Math" }, { Alpha: 90, Gamma: 40 }),
    // 全空行不该出现在轴选择器里
    createBenchmarkRow({ rowKey: "merged::empty", benchmark: "Empty", category: "Math" }, { Alpha: null })
  ];

  function build(overallScore: Map<string, number | null> | null = new Map([["Alpha", 82], ["Beta", 60], ["Gamma", 41]])) {
    return buildScatterMetrics({
      benchmarkRows,
      priceRows: buildPriceMatrixRows(modelColumns, modelPrices),
      paramsRows: buildParamsMatrixRows(modelColumns, modelParams),
      overallScoreByModel: overallScore
    });
  }

  test("总评分作为独立指标，且越大越好", () => {
    const overall = findScatterMetric(build(), OVERALL_METRIC_SLUG);

    expect(overall).not.toBeNull();
    expect(overall?.kind).toBe("overall");
    expect(overall?.higherIsBetter).toBe(true);
    expect(overall?.rowKey).toBe(OVERALL_ROW_KEY);
    expect(overall?.valueByModel.get("Alpha")).toBe(82);
  });

  test("不提供总评时不生成该轴", () => {
    expect(findScatterMetric(build(null), OVERALL_METRIC_SLUG)).toBeNull();
  });

  test("总评全为空时同样不生成该轴", () => {
    expect(findScatterMetric(build(new Map([["Alpha", null]])), OVERALL_METRIC_SLUG)).toBeNull();
  });

  test("过滤掉没有任何数值的指标", () => {
    expect(build().some((metric) => metric.label === "Empty")).toBe(false);
    // Cache Input Price 只有 Alpha / Beta 有值，应当保留
    expect(build().some((metric) => metric.label === "Cache Input Price")).toBe(true);
  });

  test("排序为 总评 → Cost → 模型属性 → 价格 → Performance → 其余分类", () => {
    const metrics = buildScatterMetrics({
      benchmarkRows: [
        ...benchmarkRows,
        createBenchmarkRow(
          {
            rowKey: "merged::aa-intelligence",
            benchmark: "AA Intelligence Index",
            category: "Overall"
          },
          { Alpha: 66 }
        ),
        createBenchmarkRow(
          {
            rowKey: "merged::cost-per-task",
            benchmark: "AA Intelligence Index Cost per Task",
            category: "Cost"
          },
          { Alpha: 0.4 }
        ),
        createBenchmarkRow(
          {
            rowKey: "merged::output-speed",
            benchmark: "Output Speed",
            category: "Performance"
          },
          { Alpha: 120 }
        )
      ],
      priceRows: buildPriceMatrixRows(modelColumns, modelPrices),
      paramsRows: buildParamsMatrixRows(modelColumns, modelParams),
      overallScoreByModel: new Map([
        ["Alpha", 82],
        ["Beta", 60],
        ["Gamma", 41]
      ])
    });
    const categories = metrics.map((metric) => metric.category);
    const firstIndexOf = (category: string) => categories.indexOf(category);

    expect(firstIndexOf("Summary")).toBe(0);
    expect(firstIndexOf("Cost")).toBeLessThan(firstIndexOf(MODEL_INFO_CATEGORY_LABEL));
    expect(firstIndexOf(MODEL_INFO_CATEGORY_LABEL)).toBeLessThan(firstIndexOf(PRICE_CATEGORY_LABEL));
    expect(firstIndexOf(PRICE_CATEGORY_LABEL)).toBeLessThan(firstIndexOf("Performance"));
    expect(firstIndexOf("Performance")).toBeLessThan(firstIndexOf("Math"));
    expect(metrics.find((metric) => metric.label === "AA Intelligence Index")?.category).toBe("Summary");
  });

  test("指标 key 唯一", () => {
    const keys = build().map((metric) => metric.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("groupScatterMetrics 按分类聚合且保持优先级顺序", () => {
    const groups = groupScatterMetrics(build());

    expect(groups[0]?.category).toBe("Summary");
    expect(groups.map((group) => group.category)).toContain(PRICE_CATEGORY_LABEL);
    expect(groups.every((group) => group.metrics.length > 0)).toBe(true);
  });

  test("默认双轴取 总评 × 输出价格", () => {
    const metrics = build();
    expect(resolveDefaultAxisKeys(metrics)).toEqual({ xKey: "price-output", yKey: OVERALL_METRIC_SLUG });
  });

  test("有 AA Intelligence Index Cost per Task 时默认 X 轴优先取它", () => {
    const costRow = createBenchmarkRow(
      {
        rowKey: "merged::aa-cost-per-task",
        benchmark: "AA Intelligence Index Cost per Task",
        category: "Cost",
        higherIsBetter: false
      },
      { Alpha: 0.4, Beta: 1.2, Gamma: 0.05 }
    );
    const metrics = buildScatterMetrics({
      benchmarkRows: [...benchmarkRows, costRow],
      priceRows: buildPriceMatrixRows(modelColumns, modelPrices),
      paramsRows: buildParamsMatrixRows(modelColumns, modelParams),
      overallScoreByModel: new Map([
        ["Alpha", 82],
        ["Beta", 60],
        ["Gamma", 41]
      ])
    });
    const costMetric = metrics.find((metric) => metric.label === "AA Intelligence Index Cost per Task");

    expect(costMetric).not.toBeNull();
    expect(costMetric?.preferLogScale).toBe(true);
    expect(resolveDefaultAxisKeys(metrics)).toEqual({
      xKey: costMetric!.key,
      yKey: OVERALL_METRIC_SLUG
    });
  });

  test("没有总评与价格时退化为覆盖最广的指标，且两轴不重复", () => {
    const metrics = buildScatterMetrics({
      benchmarkRows,
      priceRows: [],
      paramsRows: [],
      overallScoreByModel: null
    });
    const { xKey, yKey } = resolveDefaultAxisKeys(metrics);

    expect(yKey).not.toBeNull();
    expect(xKey).not.toBeNull();
    expect(xKey).not.toBe(yKey);
  });

  test("空指标列表返回空轴", () => {
    expect(resolveDefaultAxisKeys([])).toEqual({ xKey: null, yKey: null });
  });
});

describe("formatScatterValue / formatScatterAxisTick", () => {
  test("价格保留有效位且不补零", () => {
    expect(formatScatterValue({ unit: "usd" }, 12)).toBe("$12");
    expect(formatScatterValue({ unit: "usd" }, 1.25)).toBe("$1.25");
    expect(formatScatterValue({ unit: "usd" }, 0.075)).toBe("$0.075");
  });

  test("参数量、百分比、分数各自格式化", () => {
    expect(formatScatterValue({ unit: "billions" }, 397)).toBe("397B");
    expect(formatScatterValue({ unit: "percent" }, 4.28)).toBe("4.3%");
    expect(formatScatterValue({ unit: "score" }, 82.456)).toBe("82.46");
  });

  test("非有限值统一显示为 --", () => {
    expect(formatScatterValue({ unit: "score" }, Number.NaN)).toBe("--");
  });

  test("刻度文本比数值文本更紧凑", () => {
    expect(formatScatterAxisTick({ unit: "usd" }, 12)).toBe("$12");
    expect(formatScatterAxisTick({ unit: "usd" }, 0.1)).toBe("$0.1");
    expect(formatScatterAxisTick({ unit: "billions" }, 1200)).toBe("1.2T");
    expect(formatScatterAxisTick({ unit: "score" }, 82.456)).toBe("82");
  });
});

describe("buildScatterDataset", () => {
  const xMetric = toScatterMetric(
    createBenchmarkRow({ rowKey: "x", benchmark: "Price", higherIsBetter: false, isPriceRow: true },
      { Alpha: 4, Beta: 12, Gamma: 0.8, Delta: 30 })
  );
  const yMetric = toScatterMetric(
    createBenchmarkRow({ rowKey: "y", benchmark: "Score" },
      { Alpha: 82, Beta: 90, Gamma: 55, Delta: 60 })
  );

  const providerNameByModel = new Map([
    ["Alpha", "OpenAI"],
    ["Beta", "Anthropic"],
    ["Gamma", "Google"],
    ["Delta", "Meta"]
  ]);
  const colorByModel = new Map([["Alpha", "#ff0000"]]);

  function build(overrides: Partial<Parameters<typeof buildScatterDataset>[0]> = {}) {
    return buildScatterDataset({
      xMetric,
      yMetric,
      modelNames: ["Alpha", "Beta", "Gamma", "Delta", "Missing"],
      providerNameByModel,
      colorByModel,
      xScale: "linear",
      yScale: "linear",
      ...overrides
    });
  }

  test("缺任一轴数值的模型被计入 missingCount", () => {
    const dataset = build();
    expect(dataset.points).toHaveLength(4);
    expect(dataset.missingCount).toBe(1);
  });

  test("帕累托前沿标注到点上", () => {
    const dataset = build();
    const paretoNames = dataset.points.filter((point) => point.isPareto).map((point) => point.modelName).sort();

    // Delta（30/60）被 Beta（12/90）全面压制；Alpha（4/82）没有更便宜又更强的对手，留在前沿
    expect(paretoNames).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(dataset.paretoKeys.has("Delta")).toBe(false);
  });

  test("paretoPath 按支配序排列，可直接连线", () => {
    const dataset = build();
    // X 越小越好 ⇒ 支配序为价格降序
    expect(dataset.paretoPath.map((point) => point.modelName)).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  test("对数轴下非正值单独计数", () => {
    const zeroPriceMetric = toScatterMetric(
      createBenchmarkRow({ rowKey: "x0", benchmark: "Price", higherIsBetter: false, isPriceRow: true },
        { Alpha: 0, Beta: 12 })
    );
    const dataset = build({ xMetric: zeroPriceMetric, xScale: "log", modelNames: ["Alpha", "Beta"] });

    expect(dataset.nonPositiveCount).toBe(1);
    expect(dataset.missingCount).toBe(0);
    expect(dataset.points.map((point) => point.modelName)).toEqual(["Beta"]);
  });

  test("未配置品牌色时回落到默认色", () => {
    const dataset = build();
    expect(dataset.points.find((point) => point.modelName === "Alpha")?.color).toBe("#ff0000");
    expect(dataset.points.find((point) => point.modelName === "Beta")?.color).toBe("#5da7ff");
  });

  test("空模型列表返回空数据集", () => {
    const dataset = build({ modelNames: [] });
    expect(dataset.points).toEqual([]);
    expect(dataset.paretoPath).toEqual([]);
  });
});

describe("computeAxisDomain / computeMedian", () => {
  test("线性轴两端留白，非负数据不会被推到负值", () => {
    const [min, max] = computeAxisDomain([0.5, 10], "linear");
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeGreaterThan(10);
  });

  test("线性轴单值不产生退化 domain", () => {
    const [min, max] = computeAxisDomain([7], "linear");
    expect(max).toBeGreaterThan(min);
  });

  test("对数轴 domain 落在正数区并包住极值", () => {
    const [min, max] = computeAxisDomain([0.1, 100], "log");
    expect(min).toBeGreaterThan(0);
    expect(min).toBeLessThan(0.1);
    expect(max).toBeGreaterThan(100);
  });

  test("对数轴没有正值时给出安全兜底", () => {
    expect(computeAxisDomain([0, -3], "log")).toEqual([1, 10]);
  });

  test("中位数支持奇偶长度", () => {
    expect(computeMedian([3, 1, 2])).toBe(2);
    expect(computeMedian([4, 1, 2, 3])).toBe(2.5);
    expect(computeMedian([])).toBeNull();
  });
});

describe("zoomAxisDomain", () => {
  const base: [number, number] = [0, 100];

  test("放大以光标为锚点：光标底下的数值原地不动", () => {
    const anchorRatio = 0.25;
    const zoomed = zoomAxisDomain(base, base, "linear", anchorRatio, 0.5);

    const anchorBefore = base[0] + (base[1] - base[0]) * anchorRatio;
    const anchorAfter = zoomed[0] + (zoomed[1] - zoomed[0]) * anchorRatio;

    expect(anchorAfter).toBeCloseTo(anchorBefore, 6);
    expect(zoomed[1] - zoomed[0]).toBeCloseTo(50, 6);
  });

  test("缩小不锚定光标，而是朝基准视图收敛", () => {
    // 先放大到右上角一小块
    const zoomedIn = zoomAxisDomain(base, base, "linear", 0.9, 0.25);
    expect(zoomedIn[1] - zoomedIn[0]).toBeCloseTo(25, 6);

    const centerBefore = (zoomedIn[0] + zoomedIn[1]) / 2;
    const baseCenter = (base[0] + base[1]) / 2;
    expect(centerBefore).toBeGreaterThan(baseCenter);

    // 缩小时无论光标在哪，中心都朝基准中心靠拢
    const zoomedOut = zoomAxisDomain(zoomedIn, base, "linear", 0.1, 2);
    const centerAfter = (zoomedOut[0] + zoomedOut[1]) / 2;

    expect(Math.abs(centerAfter - baseCenter)).toBeLessThan(Math.abs(centerBefore - baseCenter));
  });

  test("一直缩小最终精确还原初始视图", () => {
    let domain = zoomAxisDomain(base, base, "linear", 0.85, 0.2);
    expect(domain).not.toEqual(base);

    for (let step = 0; step < 40; step += 1) {
      domain = zoomAxisDomain(domain, base, "linear", 0.3, 1.18);
    }

    expect(domain[0]).toBeCloseTo(base[0], 6);
    expect(domain[1]).toBeCloseTo(base[1], 6);
  });

  test("缩小的尽头就是基准视图，不会再往外撑", () => {
    let domain: [number, number] = [...base];
    for (let step = 0; step < 20; step += 1) {
      domain = zoomAxisDomain(domain, base, "linear", 0.5, 2);
    }

    expect(domain[1] - domain[0]).toBeCloseTo(100, 6);
  });

  test("对数轴在 log 空间等比缩放，结果保持为正", () => {
    const logBase: [number, number] = [0.1, 100];
    const zoomed = zoomAxisDomain(logBase, logBase, "log", 0.5, 0.5);

    expect(zoomed[0]).toBeGreaterThan(0);
    expect(zoomed[0]).toBeGreaterThan(logBase[0]);
    expect(zoomed[1]).toBeLessThan(logBase[1]);
    // 中心锚点缩放：log 空间跨度减半
    expect(Math.log10(zoomed[1]) - Math.log10(zoomed[0])).toBeCloseTo(1.5, 6);
  });

  test("对数轴缩小同样收敛回基准", () => {
    const logBase: [number, number] = [0.1, 100];
    let domain = zoomAxisDomain(logBase, logBase, "log", 0.9, 0.3);

    for (let step = 0; step < 40; step += 1) {
      domain = zoomAxisDomain(domain, logBase, "log", 0.2, 1.18);
    }

    expect(domain[0]).toBeCloseTo(logBase[0], 6);
    expect(domain[1]).toBeCloseTo(logBase[1], 6);
  });

  test("放大有下限，不会无限缩到一个点", () => {
    let domain: [number, number] = [...base];
    for (let step = 0; step < 60; step += 1) {
      domain = zoomAxisDomain(domain, base, "linear", 0.5, 0.5);
    }

    expect(domain[1] - domain[0]).toBeGreaterThan(0);
    expect(domain[1] - domain[0]).toBeCloseTo(100 / 40, 6);
  });

  test("退化值域原样返回", () => {
    expect(zoomAxisDomain([5, 5], [5, 5], "linear", 0.5, 0.5)).toEqual([5, 5]);
  });

  test("锚点比例超出 [0,1] 时被夹住", () => {
    expect(zoomAxisDomain(base, base, "linear", -3, 0.5)).toEqual(
      zoomAxisDomain(base, base, "linear", 0, 0.5)
    );
    expect(zoomAxisDomain(base, base, "linear", 9, 0.5)).toEqual(
      zoomAxisDomain(base, base, "linear", 1, 0.5)
    );
  });
});

describe("panAxisDomain / clampPannedDomain", () => {
  const base: [number, number] = [0, 100];

  test("按跨度比例整体平移，跨度不变", () => {
    const panned = panAxisDomain([20, 60], "linear", 0.25);

    expect(panned).toEqual([30, 70]);
    expect(panned[1] - panned[0]).toBe(40);
  });

  test("负向平移方向相反", () => {
    expect(panAxisDomain([20, 60], "linear", -0.25)).toEqual([10, 50]);
  });

  test("零位移原样返回", () => {
    expect(panAxisDomain([20, 60], "linear", 0)).toEqual([20, 60]);
  });

  test("对数轴在 log 空间平移，比例关系保持不变", () => {
    const panned = panAxisDomain([1, 100], "log", 0.5);

    // log 空间跨度 2，位移 1 个数量级
    expect(panned[0]).toBeCloseTo(10, 6);
    expect(panned[1]).toBeCloseTo(1000, 6);
    expect(panned[1] / panned[0]).toBeCloseTo(100, 6);
  });

  test("视图中心留在基准值域内时不做限制", () => {
    expect(clampPannedDomain([20, 60], base, "linear")).toEqual([20, 60]);
  });

  test("拖过头时把中心拉回基准值域边界", () => {
    const clamped = clampPannedDomain([500, 540], base, "linear");

    const center = (clamped[0] + clamped[1]) / 2;
    expect(center).toBeCloseTo(100, 6);
    // 跨度不受影响
    expect(clamped[1] - clamped[0]).toBeCloseTo(40, 6);
  });

  test("反方向拖过头同样被拉回", () => {
    const clamped = clampPannedDomain([-500, -460], base, "linear");
    const center = (clamped[0] + clamped[1]) / 2;

    expect(center).toBeCloseTo(0, 6);
  });

  test("对数轴的限制在 log 空间生效且结果为正", () => {
    const clamped = clampPannedDomain([10000, 100000], [0.1, 100] as [number, number], "log");

    expect(clamped[0]).toBeGreaterThan(0);
    expect(Math.log10(clamped[0] * clamped[1]) / 2).toBeCloseTo(2, 6);
  });
});

describe("isDomainZoomed", () => {
  test("与基准一致时判为未缩放", () => {
    expect(isDomainZoomed([0, 100], [0, 100])).toBe(false);
  });

  test("任一端偏离即判为已缩放", () => {
    expect(isDomainZoomed([10, 100], [0, 100])).toBe(true);
    expect(isDomainZoomed([0, 90], [0, 100])).toBe(true);
  });

  test("浮点误差不算缩放", () => {
    expect(isDomainZoomed([0, 100 + 1e-9], [0, 100])).toBe(false);
  });
});

describe("投影", () => {
  const margin = { top: 24, right: 32, bottom: 48, left: 16 };

  test("绘图区扣掉边距与两根坐标轴", () => {
    const plotArea = computePlotArea({ width: 640, height: 420, margin, yAxisWidth: 64, xAxisHeight: 30 });

    expect(plotArea).toEqual({ left: 80, top: 24, right: 608, bottom: 342 });
  });

  test("尺寸不足以容纳坐标轴时返回 null", () => {
    expect(computePlotArea({ width: 60, height: 420, margin, yAxisWidth: 64, xAxisHeight: 30 })).toBeNull();
    expect(computePlotArea({ width: 640, height: 40, margin, yAxisWidth: 64, xAxisHeight: 30 })).toBeNull();
  });

  test("线性投影把值域两端映到像素两端", () => {
    expect(projectToPixel(0, [0, 100], "linear", 80, 608)).toBeCloseTo(80, 6);
    expect(projectToPixel(100, [0, 100], "linear", 80, 608)).toBeCloseTo(608, 6);
    expect(projectToPixel(50, [0, 100], "linear", 80, 608)).toBeCloseTo(344, 6);
  });

  test("对数投影在 log 空间线性", () => {
    // 0.1 → 100 共 3 个数量级，中点 10 应落在正中
    expect(projectToPixel(10, [0.1, 100], "log", 0, 300)).toBeCloseTo(200, 6);
    expect(projectToPixel(0.1, [0.1, 100], "log", 0, 300)).toBeCloseTo(0, 6);
  });

  test("对数轴下非正值无法投影", () => {
    expect(projectToPixel(0, [0.1, 100], "log", 0, 300)).toBeNull();
    expect(projectToPixel(-5, [0.1, 100], "log", 0, 300)).toBeNull();
  });

  test("退化值域与非有限值返回 null", () => {
    expect(projectToPixel(5, [5, 5], "linear", 0, 300)).toBeNull();
    expect(projectToPixel(Number.NaN, [0, 10], "linear", 0, 300)).toBeNull();
  });

  test("Y 轴以底边为起点，数值越大像素越小", () => {
    const plotArea = { left: 80, top: 24, right: 608, bottom: 342 };
    const projections = buildPointProjections({
      points: [
        { modelName: "high", providerName: "p", color: "#fff", x: 1, y: 100, isPareto: false },
        { modelName: "low", providerName: "p", color: "#fff", x: 1, y: 0, isPareto: false }
      ],
      xDomain: [0, 10],
      yDomain: [0, 100],
      xScale: "linear",
      yScale: "linear",
      plotArea
    });

    expect(projections.get("high")!.cy).toBeCloseTo(plotArea.top, 6);
    expect(projections.get("low")!.cy).toBeCloseTo(plotArea.bottom, 6);
  });

  test("没有绘图区时不产出任何投影", () => {
    const projections = buildPointProjections({
      points: [{ modelName: "a", providerName: "p", color: "#fff", x: 1, y: 1, isPareto: false }],
      xDomain: [0, 10],
      yDomain: [0, 10],
      xScale: "linear",
      yScale: "linear",
      plotArea: null
    });

    expect(projections.size).toBe(0);
  });

  test("像素换算回轴上的相对位置", () => {
    expect(pixelToAxisRatio(80, 80, 608)).toBeCloseTo(0, 6);
    expect(pixelToAxisRatio(608, 80, 608)).toBeCloseTo(1, 6);
    expect(pixelToAxisRatio(344, 80, 608)).toBeCloseTo(0.5, 6);
    // 起终点互换（Y 轴用法）时方向随之翻转
    expect(pixelToAxisRatio(342, 342, 24)).toBeCloseTo(0, 6);
    expect(pixelToAxisRatio(24, 342, 24)).toBeCloseTo(1, 6);
  });
});
