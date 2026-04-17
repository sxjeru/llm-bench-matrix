"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Database,
  Eye,
  FileSpreadsheet,
  Headphones,
  Layers,
  Merge as MergeIcon,
  PlusCircle,
  Search,
  Settings2,
  Sparkles,
  ShieldAlert,
  Table2,
  TriangleAlert,
  Upload,
  Video
} from "lucide-react";

type ProviderOption = {
  id: number;
  name: string;
  slug: string;
};

type ModelOption = {
  id: number;
  providerId: number;
  modelName: string;
  canonicalKey: string;
};

type BenchmarkOption = {
  id: number;
  benchmarkName: string;
  benchmarkType: string;
  modalities: string[];
};

type MergedRecord = {
  entityType: "model" | "benchmark";
  sourceId: number;
  sourceName: string;
  targetId: number;
  targetName: string;
};

type PreviewRow = {
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

type ImportWarning = {
  rowNumber: number;
  modelName: string;
  benchmarkName: string;
  rawValue: string;
  reason: string;
};

type TextImportPreviewRow = {
  rowNumber: number;
  providerName: string;
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

type Props = {
  providers: ProviderOption[];
  models: ModelOption[];
  benchmarks: BenchmarkOption[];
  sourceOptions?: string[];
  mergedRecords: MergedRecord[];
  initialSettings: Record<string, unknown>;
};

type ModelDedupeRule = {
  lowercase: boolean;
  removeHyphen: boolean;
  removeSpace: boolean;
  removeDot: boolean;
};

type TabKey = "import" | "entry" | "rename" | "merge" | "settings";

type BenchmarkWarningLevel = "info" | "warn" | "danger";

type BenchmarkWarningItem = {
  key: string;
  benchmarkName: string;
  benchmarkType: string;
  level: BenchmarkWarningLevel;
  reasons: string[];
  suggestedTargetId: number | null;
  candidateTargetIds: number[];
  hasParentheses: boolean;
};

type ModelWarningItem = {
  key: string;
  modelName: string;
  level: BenchmarkWarningLevel;
  reasons: string[];
  suggestedTargetId: number | null;
  candidateTargetIds: number[];
  hasParentheses: boolean;
};

type MatrixPreviewRow = {
  key: string;
  benchmarkName: string;
  benchmarkType: string;
  higherIsBetter: boolean;
  modalities: string[];
  cellRowIndexByModel: Record<string, number>;
};

type StructuredCsvImportRow = {
  providerName: string;
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

type NoticeState = {
  type: "success" | "error";
  message: string;
  details?: string[];
};

type NoticeItem = NoticeState & {
  id: number;
  visible: boolean;
};

type MergeSubmitState = "idle" | "submitting" | "success";

type RenameSubmitState = "idle" | "submitting" | "success";

type DuplicateConfidence = "high" | "medium" | "low";

type DuplicateModelCandidate = {
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

type DuplicateBenchmarkCandidate = {
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

type DuplicateDetectionResult = {
  generatedAt: string;
  modelCandidates: DuplicateModelCandidate[];
  benchmarkCandidates: DuplicateBenchmarkCandidate[];
};

const DEFAULT_MODEL_DEDUPE_RULE: ModelDedupeRule = {
  lowercase: true,
  removeHyphen: true,
  removeSpace: true,
  removeDot: false
};

const BENCHMARK_SUSPECT_KEYWORDS = ["last exam"];
const BENCHMARK_NAME_REPLACERS = [/\bno\s*tools?\b/gi, /\bwith\s*search\b/gi, /\bw\/?\s*tools?\b/gi, /\bwith\s*tools?\b/gi];
const HARDCODED_BENCHMARK_ALIAS_RULES: Array<{ pattern: RegExp; targetName: string }> = [
  { pattern: /^\s*hle\s+with\s+tools?\s*$/i, targetName: "HLE w/ tool" }
];
const LOWER_IS_BETTER_PREVIEW_RULES = [/omnidocbench\s*1\.5/i, /\b(?:r?mse)\b/i];
const LOWER_IS_BETTER_PREVIEW_ASR_TYPE_REGEX = /\basr\b/i;
const OMNIDOCBENCH_15_MATCHER = /omnidocbench\s*1\.5/i;
const MULTIMODAL_HINT_PATTERN = /(\bmultimodal(?:ity)?\b|\bmulti[\s-_]?modal(?:ity)?\b|多模态)/i;
const MODEL_HYPHEN_VARIANT_REGEX = /[\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const PAIR_NOTE_HISTORY_STORAGE_KEY = "admin-console:pair-note-history";
const STAR_NOTE_HISTORY_STORAGE_KEY = "admin-console:star-note-history";
const MODALITY_OPTIONS = ["Text", "Vision", "Audio", "Video", "Multimodal"] as const;
const RENAME_LIST_ROW_HEIGHT = 38;
const RENAME_LIST_VIEWPORT_HEIGHT = 320;
const RENAME_LIST_OVERSCAN = 8;

function normalizeModelDedupeRule(raw: unknown): ModelDedupeRule {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_MODEL_DEDUPE_RULE };
  }

  const candidate = raw as Partial<ModelDedupeRule>;
  return {
    lowercase:
      typeof candidate.lowercase === "boolean"
        ? candidate.lowercase
        : DEFAULT_MODEL_DEDUPE_RULE.lowercase,
    removeHyphen:
      typeof candidate.removeHyphen === "boolean"
        ? candidate.removeHyphen
        : DEFAULT_MODEL_DEDUPE_RULE.removeHyphen,
    removeSpace:
      typeof candidate.removeSpace === "boolean"
        ? candidate.removeSpace
        : DEFAULT_MODEL_DEDUPE_RULE.removeSpace,
    removeDot:
      typeof candidate.removeDot === "boolean"
        ? candidate.removeDot
        : DEFAULT_MODEL_DEDUPE_RULE.removeDot
  };
}

function parseMergeEntityId(
  rawInput: string,
  options: Array<{ id: number; label: string }>
): number | null {
  const normalized = rawInput.trim();
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const matchedId = normalized.match(/\[(\d+)\]\s*$/);
  if (matchedId) {
    return Number(matchedId[1]);
  }

  const exact = options.find((option) => option.label === normalized);
  return exact?.id ?? null;
}

function parseExplicitMergeEntityId(rawInput: string): number | null {
  const normalized = rawInput.trim();
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const matchedId = normalized.match(/\[(\d+)\]\s*$/);
  if (matchedId) {
    return Number(matchedId[1]);
  }

  return null;
}

async function postJson(
  url: string,
  payload: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST"
) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason =
      typeof data?.error === "string"
        ? data.error
        : data?.error
          ? JSON.stringify(data.error)
          : `Request failed: ${response.status}`;
    throw new Error(reason);
  }

  return data;
}

async function postFormData(url: string, formData: FormData) {
  const response = await fetch(url, { method: "POST", body: formData });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const reason =
      typeof data?.error === "string"
        ? data.error
        : data?.error
          ? JSON.stringify(data.error)
          : `Request failed: ${response.status}`;

    const error = new Error(reason) as Error & { payload?: unknown };
    error.payload = data;
    throw error;
  }

  return data;
}

function getTextImportBenchmarkKey(benchmarkName: string, benchmarkType: string): string {
  return `${benchmarkName}@@${benchmarkType}`;
}

function getBenchmarkExactLookupKey(benchmarkName: string, benchmarkType: string): string {
  return `${benchmarkName.trim().toLowerCase()}@@${benchmarkType.trim().toLowerCase()}`;
}

function removeParenthesesContent(input: string): string {
  return input.replace(/\([^)]*\)/g, " ").replace(/（[^）]*）/g, " ").replace(/\s+/g, " ").trim();
}

function buildBenchmarkCompareKey(input: string): string {
  let normalized = removeParenthesesContent(input).toLowerCase().trim();

  BENCHMARK_NAME_REPLACERS.forEach((pattern) => {
    normalized = normalized.replace(pattern, " ");
  });

  normalized = normalized
    .replace(/[\/_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
}

function buildModelCompareKey(input: string): string {
  return input
    .toLowerCase()
    .replace(MODEL_HYPHEN_VARIANT_REGEX, "")
    .replace(/[\s\.]/g, "")
    .trim();
}

function normalizeModelNameByDedupeRule(input: string, rule: ModelDedupeRule): string {
  let normalized = input.trim().replace(MODEL_HYPHEN_VARIANT_REGEX, "-");

  if (rule.lowercase) {
    normalized = normalized.toLowerCase();
  }
  if (rule.removeHyphen) {
    normalized = normalized.replace(/-/g, "");
  }
  if (rule.removeSpace) {
    normalized = normalized.replace(/\s+/g, "");
  }
  if (rule.removeDot) {
    normalized = normalized.replace(/\./g, "");
  }

  return normalized;
}

function toDomSafeId(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function isFleursZhTranslationPreviewBenchmark(benchmarkName: string): boolean {
  if (!/fleurs/i.test(benchmarkName)) return false;

  const normalized = benchmarkName
    .toLowerCase()
    .replace(/\s+/g, "");

  const hasBiDirectionalHint = /(?:⇄|↔|<->|<=>)/.test(normalized);

  return hasBiDirectionalHint;
}

function isLowerBetterPreviewBenchmark(benchmarkName: string, benchmarkType?: string): boolean {
  if (benchmarkType && LOWER_IS_BETTER_PREVIEW_ASR_TYPE_REGEX.test(benchmarkType)) {
    return true;
  }

  if (/fleurs/i.test(benchmarkName)) {
    return !isFleursZhTranslationPreviewBenchmark(benchmarkName);
  }

  return LOWER_IS_BETTER_PREVIEW_RULES.some((rule) => rule.test(benchmarkName));
}

function getOmniDocBenchNormalizeHint(benchmarkName: string, rawValue: string): string | null {
  if (!OMNIDOCBENCH_15_MATCHER.test(benchmarkName)) return null;

  const numeric = Number.parseFloat(rawValue.trim().replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 1) return null;

  const normalized = Number(((100 - numeric) / 100).toFixed(6));
  return String(normalized);
}

function formatPreviewNumericValue(
  rawValue: string,
  numericValue: number | null,
  position: "first" | "second" = "first"
): string {
  if (numericValue === null) {
    return "-";
  }

  const normalizedRaw = rawValue.trim();
  const targetPart = position === "second"
    ? (normalizedRaw.split("/")[1] ?? "").trim()
    : (normalizedRaw.split("/")[0] ?? "").trim();

  const currencyMatch = targetPart.match(/^([$¥€£])/);
  if (!currencyMatch) {
    return String(numericValue);
  }

  const fractionDigits = targetPart.match(/\.(\d+)/)?.[1]?.length ?? 0;
  const formatted = numericValue.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: Math.max(fractionDigits, 6)
  });

  return `${currencyMatch[1]}${formatted}`;
}

function normalizeModalityName(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return "Text";
  if (normalized.includes("vision") || normalized.includes("vlm")) return "Vision";
  if (normalized.includes("audio")) return "Audio";
  if (normalized.includes("video")) return "Video";
  if (MULTIMODAL_HINT_PATTERN.test(normalized)) return "Multimodal";
  return "Text";
}

function normalizeModalityList(input: string[] | undefined): string[] {
  if (!input || input.length === 0) return ["Text"];

  const normalized = input
    .map((item) => normalizeModalityName(item))
    .filter(Boolean);

  const unique = normalized.length > 0 ? Array.from(new Set(normalized)) : ["Text"];
  const withoutText = unique.some((item) => item !== "Text")
    ? unique.filter((item) => item !== "Text")
    : unique;

  const withoutVision = withoutText.includes("Video")
    ? withoutText.filter((item) => item !== "Vision")
    : withoutText;

  if (withoutVision.length === 0) {
    return ["Text"];
  }

  return withoutVision;
}

function inferProviderNameFromModelName(modelName: string): string {
  const trimmed = modelName.trim();
  if (!trimmed) return "Unknown";

  const alphaPrefix = trimmed.match(/^[A-Za-z]+/);
  if (alphaPrefix?.[0]) {
    return alphaPrefix[0];
  }

  const tokenized = trimmed.split(/[\s\-_:]/).map((item) => item.trim()).filter(Boolean);
  if (tokenized.length > 0) {
    return tokenized[0];
  }

  return "Unknown";
}

function resolveHardcodedBenchmarkAliasTarget(input: string): string | null {
  for (const rule of HARDCODED_BENCHMARK_ALIAS_RULES) {
    if (rule.pattern.test(input)) {
      return rule.targetName;
    }
  }

  return null;
}

function escapeCsvCell(input: string): string {
  if (/[",\n\r]/.test(input)) {
    return `"${input.replace(/"/g, '""')}"`;
  }

  return input;
}

function buildStructuredCsvText(rows: StructuredCsvImportRow[]): string {
  const header = [
    "provider",
    "model",
    "benchmark",
    "benchmark_type",
    "benchmark_type_provided",
    "higher_is_better",
    "value_raw",
    "value_note",
    "modalities",
    "source"
  ];
  const lines = [header.join(",")];

  rows.forEach((row) => {
    const line = [
      row.providerName,
      row.modelName,
      row.benchmarkName,
      row.benchmarkType,
      row.benchmarkTypeProvided ? "1" : "0",
      row.higherIsBetter ? "1" : "0",
      row.rawValue,
      row.valueNote ?? "",
      row.modalities.join(","),
      row.source ?? ""
    ]
      .map((item) => escapeCsvCell(item))
      .join(",");

    lines.push(line);
  });

  return lines.join("\n");
}

function parsePairRawValue(rawValue: string): { first: string; second: string; note: string | null } | null {
  const normalized = rawValue.trim();
  const pairMatch = normalized.match(
    /^((?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*\/\s*((?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/
  );

  if (!pairMatch) return null;

  const [, first, second, tail] = pairMatch;
  const note = tail.trim();

  return {
    first: first.trim(),
    second: second.trim(),
    note: note.length > 0 ? note : null
  };
}

function composePairRawValue(first: string, second: string, note?: string | null): string {
  const normalizedNote = note?.trim();
  return normalizedNote ? `${first} / ${second} ${normalizedNote}` : `${first} / ${second}`;
}

function parseSingleRawValue(rawValue: string): { value: string; tail: string } | null {
  if (parsePairRawValue(rawValue)) return null;

  const normalized = rawValue.trim();
  const singleMatch = normalized.match(/^((?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/);
  if (!singleMatch) return null;

  return {
    value: singleMatch[1].trim(),
    tail: singleMatch[2].trim()
  };
}

function parseStarSingleRawValue(rawValue: string): { value: string; note: string | null } | null {
  const parsedSingle = parseSingleRawValue(rawValue);
  if (!parsedSingle) return null;

  const tail = parsedSingle.tail.trim();
  if (!tail.startsWith("*")) return null;

  const afterStar = tail.slice(1).trim();
  const note = afterStar.startsWith("://") ? afterStar.slice(3).trim() : afterStar;

  return {
    value: parsedSingle.value,
    note: note.length > 0 ? note : null
  };
}

function composeStarRawValue(value: string, note?: string | null): string {
  const normalized = note?.trim();
  return normalized ? `${value}* ${normalized}` : `${value}*`;
}

function formatTextImportWarningDetail(warning: unknown): string | null {
  if (!warning || typeof warning !== "object") return null;

  const candidate = warning as Record<string, unknown>;
  const contextParts: string[] = [];

  if (typeof candidate.rowNumber === "number") {
    contextParts.push(`行 ${candidate.rowNumber}`);
  }

  if (Array.isArray(candidate.rowNumbers)) {
    const rowNumbers = Array.from(
      new Set(
        candidate.rowNumbers
          .filter((item): item is number => typeof item === "number" && Number.isFinite(item))
          .sort((a, b) => a - b)
      )
    );

    if (rowNumbers.length > 0) {
      contextParts.push(`行 ${rowNumbers.join(", ")}`);
    }
  }

  if (typeof candidate.modelName === "string" && candidate.modelName.trim()) {
    contextParts.push(`模型 ${candidate.modelName.trim()}`);
  }

  if (typeof candidate.benchmarkName === "string" && candidate.benchmarkName.trim()) {
    contextParts.push(`指标 ${candidate.benchmarkName.trim()}`);
  }

  if (typeof candidate.benchmarkType === "string" && candidate.benchmarkType.trim()) {
    contextParts.push(`类型 ${candidate.benchmarkType.trim()}`);
  }

  const reason = typeof candidate.reason === "string" ? candidate.reason.trim() : "";
  const action = typeof candidate.action === "string" ? candidate.action.trim() : "";
  const mainText = [reason, action].filter(Boolean).join("；");

  if (!mainText) return null;
  if (contextParts.length === 0) return mainText;

  return `${contextParts.join(" / ")}：${mainText}`;
}

function extractTextImportWarningDetails(rawWarnings: unknown): string[] {
  if (!Array.isArray(rawWarnings)) return [];

  const details = rawWarnings
    .map((item) => formatTextImportWarningDetail(item))
    .filter((item): item is string => Boolean(item));

  const LIMIT = 50;
  if (details.length <= LIMIT) {
    return details;
  }

  return [...details.slice(0, LIMIT), `...其余 ${details.length - LIMIT} 条未展开`];
}

export function AdminConsole({
  providers,
  models,
  benchmarks,
  sourceOptions = [],
  mergedRecords,
  initialSettings
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("import");
  const [noticeList, setNoticeList] = useState<NoticeItem[]>([]);

  const [providerName, setProviderName] = useState("");
  const [providerId, setProviderId] = useState<number | "">(providers[0]?.id ?? "");
  const [modelName, setModelName] = useState("");
  const [modelAlias, setModelAlias] = useState("");
  const [sourceModelId, setSourceModelId] = useState("");

  const [benchmarkName, setBenchmarkName] = useState("");
  const [benchmarkType, setBenchmarkType] = useState("general");
  const [benchmarkUnit, setBenchmarkUnit] = useState("score");
  const [modalities, setModalities] = useState("Text");
  const [higherIsBetter, setHigherIsBetter] = useState(true);

  const [valueModelId, setValueModelId] = useState<number | "">(models[0]?.id ?? "");
  const [valueBenchmarkId, setValueBenchmarkId] = useState<number | "">(benchmarks[0]?.id ?? "");
  const [valueRaw, setValueRaw] = useState("");
  const [valueSource, setValueSource] = useState("");
  const [benchTime, setBenchTime] = useState(() => new Date().toISOString().slice(0, 16));

  const [csvText, setCsvText] = useState(
    ""
  );
  const [csvSource, setCsvSource] = useState("");
  const [confirmImportWithoutPreviewOpen, setConfirmImportWithoutPreviewOpen] = useState(false);
  const [confirmImportWithoutSourceOpen, setConfirmImportWithoutSourceOpen] = useState(false);
  const [clearDatabaseConfirmOpen, setClearDatabaseConfirmOpen] = useState(false);
  const [isClearingDatabase, setIsClearingDatabase] = useState(false);
  const [isPreviewingTextImport, setIsPreviewingTextImport] = useState(false);
  const [textImportPreviewRows, setTextImportPreviewRows] = useState<TextImportPreviewRow[]>([]);
  const [textImportDraftRows, setTextImportDraftRows] = useState<TextImportPreviewRow[]>([]);
  const [pairNoteHistory, setPairNoteHistory] = useState<string[]>([]);
  const [starNoteHistory, setStarNoteHistory] = useState<string[]>([]);
  const [matrixBenchmarkNameDrafts, setMatrixBenchmarkNameDrafts] = useState<Record<string, string>>({});
  const [matrixBenchmarkTypeDrafts, setMatrixBenchmarkTypeDrafts] = useState<Record<string, string>>({});
  const [matrixModelNameDrafts, setMatrixModelNameDrafts] = useState<Record<string, string>>({});
  const [openMatrixBenchmarkCandidateFor, setOpenMatrixBenchmarkCandidateFor] = useState<string | null>(null);
  const [globalStarSupplement, setGlobalStarSupplement] = useState("");
  const [benchmarkMergeTargets, setBenchmarkMergeTargets] = useState<Record<string, string>>({});
  const [benchmarkMergeFilters, setBenchmarkMergeFilters] = useState<Record<string, string>>({});
  const [ignoredBenchmarkKeys, setIgnoredBenchmarkKeys] = useState<Record<string, boolean>>({});
  const [parenthesesModes, setParenthesesModes] = useState<Record<string, "keep" | "remove" | "custom">>({});
  const [parenthesesCustomNames, setParenthesesCustomNames] = useState<Record<string, string>>({});
  const [modelMergeTargets, setModelMergeTargets] = useState<Record<string, string>>({});
  const [modelMergeFilters, setModelMergeFilters] = useState<Record<string, string>>({});
  const [modelParenthesesModes, setModelParenthesesModes] = useState<Record<string, "keep" | "remove" | "custom">>({});
  const [modelParenthesesCustomNames, setModelParenthesesCustomNames] = useState<Record<string, string>>({});
  const [pairNoteAutoFillAppliedByBenchmark, setPairNoteAutoFillAppliedByBenchmark] = useState<Record<string, boolean>>({});
  const [textImportPreviewMeta, setTextImportPreviewMeta] = useState<{
    format: string;
    total: number;
    skipped: number;
  } | null>(null);
  const [textImportPreviewVisibleCount, setTextImportPreviewVisibleCount] = useState(200);

  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetPickerOpen, setSheetPickerOpen] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewWarnings, setPreviewWarnings] = useState<ImportWarning[]>([]);
  const [previewMeta, setPreviewMeta] = useState<{
    benchmarkColumn: string;
    categoryColumn: string | null;
    parsedCount: number;
    warningCount: number;
  } | null>(null);
  const [allowWarningsImport, setAllowWarningsImport] = useState(false);
  const [isImportingWorkbook, setIsImportingWorkbook] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [importStatusText, setImportStatusText] = useState("等待导入");
  const [isImportingTextCsv, setIsImportingTextCsv] = useState(false);
  const [textImportProgress, setTextImportProgress] = useState(0);
  const [textImportStatus, setTextImportStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [textImportStatusText, setTextImportStatusText] = useState("等待导入");
  const importProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textImportProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noticeTimersRef = useRef<
    Map<number, { hideTimer: ReturnType<typeof setTimeout>; clearTimer: ReturnType<typeof setTimeout> }>
  >(new Map());
  const nextNoticeIdRef = useRef(1);

  const [mergeType, setMergeType] = useState<"model" | "benchmark">("model");
  const [mergeSourceInput, setMergeSourceInput] = useState("");
  const [mergeTargetInput, setMergeTargetInput] = useState("");
  const [mergeTargetBenchmarkNameInput, setMergeTargetBenchmarkNameInput] = useState("");
  const [mergeSubmitState, setMergeSubmitState] = useState<MergeSubmitState>("idle");
  const mergeSubmitResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mergeSubmitButtonRef = useRef<HTMLButtonElement | null>(null);
  const [mergedRecordList, setMergedRecordList] = useState<MergedRecord[]>(mergedRecords);
  const [mergedRecordTargetInputs, setMergedRecordTargetInputs] = useState<Record<string, string>>(() =>
    mergedRecords.reduce<Record<string, string>>((acc, record) => {
      acc[`${record.entityType}:${record.sourceId}`] = `${record.targetName} [${record.targetId}]`;
      return acc;
    }, {})
  );
  const [isDetectingDuplicates, setIsDetectingDuplicates] = useState(false);
  const [duplicateDetectionResult, setDuplicateDetectionResult] = useState<DuplicateDetectionResult | null>(null);
  const [duplicateDetectionEntityType, setDuplicateDetectionEntityType] = useState<"model" | "benchmark">("model");
  const [duplicateConfidenceFilter, setDuplicateConfidenceFilter] = useState<"high-medium" | "all">("high-medium");

  const [renameEntityType, setRenameEntityType] = useState<"model" | "benchmark">("model");
  const [renameSearchKeyword, setRenameSearchKeyword] = useState("");
  const [renameSelectedEntityId, setRenameSelectedEntityId] = useState<number | null>(null);
  const [renameNextName, setRenameNextName] = useState("");
  const [renameMergeOnConflict, setRenameMergeOnConflict] = useState(true);
  const [renameSubmitState, setRenameSubmitState] = useState<RenameSubmitState>("idle");
  const [renameListScrollTop, setRenameListScrollTop] = useState(0);
  const renameListViewportRef = useRef<HTMLDivElement | null>(null);
  const renameSubmitResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [settingKey, setSettingKey] = useState("");
  const [settingValue, setSettingValue] = useState("{}");
  const [settingNote, setSettingNote] = useState("");
  const [deleteModelInput, setDeleteModelInput] = useState("");
  const [deleteSourceInput, setDeleteSourceInput] = useState("");
  const [confirmDeleteSourceOpen, setConfirmDeleteSourceOpen] = useState(false);
  const [isDeletingSourceData, setIsDeletingSourceData] = useState(false);
  const [modelDedupeRule, setModelDedupeRule] = useState<ModelDedupeRule>(() =>
    normalizeModelDedupeRule(initialSettings.model_dedupe_rule)
  );

  const sortedSettings = useMemo(() => {
    return Object.entries(initialSettings).sort(([a], [b]) => a.localeCompare(b));
  }, [initialSettings]);

  const benchmarkById = useMemo(() => {
    return new Map(benchmarks.map((item) => [item.id, item]));
  }, [benchmarks]);

  const providerById = useMemo(() => {
    return new Map(providers.map((item) => [item.id, item]));
  }, [providers]);

  const existingBenchmarkExactMap = useMemo(() => {
    const map = new Map<string, BenchmarkOption>();
    benchmarks.forEach((item) => {
      map.set(getBenchmarkExactLookupKey(item.benchmarkName, item.benchmarkType), item);
    });
    return map;
  }, [benchmarks]);

  const existingBenchmarkByNameMap = useMemo(() => {
    const map = new Map<string, BenchmarkOption[]>();
    benchmarks.forEach((item) => {
      const key = item.benchmarkName.trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)?.push(item);
    });
    return map;
  }, [benchmarks]);

  const existingBenchmarkModalitiesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    benchmarks.forEach((item) => {
      map.set(
        getBenchmarkExactLookupKey(item.benchmarkName, item.benchmarkType),
        (item.modalities?.length ? item.modalities : ["Text"]).map((modality) => normalizeModalityName(modality))
      );
    });
    return map;
  }, [benchmarks]);

  const deleteSourceOptions = useMemo(
    () => Array.from(new Set(sourceOptions.map((item) => item.trim()).filter(Boolean))),
    [sourceOptions]
  );

  const modelById = useMemo(() => {
    return new Map(models.map((item) => [item.id, item]));
  }, [models]);

  const existingModelExactMap = useMemo(() => {
    const map = new Map<string, ModelOption>();
    models.forEach((item) => {
      map.set(item.modelName.trim().toLowerCase(), item);
    });
    return map;
  }, [models]);

  const existingModelByCanonicalKey = useMemo(() => {
    const map = new Map<string, ModelOption>();
    models.forEach((item) => {
      if (!map.has(item.canonicalKey)) {
        map.set(item.canonicalKey, item);
      }
    });
    return map;
  }, [models]);

  const existingModelByNameMap = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    models.forEach((item) => {
      const key = item.modelName.trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)?.push(item);
    });
    return map;
  }, [models]);

  const existingModelByCompareKey = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    models.forEach((item) => {
      const compareKey = buildModelCompareKey(item.modelName);
      if (!compareKey) return;

      if (!map.has(compareKey)) {
        map.set(compareKey, []);
      }
      map.get(compareKey)?.push(item);
    });
    return map;
  }, [models]);

  const modelWarnings = useMemo(() => {
    const importedModels = Array.from(new Set(textImportDraftRows.map((item) => item.modelName.trim()).filter(Boolean)));
    const warnings: ModelWarningItem[] = [];

    importedModels.forEach((modelName) => {
      const exactExisting = existingModelExactMap.get(modelName.toLowerCase());
      if (exactExisting) {
        return;
      }

      const reasons: string[] = [];
      let level: BenchmarkWarningLevel = "info";
      let suggestedTargetId: number | null = null;

      const hasParentheses = /[（(][^()（）]+[)）]/.test(modelName);

      const compareKey = buildModelCompareKey(modelName);
      const candidates = compareKey ? (existingModelByCompareKey.get(compareKey) ?? []) : [];

      if (candidates.length > 0) {
        const candidateLabels = candidates
          .slice(0, 3)
          .map((item) => item.modelName)
          .join("、");

        reasons.push(`与库内 model 相似：${candidateLabels}`);
        level = "warn";
        suggestedTargetId = candidates[0]?.id ?? null;
      }

      if (reasons.length === 0) return;

      warnings.push({
        key: modelName,
        modelName,
        level,
        reasons,
        suggestedTargetId,
        candidateTargetIds: Array.from(new Set(candidates.map((item) => item.id))),
        hasParentheses
      });
    });

    return warnings;
  }, [textImportDraftRows, existingModelByCompareKey, existingModelExactMap]);

  const modelsWithParentheses = useMemo(() => {
    return Array.from(
      new Set(textImportDraftRows.map((item) => item.modelName).filter((name) => /[（(][^()（）]+[)）]/.test(name)))
    ).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [textImportDraftRows]);

  const modelWarningSet = useMemo(
    () => new Set([...modelWarnings.map((item) => item.modelName), ...modelsWithParentheses]),
    [modelWarnings, modelsWithParentheses]
  );

  const modelWarningMap = useMemo(
    () => new Map(modelWarnings.map((item) => [item.key, item])),
    [modelWarnings]
  );

  const benchmarkWarnings = useMemo(() => {
    const existingByCompareKey = new Map<string, BenchmarkOption[]>();

    benchmarks.forEach((item) => {
      const compareKey = buildBenchmarkCompareKey(item.benchmarkName);
      if (!compareKey) return;

      if (!existingByCompareKey.has(compareKey)) {
        existingByCompareKey.set(compareKey, []);
      }

      existingByCompareKey.get(compareKey)?.push(item);
    });

    const importedBenchmarks = new Map<string, { benchmarkName: string; benchmarkType: string }>();
    textImportDraftRows.forEach((item) => {
      const key = getTextImportBenchmarkKey(item.benchmarkName, item.benchmarkType);
      if (!importedBenchmarks.has(key)) {
        importedBenchmarks.set(key, {
          benchmarkName: item.benchmarkName,
          benchmarkType: item.benchmarkType
        });
      }
    });

    const warnings: BenchmarkWarningItem[] = [];

    importedBenchmarks.forEach(({ benchmarkName, benchmarkType }, key) => {
      const exactExisting = existingBenchmarkExactMap.get(getBenchmarkExactLookupKey(benchmarkName, benchmarkType));
      if (exactExisting) {
        return;
      }

      const sameNameExisting = existingBenchmarkByNameMap.get(benchmarkName.trim().toLowerCase()) ?? [];
      if (sameNameExisting.length > 0) {
        return;
      }

      const reasons: string[] = [];
      let level: BenchmarkWarningLevel = "info";
      let suggestedTargetId: number | null = null;

      const hasParentheses = /[（(][^()（）]+[)）]/.test(benchmarkName);

      const matchedKeyword = BENCHMARK_SUSPECT_KEYWORDS.find((keyword) =>
        benchmarkName.toLowerCase().includes(keyword)
      );
      if (matchedKeyword) {
        reasons.push(`命中高亮词：${matchedKeyword}`);
      }

      const aliasTargetName = resolveHardcodedBenchmarkAliasTarget(benchmarkName);
      if (aliasTargetName) {
        const aliasTarget = benchmarks.find((item) => item.benchmarkName.toLowerCase() === aliasTargetName.toLowerCase());
        if (aliasTarget) {
          reasons.push(`命中硬编码别名，建议合并到 ${aliasTarget.benchmarkName} [${aliasTarget.benchmarkType}]`);
          suggestedTargetId = aliasTarget.id;
          level = "danger";
        } else {
          reasons.push(`命中硬编码别名：${aliasTargetName}`);
          level = "warn";
        }
      }

      const compareKey = buildBenchmarkCompareKey(benchmarkName);
      const candidates = compareKey ? (existingByCompareKey.get(compareKey) ?? []) : [];
      if (candidates.length > 0) {
        const candidateLabels = candidates
          .slice(0, 3)
          .map((item) => `${item.benchmarkName} [${item.benchmarkType}]`)
          .join("、");

        reasons.push(`与库内 benchmark 相似：${candidateLabels}`);

        if (level !== "danger") {
          level = "warn";
        }

        if (!suggestedTargetId) {
          suggestedTargetId = candidates[0]?.id ?? null;
        }
      }

      if (reasons.length === 0) return;

      warnings.push({
        key,
        benchmarkName,
        benchmarkType,
        level,
        reasons,
        suggestedTargetId,
        candidateTargetIds: Array.from(new Set(candidates.map((item) => item.id))),
        hasParentheses
      });
    });

    return warnings;
  }, [benchmarks, textImportDraftRows, existingBenchmarkExactMap, existingBenchmarkByNameMap]);

  const benchmarkWarningMap = useMemo(
    () => new Map(benchmarkWarnings.map((item) => [item.key, item])),
    [benchmarkWarnings]
  );

  const benchmarksWithParentheses = useMemo(() => {
    const found = new Map<string, { key: string; benchmarkName: string; benchmarkType: string }>();

    textImportDraftRows.forEach((row) => {
      if (!/[（(][^()（）]+[)）]/.test(row.benchmarkName)) return;

      const hasExactExisting = existingBenchmarkExactMap.has(
        getBenchmarkExactLookupKey(row.benchmarkName, row.benchmarkType)
      );
      if (hasExactExisting) return;

      const key = getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType);
      if (!found.has(key)) {
        found.set(key, {
          key,
          benchmarkName: row.benchmarkName,
          benchmarkType: row.benchmarkType
        });
      }
    });

    return Array.from(found.values()).sort((a, b) => a.benchmarkName.localeCompare(b.benchmarkName, "zh-Hans-CN"));
  }, [textImportDraftRows, existingBenchmarkExactMap]);

  const benchmarkParenthesesSet = useMemo(
    () => new Set(benchmarksWithParentheses.map((item) => item.key)),
    [benchmarksWithParentheses]
  );

  const matrixPreview = useMemo(() => {
    const modelNames: string[] = [];
    const seenModelNames = new Set<string>();
    textImportDraftRows.forEach((row) => {
      const modelName = row.modelName;
      if (!modelName || seenModelNames.has(modelName)) return;
      seenModelNames.add(modelName);
      modelNames.push(modelName);
    });
    const rowMap = new Map<string, MatrixPreviewRow>();

    textImportDraftRows.forEach((row, rowIndex) => {
      const key = getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType);
      if (!rowMap.has(key)) {
        const modalities = row.modalities?.length
          ? normalizeModalityList(row.modalities)
          : (
            existingBenchmarkModalitiesMap.get(getBenchmarkExactLookupKey(row.benchmarkName, row.benchmarkType))
            ?? [normalizeModalityName(row.benchmarkType)]
          );
        const inferredHigherIsBetter = typeof row.higherIsBetter === "boolean"
          ? row.higherIsBetter
          : !isLowerBetterPreviewBenchmark(row.benchmarkName, row.benchmarkType);

        rowMap.set(key, {
          key,
          benchmarkName: row.benchmarkName,
          benchmarkType: row.benchmarkType,
          higherIsBetter: inferredHigherIsBetter,
          modalities,
          cellRowIndexByModel: {}
        });
      }

      const entry = rowMap.get(key);
      if (!entry) return;

      if (typeof row.higherIsBetter === "boolean") {
        entry.higherIsBetter = row.higherIsBetter;
      }

      if (entry.cellRowIndexByModel[row.modelName] === undefined) {
        entry.cellRowIndexByModel[row.modelName] = rowIndex;
      }
    });

    const rows = Array.from(rowMap.values());

    return {
      modelNames,
      rows
    };
  }, [textImportDraftRows, existingBenchmarkModalitiesMap]);

  const matrixPreviewHeaderCounts = useMemo(() => {
    const rowCount = matrixPreview.rows.length;
    const benchmarkUniqueCount = new Set(matrixPreview.rows.map((row) => row.benchmarkName)).size;
    const typeUniqueCount = new Set(matrixPreview.rows.map((row) => row.benchmarkType)).size;

    return {
      benchmarkCount: rowCount,
      benchmarkUniqueCount,
      typeUniqueCount
    };
  }, [matrixPreview.rows]);

  const pairValueRows = useMemo(() => {
    return textImportDraftRows
      .map((row, rowIndex) => {
        const parsedPair = parsePairRawValue(row.rawValue);
        if (!parsedPair) return null;

        return {
          rowIndex,
          benchmarkKey: getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType),
          benchmarkName: row.benchmarkName,
          benchmarkType: row.benchmarkType,
          modelName: row.modelName,
          first: parsedPair.first,
          second: parsedPair.second,
          note: row.valueNote ?? parsedPair.note
        };
      })
      .filter(
        (
          item
        ): item is {
          rowIndex: number;
          benchmarkKey: string;
          benchmarkName: string;
          benchmarkType: string;
          modelName: string;
          first: string;
          second: string;
          note: string | null;
        } => item !== null
      );
  }, [textImportDraftRows]);

  const pairRowsMissingNoteCount = useMemo(
    () => pairValueRows.filter((item) => !(item.note && item.note.trim().length > 0)).length,
    [pairValueRows]
  );

  const starValueRows = useMemo(() => {
    return textImportDraftRows
      .map((row, rowIndex) => {
        const parsedStar = parseStarSingleRawValue(row.rawValue);
        if (!parsedStar) return null;

        const supplement = (row.valueNote ?? parsedStar.note ?? "").trim();

        return {
          rowIndex,
          benchmarkName: row.benchmarkName,
          modelName: row.modelName,
          value: parsedStar.value,
          supplement
        };
      })
      .filter(
        (
          item
        ): item is {
          rowIndex: number;
          benchmarkName: string;
          modelName: string;
          value: string;
          supplement: string;
        } => item !== null
      );
  }, [textImportDraftRows]);

  const starRowsMissingSupplementCount = useMemo(
    () => starValueRows.filter((item) => item.supplement.length === 0).length,
    [starValueRows]
  );

  const finalizedTextImportRows = useMemo(() => {
    const latestSourceInput = csvSource.trim();

    return textImportDraftRows
      .map<StructuredCsvImportRow | null>((row) => {
        const benchmarkKey = getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType);
        const originalModelKey = row.modelName;
        if (ignoredBenchmarkKeys[benchmarkKey]) {
          return null;
        }

        const rawValueInput = row.rawValue.trim();
        if (!rawValueInput) {
          return null;
        }

        const pairValue = parsePairRawValue(rawValueInput);
        const starSingleValue = pairValue ? null : parseStarSingleRawValue(rawValueInput);

        let rawValue = rawValueInput;
        let valueNote: string | null = row.valueNote?.trim() || null;

        if (pairValue) {
          const normalizedNote = row.valueNote?.trim() || pairValue.note || null;
          rawValue = composePairRawValue(pairValue.first, pairValue.second, normalizedNote);
          valueNote = normalizedNote;
        } else if (starSingleValue) {
          const starNote = row.valueNote?.trim() || starSingleValue.note || null;
          rawValue = composeStarRawValue(starSingleValue.value, starNote);
          valueNote = starNote;
        } else {
          const singleValue = parseSingleRawValue(rawValueInput);
          if (singleValue) {
            const singleTail = singleValue.tail.trim();
            if (singleTail.length > 0 && !singleTail.startsWith("*")) {
              rawValue = singleValue.value;
              valueNote = row.valueNote?.trim() || singleTail || null;
            }
          }
        }

        let benchmarkName = row.benchmarkName;
        let benchmarkType = row.benchmarkType;
        let modelName = row.modelName;
        let providerName = row.providerName.trim() || "Unknown";

        const modelParenthesesMode = modelParenthesesModes[originalModelKey] ?? "keep";
        if (modelParenthesesMode === "remove") {
          const noParentheses = removeParenthesesContent(modelName);
          if (noParentheses) {
            modelName = noParentheses;
          }
        } else if (modelParenthesesMode === "custom") {
          const customName = (modelParenthesesCustomNames[originalModelKey] ?? "").trim();
          if (customName) {
            modelName = customName;
          }
        }

        const modelMergeTargetId = Number(modelMergeTargets[originalModelKey]);
        if (Number.isFinite(modelMergeTargetId) && modelMergeTargetId > 0) {
          const target = modelById.get(modelMergeTargetId);
          if (target) {
            modelName = target.modelName;
          }
        }

        modelName = modelName.trim();

        const exactModel = existingModelExactMap.get(modelName.toLowerCase());
        if (exactModel) {
          modelName = exactModel.modelName;
          providerName = providerById.get(exactModel.providerId)?.name ?? providerName;
        } else {
          const canonicalKey = normalizeModelNameByDedupeRule(modelName, modelDedupeRule);
          const canonicalMatchedModel = existingModelByCanonicalKey.get(canonicalKey);

          if (canonicalMatchedModel) {
            modelName = canonicalMatchedModel.modelName;
            providerName = providerById.get(canonicalMatchedModel.providerId)?.name ?? providerName;
          } else {
            const sameNameModels = existingModelByNameMap.get(modelName.toLowerCase()) ?? [];
            if (sameNameModels.length > 0) {
              modelName = sameNameModels[0].modelName;
              providerName = providerById.get(sameNameModels[0].providerId)?.name ?? providerName;
            }
          }
        }

        if (!modelName) {
          return null;
        }

        const parenthesesMode = parenthesesModes[benchmarkKey] ?? "keep";
        if (parenthesesMode === "remove") {
          const noParentheses = removeParenthesesContent(benchmarkName);
          if (noParentheses) {
            benchmarkName = noParentheses;
          }
        } else if (parenthesesMode === "custom") {
          const customName = (parenthesesCustomNames[benchmarkKey] ?? "").trim();
          if (customName) {
            benchmarkName = customName;
          }
        }

        benchmarkName = benchmarkName.trim();
        benchmarkType = benchmarkType.trim() || "general";

        if (!benchmarkName) {
          return null;
        }

        const exactExisting = existingBenchmarkExactMap.get(getBenchmarkExactLookupKey(benchmarkName, benchmarkType));
        if (exactExisting) {
          benchmarkName = exactExisting.benchmarkName;
          benchmarkType = exactExisting.benchmarkType;
        }

        const mergeTargetId = Number(benchmarkMergeTargets[benchmarkKey]);
        if (Number.isFinite(mergeTargetId) && mergeTargetId > 0) {
          const target = benchmarkById.get(mergeTargetId);
          if (target) {
            benchmarkName = target.benchmarkName;
            benchmarkType = target.benchmarkType;
          }
        }

        const normalizedModalities = normalizeModalityList(
          row.modalities?.length ? row.modalities : [benchmarkType]
        );
        const inferredHigherIsBetter = typeof row.higherIsBetter === "boolean"
          ? row.higherIsBetter
          : !isLowerBetterPreviewBenchmark(benchmarkName, benchmarkType);

        return {
          providerName,
          modelName,
          benchmarkName,
          benchmarkType,
          benchmarkTypeProvided: row.benchmarkTypeProvided ?? true,
          higherIsBetter: inferredHigherIsBetter,
          modalities: normalizedModalities,
          rawValue,
          valueNote,
          source: latestSourceInput.length > 0 ? latestSourceInput : (row.source?.trim() || null)
        };
      })
      .filter((item): item is StructuredCsvImportRow => item !== null);
  }, [
    csvSource,
    textImportDraftRows,
    ignoredBenchmarkKeys,
    parenthesesModes,
    parenthesesCustomNames,
    modelParenthesesModes,
    modelParenthesesCustomNames,
    modelMergeTargets,
    benchmarkMergeTargets,
    modelById,
    providerById,
    benchmarkById,
    modelDedupeRule,
    existingModelExactMap,
    existingModelByCanonicalKey,
    existingModelByNameMap,
    existingBenchmarkExactMap
  ]);

  const ignoredTextImportCount = useMemo(() => {
    if (textImportDraftRows.length === 0) return 0;
    return Math.max(0, textImportDraftRows.length - finalizedTextImportRows.length);
  }, [textImportDraftRows.length, finalizedTextImportRows.length]);

  const textImportPreviewTableRows = useMemo<TextImportPreviewRow[]>(() => {
    if (textImportDraftRows.length === 0) {
      return textImportPreviewRows;
    }

    return finalizedTextImportRows.map((row, index) => ({
      rowNumber: index + 1,
      providerName: row.providerName,
      modelName: row.modelName,
      benchmarkName: row.benchmarkName,
      benchmarkType: row.benchmarkType,
      benchmarkTypeProvided: row.benchmarkTypeProvided,
      higherIsBetter: row.higherIsBetter,
      modalities: row.modalities,
      rawValue: row.rawValue,
      valueNum: null,
      valueNum2: null,
      valueNote: row.valueNote,
      source: row.source,
      valid: row.rawValue.trim().length > 0
    }));
  }, [textImportDraftRows.length, textImportPreviewRows, finalizedTextImportRows]);

  const visibleResolvedTextImportPreviewRows = useMemo(
    () => textImportPreviewTableRows.slice(0, textImportPreviewVisibleCount),
    [textImportPreviewTableRows, textImportPreviewVisibleCount]
  );

  const modelEntityOptions = useMemo(
    () =>
      models.map((item) => ({
        id: item.id,
        label: item.modelName
      })),
    [models]
  );

  const benchmarkEntityOptions = useMemo(
    () =>
      benchmarks.map((item) => ({
        id: item.id,
        label: `${item.benchmarkName} [${item.benchmarkType}]`
      })),
    [benchmarks]
  );

  const mergeEntityOptions = useMemo(() => {
    if (mergeType === "model") {
      return modelEntityOptions;
    }

    return benchmarkEntityOptions;
  }, [mergeType, modelEntityOptions, benchmarkEntityOptions]);

  const renameEntityOptions = useMemo(() => {
    if (renameEntityType === "model") {
      return modelEntityOptions;
    }

    return benchmarkEntityOptions;
  }, [renameEntityType, modelEntityOptions, benchmarkEntityOptions]);

  const filteredRenameEntityOptions = useMemo(() => {
    const keyword = renameSearchKeyword.trim().toLowerCase();

    return renameEntityOptions.filter((item) => {
      if (!keyword) return true;

      return (
        item.label.toLowerCase().includes(keyword)
        || String(item.id).includes(keyword)
      );
    });
  }, [renameEntityOptions, renameSearchKeyword]);

  const renameVirtualWindow = useMemo(() => {
    const total = filteredRenameEntityOptions.length;
    if (total === 0) {
      return { start: 0, end: 0 };
    }

    const visibleCount = Math.ceil(RENAME_LIST_VIEWPORT_HEIGHT / RENAME_LIST_ROW_HEIGHT);
    const start = Math.max(
      0,
      Math.floor(renameListScrollTop / RENAME_LIST_ROW_HEIGHT) - RENAME_LIST_OVERSCAN
    );
    const end = Math.min(
      total,
      start + visibleCount + RENAME_LIST_OVERSCAN * 2
    );

    return { start, end };
  }, [filteredRenameEntityOptions.length, renameListScrollTop]);

  const visibleRenameEntityOptions = useMemo(
    () => filteredRenameEntityOptions.slice(renameVirtualWindow.start, renameVirtualWindow.end),
    [filteredRenameEntityOptions, renameVirtualWindow.start, renameVirtualWindow.end]
  );

  const renameListSpacerHeight = useMemo(
    () => filteredRenameEntityOptions.length * RENAME_LIST_ROW_HEIGHT,
    [filteredRenameEntityOptions.length]
  );

  const renameSelectedEntityLabel = useMemo(() => {
    if (renameSelectedEntityId === null) return "";

    const selected = renameEntityOptions.find((item) => item.id === renameSelectedEntityId);
    if (!selected) return `#${renameSelectedEntityId}`;
    return `${selected.label} [${selected.id}]`;
  }, [renameEntityOptions, renameSelectedEntityId]);

  const resolvedMergeSourceId = useMemo(
    () => parseMergeEntityId(mergeSourceInput, mergeEntityOptions),
    [mergeSourceInput, mergeEntityOptions]
  );

  const resolvedMergeTargetId = useMemo(
    () => parseMergeEntityId(mergeTargetInput, mergeEntityOptions),
    [mergeTargetInput, mergeEntityOptions]
  );

  const visibleModelDuplicateCandidates = useMemo(() => {
    if (!duplicateDetectionResult) return [];
    return duplicateDetectionResult.modelCandidates.filter((candidate) =>
      shouldDisplayDuplicateCandidate(candidate.confidence)
    );
  }, [duplicateDetectionResult, duplicateConfidenceFilter]);

  const visibleBenchmarkDuplicateCandidates = useMemo(() => {
    if (!duplicateDetectionResult) return [];
    return duplicateDetectionResult.benchmarkCandidates.filter((candidate) =>
      shouldDisplayDuplicateCandidate(candidate.confidence)
    );
  }, [duplicateDetectionResult, duplicateConfidenceFilter]);

  useEffect(() => {
    return () => {
      if (importProgressTimerRef.current) {
        clearInterval(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }

      if (textImportProgressTimerRef.current) {
        clearInterval(textImportProgressTimerRef.current);
        textImportProgressTimerRef.current = null;
      }

      if (mergeSubmitResetTimerRef.current) {
        clearTimeout(mergeSubmitResetTimerRef.current);
        mergeSubmitResetTimerRef.current = null;
      }

      if (renameSubmitResetTimerRef.current) {
        clearTimeout(renameSubmitResetTimerRef.current);
        renameSubmitResetTimerRef.current = null;
      }

      noticeTimersRef.current.forEach(({ hideTimer, clearTimer }) => {
        clearTimeout(hideTimer);
        clearTimeout(clearTimer);
      });
      noticeTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setMergedRecordList(mergedRecords);
    setMergedRecordTargetInputs(
      mergedRecords.reduce<Record<string, string>>((acc, record) => {
        acc[`${record.entityType}:${record.sourceId}`] = `${record.targetName} [${record.targetId}]`;
        return acc;
      }, {})
    );
  }, [mergedRecords]);

  useEffect(() => {
    setRenameSearchKeyword("");
    setRenameSelectedEntityId(null);
    setRenameNextName("");
    setRenameSubmitState("idle");
    setRenameListScrollTop(0);

    if (renameListViewportRef.current) {
      renameListViewportRef.current.scrollTop = 0;
    }

    if (renameSubmitResetTimerRef.current) {
      clearTimeout(renameSubmitResetTimerRef.current);
      renameSubmitResetTimerRef.current = null;
    }
  }, [renameEntityType]);

  useEffect(() => {
    setRenameListScrollTop(0);
    if (renameListViewportRef.current) {
      renameListViewportRef.current.scrollTop = 0;
    }
  }, [renameSearchKeyword]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PAIR_NOTE_HISTORY_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;

      const normalized = parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 30);

      setPairNoteHistory(normalized);
    } catch {
      // ignore storage read errors gracefully
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STAR_NOTE_HISTORY_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;

      const normalized = parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 30);

      setStarNoteHistory(normalized);
    } catch {
      // ignore storage read errors gracefully
    }
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      const openedDropdowns = document.querySelectorAll<HTMLDetailsElement>(
        'details[data-modality-dropdown="true"][open]'
      );

      openedDropdowns.forEach((dropdown) => {
        if (!dropdown.contains(target)) {
          dropdown.removeAttribute("open");
        }
      });

      const targetElement = target instanceof Element ? target : null;
      if (!targetElement || !targetElement.closest('[data-matrix-benchmark-candidate-container="true"]')) {
        setOpenMatrixBenchmarkCandidateFor(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function clearNoticeTimers(noticeId: number) {
    const timers = noticeTimersRef.current.get(noticeId);
    if (!timers) return;

    clearTimeout(timers.hideTimer);
    clearTimeout(timers.clearTimer);
    noticeTimersRef.current.delete(noticeId);
  }

  function enqueueNotice(type: NoticeState["type"], message: string, details?: string[]) {
    const noticeId = nextNoticeIdRef.current;
    nextNoticeIdRef.current += 1;

    const normalizedDetails = details && details.length > 0 ? details : undefined;

    setNoticeList((prev) => [
      ...prev,
      {
        id: noticeId,
        type,
        message,
        details: normalizedDetails,
        visible: false
      }
    ]);

    window.requestAnimationFrame(() => {
      setNoticeList((prev) =>
        prev.map((item) =>
          item.id === noticeId
            ? {
                ...item,
                visible: true
              }
            : item
        )
      );
    });

    const hideDelay = type === "error" ? 30000 : 15000;
    const clearDelay = hideDelay + 500;

    const hideTimer = setTimeout(() => {
      setNoticeList((prev) =>
        prev.map((item) =>
          item.id === noticeId
            ? {
                ...item,
                visible: false
              }
            : item
        )
      );
    }, hideDelay);

    const clearTimer = setTimeout(() => {
      setNoticeList((prev) => prev.filter((item) => item.id !== noticeId));
      clearNoticeTimers(noticeId);
    }, clearDelay);

    noticeTimersRef.current.set(noticeId, { hideTimer, clearTimer });
  }

  function notifySuccess(message: string, details?: string[]) {
    enqueueNotice("success", message, details);
  }

  function notifyError(message: string, details?: string[]) {
    enqueueNotice("error", message, details);
  }

  function buildWorkbookFormData(sheetName?: string, allowWarnings?: boolean) {
    if (!workbookFile) {
      throw new Error("请先选择 xlsm/xlsx 文件");
    }

    const formData = new FormData();
    formData.append("file", workbookFile);

    if (sheetName) {
      formData.append("sheetName", sheetName);
    }

    if (allowWarnings !== undefined) {
      formData.append("allowWarnings", String(allowWarnings));
    }

    return formData;
  }

  async function requestWorkbookPreview(sheetName?: string) {
    const payload = buildWorkbookFormData(sheetName || selectedSheet || undefined);
    const result = await postFormData("/api/admin/import-xlsm/preview", payload);

    const workbookPreviewRows = (result.previewRows ?? []) as PreviewRow[];
    const warningRows = (result.warnings ?? []) as ImportWarning[];
    const normalizedSelectedSheet =
      typeof result.selectedSheet === "string" && result.selectedSheet.trim().length > 0
        ? result.selectedSheet.trim()
        : (sheetName || selectedSheet || "Sheet1");

    let currentBenchmarkType = "General";
    let currentBenchmarkTypeProvided = false;
    const unifiedPreviewRows: TextImportPreviewRow[] = workbookPreviewRows.map((row) => {
      const rowCategory = typeof row.category === "string" ? row.category.trim() : "";
      if (rowCategory) {
        currentBenchmarkType = rowCategory;
        currentBenchmarkTypeProvided = true;
      }

      const benchmarkType = currentBenchmarkType || "General";
      const normalizedModelName = row.modelName.trim();
      const existingModel = existingModelExactMap.get(normalizedModelName.toLowerCase());
      const providerName = existingModel
        ? (providerById.get(existingModel.providerId)?.name ?? inferProviderNameFromModelName(normalizedModelName))
        : inferProviderNameFromModelName(normalizedModelName);
      const inferredHigherIsBetter = !isLowerBetterPreviewBenchmark(row.benchmarkName, benchmarkType);

      return {
        rowNumber: row.rowNumber,
        providerName,
        modelName: normalizedModelName,
        benchmarkName: row.benchmarkName,
        benchmarkType,
        benchmarkTypeProvided: currentBenchmarkTypeProvided,
        higherIsBetter: inferredHigherIsBetter,
        modalities: normalizeModalityList([benchmarkType]),
        rawValue: row.rawValue,
        valueNum: row.valueNum,
        valueNum2: row.valueNum2,
        valueNote: row.valueNote,
        source: `xlsm:${normalizedSelectedSheet}`,
        valid: row.valid
      };
    });

    const parsedCount = Number(result.parsedCount ?? unifiedPreviewRows.length);
    const warningCount = Number(result.warningCount ?? warningRows.length);
    const skippedCount = Math.max(0, parsedCount - unifiedPreviewRows.length);

    setSheetNames(result.sheetNames ?? []);
    setSelectedSheet(normalizedSelectedSheet);
    setPreviewRows(workbookPreviewRows);
    setPreviewWarnings(warningRows);
    setPreviewMeta({
      benchmarkColumn: result.benchmarkColumn ?? "Benchmark",
      categoryColumn: result.categoryColumn ?? null,
      parsedCount,
      warningCount
    });

    setTextImportPreviewRows(unifiedPreviewRows);
    setTextImportDraftRows(unifiedPreviewRows.map((row) => ({ ...row })));
    setGlobalStarSupplement("");
    setBenchmarkMergeTargets({});
    setBenchmarkMergeFilters({});
    setIgnoredBenchmarkKeys({});
    setParenthesesModes({});
    setParenthesesCustomNames({});
    setModelMergeTargets({});
    setModelMergeFilters({});
    setModelParenthesesModes({});
    setModelParenthesesCustomNames({});
    setPairNoteAutoFillAppliedByBenchmark({});
    setMatrixBenchmarkNameDrafts({});
    setMatrixBenchmarkTypeDrafts({});
    setMatrixModelNameDrafts({});
    setOpenMatrixBenchmarkCandidateFor(null);
    setTextImportPreviewMeta({
      format: "workbook-table",
      total: unifiedPreviewRows.length,
      skipped: skippedCount
    });
    setTextImportPreviewVisibleCount(200);

    notifySuccess(`预览完成：解析 ${parsedCount} 条，警告 ${warningCount} 条；已同步到下方统一预览表`);

    return result;
  }

  async function onPreviewWorkbook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await requestWorkbookPreview();
      if ((result.sheetNames ?? []).length > 1) {
        setSheetPickerOpen(true);
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "预览失败");
    }
  }

  async function onSelectSheet(sheetName: string) {
    try {
      setSelectedSheet(sheetName);
      await requestWorkbookPreview(sheetName);
      setSheetPickerOpen(false);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "切换工作表失败");
    }
  }

  async function onImportWorkbook() {
    if (isImportingWorkbook) {
      return;
    }

    if (importProgressTimerRef.current) {
      clearInterval(importProgressTimerRef.current);
      importProgressTimerRef.current = null;
    }

    setIsImportingWorkbook(true);
    setImportStatus("running");
    setImportStatusText("正在导入工作表...");
    setImportProgress(8);

    let finalStatus: "success" | "error" = "error";
    let finalStatusText = "导入失败";
    let finalProgress = 6;

    importProgressTimerRef.current = setInterval(() => {
      setImportProgress((prev) => {
        if (prev >= 90) return prev;
        const next = prev + Math.floor(Math.random() * 7) + 2;
        return next > 90 ? 90 : next;
      });
    }, 280);

    try {
      if (textImportDraftRows.length === 0) {
        throw new Error("请先解析并预览工作表，再执行导入");
      }

      if (previewWarnings.length > 0 && !allowWarningsImport) {
        throw new Error("存在不合规值，请先处理或勾选“忽略警告继续导入”");
      }

      if (finalizedTextImportRows.length === 0) {
        throw new Error("处理后无可导入数据，请检查忽略项或编辑值");
      }

      const generatedCsvText = buildStructuredCsvText(finalizedTextImportRows);
      const result = await postJson("/api/admin/import-csv", {
        csvText: generatedCsvText,
        source: csvSource || undefined
      });

      const directionWarningCount = Number(result.warningCount ?? 0);
      const warningDetails = extractTextImportWarningDetails(result.warnings);

      if (directionWarningCount > 0) {
        notifyError(
          `工作簿导入完成：${result.inserted ?? 0}/${result.total ?? 0}（忽略 ${ignoredTextImportCount}，格式 ${result.format ?? "structured-csv"}）；已自动处理 ${directionWarningCount} 条解析警告`,
          warningDetails
        );
      } else {
        notifySuccess(
          `工作簿导入完成：${result.inserted ?? 0}/${result.total ?? 0}（忽略 ${ignoredTextImportCount}，格式 ${result.format ?? "structured-csv"}）`
        );
      }

      finalStatus = "success";
      finalProgress = 100;
      finalStatusText = `导入成功：${result.inserted ?? 0}/${result.total ?? 0}`;
    } catch (error) {
      const payload = (error as Error & { payload?: unknown }).payload as { warnings?: ImportWarning[] } | undefined;
      if (payload?.warnings) {
        setPreviewWarnings(payload.warnings);
      }
      notifyError(error instanceof Error ? error.message : "导入失败");
      finalStatus = "error";
      finalProgress = 6;
      finalStatusText = error instanceof Error ? `导入失败：${error.message}` : "导入失败";
    } finally {
      if (importProgressTimerRef.current) {
        clearInterval(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }
      setImportStatus(finalStatus);
      setImportStatusText(finalStatusText);
      setImportProgress(finalProgress);
      setIsImportingWorkbook(false);
    }
  }

  async function onCreateProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await postJson("/api/admin/providers", { name: providerName });
      setProviderName("");
      notifySuccess("Provider 已保存，刷新页面可看到下拉选项更新。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 provider 失败");
    }
  }

  async function onCreateModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (providerId === "") {
      notifyError("请先选择 provider");
      return;
    }

    try {
      await postJson("/api/admin/models", {
        providerId,
        modelName,
        modelAlias: modelAlias || undefined,
        sourceModelId: sourceModelId || undefined
      });
      setModelName("");
      setModelAlias("");
      setSourceModelId("");
      notifySuccess("Model 已保存，刷新页面可看到下拉选项更新。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 model 失败");
    }
  }

  async function onCreateBenchmark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await postJson("/api/admin/benchmarks", {
        benchmarkName,
        benchmarkType,
        unit: benchmarkUnit,
        higherIsBetter,
        modalities: modalities
          .split(",")
          .map((item: string) => item.trim())
          .filter(Boolean)
      });
      setBenchmarkName("");
      notifySuccess("Benchmark 已保存，刷新页面可看到下拉选项更新。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 benchmark 失败");
    }
  }

  async function onCreateValue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (valueModelId === "" || valueBenchmarkId === "") {
      notifyError("请先选择 model 和 benchmark");
      return;
    }

    try {
      await postJson("/api/admin/values", {
        modelId: valueModelId,
        benchmarkId: valueBenchmarkId,
        benchTime: new Date(benchTime).toISOString(),
        valueRaw,
        source: valueSource || undefined
      });
      setValueRaw("");
      notifySuccess("Benchmark 值已保存。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 benchmark 值失败");
    }
  }

  function onUpdateTextImportDraftValue(rowIndex: number, rawValue: string) {
    setTextImportDraftRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIndex
          ? (() => {
              const pair = parsePairRawValue(rawValue);
              const starSingle = parseStarSingleRawValue(rawValue);

              let nextValueNote: string | null;
              if (pair) {
                nextValueNote = pair.note ?? row.valueNote ?? null;
              } else if (starSingle) {
                nextValueNote = starSingle.note ?? row.valueNote ?? null;
              } else {
                nextValueNote = null;
              }

              return {
                ...row,
                rawValue,
                valueNote: nextValueNote
              };
            })()
          : row
      )
    );
  }

  function onUpdateTextImportDraftNote(rowIndex: number, valueNote: string) {
    setTextImportDraftRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIndex
          ? {
              ...row,
              valueNote: valueNote.length > 0 ? valueNote : null
            }
          : row
      )
    );
  }

  function onUpdateTextImportDraftStarSupplement(rowIndex: number, supplement: string) {
    setTextImportDraftRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIndex
          ? {
              ...row,
              valueNote: supplement.length > 0 ? supplement : null
            }
          : row
      )
    );
  }

  function recordStarNoteHistory(valueNote: string) {
    const normalizedNote = valueNote.trim();
    if (!normalizedNote) return;

    setStarNoteHistory((prev) => {
      const next = [normalizedNote, ...prev.filter((item) => item !== normalizedNote)].slice(0, 30);
      try {
        window.localStorage.setItem(STAR_NOTE_HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage write errors gracefully
      }
      return next;
    });
  }

  function onStarSupplementInputBlur(rowIndex: number, supplement: string) {
    const normalized = supplement.trim();

    setTextImportDraftRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIndex
          ? {
              ...row,
              valueNote: normalized.length > 0 ? normalized : null
            }
          : row
      )
    );

    if (normalized.length > 0) {
      recordStarNoteHistory(normalized);
    }
  }

  function onApplyGlobalStarSupplement() {
    const trimmedSupplement = globalStarSupplement.trim();

    setTextImportDraftRows((prev) =>
      prev.map((row) => {
        if (!parseStarSingleRawValue(row.rawValue)) {
          return row;
        }

        return {
          ...row,
          valueNote: trimmedSupplement.length > 0 ? trimmedSupplement : null
        };
      })
    );

    if (trimmedSupplement.length > 0) {
      recordStarNoteHistory(trimmedSupplement);
      notifySuccess(`已为全部 * 数值设置统一注释：${trimmedSupplement}`);
    } else {
      notifySuccess("已清空全部 * 数值注释");
    }
  }

  function recordPairNoteHistory(valueNote: string) {
    const normalizedNote = valueNote.trim();
    if (!normalizedNote) return;

    setPairNoteHistory((prev) => {
      const next = [normalizedNote, ...prev.filter((item) => item !== normalizedNote)].slice(0, 30);
      try {
        window.localStorage.setItem(PAIR_NOTE_HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage write errors gracefully
      }
      return next;
    });
  }

  function onPairNoteInputBlur(rowIndex: number, benchmarkKey: string, valueNote: string) {
    const normalizedNote = valueNote.trim();
    if (!normalizedNote) return;

    recordPairNoteHistory(normalizedNote);

    if (pairNoteAutoFillAppliedByBenchmark[benchmarkKey]) return;

    setTextImportDraftRows((prev) =>
      prev.map((row, idx) => {
        if (idx === rowIndex) return row;

        const rowBenchmarkKey = getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType);
        if (rowBenchmarkKey !== benchmarkKey) return row;
        if (!parsePairRawValue(row.rawValue)) return row;

        const currentNote = row.valueNote?.trim() ?? "";
        if (currentNote.length > 0) return row;

        return {
          ...row,
          valueNote: normalizedNote
        };
      })
    );

    setPairNoteAutoFillAppliedByBenchmark((prev) => ({
      ...prev,
      [benchmarkKey]: true
    }));
  }

  function onToggleMatrixBenchmarkModality(benchmarkKey: string, modality: string, checked: boolean) {
    setTextImportDraftRows((prev) => {
      const matchedRows = prev.filter(
        (row) => getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType) === benchmarkKey
      );

      if (matchedRows.length === 0) {
        return prev;
      }

      const currentModalities = normalizeModalityList(
        matchedRows[0].modalities?.length ? matchedRows[0].modalities : [matchedRows[0].benchmarkType]
      );

      let nextRawModalities = checked
        ? [...currentModalities, modality]
        : currentModalities.filter((item) => item !== modality);

      if (checked && modality === "Vision") {
        nextRawModalities = nextRawModalities.filter((item) => item !== "Video");
      }

      if (checked && modality === "Video") {
        nextRawModalities = nextRawModalities.filter((item) => item !== "Vision");
      }

      const nextModalities = normalizeModalityList(
        nextRawModalities.length > 0 ? nextRawModalities : ["Text"]
      );

      return prev.map((row) =>
        getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType) === benchmarkKey
          ? {
              ...row,
              modalities: nextModalities
            }
          : row
      );
    });
  }

  function onToggleMatrixBenchmarkLowerIsBetter(benchmarkKey: string, checkedLowerIsBetter: boolean) {
    const nextHigherIsBetter = !checkedLowerIsBetter;

    setTextImportDraftRows((prev) =>
      prev.map((row) =>
        getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType) === benchmarkKey
          ? {
              ...row,
              higherIsBetter: nextHigherIsBetter
            }
          : row
      )
    );
  }

  function onRenameTextImportBenchmark(benchmarkKey: string, nextBenchmarkName: string) {
    const splitIndex = benchmarkKey.lastIndexOf("@@");
    if (splitIndex < 0) return;
    const benchmarkType = benchmarkKey.slice(splitIndex + 2);
    const nextKey = getTextImportBenchmarkKey(nextBenchmarkName, benchmarkType);

    setTextImportDraftRows((prev) =>
      prev.map((row) =>
        getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType) === benchmarkKey
          ? {
              ...row,
              benchmarkName: nextBenchmarkName
            }
          : row
      )
    );

    if (nextKey === benchmarkKey) return;

    setBenchmarkMergeTargets((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setBenchmarkMergeFilters((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setIgnoredBenchmarkKeys((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setParenthesesModes((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setParenthesesCustomNames((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setPairNoteAutoFillAppliedByBenchmark((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });
  }

  function onRenameTextImportBenchmarkType(benchmarkKey: string, nextBenchmarkType: string) {
    const splitIndex = benchmarkKey.lastIndexOf("@@");
    if (splitIndex < 0) return;

    const benchmarkName = benchmarkKey.slice(0, splitIndex);
    const nextKey = getTextImportBenchmarkKey(benchmarkName, nextBenchmarkType);

    setTextImportDraftRows((prev) =>
      prev.map((row) =>
        getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType) === benchmarkKey
          ? {
              ...row,
              benchmarkType: nextBenchmarkType
            }
          : row
      )
    );

    if (nextKey === benchmarkKey) return;

    setBenchmarkMergeTargets((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setBenchmarkMergeFilters((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setIgnoredBenchmarkKeys((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setParenthesesModes((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setParenthesesCustomNames((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setPairNoteAutoFillAppliedByBenchmark((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });
  }

  function onRenameTextImportModel(modelName: string, nextModelName: string) {
    setTextImportDraftRows((prev) =>
      prev.map((row) =>
        row.modelName === modelName
          ? {
              ...row,
              modelName: nextModelName
            }
          : row
      )
    );

    if (nextModelName === modelName) return;

    setModelMergeTargets((prev) => {
      if (!(modelName in prev)) return prev;
      const next = { ...prev };
      next[nextModelName] = prev[modelName];
      delete next[modelName];
      return next;
    });

    setModelMergeFilters((prev) => {
      if (!(modelName in prev)) return prev;
      const next = { ...prev };
      next[nextModelName] = prev[modelName];
      delete next[modelName];
      return next;
    });

    setModelParenthesesModes((prev) => {
      if (!(modelName in prev)) return prev;
      const next = { ...prev };
      next[nextModelName] = prev[modelName];
      delete next[modelName];
      return next;
    });

    setModelParenthesesCustomNames((prev) => {
      if (!(modelName in prev)) return prev;
      const next = { ...prev };
      next[nextModelName] = prev[modelName];
      delete next[modelName];
      return next;
    });
  }

  function applyBenchmarkOverwriteByTargetId(benchmarkKey: string, targetId: number): boolean {
    const target = benchmarkById.get(targetId)
      ?? benchmarks.find((item) => String(item.id) === String(targetId));
    if (!target) {
      return false;
    }

    onRenameTextImportBenchmark(benchmarkKey, target.benchmarkName);
    onRenameTextImportBenchmarkType(benchmarkKey, target.benchmarkType);
    return true;
  }

  function applyModelOverwriteByTargetId(modelName: string, targetId: number): boolean {
    const target = modelById.get(targetId)
      ?? models.find((item) => String(item.id) === String(targetId));
    if (!target) {
      return false;
    }

    onRenameTextImportModel(modelName, target.modelName);
    return true;
  }

  function onMatrixBenchmarkNameInputChange(benchmarkKey: string, nextBenchmarkName: string) {
    setMatrixBenchmarkNameDrafts((prev) => ({
      ...prev,
      [benchmarkKey]: nextBenchmarkName
    }));
  }

  function onMatrixBenchmarkNameInputBlur(
    benchmarkKey: string,
    currentBenchmarkName: string,
    inputValue: string
  ) {
    const normalized = inputValue.trim();
    const committedName = normalized.length > 0 ? normalized : currentBenchmarkName;

    setMatrixBenchmarkNameDrafts((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      delete next[benchmarkKey];
      return next;
    });

    if (committedName !== currentBenchmarkName) {
      onRenameTextImportBenchmark(benchmarkKey, committedName);
    }
  }

  function onMatrixBenchmarkTypeInputChange(benchmarkKey: string, nextBenchmarkType: string) {
    setMatrixBenchmarkTypeDrafts((prev) => ({
      ...prev,
      [benchmarkKey]: nextBenchmarkType
    }));
  }

  function onMatrixBenchmarkTypeInputBlur(
    benchmarkKey: string,
    currentBenchmarkType: string,
    inputValue: string
  ) {
    const normalized = inputValue.trim();
    const committedType = normalized.length > 0 ? normalized : currentBenchmarkType;

    setMatrixBenchmarkTypeDrafts((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      delete next[benchmarkKey];
      return next;
    });

    if (committedType !== currentBenchmarkType) {
      onRenameTextImportBenchmarkType(benchmarkKey, committedType);
    }
  }

  function onMatrixModelNameInputChange(modelName: string, nextModelName: string) {
    setMatrixModelNameDrafts((prev) => ({
      ...prev,
      [modelName]: nextModelName
    }));
  }

  function onMatrixModelNameInputBlur(modelName: string, inputValue: string) {
    const normalized = inputValue.trim();
    const committedModelName = normalized.length > 0 ? normalized : modelName;

    setMatrixModelNameDrafts((prev) => {
      if (!(modelName in prev)) return prev;
      const next = { ...prev };
      delete next[modelName];
      return next;
    });

    if (committedModelName !== modelName) {
      onRenameTextImportModel(modelName, committedModelName);
    }
  }

  function renderModalityBadge(modalityInput: string, key: string) {
    const modality = normalizeModalityName(modalityInput);

    if (modality === "Text") {
      return null;
    }

    if (modality === "Vision") {
      return (
        <span key={key} className="inline-flex items-center rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-cyan-300" title="Vision">
          <Eye size={12} />
        </span>
      );
    }

    if (modality === "Audio") {
      return (
        <span key={key} className="inline-flex items-center rounded-md bg-purple-500/15 px-1.5 py-0.5 text-purple-300" title="Audio">
          <Headphones size={12} />
        </span>
      );
    }

    if (modality === "Video") {
      return (
        <span key={key} className="inline-flex items-center rounded-md bg-pink-500/15 px-1.5 py-0.5 text-pink-300" title="Video">
          <Video size={12} />
        </span>
      );
    }

    if (modality === "Multimodal") {
      return (
        <span
          key={key}
          className="inline-flex items-center rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-300"
          title="Multimodal"
        >
          <Layers size={12} />
        </span>
      );
    }

    return null;
  }

  async function onPreviewCsvImport() {
    setIsPreviewingTextImport(true);
    try {
      const result = await postJson("/api/admin/import-csv/preview", {
        csvText,
        source: csvSource || undefined
      });
      const previewRows = (result.previewRows ?? []) as TextImportPreviewRow[];
      setTextImportPreviewRows(previewRows);
      setTextImportDraftRows(previewRows.map((row) => ({ ...row })));
      setGlobalStarSupplement("");
      setBenchmarkMergeTargets({});
      setBenchmarkMergeFilters({});
      setIgnoredBenchmarkKeys({});
      setParenthesesModes({});
      setParenthesesCustomNames({});
      setModelMergeTargets({});
      setModelMergeFilters({});
      setModelParenthesesModes({});
      setModelParenthesesCustomNames({});
      setPairNoteAutoFillAppliedByBenchmark({});
      setMatrixBenchmarkNameDrafts({});
      setMatrixBenchmarkTypeDrafts({});
      setMatrixModelNameDrafts({});
      setOpenMatrixBenchmarkCandidateFor(null);
      setTextImportPreviewMeta({
        format: result.format ?? "matrix-table",
        total: result.total ?? 0,
        skipped: result.skipped ?? 0
      });
      setTextImportPreviewVisibleCount(200);

      const directionWarningCount = Number(result.warningCount ?? 0);
      const warningDetails = extractTextImportWarningDetails(result.warnings);
      if (directionWarningCount > 0) {
        notifyError(
          `文本预览完成：可导入 ${result.total ?? 0} 条，跳过 ${result.skipped ?? 0} 条；检测到 ${directionWarningCount} 条解析警告（导入时会自动清洗/修正）`,
          warningDetails
        );
      } else {
        notifySuccess(`文本预览完成：可导入 ${result.total ?? 0} 条，跳过 ${result.skipped ?? 0} 条`);
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "文本预览失败");
    } finally {
      setIsPreviewingTextImport(false);
    }
  }

  async function executeImportCsv() {
    if (isImportingTextCsv) {
      return;
    }

    if (textImportDraftRows.length > 0 && finalizedTextImportRows.length === 0) {
      notifyError("处理后无可导入数据，请检查忽略项或编辑值");
      return;
    }

    if (textImportProgressTimerRef.current) {
      clearInterval(textImportProgressTimerRef.current);
      textImportProgressTimerRef.current = null;
    }

    setIsImportingTextCsv(true);
    setTextImportStatus("running");
    setTextImportStatusText("正在导入文本...");
    setTextImportProgress(8);

    let finalStatus: "success" | "error" = "error";
    let finalStatusText = "导入失败";
    let finalProgress = 6;

    textImportProgressTimerRef.current = setInterval(() => {
      setTextImportProgress((prev) => {
        if (prev >= 90) return prev;
        const next = prev + Math.floor(Math.random() * 7) + 2;
        return next > 90 ? 90 : next;
      });
    }, 260);

    try {
      if (textImportDraftRows.length > 0) {
        const generatedCsvText = buildStructuredCsvText(finalizedTextImportRows);
        const result = await postJson("/api/admin/import-csv", {
          csvText: generatedCsvText,
          source: csvSource || undefined
        });

        const directionWarningCount = Number(result.warningCount ?? 0);
        const warningDetails = extractTextImportWarningDetails(result.warnings);
        if (directionWarningCount > 0) {
          notifyError(
            `文本导入完成：${result.inserted ?? 0}/${result.total ?? 0}（忽略 ${ignoredTextImportCount}，格式 ${result.format ?? "structured-csv"}）；已自动处理 ${directionWarningCount} 条解析警告`,
            warningDetails
          );
        } else {
          notifySuccess(
            `文本导入完成：${result.inserted ?? 0}/${result.total ?? 0}（忽略 ${ignoredTextImportCount}，格式 ${result.format ?? "structured-csv"}）`
          );
        }
        finalStatus = "success";
        finalProgress = 100;
        finalStatusText = `导入成功：${result.inserted ?? 0}/${result.total ?? 0}`;
      } else {
        const result = await postJson("/api/admin/import-csv", {
          csvText,
          source: csvSource || undefined
        });

        const directionWarningCount = Number(result.warningCount ?? 0);
        const warningDetails = extractTextImportWarningDetails(result.warnings);
        if (directionWarningCount > 0) {
          notifyError(
            `文本导入完成：${result.inserted ?? 0}/${result.total ?? 0}（跳过 ${result.skipped ?? 0}，格式 ${result.format ?? "auto"}）；已自动处理 ${directionWarningCount} 条解析警告`,
            warningDetails
          );
        } else {
          notifySuccess(
            `文本导入完成：${result.inserted ?? 0}/${result.total ?? 0}（跳过 ${result.skipped ?? 0}，格式 ${result.format ?? "auto"}）`
          );
        }
        finalStatus = "success";
        finalProgress = 100;
        finalStatusText = `导入成功：${result.inserted ?? 0}/${result.total ?? 0}`;
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "文本导入失败");
      finalStatus = "error";
      finalProgress = 6;
      finalStatusText = error instanceof Error ? `导入失败：${error.message}` : "导入失败";
    } finally {
      if (textImportProgressTimerRef.current) {
        clearInterval(textImportProgressTimerRef.current);
        textImportProgressTimerRef.current = null;
      }
      setTextImportStatus(finalStatus);
      setTextImportStatusText(finalStatusText);
      setTextImportProgress(finalProgress);
      setIsImportingTextCsv(false);
    }
  }

  async function onImportCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isImportingTextCsv) {
      return;
    }

    const latestSourceInput = csvSource.trim();
    const hasAnySource = latestSourceInput.length > 0
      || (textImportDraftRows.length > 0
        ? finalizedTextImportRows.some((row) => (row.source ?? "").trim().length > 0)
        : false);

    if (!hasAnySource) {
      setConfirmImportWithoutSourceOpen(true);
      return;
    }

    await continueImportCsvFlow();
  }

  async function continueImportCsvFlow() {
    if (isImportingTextCsv) {
      return;
    }

    if (!textImportPreviewMeta) {
      setConfirmImportWithoutPreviewOpen(true);
      return;
    }

    await executeImportCsv();
  }

  async function onConfirmImportWithoutSource() {
    setConfirmImportWithoutSourceOpen(false);
    await continueImportCsvFlow();
  }

  async function onConfirmImportWithoutPreview() {
    setConfirmImportWithoutPreviewOpen(false);
    await executeImportCsv();
  }

  function duplicateConfidenceBadgeClass(confidence: DuplicateConfidence): string {
    if (confidence === "high") {
      return "border border-emerald-300/70 bg-emerald-500/25 text-emerald-100";
    }
    if (confidence === "medium") {
      return "border border-amber-300/70 bg-amber-500/25 text-amber-100";
    }
    return "border border-slate-300/50 bg-slate-500/20 text-slate-100";
  }

  function duplicateConfidenceLabel(confidence: DuplicateConfidence): string {
    if (confidence === "high") return "高置信";
    if (confidence === "medium") return "中置信";
    return "低置信";
  }

  function duplicateCandidateCardClass(confidence: DuplicateConfidence): string {
    if (confidence === "high") {
      return "border-success/45 bg-success/5";
    }
    if (confidence === "medium") {
      return "border-warning/45 bg-warning/5";
    }
    return "border-base-300/70 bg-base-100/70";
  }

  function duplicateReasonLabel(reason: string): string {
    if (reason === "strict-normalized-equal") return "严格归一化一致";
    if (reason === "ignore-high-reasoning-tokens-equal") return "去噪词后名称一致";
    if (reason === "normalized-name-equal") return "名称归一化一致";
    if (reason === "variant-noise-normalized-name-equal") return "去变体后缀后名称一致";
    if (reason === "same-type") return "类型一致";
    if (reason === "general-type-gap") return "General 可覆盖";
    if (reason === "type-mismatch") return "类型不一致";
    if (reason === "numeric-token-mismatch") return "数字片段不一致（降为低置信）";
    if (reason === "variant-conflict-hint") return "疑似变体冲突";
    if (reason === "version-gap-hint") return "版本差异（已降级）";
    if (reason.startsWith("char-similarity-")) {
      const value = Number.parseFloat(reason.replace("char-similarity-", ""));
      if (Number.isFinite(value)) {
        return `字符相似 ${(value * 100).toFixed(1)}%`;
      }
      return "字符相似";
    }
    return reason;
  }

  function shouldDisplayDuplicateCandidate(confidence: DuplicateConfidence): boolean {
    if (duplicateConfidenceFilter === "all") return true;
    return confidence !== "low";
  }

  function applyModelDuplicateCandidate(candidate: DuplicateModelCandidate) {
    setMergeType("model");
    setMergeSourceInput(`${candidate.sourceName} [${candidate.sourceId}]`);
    setMergeTargetInput(`${candidate.targetName} [${candidate.targetId}]`);
    setMergeTargetBenchmarkNameInput("");
    window.requestAnimationFrame(() => {
      mergeSubmitButtonRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
        inline: "nearest"
      });
    });
  }

  function applyBenchmarkDuplicateCandidate(candidate: DuplicateBenchmarkCandidate) {
    setMergeType("benchmark");
    setMergeSourceInput(`${candidate.sourceName} [${candidate.sourceType}] [${candidate.sourceId}]`);
    setMergeTargetInput(`${candidate.targetName} [${candidate.targetType}] [${candidate.targetId}]`);
    setMergeTargetBenchmarkNameInput(candidate.targetName);
    window.requestAnimationFrame(() => {
      mergeSubmitButtonRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
        inline: "nearest"
      });
    });
  }

  function resolveMergeEntityLabel(
    entityType: "model" | "benchmark",
    entityId: number,
    targetBenchmarkNameOverride?: string
  ): string {
    if (entityType === "model") {
      return modelById.get(entityId)?.modelName ?? `#${entityId}`;
    }

    const benchmark = benchmarkById.get(entityId);
    if (targetBenchmarkNameOverride && targetBenchmarkNameOverride.trim().length > 0) {
      return benchmark
        ? `${targetBenchmarkNameOverride.trim()} [${benchmark.benchmarkType}]`
        : targetBenchmarkNameOverride.trim();
    }

    return benchmark ? `${benchmark.benchmarkName} [${benchmark.benchmarkType}]` : `#${entityId}`;
  }

  function removeDuplicateCandidateByMerge(entityType: "model" | "benchmark", sourceId: number, targetId: number) {
    setDuplicateDetectionResult((prev) => {
      if (!prev) return prev;

      const shouldKeepCandidate = (candidate: { sourceId: number; targetId: number }) => {
        const isExactPair = candidate.sourceId === sourceId && candidate.targetId === targetId;
        const isReversePair = candidate.sourceId === targetId && candidate.targetId === sourceId;
        return !isExactPair && !isReversePair;
      };

      if (entityType === "model") {
        return {
          ...prev,
          modelCandidates: prev.modelCandidates.filter(shouldKeepCandidate)
        };
      }

      return {
        ...prev,
        benchmarkCandidates: prev.benchmarkCandidates.filter(shouldKeepCandidate)
      };
    });
  }

  function upsertMergedRecordAfterMerge(
    entityType: "model" | "benchmark",
    sourceId: number,
    targetId: number,
    targetBenchmarkNameOverride?: string
  ) {
    const sourceName = resolveMergeEntityLabel(entityType, sourceId);
    const targetName = resolveMergeEntityLabel(entityType, targetId, targetBenchmarkNameOverride);

    setMergedRecordList((prev) => {
      const nextRecord: MergedRecord = {
        entityType,
        sourceId,
        sourceName,
        targetId,
        targetName
      };

      const existingIndex = prev.findIndex(
        (item) => item.entityType === entityType && item.sourceId === sourceId
      );

      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = nextRecord;
        return next;
      }

      return [nextRecord, ...prev];
    });

    setMergedRecordTargetInputs((prev) => ({
      ...prev,
      [`${entityType}:${sourceId}`]: `${targetName} [${targetId}]`
    }));
  }

  async function onDetectDuplicateCandidates() {
    if (isDetectingDuplicates) return;

    setIsDetectingDuplicates(true);
    try {
      const result = await postJson("/api/admin/detect-duplicates", {});
      const typedResult = result as DuplicateDetectionResult;
      setDuplicateDetectionResult(typedResult);

      if ((typedResult.modelCandidates?.length ?? 0) > 0) {
        setDuplicateDetectionEntityType("model");
      } else {
        setDuplicateDetectionEntityType("benchmark");
      }

      notifySuccess(
        `重复检测完成：model 候选 ${typedResult.modelCandidates?.length ?? 0} 条，benchmark 候选 ${typedResult.benchmarkCandidates?.length ?? 0} 条`
      );
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "重复检测失败");
    } finally {
      setIsDetectingDuplicates(false);
    }
  }

  async function onMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mergeSubmitState === "submitting") return;

    if (resolvedMergeSourceId === null || resolvedMergeTargetId === null) {
      notifyError("请从下拉候选中选择 source/target，或直接输入合法 ID");
      return;
    }

    if (resolvedMergeSourceId === resolvedMergeTargetId) {
      notifyError("source 和 target 不能相同");
      return;
    }

    if (mergeSubmitResetTimerRef.current) {
      clearTimeout(mergeSubmitResetTimerRef.current);
      mergeSubmitResetTimerRef.current = null;
    }

    const normalizedTargetBenchmarkName =
      mergeType === "benchmark"
        ? mergeTargetBenchmarkNameInput.trim()
        : "";

    setMergeSubmitState("submitting");

    try {
      await postJson("/api/admin/merge", {
        entityType: mergeType,
        sourceId: resolvedMergeSourceId,
        targetId: resolvedMergeTargetId,
        targetBenchmarkName:
          mergeType === "benchmark" && normalizedTargetBenchmarkName.length > 0
            ? normalizedTargetBenchmarkName
            : undefined
      });

      upsertMergedRecordAfterMerge(
        mergeType,
        resolvedMergeSourceId,
        resolvedMergeTargetId,
        mergeType === "benchmark" ? normalizedTargetBenchmarkName : undefined
      );
      removeDuplicateCandidateByMerge(mergeType, resolvedMergeSourceId, resolvedMergeTargetId);

      setMergeSubmitState("success");

      mergeSubmitResetTimerRef.current = setTimeout(() => {
        setMergeSubmitState("idle");
        mergeSubmitResetTimerRef.current = null;
      }, 1200);

      notifySuccess("合并完成。");
    } catch (error) {
      setMergeSubmitState("idle");
      notifyError(error instanceof Error ? error.message : "合并失败");
    }
  }

  async function onUpdateMergedRecord(record: MergedRecord) {
    const key = `${record.entityType}:${record.sourceId}`;
    const input = mergedRecordTargetInputs[key] ?? "";
    const options = record.entityType === "model" ? modelEntityOptions : benchmarkEntityOptions;
    const targetId = parseMergeEntityId(input, options);

    if (targetId === null) {
      notifyError("请从候选中选择有效 target，或输入合法 ID");
      return;
    }

    if (targetId === record.sourceId) {
      notifyError("source 和 target 不能相同");
      return;
    }

    try {
      await postJson(
        "/api/admin/merge-record",
        {
          entityType: record.entityType,
          sourceId: record.sourceId,
          targetId
        },
        "PATCH"
      );

      const targetName = options.find((item) => item.id === targetId)?.label ?? `#${targetId}`;

      setMergedRecordList((prev) =>
        prev.map((item) =>
          item.entityType === record.entityType && item.sourceId === record.sourceId
            ? { ...item, targetId, targetName }
            : item
        )
      );

      setMergedRecordTargetInputs((prev) => ({
        ...prev,
        [key]: `${targetName} [${targetId}]`
      }));

      notifySuccess("已更新合并目标。注意：此操作仅更新合并映射，不会回滚历史值迁移。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "更新合并记录失败");
    }
  }

  async function onDeleteMergedRecord(record: MergedRecord) {
    const confirmed = window.confirm("确认删除该合并记录吗？此操作不会回滚历史值迁移。继续？");
    if (!confirmed) return;

    try {
      await postJson(
        "/api/admin/merge-record",
        {
          entityType: record.entityType,
          sourceId: record.sourceId
        },
        "DELETE"
      );

      setMergedRecordList((prev) =>
        prev.filter((item) => !(item.entityType === record.entityType && item.sourceId === record.sourceId))
      );
      setMergedRecordTargetInputs((prev) => {
        const next = { ...prev };
        delete next[`${record.entityType}:${record.sourceId}`];
        return next;
      });

      notifySuccess("已删除合并映射。若需刷新下拉数据可手动刷新页面。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "删除合并记录失败");
    }
  }

  function onPickRenameEntity(entityId: number) {
    setRenameSelectedEntityId(entityId);
    setRenameSubmitState("idle");

    if (renameEntityType === "model") {
      const matchedModel = modelById.get(entityId);
      setRenameNextName(matchedModel?.modelName ?? "");
      return;
    }

    const matchedBenchmark = benchmarkById.get(entityId);
    setRenameNextName(matchedBenchmark?.benchmarkName ?? "");
  }

  async function onRenameEntity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (renameSubmitState === "submitting") {
      return;
    }

    if (renameSelectedEntityId === null) {
      notifyError("请先在上方搜索结果中选择一个实体");
      return;
    }

    const normalizedNextName = renameNextName.trim();
    if (!normalizedNextName) {
      notifyError("新名称不能为空");
      return;
    }

    if (renameSubmitResetTimerRef.current) {
      clearTimeout(renameSubmitResetTimerRef.current);
      renameSubmitResetTimerRef.current = null;
    }

    setRenameSubmitState("submitting");

    try {
      const result = await postJson("/api/admin/rename-entity", {
        entityType: renameEntityType,
        entityId: renameSelectedEntityId,
        nextName: normalizedNextName,
        mergeOnConflict: renameMergeOnConflict
      });

      const action = typeof result?.action === "string" ? result.action : "renamed";
      const persistedNextName = typeof result?.nextName === "string" ? result.nextName : normalizedNextName;

      setRenameNextName(persistedNextName);
      setRenameSubmitState("success");

      renameSubmitResetTimerRef.current = setTimeout(() => {
        setRenameSubmitState("idle");
        renameSubmitResetTimerRef.current = null;
      }, 1200);

      if (action === "unchanged") {
        notifySuccess("名称未变化，无需更新。", ["实体当前名称与目标名称一致"]);
        return;
      }

      if (action === "merged-and-renamed") {
        const mergedSourceId = Number(result?.mergedSourceId);
        const mergedSourceName = typeof result?.mergedSourceName === "string"
          ? result.mergedSourceName
          : undefined;

        if (Number.isFinite(mergedSourceId) && mergedSourceId > 0 && mergedSourceId !== renameSelectedEntityId) {
          const fallbackSourceName = renameEntityType === "model"
            ? (modelById.get(mergedSourceId)?.modelName ?? `#${mergedSourceId}`)
            : (benchmarkById.get(mergedSourceId)?.benchmarkName ?? `#${mergedSourceId}`);

          upsertMergedRecordAfterMerge(
            renameEntityType,
            mergedSourceId,
            renameSelectedEntityId,
            renameEntityType === "benchmark" ? persistedNextName : undefined
          );

          notifySuccess("改名完成，并已自动合并重名实体。", [
            `合并来源：${mergedSourceName ?? fallbackSourceName} [${mergedSourceId}]`,
            "建议刷新页面以同步最新实体下拉数据"
          ]);
          return;
        }

        notifySuccess("改名完成，并已处理重名冲突。", ["建议刷新页面以同步最新实体下拉数据"]);
        return;
      }

      notifySuccess("名称已更新并写入数据库。", ["建议刷新页面以同步最新实体下拉数据"]);
    } catch (error) {
      setRenameSubmitState("idle");
      notifyError(error instanceof Error ? error.message : "实体改名失败");
    }
  }

  async function onSaveSetting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const valueJson = JSON.parse(settingValue);
      await postJson("/api/admin/settings", {
        key: settingKey,
        valueJson,
        note: settingNote || undefined,
        updatedBy: "admin"
      });
      notifySuccess("设置项已保存。刷新页面可看到最新 settings。");
    } catch (error) {
      if (error instanceof SyntaxError) {
        notifyError("setting value 必须是合法 JSON");
        return;
      }
      notifyError(error instanceof Error ? error.message : "设置项保存失败");
    }
  }

  function onClearDatabase() {
    setClearDatabaseConfirmOpen(true);
  }

  function closeClearDatabaseConfirm() {
    if (isClearingDatabase) return;
    setClearDatabaseConfirmOpen(false);
  }

  async function onConfirmClearDatabase() {
    if (isClearingDatabase) return;

    setIsClearingDatabase(true);
    try {
      await postJson("/api/admin/debug/clear-data", {
        confirm: "CLEAR_NON_SETTINGS_DATA"
      });

      setClearDatabaseConfirmOpen(false);
      notifySuccess("已清空除 settings 外的所有表。若下拉项未更新，请刷新页面。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "清空数据库失败");
    } finally {
      setIsClearingDatabase(false);
    }
  }

  async function onDeleteModelData() {
    const modelId = parseMergeEntityId(deleteModelInput, modelEntityOptions);
    if (modelId === null) {
      notifyError("请先选择有效模型（可输入名称后从下拉候选选择）");
      return;
    }

    const selectedModelName = models.find((item) => item.id === modelId)?.modelName ?? `#${modelId}`;
    const confirmed = window.confirm(
      `确认删除模型 ${selectedModelName} 的所有数据吗？\n将删除该模型及其全部 benchmark_values。`
    );
    if (!confirmed) return;

    try {
      const result = await postJson("/api/admin/debug/delete-model", { modelId });
      notifySuccess(`已删除模型：${result.modelName ?? selectedModelName}`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "删除模型失败");
    }
  }

  async function onDeleteSourceData() {
    if (isDeletingSourceData) {
      return;
    }

    setConfirmDeleteSourceOpen(true);
  }

  function getDeleteSourceDisplayLabel(sourceInput: string): string {
    const source = sourceInput.trim();
    if (!source) {
      return "空 source（NULL/空字符串）";
    }

    return source.toLowerCase().startsWith("text:")
      ? `text:${source.slice(5).trim()}`
      : `text:${source}`;
  }

  async function onConfirmDeleteSourceData() {
    if (isDeletingSourceData) {
      return;
    }

    const source = deleteSourceInput.trim();
    const normalizedSourceLabel = getDeleteSourceDisplayLabel(source);

    setIsDeletingSourceData(true);

    try {
      const result = await postJson("/api/admin/debug/delete-source", { source });
      setDeleteSourceInput("");
      setConfirmDeleteSourceOpen(false);

      const deletedSourceLabel = result.deletedEmptySource
        ? "空 source（NULL/空字符串）"
        : (result.normalizedSource ?? normalizedSourceLabel);

      notifySuccess(`已删除 source=${deletedSourceLabel} 的 ${result.deleted ?? 0} 条记录`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "删除 source 数据失败");
    } finally {
      setIsDeletingSourceData(false);
    }
  }

  async function onSaveModelDedupeRule() {
    try {
      const result = await postJson("/api/admin/settings", {
        key: "model_dedupe_rule",
        valueJson: modelDedupeRule,
        note: "模型重复识别规则",
        updatedBy: "admin"
      });

      const mergedCount =
        typeof result?.rebuildResult?.mergedCount === "number" ? result.rebuildResult.mergedCount : null;
      const benchmarkMergedCount =
        typeof result?.rebuildResult?.benchmarkMergedCount === "number"
          ? result.rebuildResult.benchmarkMergedCount
          : null;

      notifySuccess(
        mergedCount !== null || benchmarkMergedCount !== null
          ? `模型重复识别规则已保存，并已重算 canonical_key（模型合并 ${mergedCount ?? 0} 条，benchmark 合并 ${benchmarkMergedCount ?? 0} 条）。`
          : "模型重复识别规则已保存。新导入与新增实体会按此规则判重。"
      );
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存模型规则失败");
    }
  }

  const canSubmitMerge =
    mergeSubmitState !== "submitting"
    && resolvedMergeSourceId !== null
    && resolvedMergeTargetId !== null
    && resolvedMergeSourceId !== resolvedMergeTargetId;

  const tabClass = (key: TabKey) =>
    `btn rounded-xl border-0 text-base md:text-base transition-all duration-200 ease-out ${
      activeTab === key
        ? "bg-primary text-primary-content font-semibold shadow-md"
        : "bg-transparent text-base-content/70 hover:bg-base-100/70 hover:text-base-content"
    }`;

  return (
    <>
      {noticeList.length > 0 ? (
        <div className="pointer-events-none fixed right-6 top-20 z-[120] flex max-w-[min(92vw,720px)] flex-col items-end gap-2">
          {noticeList.map((notice) => (
            <div
              key={notice.id}
              className={`pointer-events-auto flex min-w-[260px] max-w-[640px] gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-md transition-all duration-300 ease-out ${
                notice.details && notice.details.length > 0 ? "items-start" : "items-center"
              } ${
                notice.visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
              } ${
                notice.type === "success"
                  ? "border-emerald-500/45 bg-emerald-900/80 text-emerald-100"
                  : "border-rose-500/45 bg-rose-900/80 text-rose-100"
              }`}
            >
              <span
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  notice.type === "success" ? "bg-emerald-500/25 text-emerald-200" : "bg-rose-500/25 text-rose-200"
                }`}
              >
                {notice.type === "success" ? <Check size={18} /> : <TriangleAlert size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm font-semibold tracking-wide">{notice.message}</div>
                {notice.details && notice.details.length > 0 ? (
                  <ul
                    className={`mt-2 max-h-56 list-disc space-y-1 overflow-auto rounded-lg border px-3 py-2 text-xs leading-5 ${
                      notice.type === "success"
                        ? "border-emerald-300/35 bg-emerald-950/25"
                        : "border-rose-300/35 bg-rose-950/25"
                    }`}
                  >
                    {notice.details.map((detail, index) => (
                      <li key={`notice-detail-${notice.id}-${index}`} className="break-words">
                        {detail}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {sheetPickerOpen ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">选择工作表</h3>
            <p className="py-2 text-sm opacity-80">请选择要导入的工作表，选中后会自动刷新预览。</p>
            <div className="flex flex-col gap-2">
              {sheetNames.map((name) => (
                <button key={name} type="button" className="btn btn-outline" onClick={() => onSelectSheet(name)}>
                  {name}
                </button>
              ))}
            </div>
            <div className="modal-action">
              <button type="button" className="btn" onClick={() => setSheetPickerOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmImportWithoutPreviewOpen ? (
        <div
          className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setConfirmImportWithoutPreviewOpen(false);
            }
          }}
        >
          <div className="w-full max-w-xl rounded-2xl border border-base-300/80 bg-base-100/95 p-6 shadow-2xl backdrop-blur">
            <h3 className="text-lg font-bold">尚未预览，确认直接导入？</h3>
            <p className="mt-2 text-sm opacity-80">
              你还没有点击“预览导入结果”。建议先预览再导入，以检查重复嫌疑、注释和合并策略。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmImportWithoutPreviewOpen(false)}
                disabled={isImportingTextCsv}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onConfirmImportWithoutPreview}
                disabled={isImportingTextCsv}
              >
                {isImportingTextCsv ? "导入中..." : "仍然导入"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmImportWithoutSourceOpen ? (
        <div
          className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setConfirmImportWithoutSourceOpen(false);
            }
          }}
        >
          <div className="w-full max-w-xl rounded-2xl border border-base-300/80 bg-base-100/95 p-6 shadow-2xl backdrop-blur">
            <h3 className="text-lg font-bold">Source 为空，确认继续导入？</h3>
            <p className="mt-2 text-sm opacity-80">
              当前导入将不会带统一 source 标记，后续按 source 筛选/删除会更困难。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmImportWithoutSourceOpen(false)}
                disabled={isImportingTextCsv}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onConfirmImportWithoutSource}
                disabled={isImportingTextCsv}
              >
                {isImportingTextCsv ? "导入中..." : "继续导入"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {clearDatabaseConfirmOpen ? (
        <div
          className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeClearDatabaseConfirm();
            }
          }}
        >
          <div className="w-full max-w-xl rounded-2xl border border-error/35 bg-base-100/95 p-6 shadow-2xl backdrop-blur">
            <h3 className="text-lg font-bold text-error">确认清空数据库？</h3>
            <p className="mt-2 text-sm opacity-85">
              该操作会删除除 <code>settings</code> 外所有表数据，且无法恢复。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={closeClearDatabaseConfirm}
                disabled={isClearingDatabase}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={onConfirmClearDatabase}
                disabled={isClearingDatabase}
              >
                {isClearingDatabase ? "清空中..." : "确认清空"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDeleteSourceOpen ? (
        <div
          className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget && !isDeletingSourceData) {
              setConfirmDeleteSourceOpen(false);
            }
          }}
        >
          <div className="w-full max-w-xl rounded-2xl border border-base-300/80 bg-base-100/95 p-6 shadow-2xl backdrop-blur">
            <h3 className="text-lg font-bold text-error">确认删除 source 数据？</h3>
            <p className="mt-2 text-sm opacity-85">
              将删除 <code>{getDeleteSourceDisplayLabel(deleteSourceInput)}</code> 匹配的所有 benchmark_values 记录（不可恢复）。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmDeleteSourceOpen(false)}
                disabled={isDeletingSourceData}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={onConfirmDeleteSourceData}
                disabled={isDeletingSourceData}
              >
                {isDeletingSourceData ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        <div
          role="tablist"
          className="inline-flex w-full max-w-3xl flex-wrap items-center gap-1 rounded-2xl border border-base-300/70 bg-base-200/70 p-1.5 shadow-inner backdrop-blur"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "import"}
            className={tabClass("import")}
            onClick={() => setActiveTab("import")}
          >
            导入中心
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "entry"}
            className={tabClass("entry")}
            onClick={() => setActiveTab("entry")}
          >
            数据录入
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "rename"}
            className={tabClass("rename")}
            onClick={() => setActiveTab("rename")}
          >
            名称维护
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "merge"}
            className={tabClass("merge")}
            onClick={() => setActiveTab("merge")}
          >
            实体去重
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "settings"}
            className={tabClass("settings")}
            onClick={() => setActiveTab("settings")}
          >
            数据库设置
          </button>
        </div>

        {activeTab === "import" ? (
          <div className="grid grid-cols-1 gap-4">
            <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <FileSpreadsheet size={18} />
                XLSM / XLSX 导入
              </h3>
              <p className="mb-4 text-sm opacity-80">
                导入前会提示不合规值
              </p>

              <form onSubmit={onPreviewWorkbook} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-6">
                  <input
                    type="file"
                    className="file-input file-input-bordered w-full"
                    accept=".xlsm,.xlsx,.xls"
                    onChange={(e) => setWorkbookFile(e.target.files?.[0] ?? null)}
                    required
                  />
                </div>
                <div className="md:col-span-3">
                  <button type="submit" className="btn btn-primary w-full">
                    <FileSpreadsheet size={16} />
                    解析并预览
                  </button>
                </div>
                <div className="md:col-span-3">
                  <button
                    type="button"
                    className="btn btn-outline w-full"
                    onClick={() => setSheetPickerOpen(true)}
                    disabled={sheetNames.length <= 1}
                  >
                    选择工作表
                  </button>
                </div>
              </form>

              {previewMeta ? (
                <div className="alert alert-info mt-4">
                  <div>
                    <div>当前工作表：{selectedSheet || "-"}</div>
                    <div>
                      列识别：Benchmark = {previewMeta.benchmarkColumn}
                      {previewMeta.categoryColumn ? `，Category = ${previewMeta.categoryColumn}` : "，未检测到 Category"}
                    </div>
                    <div>
                      解析记录：{previewMeta.parsedCount}，警告：{previewMeta.warningCount}
                    </div>
                  </div>
                </div>
              ) : null}

              {previewMeta ? (
                <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[auto_auto_minmax(320px,1fr)] xl:items-center">
                  <label className="label cursor-pointer gap-2">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={allowWarningsImport}
                      onChange={(e) => setAllowWarningsImport(e.target.checked)}
                    />
                    <span className="label-text">忽略警告继续导入</span>
                  </label>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onImportWorkbook}
                    disabled={isImportingWorkbook}
                  >
                    <Upload size={16} />
                    {isImportingWorkbook ? "导入中..." : "导入当前工作表"}
                  </button>

                  {importStatus !== "idle" ? (
                    <div className="w-full xl:justify-self-end">
                      <progress
                        className={`progress w-full ${
                          importStatus === "error"
                            ? "progress-error"
                            : importStatus === "success"
                              ? "progress-success"
                              : "progress-primary"
                        }`}
                        value={importProgress}
                        max={100}
                      />
                      <div className="mt-1 text-xs opacity-80 xl:text-right">{importStatusText}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {previewWarnings.length > 0 ? (
                <div className="mt-4">
                  <h4 className="mb-2 flex items-center gap-2 font-semibold">
                    <ShieldAlert size={16} />
                    告警（最多 200 条）
                  </h4>
                  <div className="overflow-x-auto rounded-box border border-base-300">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Benchmark</th>
                          <th>Model</th>
                          <th>Raw</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewWarnings.map((warning, idx) => (
                          <tr key={`${warning.rowNumber}-${warning.modelName}-${idx}`}>
                            <td>{warning.rowNumber}</td>
                            <td>{warning.benchmarkName}</td>
                            <td>{warning.modelName}</td>
                            <td>{warning.rawValue}</td>
                            <td>{warning.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {previewRows.length > 0 ? (
                <div className="mt-4">
                  <h4 className="mb-2 flex items-center gap-2 font-semibold">
                    <Table2 size={16} />
                    预览数据
                  </h4>
                  <div className="overflow-x-auto rounded-box border border-base-300">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Category</th>
                          <th>Benchmark</th>
                          <th>Model</th>
                          <th>Raw</th>
                          <th>Num</th>
                          <th>Num2</th>
                          <th>Note</th>
                          <th>Valid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row) => (
                          <tr key={`${row.rowNumber}-${row.benchmarkName}-${row.modelName}-${row.rawValue}`}>
                            <td>{row.rowNumber}</td>
                            <td>{row.category || "-"}</td>
                            <td>{row.benchmarkName}</td>
                            <td>{row.modelName}</td>
                            <td>{row.rawValue}</td>
                            <td>{formatPreviewNumericValue(row.rawValue, row.valueNum, "first")}</td>
                            <td>{formatPreviewNumericValue(row.rawValue, row.valueNum2, "second")}</td>
                            <td>{row.valueNote ?? "-"}</td>
                            <td>{row.valid ? "✅" : "⚠️"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Upload size={18} />
                表格文本导入（CSV / TSV / 粘贴文本）
              </h3>
              <p className="mb-3 text-sm opacity-80">
                支持两种格式：
                ① 结构化 CSV（provider/model/benchmark/value...）；
                ② 矩阵文本（首行模型，首列 benchmark，如从表格直接复制粘贴）。
              </p>
              <form onSubmit={onImportCsv} className="space-y-3">
                <div className="space-y-1">
                  <input
                    className="input input-bordered w-full"
                    value={csvSource}
                    onChange={(e) => setCsvSource(e.target.value)}
                    placeholder="source（可选，指明该 benchmark 数据来源）"
                  />
                </div>
                <textarea
                  className="textarea textarea-bordered min-h-[180px] w-full"
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  required
                />
                <div className="mt-1 grid grid-cols-1 gap-3 xl:grid-cols-[auto_auto_minmax(320px,1fr)] xl:items-center">
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={onPreviewCsvImport}
                    disabled={isPreviewingTextImport || isImportingTextCsv}
                  >
                    {isPreviewingTextImport ? "预览中..." : "预览导入结果"}
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={isImportingTextCsv}>
                    {isImportingTextCsv ? "导入中..." : "执行导入"}
                  </button>
                  {textImportStatus !== "idle" ? (
                    <div className="w-full xl:justify-self-end">
                      <progress
                        className={`progress w-full ${
                          textImportStatus === "error"
                            ? "progress-error"
                            : textImportStatus === "success"
                              ? "progress-success"
                              : "progress-primary"
                        }`}
                        value={textImportProgress}
                        max={100}
                      />
                      <div className="mt-1 text-xs opacity-80 xl:text-right">{textImportStatusText}</div>
                    </div>
                  ) : null}
                </div>
              </form>

              {textImportPreviewMeta ? (
                <div className="alert alert-info mt-4">
                  <div>
                    <div>识别格式：{textImportPreviewMeta.format}</div>
                    <div>可导入：{textImportPreviewMeta.total} 条，跳过：{textImportPreviewMeta.skipped} 条</div>
                    {textImportDraftRows.length > 0 ? (
                      <div>
                        当前草稿：{finalizedTextImportRows.length} 条可提交，忽略/空值 {ignoredTextImportCount} 条
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {pairValueRows.length > 0 ? (
                <div className="mt-4 space-y-2 rounded-box border border-warning/40 bg-warning/5 p-3">
                  <h4 className="font-semibold">成对数值注释</h4>
                  {pairRowsMissingNoteCount > 0 ? (
                    <div className="text-sm text-warning">
                      检测到 {pairRowsMissingNoteCount} 条成对值暂未注释，可补充（允许留空）
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    {pairValueRows.map((item) => (
                      <div
                        key={`pair-note-${item.rowIndex}-${item.modelName}-${item.benchmarkName}`}
                        className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(280px,1fr)_minmax(220px,1fr)] lg:items-center"
                      >
                        <div className="text-xs opacity-80">
                          {item.benchmarkName} / {item.modelName} ：{item.first} / {item.second}
                        </div>
                        <input
                          className="input input-bordered input-sm"
                          list="pair-note-history-options"
                          value={item.note ?? ""}
                          onChange={(e) => onUpdateTextImportDraftNote(item.rowIndex, e.target.value)}
                          onBlur={(e) => onPairNoteInputBlur(item.rowIndex, item.benchmarkKey, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                  <datalist id="pair-note-history-options">
                    {pairNoteHistory.map((note) => (
                      <option key={`pair-note-history-${note}`} value={note} />
                    ))}
                  </datalist>
                </div>
              ) : null}

              {starValueRows.length > 0 ? (
                <div className="mt-4 space-y-2 rounded-box border border-warning/40 bg-warning/5 p-3">
                  <h4 className="font-semibold">星号数值注释补充</h4>
                  {starRowsMissingSupplementCount > 0 ? (
                    <div className="text-sm text-warning">
                      检测到 {starRowsMissingSupplementCount} 条含 `*` 数值建议补充注释（可留空）
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <input
                      className="input input-bordered input-sm w-full md:max-w-md"
                      value={globalStarSupplement}
                      onChange={(e) => setGlobalStarSupplement(e.target.value)}
                      placeholder="为全部 * 数值设置同一注释"
                    />
                    <button
                      type="button"
                      className="btn btn-outline btn-sm md:shrink-0"
                      onClick={onApplyGlobalStarSupplement}
                    >
                      应用到全部 *
                    </button>
                  </div>

                  <div className="space-y-2">
                    {starValueRows.map((item) => (
                      <div
                        key={`star-note-${item.rowIndex}-${item.modelName}-${item.benchmarkName}`}
                        className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(280px,1fr)_minmax(220px,1fr)] lg:items-center"
                      >
                        <div className="text-xs opacity-80">
                          {item.benchmarkName} / {item.modelName} ：{item.value}*
                        </div>
                        <input
                          className="input input-bordered input-sm"
                          value={item.supplement}
                          list="star-note-history-options"
                          onChange={(e) => onUpdateTextImportDraftStarSupplement(item.rowIndex, e.target.value)}
                          onBlur={(e) => onStarSupplementInputBlur(item.rowIndex, e.target.value)}
                          placeholder="可选补充注释"
                        />
                      </div>
                    ))}
                  </div>
                  <datalist id="star-note-history-options">
                    {starNoteHistory.map((note) => (
                      <option key={`star-note-history-${note}`} value={note} />
                    ))}
                  </datalist>
                </div>
              ) : null}

              {matrixPreview.rows.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <h4 className="font-semibold">矩阵预览（可编辑）</h4>
                  <div className="overflow-x-auto rounded-box border border-base-300 max-h-[420px]">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr>
                          <th className="w-[56px]">模态</th>
                          <th className="min-w-[240px]">
                            Benchmark
                            <span className="ml-1 text-[11px] opacity-70">
                              ({matrixPreviewHeaderCounts.benchmarkUniqueCount})
                            </span>
                          </th>
                          <th className="min-w-[120px]">
                            Type
                            <span className="ml-1 text-[11px] opacity-70">
                              ({matrixPreviewHeaderCounts.typeUniqueCount})
                            </span>
                          </th>
                          {matrixPreview.modelNames.map((modelName) => {
                            const modelWarning = modelWarningMap.get(modelName);
                            const modelCandidateTargetIds = Array.from(new Set([
                              ...(modelWarning?.candidateTargetIds ?? []),
                              ...(modelWarning?.suggestedTargetId ? [modelWarning.suggestedTargetId] : [])
                            ]));
                            const modelInputListId = `matrix-model-override-${toDomSafeId(modelName)}`;

                            return (
                              <th
                                key={`matrix-model-${modelName}`}
                                className={modelWarningSet.has(modelName) ? "bg-warning/20 text-warning-content" : ""}
                              >
                                <input
                                  className="input input-bordered input-xs w-full min-w-[120px]"
                                  list={modelCandidateTargetIds.length > 0 ? modelInputListId : undefined}
                                  value={matrixModelNameDrafts[modelName] ?? modelName}
                                  onChange={(e) => {
                                    const nextInput = e.target.value;
                                    const parsedTargetId = parseExplicitMergeEntityId(nextInput);
                                    if (parsedTargetId !== null && applyModelOverwriteByTargetId(modelName, parsedTargetId)) {
                                      return;
                                    }
                                    onMatrixModelNameInputChange(modelName, nextInput);
                                  }}
                                  onBlur={(e) => onMatrixModelNameInputBlur(modelName, e.target.value)}
                                />
                                {modelCandidateTargetIds.length > 0 ? (
                                  <datalist id={modelInputListId}>
                                    {modelCandidateTargetIds.map((targetId) => {
                                      const target = modelEntityOptions.find((item) => String(item.id) === String(targetId));
                                      if (!target) {
                                        return (
                                          <option
                                            key={`matrix-model-override-option-${modelName}-${targetId}`}
                                            value={`#${targetId} [${targetId}]`}
                                          />
                                        );
                                      }

                                      return (
                                        <option
                                          key={`matrix-model-override-option-${modelName}-${targetId}`}
                                          value={`${target.label} [${targetId}]`}
                                        />
                                      );
                                    })}
                                  </datalist>
                                ) : null}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {matrixPreview.rows.map((matrixRow) => {
                          const warning = benchmarkWarningMap.get(matrixRow.key);
                          const hasParenthesesHighlight = benchmarkParenthesesSet.has(matrixRow.key);
                          const rowModalities = normalizeModalityList(matrixRow.modalities);
                          const hasVisibleModality = rowModalities.some(
                            (modality) => normalizeModalityName(modality) !== "Text"
                          );
                          const isLowerBetter = !matrixRow.higherIsBetter;

                          return (
                            <tr key={matrixRow.key}>
                              <td>
                                <details className="dropdown dropdown-bottom" data-modality-dropdown="true">
                                  <summary className="btn btn-ghost btn-xs h-7 min-h-0 px-1">
                                    <div className="flex flex-wrap items-center gap-1">
                                      {hasVisibleModality
                                        ? rowModalities.map((modality, idx) =>
                                            renderModalityBadge(modality, `${matrixRow.key}-mod-${modality}-${idx}`)
                                          )
                                        : <span className="text-xs opacity-60">Text</span>}
                                    </div>
                                  </summary>
                                  <div className="dropdown-content z-[90] mt-1 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
                                    <div className="mb-1 text-[11px] opacity-75">选择模态</div>
                                    <div className="space-y-1">
                                      {MODALITY_OPTIONS.map((modality) => (
                                        <label
                                          key={`${matrixRow.key}-modality-option-${modality}`}
                                          className="label cursor-pointer justify-start gap-2 py-0.5"
                                        >
                                          <input
                                            type="checkbox"
                                            className="checkbox checkbox-xs"
                                            checked={rowModalities.includes(modality)}
                                            onChange={(e) =>
                                              onToggleMatrixBenchmarkModality(matrixRow.key, modality, e.target.checked)
                                            }
                                          />
                                          <span className="label-text text-xs">{modality}</span>
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                </details>
                              </td>
                              <th
                                className={`min-w-[240px] ${
                                  warning?.level === "danger"
                                    ? "bg-error/15 text-error"
                                    : warning?.level === "warn"
                                      ? "bg-warning/15 text-warning-content"
                                      : warning?.level === "info" || hasParenthesesHighlight
                                        ? "bg-info/15 text-info-content"
                                        : ""
                                }`}
                              >
                                <div className="space-y-1">
                                  {(() => {
                                    const benchmarkCandidateTargetIds = Array.from(new Set([
                                      ...(warning?.candidateTargetIds ?? []),
                                      ...(warning?.suggestedTargetId ? [warning.suggestedTargetId] : [])
                                    ]));
                                    const benchmarkCandidateOptions = benchmarkCandidateTargetIds.map((targetId) => {
                                      const target = benchmarkEntityOptions.find((item) => String(item.id) === String(targetId));
                                      return {
                                        targetId,
                                        label: target?.label ?? `#${targetId}`
                                      };
                                    });

                                    return (
                                      <>
                                        <div className="relative" data-matrix-benchmark-candidate-container="true">
                                          <input
                                            className="input input-bordered input-xs w-full"
                                            value={matrixBenchmarkNameDrafts[matrixRow.key] ?? matrixRow.benchmarkName}
                                            onFocus={() => {
                                              if (benchmarkCandidateOptions.length > 0) {
                                                setOpenMatrixBenchmarkCandidateFor(matrixRow.key);
                                              }
                                            }}
                                            onChange={(e) => {
                                              const nextInput = e.target.value;
                                              const parsedTargetId = parseExplicitMergeEntityId(nextInput);
                                              if (parsedTargetId !== null && applyBenchmarkOverwriteByTargetId(matrixRow.key, parsedTargetId)) {
                                                setOpenMatrixBenchmarkCandidateFor(null);
                                                return;
                                              }
                                              onMatrixBenchmarkNameInputChange(matrixRow.key, nextInput);
                                            }}
                                            onBlur={(e) => {
                                              onMatrixBenchmarkNameInputBlur(
                                                matrixRow.key,
                                                matrixRow.benchmarkName,
                                                e.target.value
                                              );
                                              setOpenMatrixBenchmarkCandidateFor((current) =>
                                                current === matrixRow.key ? null : current
                                              );
                                            }}
                                          />
                                          {benchmarkCandidateOptions.length > 0 && openMatrixBenchmarkCandidateFor === matrixRow.key ? (
                                            <div
                                              role="listbox"
                                              className="absolute left-0 right-0 top-full z-[95] mt-1 max-h-60 overflow-auto rounded-md border border-base-300 bg-base-100/95 p-1 shadow-xl backdrop-blur"
                                            >
                                              {benchmarkCandidateOptions.map((option) => (
                                                <div
                                                  key={`matrix-benchmark-override-option-${matrixRow.key}-${option.targetId}`}
                                                  role="option"
                                                  tabIndex={0}
                                                  className="cursor-pointer rounded-sm px-2 py-1 text-left text-xs leading-5 text-base-content hover:bg-base-200/90"
                                                  onMouseDown={(event) => {
                                                    event.preventDefault();
                                                    applyBenchmarkOverwriteByTargetId(matrixRow.key, option.targetId);
                                                    setOpenMatrixBenchmarkCandidateFor(null);
                                                  }}
                                                  onKeyDown={(event) => {
                                                    if (event.key !== "Enter" && event.key !== " ") {
                                                      return;
                                                    }
                                                    event.preventDefault();
                                                    applyBenchmarkOverwriteByTargetId(matrixRow.key, option.targetId);
                                                    setOpenMatrixBenchmarkCandidateFor(null);
                                                  }}
                                                >
                                                  {`${option.label} [${option.targetId}]`}
                                                </div>
                                              ))}
                                            </div>
                                          ) : null}
                                        </div>
                                      </>
                                    );
                                  })()}
                                </div>
                              </th>
                              <td className="whitespace-nowrap text-sm">
                                <div className="flex min-w-0 items-center gap-1">
                                  <input
                                    className="input input-bordered input-xs min-w-[90px] flex-1"
                                    value={matrixBenchmarkTypeDrafts[matrixRow.key] ?? matrixRow.benchmarkType}
                                    onChange={(e) => onMatrixBenchmarkTypeInputChange(matrixRow.key, e.target.value)}
                                    onBlur={(e) =>
                                      onMatrixBenchmarkTypeInputBlur(
                                        matrixRow.key,
                                        matrixRow.benchmarkType,
                                        e.target.value
                                      )
                                    }
                                  />
                                  <label className="inline-flex shrink-0 cursor-pointer items-center gap-0.5" title="以小为好">
                                    <input
                                      type="checkbox"
                                      className="checkbox checkbox-xs"
                                      checked={isLowerBetter}
                                      onChange={(e) =>
                                        onToggleMatrixBenchmarkLowerIsBetter(matrixRow.key, e.target.checked)
                                      }
                                    />
                                    {isLowerBetter ? <span className="text-xs opacity-80">↓</span> : null}
                                  </label>
                                </div>
                              </td>
                              {matrixPreview.modelNames.map((modelName) => {
                                const rowIndex = matrixRow.cellRowIndexByModel[modelName];
                                const normalizedHint =
                                  rowIndex === undefined
                                    ? null
                                    : getOmniDocBenchNormalizeHint(
                                        matrixRow.benchmarkName,
                                        textImportDraftRows[rowIndex]?.rawValue ?? ""
                                      );
                                const noteText =
                                  rowIndex === undefined
                                    ? ""
                                    : (textImportDraftRows[rowIndex]?.valueNote?.trim() ?? "");

                                return (
                                  <td key={`${matrixRow.key}-${modelName}`}>
                                    {rowIndex === undefined ? (
                                      <span className="opacity-40">-</span>
                                    ) : (
                                      <div className="space-y-1">
                                        <div className="relative">
                                          <input
                                            className="input input-bordered input-xs w-full min-w-[90px] pr-7"
                                            value={textImportDraftRows[rowIndex]?.rawValue ?? ""}
                                            onChange={(e) => onUpdateTextImportDraftValue(rowIndex, e.target.value)}
                                          />
                                          {noteText ? (
                                            <span
                                              className="pointer-events-auto absolute right-2 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border border-base-content/30 text-[10px] font-bold leading-none opacity-85"
                                              title={noteText}
                                            >
                                              ?
                                            </span>
                                          ) : null}
                                        </div>
                                        {normalizedHint ? (
                                          <div className="text-[10px] text-warning">入库校对 → {normalizedHint}</div>
                                        ) : null}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {benchmarkWarnings.length > 0 ? (
                <div className="mt-4 space-y-3">
                  <h4 className="font-semibold">重复嫌疑与快捷合并</h4>
                  <div className="space-y-3">
                    {benchmarkWarnings.map((warning) => {
                      const benchmarkCandidateTargetIds = Array.from(new Set([
                        ...warning.candidateTargetIds,
                        ...(warning.suggestedTargetId ? [warning.suggestedTargetId] : [])
                      ]));
                      const benchmarkMergeListId = `benchmark-merge-options-${toDomSafeId(warning.key)}`;

                      return (
                        <div
                          key={`warning-${warning.key}`}
                          className={`rounded-box border p-3 ${
                            warning.level === "danger"
                              ? "border-error/40 bg-error/5"
                              : warning.level === "warn"
                                ? "border-warning/40 bg-warning/5"
                                : "border-info/40 bg-info/5"
                          }`}
                        >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{warning.benchmarkName}</span>
                          <span className="text-xs opacity-70">[{warning.benchmarkType}]</span>
                          <span className="badge badge-sm">{warning.level}</span>
                        </div>
                        <ul className="mb-2 list-disc pl-5 text-sm opacity-85">
                          {warning.reasons.map((reason, idx) => (
                            <li key={`${warning.key}-reason-${idx}`}>{reason}</li>
                          ))}
                        </ul>
                        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(320px,1fr)_auto] lg:items-center">
                          <input
                            className="input input-bordered input-sm"
                            value={benchmarkMergeFilters[warning.key] ?? ""}
                            list={benchmarkMergeListId}
                            onChange={(e) => {
                              const nextInput = e.target.value;
                              const parsedTargetId = parseExplicitMergeEntityId(nextInput);

                              if (parsedTargetId !== null && applyBenchmarkOverwriteByTargetId(warning.key, parsedTargetId)) {
                                return;
                              }

                              setBenchmarkMergeFilters((prev) => ({
                                ...prev,
                                [warning.key]: nextInput
                              }));

                              setBenchmarkMergeTargets((prev) => ({
                                ...prev,
                                [warning.key]: parsedTargetId !== null ? String(parsedTargetId) : ""
                              }));
                            }}
                            placeholder="输入 benchmark 名称并选择候选（即时覆盖预览）"
                          />
                          <datalist id={benchmarkMergeListId}>
                            {benchmarkCandidateTargetIds.map((targetId) => {
                              const target = benchmarkEntityOptions.find((item) => item.id === targetId);
                              if (!target) return null;
                              return (
                                <option
                                  key={`warning-target-${warning.key}-${target.id}`}
                                  value={`${target.label} [${target.id}]`}
                                />
                              );
                            })}
                          </datalist>

                          <label className="label cursor-pointer justify-start gap-2">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-xs"
                              checked={Boolean(ignoredBenchmarkKeys[warning.key])}
                              onChange={(e) =>
                                setIgnoredBenchmarkKeys((prev) => ({
                                  ...prev,
                                  [warning.key]: e.target.checked
                                }))
                              }
                            />
                            <span className="label-text text-xs">忽略该 benchmark</span>
                          </label>
                        </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {benchmarksWithParentheses.length > 0 ? (
                <div className="mt-4 space-y-2 rounded-box border border-base-300 p-3">
                  <h4 className="font-semibold">Benchmark 括号处理（默认保留）</h4>
                  <div className="space-y-2">
                    {benchmarksWithParentheses.map((item) => {
                      const mode = parenthesesModes[item.key] ?? "keep";

                      return (
                        <div key={`paren-${item.key}`} className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(260px,1fr)_200px_minmax(220px,1fr)] lg:items-center">
                          <div className="text-sm">
                            <span className="font-medium">{item.benchmarkName}</span>
                            <span className="ml-1 opacity-70">({item.benchmarkType})</span>
                          </div>
                          <select
                            className="select select-bordered select-sm"
                            value={mode}
                            onChange={(e) =>
                              setParenthesesModes((prev) => ({
                                ...prev,
                                [item.key]: e.target.value as "keep" | "remove" | "custom"
                              }))
                            }
                          >
                            <option value="keep">保留括号（默认）</option>
                            <option value="remove">去掉括号内容</option>
                            <option value="custom">自定义名称</option>
                          </select>
                          {mode === "custom" ? (
                            <input
                              className="input input-bordered input-sm"
                              value={parenthesesCustomNames[item.key] ?? ""}
                              onChange={(e) =>
                                setParenthesesCustomNames((prev) => ({
                                  ...prev,
                                  [item.key]: e.target.value
                                }))
                              }
                              placeholder="输入自定义 benchmark 名称"
                            />
                          ) : (
                            <div className="text-xs opacity-70">当前模式：{mode === "remove" ? "去括号" : "保留"}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {modelWarnings.length > 0 ? (
                <div className="mt-4 space-y-3">
                  <h4 className="font-semibold">模型重名嫌疑与快捷合并</h4>
                  <div className="space-y-3">
                    {modelWarnings.map((warning) => {
                      const modelMergeListId = `model-merge-options-${toDomSafeId(warning.key)}`;

                      return (
                        <div
                          key={`model-warning-${warning.key}`}
                          className={`rounded-box border p-3 ${
                            warning.level === "danger"
                              ? "border-error/40 bg-error/5"
                              : warning.level === "warn"
                                ? "border-warning/40 bg-warning/5"
                                : "border-info/40 bg-info/5"
                          }`}
                        >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{warning.modelName}</span>
                          <span className="badge badge-sm">{warning.level}</span>
                        </div>
                        <ul className="mb-2 list-disc pl-5 text-sm opacity-85">
                          {warning.reasons.map((reason, idx) => (
                            <li key={`${warning.key}-model-reason-${idx}`}>{reason}</li>
                          ))}
                        </ul>
                        <div className="grid grid-cols-1 gap-2 lg:grid-cols-1 lg:items-center">
                          <input
                            className="input input-bordered input-sm"
                            value={modelMergeFilters[warning.key] ?? ""}
                            list={modelMergeListId}
                            onChange={(e) => {
                              const nextInput = e.target.value;
                              const parsedTargetId = parseExplicitMergeEntityId(nextInput);

                              if (parsedTargetId !== null && applyModelOverwriteByTargetId(warning.key, parsedTargetId)) {
                                return;
                              }

                              setModelMergeFilters((prev) => ({
                                ...prev,
                                [warning.key]: nextInput
                              }));

                              setModelMergeTargets((prev) => ({
                                ...prev,
                                [warning.key]: parsedTargetId !== null ? String(parsedTargetId) : ""
                              }));
                            }}
                            placeholder="输入 model 名称并选择候选（即时覆盖预览）"
                          />
                          <datalist id={modelMergeListId}>
                            {modelEntityOptions.map((option) => (
                              <option key={`model-warning-target-${warning.key}-${option.id}`} value={`${option.label} [${option.id}]`} />
                            ))}
                          </datalist>

                        </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {modelsWithParentheses.length > 0 ? (
                <div className="mt-4 space-y-2 rounded-box border border-base-300 p-3">
                  <h4 className="font-semibold">模型括号处理（默认保留）</h4>
                  <div className="space-y-2">
                    {modelsWithParentheses.map((modelName) => {
                      const mode = modelParenthesesModes[modelName] ?? "keep";

                      return (
                        <div key={`model-paren-${modelName}`} className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(260px,1fr)_200px_minmax(220px,1fr)] lg:items-center">
                          <div className="text-sm font-medium">{modelName}</div>
                          <select
                            className="select select-bordered select-sm"
                            value={mode}
                            onChange={(e) =>
                              setModelParenthesesModes((prev) => ({
                                ...prev,
                                [modelName]: e.target.value as "keep" | "remove" | "custom"
                              }))
                            }
                          >
                            <option value="keep">保留括号（默认）</option>
                            <option value="remove">去掉括号内容</option>
                            <option value="custom">自定义名称</option>
                          </select>
                          {mode === "custom" ? (
                            <input
                              className="input input-bordered input-sm"
                              value={modelParenthesesCustomNames[modelName] ?? ""}
                              onChange={(e) =>
                                setModelParenthesesCustomNames((prev) => ({
                                  ...prev,
                                  [modelName]: e.target.value
                                }))
                              }
                              placeholder="输入自定义 model 名称"
                            />
                          ) : (
                            <div className="text-xs opacity-70">当前模式：{mode === "remove" ? "去括号" : "保留"}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {textImportPreviewTableRows.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <h4 className="flex items-center justify-between gap-3 font-semibold">
                    <span>文本导入预览</span>
                    <span className="text-xs opacity-70">
                      已显示 {visibleResolvedTextImportPreviewRows.length} / {textImportPreviewTableRows.length}
                    </span>
                  </h4>
                  <div className="overflow-x-auto rounded-box border border-base-300 max-h-[420px]">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Provider</th>
                          <th>Model</th>
                          <th>Benchmark</th>
                          <th>Type</th>
                          <th>Raw</th>
                          <th>Num</th>
                          <th>Num2</th>
                          <th>Note</th>
                          <th>Source</th>
                          <th>Valid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleResolvedTextImportPreviewRows.map((row, idx) => {
                          const noteText = row.valueNote?.trim() ?? "";
                          const omniHint = getOmniDocBenchNormalizeHint(row.benchmarkName, row.rawValue);

                          return (
                            <tr key={`${row.rowNumber}-${row.modelName}-${row.benchmarkName}-${idx}`}>
                              <td>{row.rowNumber}</td>
                              <td>{row.providerName}</td>
                              <td>{row.modelName}</td>
                              <td>{row.benchmarkName}</td>
                              <td>{row.benchmarkType}</td>
                              <td>
                                <span className="inline-flex items-center gap-1">
                                  <span>{row.rawValue}</span>
                                  {noteText ? (
                                    <span
                                      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-base-content/30 text-[10px] font-bold leading-none opacity-85"
                                      title={noteText}
                                    >
                                      ?
                                    </span>
                                  ) : null}
                                </span>
                              </td>
                              <td>{formatPreviewNumericValue(row.rawValue, row.valueNum, "first")}</td>
                              <td>{formatPreviewNumericValue(row.rawValue, row.valueNum2, "second")}</td>
                              <td>{omniHint ? `入库校对 → ${omniHint}` : noteText || "-"}</td>
                              <td>{row.source ?? "-"}</td>
                              <td>{row.valid ? "✅" : "⚠️"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {visibleResolvedTextImportPreviewRows.length < textImportPreviewTableRows.length ? (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => setTextImportPreviewVisibleCount((prev) => prev + 200)}
                    >
                      加载更多（+200）
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {activeTab === "entry" ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <PlusCircle size={18} />
                新增 Provider
              </h3>
              <form onSubmit={onCreateProvider} className="space-y-3">
                <input
                  className="input input-bordered w-full"
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  placeholder="例如 OpenAI"
                  required
                />
                <button type="submit" className="btn btn-primary">保存 Provider</button>
              </form>
            </section>

            <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Database size={18} />
                新增 Model
              </h3>
              <form onSubmit={onCreateModel} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-4">
                  <select
                    className="select select-bordered w-full"
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value ? Number(e.target.value) : "")}
                    required
                  >
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.name}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-4">
                  <input
                    className="input input-bordered w-full"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="model name"
                    required
                  />
                </div>
                <div className="md:col-span-4">
                  <input
                    className="input input-bordered w-full"
                    value={modelAlias}
                    onChange={(e) => setModelAlias(e.target.value)}
                    placeholder="model alias (可选)"
                  />
                </div>
                <div className="md:col-span-12">
                  <input
                    className="input input-bordered w-full"
                    value={sourceModelId}
                    onChange={(e) => setSourceModelId(e.target.value)}
                    placeholder="source model id (可选)"
                  />
                </div>
                <div className="md:col-span-12">
                  <button type="submit" className="btn btn-primary">保存 Model</button>
                </div>
              </form>
            </section>

            <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Upload size={18} />
                新增 Benchmark
              </h3>
              <form onSubmit={onCreateBenchmark} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-4">
                  <input className="input input-bordered w-full" value={benchmarkName} onChange={(e) => setBenchmarkName(e.target.value)} placeholder="benchmark name" required />
                </div>
                <div className="md:col-span-4">
                  <input className="input input-bordered w-full" value={benchmarkType} onChange={(e) => setBenchmarkType(e.target.value)} placeholder="benchmark type" required />
                </div>
                <div className="md:col-span-4">
                  <input className="input input-bordered w-full" value={benchmarkUnit} onChange={(e) => setBenchmarkUnit(e.target.value)} placeholder="unit" required />
                </div>
                <div className="md:col-span-7">
                  <input className="input input-bordered w-full" value={modalities} onChange={(e) => setModalities(e.target.value)} placeholder="Text, Vision, Audio" />
                </div>
                <div className="md:col-span-5 flex items-center">
                  <label className="label cursor-pointer justify-start gap-2">
                    <input type="checkbox" className="checkbox checkbox-sm" checked={higherIsBetter} onChange={(e) => setHigherIsBetter(e.target.checked)} />
                    <span className="label-text">higher is better</span>
                  </label>
                </div>
                <div className="md:col-span-12">
                  <button type="submit" className="btn btn-primary">保存 Benchmark</button>
                </div>
              </form>
            </section>

            <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Table2 size={18} />
                新增 Benchmark 值
              </h3>
              <form onSubmit={onCreateValue} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-6">
                  <select className="select select-bordered w-full" value={valueModelId} onChange={(e) => setValueModelId(e.target.value ? Number(e.target.value) : "")} required>
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>{model.modelName}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-6">
                  <select className="select select-bordered w-full" value={valueBenchmarkId} onChange={(e) => setValueBenchmarkId(e.target.value ? Number(e.target.value) : "")} required>
                    {benchmarks.map((benchmark) => (
                      <option key={benchmark.id} value={benchmark.id}>{benchmark.benchmarkName} ({benchmark.benchmarkType})</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-4">
                  <input type="datetime-local" className="input input-bordered w-full" value={benchTime} onChange={(e) => setBenchTime(e.target.value)} required />
                </div>
                <div className="md:col-span-4">
                  <input className="input input-bordered w-full" value={valueRaw} onChange={(e) => setValueRaw(e.target.value)} placeholder="value raw, e.g. 31.5*" required />
                </div>
                <div className="md:col-span-4">
                  <input className="input input-bordered w-full" value={valueSource} onChange={(e) => setValueSource(e.target.value)} placeholder="source (optional)" />
                </div>
                <div className="md:col-span-12">
                  <button type="submit" className="btn btn-primary">保存记录</button>
                </div>
              </form>
            </section>
          </div>
        ) : null}

        {activeTab === "rename" ? (
          <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <Search size={18} />
              实体名称维护
            </h3>
            <p className="mb-3 text-sm opacity-80">
              支持搜索并更改已有 model / benchmark 名称。若命中重名冲突，可自动合并并保留当前选中实体。
            </p>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-3">
                <select
                  className="select select-bordered w-full"
                  value={renameEntityType}
                  onChange={(event) => setRenameEntityType(event.target.value as "model" | "benchmark")}
                >
                  <option value="model">model</option>
                  <option value="benchmark">benchmark</option>
                </select>
              </div>
              <div className="md:col-span-9">
                <input
                  className="input input-bordered w-full"
                  value={renameSearchKeyword}
                  onChange={(event) => setRenameSearchKeyword(event.target.value)}
                  placeholder="输入名称或 ID 关键字搜索实体"
                />
              </div>
              <div className="md:col-span-12 text-xs opacity-70">
                匹配 {filteredRenameEntityOptions.length} 条（虚拟列表渲染）
              </div>
            </div>

            {filteredRenameEntityOptions.length > 0 ? (
              <div className="mt-3 rounded-box border border-base-300">
                <div className="grid grid-cols-[80px_minmax(0,1fr)_180px] border-b border-base-300 bg-base-100/60 px-1 py-2 text-xs font-semibold">
                  <span className="px-2">ID</span>
                  <span className="px-2">名称</span>
                  <span className="px-2">{renameEntityType === "model" ? "Provider" : "Type"}</span>
                </div>
                <div
                  ref={renameListViewportRef}
                  className="overflow-auto"
                  style={{ height: `${RENAME_LIST_VIEWPORT_HEIGHT}px` }}
                  onScroll={(event) => setRenameListScrollTop(event.currentTarget.scrollTop)}
                >
                  <div className="relative" style={{ height: `${renameListSpacerHeight}px` }}>
                    {visibleRenameEntityOptions.map((item, visibleIndex) => {
                      const index = renameVirtualWindow.start + visibleIndex;
                      const top = index * RENAME_LIST_ROW_HEIGHT;
                      const isSelected = renameSelectedEntityId === item.id;
                      const detailText = renameEntityType === "model"
                        ? (() => {
                            const model = modelById.get(item.id);
                            if (!model) return "-";
                            return providerById.get(model.providerId)?.name ?? "-";
                          })()
                        : (benchmarkById.get(item.id)?.benchmarkType ?? "-");

                      return (
                        <div
                          key={`rename-entity-${renameEntityType}-${item.id}`}
                          role="button"
                          tabIndex={0}
                          className={`absolute left-0 right-0 grid cursor-pointer grid-cols-[80px_minmax(0,1fr)_180px] items-center border-b border-base-300/50 px-1 text-left transition-colors ${
                            isSelected
                              ? "bg-base-200/55 text-base-content border-l-2 border-base-content/25"
                              : "bg-transparent hover:bg-base-200/35"
                          }`}
                          style={{
                            top: `${top}px`,
                            height: `${RENAME_LIST_ROW_HEIGHT}px`
                          }}
                          onClick={() => onPickRenameEntity(item.id)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            onPickRenameEntity(item.id);
                          }}
                        >
                          <span className="truncate px-2 text-xs opacity-80">{item.id}</span>
                          <span className="truncate px-2 text-sm">{item.label}</span>
                          <span className="truncate px-2 text-xs opacity-80">{detailText}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm opacity-70">未匹配到实体，请调整关键词。</p>
            )}

            <form onSubmit={onRenameEntity} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-4">
                <div className="mb-1 text-xs opacity-70">当前实体</div>
                <input
                  className="input input-bordered w-full"
                  value={renameSelectedEntityLabel}
                  readOnly
                  placeholder="请先在上方列表选中实体"
                />
              </div>
              <div className="md:col-span-5">
                <div className="mb-1 text-xs opacity-70">新名称</div>
                <input
                  className="input input-bordered w-full"
                  value={renameNextName}
                  onChange={(event) => setRenameNextName(event.target.value)}
                  placeholder={renameEntityType === "model" ? "输入新的 model 名称" : "输入新的 benchmark 名称"}
                  required
                />
              </div>
              <div className="md:col-span-3 flex items-end">
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={renameMergeOnConflict}
                    onChange={(event) => setRenameMergeOnConflict(event.target.checked)}
                  />
                  <span className="label-text text-xs">重名时自动合并</span>
                </label>
              </div>
              <div className="md:col-span-12 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className={`btn ${renameSubmitState === "success" ? "btn-success" : "btn-primary"}`}
                  disabled={renameSubmitState === "submitting" || renameSelectedEntityId === null}
                >
                  {renameSubmitState === "submitting"
                    ? "提交中..."
                    : renameSubmitState === "success"
                      ? "已提交"
                      : "保存名称变更"}
                </button>
                <span className="text-xs opacity-70">
                  自动合并开启时：若命中重名冲突，会把冲突实体并入当前选中实体后再完成改名。
                </span>
              </div>
            </form>
          </section>
        ) : null}

        {activeTab === "merge" ? (
          <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <MergeIcon size={18} />
              实体合并（去重）
            </h3>
            <div className="mb-5 rounded-2xl border border-primary/25 bg-gradient-to-br from-base-200/45 via-base-100/30 to-base-100/70 p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="flex items-center gap-2 text-base font-semibold">
                  <Sparkles size={16} className="text-primary" />
                  重复候选检测
                </h4>
                <button
                  type="button"
                  className="btn btn-sm btn-primary ml-auto"
                  onClick={onDetectDuplicateCandidates}
                  disabled={isDetectingDuplicates}
                >
                  <Search size={14} />
                  {isDetectingDuplicates ? "检测中..." : "检测重复候选"}
                </button>
              </div>

              <p className="mt-2 text-xs opacity-75">
                模型：去噪词（如 high/reasoning）+ 字符重复匹配度；Benchmark：名称归一化 + 字符重复匹配度（不依赖模型重合度）。
              </p>

              {duplicateDetectionResult ? (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs opacity-80">
                    <span className="opacity-70">生成时间：{new Date(duplicateDetectionResult.generatedAt).toLocaleString()}</span>
                  </div>

                  <div className="tabs tabs-boxed inline-flex bg-base-200/70 p-1">
                    <button
                      type="button"
                      className={`tab ${duplicateDetectionEntityType === "model" ? "tab-active" : ""}`}
                      onClick={() => setDuplicateDetectionEntityType("model")}
                    >
                      {`Model 候选（${duplicateDetectionResult.modelCandidates.length}）`}
                    </button>
                    <button
                      type="button"
                      className={`tab ${duplicateDetectionEntityType === "benchmark" ? "tab-active" : ""}`}
                      onClick={() => setDuplicateDetectionEntityType("benchmark")}
                    >
                      {`Benchmark 候选（${duplicateDetectionResult.benchmarkCandidates.length}）`}
                    </button>
                  </div>

                  <div className="inline-flex items-center gap-1 rounded-lg border border-base-300/70 bg-base-100/60 p-1 text-xs">
                    <button
                      type="button"
                      className={`btn btn-xs ${duplicateConfidenceFilter === "high-medium" ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => setDuplicateConfidenceFilter("high-medium")}
                    >
                      仅高/中置信
                    </button>
                    <button
                      type="button"
                      className={`btn btn-xs ${duplicateConfidenceFilter === "all" ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => setDuplicateConfidenceFilter("all")}
                    >
                      显示全部
                    </button>
                  </div>

                  {duplicateDetectionEntityType === "model" ? (
                    visibleModelDuplicateCandidates.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-base-300 p-3 text-sm opacity-70">
                        当前筛选条件下未检测到 model 重复候选。
                      </div>
                    ) : (
                      <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                        {visibleModelDuplicateCandidates.map((candidate) => (
                          <div
                            key={`dup-model-${candidate.sourceId}-${candidate.targetId}`}
                            className={`rounded-xl border p-3 shadow-sm ${duplicateCandidateCardClass(candidate.confidence)}`}
                          >
                            <div className="flex flex-wrap items-start gap-2">
                              <span className="font-semibold">
                                {candidate.sourceName} [{candidate.sourceId}] → {candidate.targetName} [{candidate.targetId}]
                              </span>
                              <span className={`badge badge-sm font-semibold ${duplicateConfidenceBadgeClass(candidate.confidence)}`}>
                                {duplicateConfidenceLabel(candidate.confidence)}
                              </span>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline ml-auto"
                                onClick={() => applyModelDuplicateCandidate(candidate)}
                              >
                                填充到合并表单
                              </button>
                            </div>

                            <div className="mt-1 text-xs opacity-80">
                              {/* 提供方：{candidate.sourceProviderName} → {candidate.targetProviderName} */}
                              记录数：{candidate.sourceValueCount} → {candidate.targetValueCount}
                              ・相似度 {(candidate.similarity * 100).toFixed(1)}%
                              ・字符重复 {(candidate.characterRepeatScore * 100).toFixed(1)}%
                            </div>

                            <div className="mt-2 flex flex-wrap gap-1">
                              {candidate.reasons.map((reason) => (
                                <span
                                  key={`dup-model-reason-${candidate.sourceId}-${candidate.targetId}-${reason}`}
                                  className="badge badge-outline badge-xs"
                                >
                                  {duplicateReasonLabel(reason)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    visibleBenchmarkDuplicateCandidates.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-base-300 p-3 text-sm opacity-70">
                        当前筛选条件下未检测到 benchmark 重复候选。
                      </div>
                    ) : (
                      <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                        {visibleBenchmarkDuplicateCandidates.map((candidate) => (
                          <div
                            key={`dup-benchmark-${candidate.sourceId}-${candidate.targetId}`}
                            className={`rounded-xl border p-3 shadow-sm ${duplicateCandidateCardClass(candidate.confidence)}`}
                          >
                            <div className="flex flex-wrap items-start gap-2">
                              <span className="font-semibold">
                                {candidate.sourceName} [{candidate.sourceType}] → {candidate.targetName} [{candidate.targetType}]
                              </span>
                              <span className={`badge badge-sm font-semibold ${duplicateConfidenceBadgeClass(candidate.confidence)}`}>
                                {duplicateConfidenceLabel(candidate.confidence)}
                              </span>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline ml-auto"
                                onClick={() => applyBenchmarkDuplicateCandidate(candidate)}
                              >
                                填充到合并表单
                              </button>
                            </div>

                            <div className="mt-1 text-xs opacity-80">
                              记录数：{candidate.sourceValueCount} → {candidate.targetValueCount}
                              ・相似度 {(candidate.similarity * 100).toFixed(1)}%
                              ・字符重复 {(candidate.characterRepeatScore * 100).toFixed(1)}%
                              {candidate.sourceSourceSummary || candidate.targetSourceSummary
                                ? `・Source ${candidate.sourceSourceSummary ?? "空 source"} → ${candidate.targetSourceSummary ?? "空 source"}`
                                : ""}
                            </div>

                            <div className="mt-2 flex flex-wrap gap-1">
                              {candidate.reasons.map((reason) => (
                                <span
                                  key={`dup-benchmark-reason-${candidate.sourceId}-${candidate.targetId}-${reason}`}
                                  className="badge badge-outline badge-xs"
                                >
                                  {duplicateReasonLabel(reason)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-base-300 p-3 text-sm opacity-75">
                  点击“检测重复候选”后，会列出可疑的 model / benchmark，并支持一键填充到下方合并表单。
                </div>
              )}
            </div>

            <form onSubmit={onMerge} className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-4">
                <select
                  className="select select-bordered w-full"
                  value={mergeType}
                  onChange={(e) => {
                    setMergeType(e.target.value as "model" | "benchmark");
                    setMergeSourceInput("");
                    setMergeTargetInput("");
                    setMergeTargetBenchmarkNameInput("");
                  }}
                >
                  <option value="model">model</option>
                  <option value="benchmark">benchmark</option>
                </select>
              </div>
              <div className="md:col-span-4">
                <input
                  list={`merge-options-${mergeType}`}
                  className="input input-bordered w-full"
                  value={mergeSourceInput}
                  onChange={(e) => setMergeSourceInput(e.target.value)}
                  placeholder="source：输入名称或ID"
                  required
                />
              </div>
              <div className="md:col-span-4">
                <input
                  list={`merge-options-${mergeType}`}
                  className="input input-bordered w-full"
                  value={mergeTargetInput}
                  onChange={(e) => setMergeTargetInput(e.target.value)}
                  placeholder="target：输入名称或ID"
                  required
                />
                <datalist id={`merge-options-${mergeType}`}>
                  {mergeEntityOptions.map((item) => (
                    <option key={`${mergeType}-${item.id}`} value={`${item.label} [${item.id}]`} />
                  ))}
                </datalist>
              </div>
              <div className="md:col-span-12 text-xs opacity-75">
                解析结果：source = {resolvedMergeSourceId ?? "-"}，target = {resolvedMergeTargetId ?? "-"}
              </div>
              {mergeType === "benchmark" ? (
                <div className="md:col-span-8">
                  <input
                    className="input input-bordered w-full"
                    value={mergeTargetBenchmarkNameInput}
                    onChange={(e) => setMergeTargetBenchmarkNameInput(e.target.value)}
                    placeholder="可选：合并时同时修改 target benchmark 显示名称"
                  />
                </div>
              ) : null}
              <div className={mergeType === "benchmark" ? "md:col-span-4" : "md:col-span-12"}>
                <button
                  ref={mergeSubmitButtonRef}
                  type="submit"
                  className={`btn ${mergeSubmitState === "success" ? "btn-success" : "btn-error"}`}
                  disabled={!canSubmitMerge}
                  style={{ scrollMarginBottom: "72px" }}
                >
                  {mergeSubmitState === "submitting"
                    ? "合并中..."
                    : mergeSubmitState === "success"
                      ? "已合并"
                      : "合并实体"}
                </button>
              </div>
            </form>

            <h4 className="mt-6 mb-2 font-semibold">已有合并去重记录</h4>
            {mergedRecordList.length === 0 ? (
              <p className="text-sm opacity-70">暂无已合并记录</p>
            ) : (
              <div className="overflow-x-auto rounded-box border border-base-300">
                <table className="table table-zebra table-sm">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Source</th>
                      <th>Target（可编辑）</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mergedRecordList.map((record) => {
                      const recordKey = `${record.entityType}:${record.sourceId}`;
                      const inputValue = mergedRecordTargetInputs[recordKey] ?? `${record.targetName} [${record.targetId}]`;

                      return (
                        <tr key={recordKey}>
                          <td>{record.entityType}</td>
                          <td>{record.sourceName} [{record.sourceId}]</td>
                          <td>
                            <input
                              list={`merge-edit-options-${record.entityType}`}
                              className="input input-bordered input-sm w-full min-w-[300px]"
                              value={inputValue}
                              onChange={(e) =>
                                setMergedRecordTargetInputs((prev) => ({
                                  ...prev,
                                  [recordKey]: e.target.value
                                }))
                              }
                              placeholder="输入名称或ID"
                            />
                          </td>
                          <td>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="btn btn-xs btn-outline"
                                onClick={() => onUpdateMergedRecord(record)}
                              >
                                保存修改
                              </button>
                              <button
                                type="button"
                                className="btn btn-xs btn-outline btn-error"
                                onClick={() => onDeleteMergedRecord(record)}
                              >
                                删除记录
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <datalist id="merge-edit-options-model">
              {modelEntityOptions.map((item) => (
                <option key={`merge-edit-model-${item.id}`} value={`${item.label} [${item.id}]`} />
              ))}
            </datalist>
            <datalist id="merge-edit-options-benchmark">
              {benchmarkEntityOptions.map((item) => (
                <option key={`merge-edit-benchmark-${item.id}`} value={`${item.label} [${item.id}]`} />
              ))}
            </datalist>
          </section>
        ) : null}

        {activeTab === "settings" ? (
          <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <Settings2 size={18} />
              Settings
            </h3>

            <div className="mb-5 rounded-box border border-base-300 bg-base-200/50 p-4">
              <h4 className="mb-2 font-semibold">模型重复识别规则</h4>
              <p className="mb-3 text-sm opacity-80">
                当前默认：小写 + 去掉 `-`、空格、`.` 后比较模型名；若归一化结果相同，则判定为同一模型。
              </p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={modelDedupeRule.lowercase}
                    onChange={(e) =>
                      setModelDedupeRule((prev) => ({ ...prev, lowercase: e.target.checked }))
                    }
                  />
                  <span className="label-text">转为小写</span>
                </label>
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={modelDedupeRule.removeHyphen}
                    onChange={(e) =>
                      setModelDedupeRule((prev) => ({ ...prev, removeHyphen: e.target.checked }))
                    }
                  />
                  <span className="label-text">移除连字符 -</span>
                </label>
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={modelDedupeRule.removeSpace}
                    onChange={(e) =>
                      setModelDedupeRule((prev) => ({ ...prev, removeSpace: e.target.checked }))
                    }
                  />
                  <span className="label-text">移除空格</span>
                </label>
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={modelDedupeRule.removeDot}
                    onChange={(e) =>
                      setModelDedupeRule((prev) => ({ ...prev, removeDot: e.target.checked }))
                    }
                  />
                  <span className="label-text">移除小数点 .</span>
                </label>
              </div>
              <div className="mt-3">
                <button type="button" className="btn btn-primary" onClick={onSaveModelDedupeRule}>
                  保存模型规则
                </button>
              </div>
            </div>

            <div className="mb-5 rounded-box border border-error/40 bg-base-200/50 p-4">
              <h4 className="mb-2 font-semibold text-error">删除单个模型</h4>
              <p className="mb-3 text-sm opacity-80">
                会删除该模型记录与其所有 benchmark_values（不可恢复）。
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(420px,1fr)_auto] md:items-center">
                <input
                  className="input input-bordered w-full"
                  list="delete-model-options"
                  value={deleteModelInput}
                  onChange={(e) => setDeleteModelInput(e.target.value)}
                  placeholder="输入模型名或ID后选择候选"
                />
                <datalist id="delete-model-options">
                  {modelEntityOptions.map((item) => (
                    <option key={`delete-model-${item.id}`} value={`${item.label} [${item.id}]`} />
                  ))}
                </datalist>
                <button type="button" className="btn btn-outline btn-error" onClick={onDeleteModelData}>
                  删除模型及数据
                </button>
              </div>
            </div>

            <div className="mb-5 rounded-box border border-error/40 bg-base-200/50 p-4">
              <h4 className="mb-2 font-semibold text-error">删除 source</h4>
              <p className="mb-3 text-sm opacity-80">
                会删除 benchmark_values 中该 source 对应的所有记录（不可恢复）。输入 llm-benchmark 会按 text:llm-benchmark 删除；留空可删除 source 为空（NULL/空字符串）的记录。
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(420px,1fr)_auto] md:items-center">
                <input
                  className="input input-bordered w-full"
                  list="delete-source-options"
                  value={deleteSourceInput}
                  onChange={(e) => setDeleteSourceInput(e.target.value)}
                  placeholder="输入 source（留空表示删除空 source）"
                />
                <datalist id="delete-source-options">
                  {deleteSourceOptions.map((item) => (
                    <option key={`delete-source-${item}`} value={item} />
                  ))}
                </datalist>
                <button type="button" className="btn btn-outline btn-error" onClick={onDeleteSourceData}>
                  删除 source 数据
                </button>
              </div>
            </div>

            <form onSubmit={onSaveSetting} className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-3">
                <input className="input input-bordered w-full" value={settingKey} onChange={(e) => setSettingKey(e.target.value)} placeholder="key" required />
              </div>
              <div className="md:col-span-6">
                <textarea className="textarea textarea-bordered min-h-[120px] w-full" value={settingValue} onChange={(e) => setSettingValue(e.target.value)} required />
              </div>
              <div className="md:col-span-3 space-y-3">
                <input className="input input-bordered w-full" value={settingNote} onChange={(e) => setSettingNote(e.target.value)} placeholder="note (optional)" />
                <button type="submit" className="btn btn-primary w-full">保存 Setting</button>
                <button type="button" className="btn btn-outline btn-error w-full" onClick={onClearDatabase}>
                  清空数据库（保留 settings）
                </button>
              </div>
            </form>

            <h4 className="mt-6 mb-2 font-semibold">当前 settings（初始快照）</h4>
            {sortedSettings.length === 0 ? (
              <p className="text-sm opacity-70">暂无 settings 记录</p>
            ) : (
              <div className="overflow-x-auto rounded-box border border-base-300">
                <table className="table table-zebra table-sm">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSettings.map(([key, value]) => (
                      <tr key={key}>
                        <td>{key}</td>
                        <td>
                          <pre className="m-0 whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
