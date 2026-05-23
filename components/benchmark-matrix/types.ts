export type MatrixInputRow = {
  recordId?: number | null;
  providerName: string;
  providerDisplayName?: string | null;
  providerBrandColor?: string | null;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  sourceBenchmarkType?: string | null;
  higherIsBetter?: boolean;
  benchmarkCanonicalKey?: string | null;
  modalities?: string[];
  sourceModalities?: string[] | null;
  benchTime: string;
  valueRaw: string;
  valueNum: number | null;
  valueNum2?: number | null;
  valueNote: string | null;
  source: string | null;
  updatedAt?: string | null;
};

export type MatrixCellEntry = {
  valueRaw: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  source: string | null;
  benchTime: string;
};

export type MatrixCell = {
  valueRaw: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  source: string | null;
  benchTime: string;
  allEntries: MatrixCellEntry[];
  hasMultipleValues: boolean;
  uniqueEntries: MatrixCellEntry[];
  noteText: string;
  displayValue: string;
  hasMeaningfulMultipleValues: boolean;
  shouldShowQuestionMark: boolean;
};

export type IndexedMatrixInputRow = {
  row: MatrixInputRow;
  matrixKey: string;
};

export type MatrixRow = {
  rowKey: string;
  category: string;
  benchmark: string;
  higherIsBetter: boolean;
  modalities: string[];
  cells: Map<string, MatrixCell>;
  firstSeenIndex: number;
  sourceOrderKey: number | null;
  rowDataCount: number;
  rowNumericCount: number;
  minComparable: number | null;
  maxComparable: number | null;
  minComparable2: number | null;
  maxComparable2: number | null;
  minNum: number | null;
  maxNum: number | null;
  minNum2: number | null;
  maxNum2: number | null;
};

export type ProviderIdentity = {
  canonicalName: string;
  displayName: string;
};

export type OverallModelSummary = {
  rawScore: number | null;
  rawRank: number | null;
  correctedScore: number | null;
  correctedRank: number | null;
  coverage: number;
  coveredRows: number;
  totalRows: number;
  correctionFactor: number;
};

export type RowSortColumn = "category" | "benchmark";
export type RowSortMode = "source" | "alpha" | "data";

export type Props = {
  rows: MatrixInputRow[];
  allRows?: MatrixInputRow[];
  sourceOptions?: string[];
};

export type HeatmapPresetKey = "classic" | "coolwarm" | "mintsun" | "colorblind";
export type HeatmapPresetSelection = HeatmapPresetKey | "custom";
export type HeatmapPaletteHex = {
  low: string;
  mid: string;
  high: string;
};
export type HeatmapPaletteRgb = {
  low: [number, number, number];
  mid: [number, number, number];
  high: [number, number, number];
};

export type SourceFrameShadowBuildInput = {
  isMatched: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  includeTop?: boolean;
  includeBottom?: boolean;
  exportMode?: boolean;
};

export type CompareDirection = "up" | "down" | "flat";

export type CompareBaselineShadowBuildInput = {
  isBaseline: boolean;
  includeTop?: boolean;
  includeBottom?: boolean;
  exportMode?: boolean;
};

export type ExportPresetKey = "1x-png" | "2x-png" | "3x-png" | "1x-webp" | "2x-webp" | "3x-webp" | "1x-avif" | "2x-avif" | "3x-avif";
export type ExportMimeType = "image/png" | "image/webp" | "image/avif";
export type ExportFormat = "png" | "webp" | "avif";

export type Html2CanvasFn = (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>;

export type ModelScaleToken = {
  prefixKey: string;
  sizeInBillions: number;
  isEstimated: boolean;
};

export type ModelVersionToken = {
  familyKey: string;
  version: number;
};

export type ModelVariantToken = {
  familyKey: string;
  variant: "pro" | "base" | "flash" | "flash-lite" | "mini" | "nano";
};

export type OverallScoreDisplayItem = {
  modelName: string;
  rawScore: number | null;
  rawRank: number | null;
};
