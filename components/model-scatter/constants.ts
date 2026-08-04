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

/** 轴选择器与图例的分类排序：总评 → Cost → 模型属性 → 价格 → Performance → 其余按字母 */
export const METRIC_CATEGORY_PRIORITY: Readonly<Record<string, number>> = {
  Summary: 0,
  Cost: 1,
  "Model Info": 2,
  Pricing: 3,
  Performance: 4
};

/**
 * 散点下拉里并入 Summary 的 AA 复合指数名。
 * 要求整段以 Index 收尾，避免把 Cost per Task 等后缀项误归类。
 */
export const AA_SUMMARY_INDEX_LABEL_REGEX = /^AA[\s-].+ Index$/;

/** 散点轴下拉里始终保留的 benchmark 分类（全匹配），不受「含低覆盖指标」裁剪 */
export const SCATTER_ALWAYS_VISIBLE_BENCHMARK_TYPES = new Set(["Cost", "Performance"]);

/**
 * 默认 X 轴偏好：先按 label 精确匹配 AA 任务成本，再回落到合成价格/参数量 key。
 * `pickByPreference` 同时匹配 metric.key 与 metric.label。
 */
export const DEFAULT_X_METRIC_PREFERENCE = [
  "AA Intelligence Index Cost per Task",
  "price-output",
  "price-input",
  "params"
] as const;
export const DEFAULT_Y_METRIC_PREFERENCE = [OVERALL_METRIC_SLUG] as const;

/** 分类全匹配时默认对数轴（跨数量级的成本/性能指标） */
export const LOG_SCALE_CATEGORIES = new Set(["Cost", "Performance"]);

export const SCATTER_CHART_HEIGHT = 520;
export const SCATTER_CHART_HEIGHT_COMPACT = 400;
export const SCATTER_CHART_COMPACT_BREAKPOINT = 768;
export const SCATTER_CHART_MARGIN = { top: 24, right: 32, bottom: 48, left: 16 } as const;
/**
 * 坐标轴尺寸显式固定。
 *
 * 不用 `width="auto"`：那会让 Recharts 依据渲染内容反复测量并改写布局，
 * 绘图区因此会在两个值之间抖动。固定下来，外部才能同步算出同一个绘图区。
 */
export const SCATTER_Y_AXIS_WIDTH = 64;
export const SCATTER_X_AXIS_HEIGHT = 30;
/** 全屏时图表之外（控件、说明行、图例）大致占用的高度 */
export const SCATTER_CHART_FULLSCREEN_CHROME = 210;
export const SCATTER_CHART_MIN_HEIGHT = 320;
/** 单次滚轮的缩放步长 */
export const SCATTER_WHEEL_ZOOM_STEP = 1.18;

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
/**
 * 定位十字线。
 *
 * 比坐标轴亮一档：它是跟着鼠标走的临时线，深色底上太暗就起不到定位作用；
 * 同时用更短的虚线节奏与中位参考线区分开。
 */
export const SCATTER_CURSOR_STROKE = "rgba(206, 219, 245, 0.6)";
export const SCATTER_CURSOR_WIDTH = 1.25;
export const SCATTER_CURSOR_DASH = "4 3";
/** 最优象限底色：两轴都优于中位数的那一块，取 --success 的极淡版本 */
export const SCATTER_BEST_QUADRANT_FILL = "rgba(101, 212, 143, 0.08)";
/**
 * 标签描边：深色底上给彩色字描一圈晕边，压过网格线。
 * 描边保持偏细，清晰度主要靠字重与品牌色本身的对比度。
 */
export const SCATTER_LABEL_STROKE = "rgba(11, 16, 32, 0.88)";
export const SCATTER_LABEL_STROKE_WIDTH = 2.25;
export const SCATTER_LABEL_STROKE_WIDTH_HIGHLIGHTED = 2.75;
export const SCATTER_DIMMED_OPACITY = 0.28;

/** 对数轴 domain 在 log 空间的两端留白比例 */
export const SCATTER_LOG_DOMAIN_PADDING = 0.06;
/** 线性轴 domain 的两端留白比例 */
export const SCATTER_LINEAR_DOMAIN_PADDING = 0.06;
