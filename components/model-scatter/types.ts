import type { MatrixInputRow, ModelParamsInfo, ModelPriceInfo } from "@/components/benchmark-matrix/types";

/** 指标来源类别。价格与参数量是矩阵合成行，overall 是矩阵的总评分。 */
export type ScatterMetricKind = "benchmark" | "price" | "params" | "overall";

/** 数值单位，只影响刻度与提示的格式化，不参与任何计算。 */
export type ScatterMetricUnit = "score" | "usd" | "billions" | "percent" | "date";

export type ScatterAxisScale = "linear" | "log";
export type ScatterLabelMode = "auto" | "all" | "none";
export type ScatterParetoLineStyle = "linear" | "step";
export type ScatterOverlayMode = "pareto" | "trend";

/**
 * 可作为坐标轴的指标。
 *
 * 把 benchmark 行、价格行、参数量行、总评分收敛成同一种形状，
 * 图表层因此不需要知道数据来自哪条链路。
 */
export type ScatterMetric = {
  /** URL 与 localStorage 用的稳定标识 */
  key: string;
  /** 对应的 MatrixRow.rowKey（总评分为 OVERALL_ROW_KEY） */
  rowKey: string;
  label: string;
  category: string;
  kind: ScatterMetricKind;
  /** true 表示数值越大越好；由 getMatrixRowComparableScore 反推，不另立规则 */
  higherIsBetter: boolean;
  unit: ScatterMetricUnit;
  /** 量纲跨数量级的指标（价格、参数量、Cost/Performance 分类）默认建议对数轴 */
  preferLogScale: boolean;
  valueByModel: Map<string, number>;
  /** 仅 benchmark 行有历史；价格/参数量/总评为空 Map */
  historyByModel: Map<string, readonly ScatterHistorySample[]>;
};

/** 某模型在某指标下的一条真实记录，供历史点按时间对齐。 */
export type ScatterHistorySample = {
  value: number;
  benchTime: string | null;
  recordId: number | null;
};

export type ScatterHistoryMode = "best" | "worst";

/** 空心历史点：X 取历史极值，Y 取时间最近的同期值。 */
export type ScatterHistoricalPoint = {
  modelName: string;
  providerName: string;
  color: string;
  mode: ScatterHistoryMode;
  x: number;
  y: number;
  xBenchTime: string | null;
  yBenchTime: string | null;
  currentX: number;
  currentY: number;
};

export type ScatterHistoryLookupResult =
  | { status: "ok"; point: ScatterHistoricalPoint }
  | { status: "unavailable"; reason: ScatterHistoryUnavailableReason };

export type ScatterHistoryUnavailableReason =
  | "unsupported-x"
  | "no-history"
  | "same-extreme"
  | "no-y"
  | "non-positive";

export type ScatterMetricGroup = {
  category: string;
  metrics: ScatterMetric[];
};

/** 一个模型在当前双轴下的落点。 */
export type ScatterPoint = {
  modelName: string;
  providerName: string;
  color: string;
  x: number;
  y: number;
  isPareto: boolean;
};

export type ScatterPlotDataset = {
  points: ScatterPoint[];
  paretoKeys: Set<string>;
  /** 帕累托前沿点，按真实 x 升序，用于连线 */
  paretoPath: ScatterPoint[];
  /** 当前可绘制点的线性回归趋势线；不适用于少于两点或 X 值无差异的情况。 */
  trendLine: ScatterTrendLine | null;
  /** 因数值缺失被排除的模型数 */
  missingCount: number;
  /** 因对数轴要求正数被排除的模型数 */
  nonPositiveCount: number;
};

export type ScatterTrendLine = {
  slope: number;
  intercept: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
};

export type ScatterAxisBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** 标签占位矩形，用于碰撞检测与描边背景。 */
export type ScatterLabelBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type ScatterLabelAnchor =
  | "right"
  | "left"
  | "top"
  | "bottom"
  | "top-right"
  | "bottom-right";

export type ScatterLabelCandidate = {
  key: string;
  text: string;
  cx: number;
  cy: number;
  /** 越大越优先占位 */
  priority: number;
};

export type ScatterPlacedLabel = {
  key: string;
  text: string;
  /** 文本绘制原点（配合 textAnchor / dominantBaseline） */
  x: number;
  y: number;
  textAnchor: "start" | "middle" | "end";
  anchor: ScatterLabelAnchor;
};

export type ScatterLabelLayoutOptions = {
  fontSize: number;
  /** 点半径，决定标签与点的间距起点 */
  dotRadius: number;
  /** 标签之间的最小空隙 */
  gap: number;
  mode: ScatterLabelMode;
};

export type ModelScatterProps = {
  rows: MatrixInputRow[];
  allRows?: MatrixInputRow[];
  sourceOptions?: string[];
  modelPrices?: ModelPriceInfo[];
  modelParams?: ModelParamsInfo[];
  /** 为 false 时仍更新视图，但不写地址栏。keep-alive 隐藏态由调用方关闭。 */
  urlSyncEnabled?: boolean;
};
