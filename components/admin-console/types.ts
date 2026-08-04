export type ProviderOption = {
  id: number;
  name: string;
  slug: string;
  config?: {
    displayName?: string;
    displayTargetProviderId?: number;
    prefixRules?: Array<{
      prefix: string;
      enabled: boolean;
      priority?: number;
      note?: string;
    }>;
    branding?: {
      color?: string;
    };
    pricing?: {
      modelsDevProviderId?: string;
      modelsDevProviderAliases?: string[];
      disabled?: boolean;
    };
  };
};

export type ModelOption = {
  id: number;
  providerId: number;
  modelName: string;
  canonicalKey: string;
};

export type BenchmarkOption = {
  id: number;
  benchmarkName: string;
  benchmarkType: string;
  modalities: string[];
  valueCount?: number;
  overHundredValueCount?: number;
};

export type MergedRecord = {
  entityType: "model" | "benchmark";
  sourceId: number;
  sourceName: string;
  targetId: number;
  targetName: string;
};

export type PreviewRow = {
  rowNumber: number;
  category: string | null;
  benchmarkName: string;
  modelName: string;
  rawValue: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  valid: boolean;
};

export type ImportWarning = {
  rowNumber: number;
  modelName: string;
  benchmarkName: string;
  rawValue: string;
  reason: string;
};

export type TextImportPreviewRow = {
  rowNumber: number;
  providerName: string;
  providerDisplayName?: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  benchmarkTypeProvided?: boolean;
  higherIsBetter?: boolean;
  modalities?: string[];
  rawValue: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  source: string | null;
  valid: boolean;
};

export type Props = {
  initialTab?: TabKey;
  providers: ProviderOption[];
  models: ModelOption[];
  benchmarks: BenchmarkOption[];
  sourceOptions?: string[];
  mergedRecords: MergedRecord[];
  initialSettings: Record<string, unknown>;
};

export type ModelDedupeRule = {
  lowercase: boolean;
  removeHyphen: boolean;
  removeSpace: boolean;
  removeDot: boolean;
};

export type TabKey =
  | "import"
  | "external"
  | "entry"
  | "providers"
  | "pricing"
  | "params"
  | "rename"
  | "merge"
  | "maintenance"
  | "settings";

// --- 外部数据源导入（artificialanalysis.ai） ---

export type ExternalMetricGroup = "evaluation" | "performance" | "cost";
export type ExternalMetricValueScale = "fraction" | "absolute";

export type ExternalMetricCatalogEntry = {
  key: string;
  group: ExternalMetricGroup;
  label: string;
  benchmarkType: string;
  unit: string;
  higherIsBetter: boolean;
  modalities: string[];
  valueScale: ExternalMetricValueScale;
  modelCount: number;
  minValue: number | null;
  maxValue: number | null;
  sampleValues: number[];
  /** 该指标只能从旧 API 拿到（新 API 免费档不含逐项 benchmark） */
  legacyOnly: boolean;
};

export type ExternalMetricOverride = {
  benchmarkName?: string;
  benchmarkType?: string;
  higherIsBetter?: boolean;
  modalities?: string[];
  valueScale?: ExternalMetricValueScale;
};

export type ExternalImportConfig = {
  selectedMetrics: string[];
  metricOverrides: Record<string, ExternalMetricOverride>;
  lastImportedAt?: string;
};

export type ExternalMatchStatus = "matched" | "unmatched" | "ignored" | "manual";

export type ExternalMappingRow = {
  modelId: number;
  modelName: string;
  providerName: string;
  externalModelId: string | null;
  externalModelName: string | null;
  externalCreator: string | null;
  reasoningEffort: string | null;
  matchStatus: ExternalMatchStatus;
  matchConfidence: number;
  matchReason: string;
  manualOverride: boolean;
  externalMissing: boolean;
};

export type ExternalUpstreamModel = {
  externalModelId: string;
  externalModelName: string;
  externalModelSlug: string | null;
  externalCreator: string | null;
};

export type ExternalMappingConflict = {
  externalModelId: string;
  externalModelName: string;
  modelIds: number[];
};

export type ExternalImportSnapshot = {
  apiKeyConfigured: boolean;
  fetchedAt: string | null;
  sourceLabel: string;
  attributionUrl: string;
  catalog: ExternalMetricCatalogEntry[];
  config: ExternalImportConfig;
  mappings: ExternalMappingRow[];
  upstreamOnly: ExternalUpstreamModel[];
  conflicts: ExternalMappingConflict[];
  upstreamOptions: ExternalUpstreamModel[];
  intelligenceIndexVersion: number | null;
  freePageCount: number;
  legacyWarning: string | null;
};

export type ExternalImportPreviewRow = {
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  rawValue: string;
  previousValue: string | null;
  outcome: "inserted" | "appended" | "unchanged" | "skipped";
};

export type ExternalImportSummary = {
  source: string;
  total: number;
  inserted: number;
  appended: number;
  unchanged: number;
  skipped: number;
  createdBenchmarks: string[];
  createdModels: string[];
  matchedModelCount: number;
  metricCount: number;
  benchTime: string;
  dryRun: boolean;
  preview: ExternalImportPreviewRow[];
};

/** 单个模型行的未保存改动 */
export type ExternalMappingDraft = {
  externalModelId: string | null;
  reasoningEffort: string | null;
  ignored: boolean;
  manualOverride: boolean;
};

export type ModelParamsRow = {
  modelId: number;
  modelName: string;
  providerName: string;
  modelCreatedAt: string;
  totalParamsB: number | null;
  activatedParamsB: number | null;
  isEstimated: boolean;
  note: string | null;
  suggestion: {
    totalParamsB: number | null;
    activatedParamsB: number | null;
    isEstimated: boolean;
    note: string | null;
  } | null;
};

export type ModelParamsDraft = {
  totalParamsB: string;
  activatedParamsB: string;
  isEstimated: boolean;
  note: string;
};

export type ModelPricingRow = {
  modelId: number;
  modelName: string;
  providerName: string;
  /** 模型在数据库中的添加时间（始终为 models.created_at，不随价格更新变动） */
  modelCreatedAt: string;
  source: string;
  sourceProviderId: string | null;
  sourceProviderName: string | null;
  sourceModelId: string | null;
  sourceModelName: string | null;
  inputCost: number | null;
  outputCost: number | null;
  reasoningCost: number | null;
  cacheReadCost: number | null;
  cacheWriteCost: number | null;
  inputAudioCost: number | null;
  outputAudioCost: number | null;
  currency: string;
  unit: string;
  matchConfidence: number;
  matchStatus: "matched" | "unmatched" | "ignored" | "manual";
  manualOverride: boolean;
  note: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
};

export type ModelPricingDraft = {
  inputCost: string;
  outputCost: string;
  cacheReadCost: string;
  reasoningCost: string;
  cacheWriteCost: string;
  inputAudioCost: string;
  outputAudioCost: string;
  sourceProviderId: string;
  sourceProviderName: string;
  sourceModelId: string;
  sourceModelName: string;
  manualOverride: boolean;
  note: string;
};

export type ModelPricingSyncResult = {
  providerCount: number;
  sourceModelCount: number;
  matchedCount: number;
  unmatchedCount: number;
  skippedManualCount: number;
  changedCount: number;
  changedModels: string[];
  syncedAt: string;
};

export type ProviderConfigDraft = {
  displayName: string;
  displayTargetProviderId: number | null;
  prefixRules: Array<{
    id: string;
    prefix: string;
    enabled: boolean;
    priority?: number;
    note?: string;
  }>;
  brandingColor: string;
  modelsDevProviderId: string;
  modelsDevProviderAliases: string;
  pricingDisabled: boolean;
};

export type BenchmarkWarningLevel = "info" | "warn" | "danger";

export type BenchmarkWarningItem = {
  key: string;
  benchmarkName: string;
  benchmarkType: string;
  level: BenchmarkWarningLevel;
  reasons: string[];
  suggestedTargetId: number | null;
  candidateTargetIds: number[];
  hasParentheses: boolean;
};

export type ModelWarningItem = {
  key: string;
  modelName: string;
  level: BenchmarkWarningLevel;
  reasons: string[];
  suggestedTargetId: number | null;
  candidateTargetIds: number[];
  hasParentheses: boolean;
};

export type MatrixPreviewRow = {
  key: string;
  benchmarkName: string;
  benchmarkType: string;
  higherIsBetter: boolean;
  modalities: string[];
  cellRowIndexByModel: Record<string, number>;
};

export type StructuredCsvImportRow = {
  providerName: string;
  providerDisplayName?: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  benchmarkTypeProvided: boolean;
  higherIsBetter: boolean;
  modalities: string[];
  rawValue: string;
  valueNote: string | null;
  source: string | null;
};

export type NoticeState = {
  type: "success" | "error";
  message: string;
  details?: string[];
};

export type NoticeItem = NoticeState & {
  id: number;
  visible: boolean;
};

export type MergeSubmitState = "idle" | "submitting" | "success";

export type RenameEntityType = "model" | "benchmark" | "source";

export type RenameSubmitState = "idle" | "submitting" | "success";

export type BenchmarkValueOverlapStats = {
  sourceId: number;
  targetId: number;
  sameCount: number;
  overlapCount: number;
  sourceValueCount: number;
  targetValueCount: number;
  sourceModelCount: number;
  targetModelCount: number;
};

export type BenchmarkPreviewValueOverlapStats = {
  previewBenchmarkKey: string;
  candidateBenchmarkId: number;
  previewTotal: number;
  modelOverlapCount: number;
  exactDuplicateCount: number;
  conflictCount: number;
  duplicateRate: number;
};

export type DuplicateConfidence = "high" | "medium" | "low";

export type DuplicateModelCandidate = {
  sourceId: number;
  sourceName: string;
  sourceProviderName: string;
  sourceValueCount: number;
  targetId: number;
  targetName: string;
  targetProviderName: string;
  targetValueCount: number;
  confidence: DuplicateConfidence;
  similarity: number;
  characterRepeatScore: number;
  reasons: string[];
};

export type DuplicateBenchmarkCandidate = {
  sourceId: number;
  sourceName: string;
  sourceType: string;
  sourceSourceSummary?: string;
  sourceValueCount: number;
  targetId: number;
  targetName: string;
  targetType: string;
  targetSourceSummary?: string;
  targetValueCount: number;
  confidence: DuplicateConfidence;
  similarity: number;
  characterRepeatScore: number;
  reasons: string[];
};

export type DuplicateDetectionResult = {
  generatedAt: string;
  modelCandidates: DuplicateModelCandidate[];
  benchmarkCandidates: DuplicateBenchmarkCandidate[];
};

export type ScaleConsistencyIssue = {
  issueType: "mixed-scale-0-1-vs-100" | "mixed-scale-100-vs-elo";
  recommendedAction: "normalize-scale" | "split-benchmark";
  segments: Array<{
    key: "small" | "large" | "base" | "elo";
    label: string;
    count: number;
    minValue: number | null;
    maxValue: number | null;
  }>;
  valueDetails: Array<{
    value: number;
    field: "valueNum" | "valueNum2";
    modelName: string;
    source: string | null;
    benchTime: string;
  }>;
  benchmarkId: number;
  benchmarkName: string;
  benchmarkType: string;
  valueCount: number;
  smallValueCount: number;
  largeValueCount: number;
  zeroToHundredCount: number;
  overHundredCount: number;
  minValue: number;
  maxValue: number;
};

export type ScaleConsistencyCheckResult = {
  generatedAt: string;
  issues: ScaleConsistencyIssue[];
};
