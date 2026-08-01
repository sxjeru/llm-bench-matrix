import {
  OVERALL_ROW_KEY,
  PARAMS_ACTIVE_RATIO_ROW_KEY,
  PARAMS_ROW_KEY,
  PRICE_CACHE_INPUT_ROW_KEY,
  PRICE_INPUT_ROW_KEY,
  PRICE_OUTPUT_ROW_KEY
} from "@/components/benchmark-matrix/constants";

export const SCATTER_AXIS_X_STORAGE_KEY = "model-scatter:axis-x";
export const SCATTER_AXIS_Y_STORAGE_KEY = "model-scatter:axis-y";
export const SCATTER_PARETO_STORAGE_KEY = "model-scatter:pareto";
export const SCATTER_PARETO_ONLY_STORAGE_KEY = "model-scatter:pareto-only";
export const SCATTER_PARETO_LINE_STYLE_STORAGE_KEY = "model-scatter:pareto-line-style";
export const SCATTER_SCALE_X_STORAGE_KEY = "model-scatter:scale-x";
export const SCATTER_SCALE_Y_STORAGE_KEY = "model-scatter:scale-y";
export const SCATTER_LABEL_MODE_STORAGE_KEY = "model-scatter:label-mode";
export const SCATTER_SHOW_GUIDES_STORAGE_KEY = "model-scatter:show-guides";

/** 总评分作为轴时的合成 key，与矩阵的 OVERALL_ROW_KEY 对应 */
export const OVERALL_METRIC_SLUG = "overall";
export const SUMMARY_CATEGORY_LABEL = "Summary";
export const OVERALL_METRIC_LABEL = "Overall Score";

/**
 * 合成行的固定 slug。
 *
 * 这些 rowKey 是常量，直接给一个干净短名，URL 才不会被哈希后缀污染。
 */
export const SYNTHETIC_METRIC_SLUGS: Readonly<Record<string, string>> = {
  [OVERALL_ROW_KEY]: OVERALL_METRIC_SLUG,
  [PRICE_INPUT_ROW_KEY]: "price-input",
  [PRICE_OUTPUT_ROW_KEY]: "price-output",
  [PRICE_CACHE_INPUT_ROW_KEY]: "price-cache-input",
  [PARAMS_ROW_KEY]: "params",
  [PARAMS_ACTIVE_RATIO_ROW_KEY]: "params-activated"
};

/** 轴选择器与图例的分类排序：总评 → 模型属性 → 价格 → 其余按字母 */
export const METRIC_CATEGORY_PRIORITY: Readonly<Record<string, number>> = {
  Summary: 0,
  "Model Info": 1,
  Pricing: 2
};

export const DEFAULT_X_METRIC_PREFERENCE = ["price-output", "price-input", "params"] as const;
export const DEFAULT_Y_METRIC_PREFERENCE = [OVERALL_METRIC_SLUG] as const;

export const SCATTER_CHART_HEIGHT = 520;
export const SCATTER_CHART_HEIGHT_COMPACT = 400;
export const SCATTER_CHART_COMPACT_BREAKPOINT = 768;
export const SCATTER_CHART_MARGIN = { top: 24, right: 32, bottom: 48, left: 16 } as const;

export const SCATTER_DOT_RADIUS = 5.5;
export const SCATTER_DOT_RADIUS_PARETO = 7;
export const SCATTER_LABEL_FONT_SIZE = 11;
export const SCATTER_LABEL_GAP = 3;
/** 等宽近似系数：Inter 11px 下的平均字宽 / 字号 */
export const SCATTER_LABEL_CHAR_WIDTH_RATIO = 0.58;
/** CJK 字符按整宽计 */
export const SCATTER_LABEL_CJK_WIDTH_RATIO = 1;

export const SCATTER_GRID_STROKE = "#24314f";
export const SCATTER_AXIS_STROKE = "#3b4b74";
export const SCATTER_AXIS_TICK_COLOR = "#a9b3c9";
export const SCATTER_PARETO_LINE_COLOR = "#facd6a";
export const SCATTER_GUIDE_LINE_COLOR = "rgba(169, 179, 201, 0.35)";
export const SCATTER_LABEL_COLOR = "#dbe3f5";
export const SCATTER_DIMMED_OPACITY = 0.28;

/** 对数轴 domain 在 log 空间的两端留白比例 */
export const SCATTER_LOG_DOMAIN_PADDING = 0.06;
/** 线性轴 domain 的两端留白比例 */
export const SCATTER_LINEAR_DOMAIN_PADDING = 0.06;
