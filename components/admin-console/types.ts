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

export type TabKey = "import" | "entry" | "providers" | "rename" | "merge" | "maintenance" | "settings";

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
