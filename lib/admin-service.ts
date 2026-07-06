import { parse } from "csv-parse/sync";
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  buildBenchmarkCanonicalKey,
  buildModelCanonicalKey,
  type ModelDedupeRule,
  normalizeModelDedupeRule,
  toProviderSlug
} from "@/lib/db/normalize";
import { parseBenchmarkValue, type ParsedBenchmarkValue } from "@/lib/db/parse-value";
import { IMPORT_VALUE_RANK_PREFIX_REGEX, IMPORT_VALUE_SINGLE_REGEX } from "@/lib/import/value-patterns";
import { composeImportPairValueRaw, parseImportPairValue } from "@/lib/import/pair-value";
import type { ParsedImportRecord } from "@/lib/import/xlsm";
import { benchmarkSourceMeta, benchmarkValues, benchmarks, models, providers, settings } from "@/lib/db/schema";
import type { ProviderConfig } from "@/lib/db/schema";
import { invalidateAllCaches, registerCacheInvalidator } from "@/lib/db/queries";
import { createVersionedCacheStore, withVersionedCache, invalidateVersionedCacheStore } from "@/lib/server-cache";
import { getCacheVersion } from "@/lib/cache-versions";
import { isValidHexColor, normalizeProviderConfig, normalizeProviderConfigPrefix } from "@/lib/provider-config";

type EnsureBenchmarkInput = {
  benchmarkName: string;
  benchmarkType: string;
  unit?: string;
  higherIsBetter?: boolean;
  modalities?: string[];
  sourceBenchmarkId?: string | null;
};

type NormalizedTextImportRow = {
  rowNumber: number;
  providerName: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  benchmarkTypeProvided: boolean;
  valueRaw: string;
  valueNote: string | null;
  benchTime: Date;
  unit: string;
  higherIsBetter: boolean;
  modalities: string[];
  source: string | null;
  modelAlias?: string | null;
  sourceModelId?: string | null;
  sourceBenchmarkId?: string | null;
};

export type StructuredImportRowInput = {
  rowNumber?: number;
  providerName?: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType?: string;
  benchmarkTypeProvided?: boolean;
  higherIsBetter?: boolean;
  modalities?: string[];
  rawValue: string;
  valueNote?: string | null;
  source?: string | null;
  unit?: string;
  benchTime?: string | Date;
  modelAlias?: string | null;
  sourceModelId?: string | null;
  sourceBenchmarkId?: string | null;
};

type ParsedTextImportFormat = "structured-csv" | "matrix-table" | "paper-table";

type ParsedTextImportResult = {
  format: ParsedTextImportFormat;
  rows: NormalizedTextImportRow[];
  skipped: number;
  confidence?: number;
  parseSource?: "text" | "html";
  warnings?: TextParseWarning[];
};

type TextParseWarning = {
  type: "unsupported-special-symbol";
  rowNumber: number;
  modelName: string;
  benchmarkName: string;
  field: "benchmark" | "value";
  before: string;
  after: string;
  symbols: string[];
  reason: string;
};

/** Structural type covering the Drizzle methods used by entity-ensure helpers. */
type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;
type ProviderConfigTx = Pick<DbTransactionClient, "execute" | "select" | "update">;
type ProviderDeleteTx = Pick<DbTransactionClient, "execute" | "select" | "update" | "delete">;
type ProviderConfigTransactionExecutor = {
  transaction<T>(callback: (tx: ProviderConfigTx) => Promise<T>): Promise<T>;
};
type ProviderDeleteTransactionExecutor = {
  transaction<T>(callback: (tx: ProviderDeleteTx) => Promise<T>): Promise<T>;
};
type DbTransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

const EMPTY_VALUE_MARKERS = new Set(["", "-", "--", "—", "na", "n/a", "null", "none"]);
const HTML_TABLE_TAG_REGEX = /<table[\s>]/i;
const LOWER_IS_BETTER_BENCHMARK_RULES = [/omnidocbench\s*1\.5/i, /\b(?:r?mse)\b/i];
const LOWER_IS_BETTER_ASR_TYPE_REGEX = /\basr\b/i;
const OMNIDOCBENCH_15_MATCHER = /omnidocbench\s*1\.5/i;
const MULTIMODAL_HINT_PATTERN = /(\bmultimodal(?:ity)?\b|\bmulti[\s-_]?modal(?:ity)?\b|多模态)/i;
const PAPER_TABLE_VALUE_TOKEN_REGEX = /^(?:[#＃]\s*)?(?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[%％])?(?:[*^][0-9A-Za-z]*)?$/;
const PAPER_HEADER_CONTINUATION_TOKENS = new Set([
  "high",
  "low",
  "pro",
  "plus",
  "max",
  "mini",
  "nano",
  "ultra",
  "super",
  "turbo",
  "flash",
  "lite",
  "thinking",
  "think",
  "no",
  "preview",
  "exp",
  "experimental",
  "default"
]);
const PAPER_MODALITY_HINT_TOKENS = new Set([
  "text",
  "vision",
  "vlm",
  "audio",
  "video",
  "multimodal",
  "multimodality",
  "multi",
  "modal",
  "视觉",
  "语音",
  "音频",
  "视频",
  "多模态",
  "文本"
]);
const PAPER_HEADER_NOISE_TOKENS = new Set([
  "evaluation",
  "evaluations",
  "model",
  "models",
  "other",
  "family",
  "families",
  "capability",
  "capabilities",
  "benchmark",
  "benchmarks",
  "category",
  "categories",
  "type",
  "types"
]);
const PAPER_MODEL_TAIL_PREFIX_TOKENS = new Set([
  "mythos",
  "fable",
  "opus",
  "sonnet",
  "haiku",
  "high",
  "low",
  "pro",
  "plus",
  "max",
  "mini",
  "nano",
  "ultra",
  "super",
  "turbo",
  "flash",
  "lite",
  "thinking",
  "think",
  "reasoning",
  "preview",
  "exp",
  "experimental",
  "default"
]);
const PAPER_HEADER_LABEL_REGEX = /\b(capability|benchmark|benchmarks|category|categories|type|types|model|models)\b/gi;
const UNSUPPORTED_SPECIAL_VALUE_SYMBOL_REGEX = /[‡†§¶※¤]/g;
const UNSUPPORTED_SPECIAL_VALUE_SYMBOL_TEST_REGEX = /[‡†§¶※¤]/;
const IMPORT_MULTI_VALUE_SEPARATOR_REGEX = /[|｜]/;

/**
 * 统一推断higherIsBetter值，优先级：方向标识 > #名次前缀 > 基准名称默认规则
 */
function getInferredHigherIsBetter(
  valueRaw: string,
  benchmarkDirection: { hadDirectionMarker: boolean; higherIsBetter: boolean },
  benchmarkName: string,
  currentBenchmarkType: string
): boolean {
  if (benchmarkDirection.hadDirectionMarker) {
    return benchmarkDirection.higherIsBetter;
  }
  if (IMPORT_VALUE_RANK_PREFIX_REGEX.test(valueRaw)) {
    return false;
  }
  return !isLowerBetterBenchmark(benchmarkName, currentBenchmarkType);
}

const MODEL_DUPLICATE_NOISE_TOKENS = new Set([
  "low",
  "medium",
  "high",
  "max",
  "reasoning",
  "reason",
  "thinking",
  "think",
  "preview",
  "exp",
  "experimental",
  "default"
]);
const BENCHMARK_DUPLICATE_VARIANT_NOISE_TOKENS = new Set([
  "max",
  "effort",
  "high",
  "low",
  "reasoning",
  "reason",
  "thinking",
  "think",
  "preview",
  "exp",
  "experimental",
  "default",
  "self",
  "reported",
  "selfreported",
  "best"
]);
const BENCHMARK_VARIANT_CONFLICT_HINTS: Array<[RegExp, RegExp]> = [
  [/with\s*tools?/i, /no\s*tools?/i],
  [/open\s*book/i, /closed\s*book/i],
  [/\b0\s*shot\b/i, /\b[1-9]\d*\s*shot\b/i]
];
const DUPLICATE_RESULT_LIMIT = 200;
const SUPERSCRIPT_SUBSCRIPT_DIGIT_MAP: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9"
};
const SUPERSCRIPT_SUBSCRIPT_DIGIT_REGEX = /[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/g;
const SCALE_NORMALIZED_NOTE_TO_ONE = "normalized-scale-to-1";
const SCALE_NORMALIZED_NOTE_TO_HUNDRED = "normalized-scale-to-100";
const HYPHEN_VARIANT_REGEX = /[\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const LATEX_INLINE_GREEK_MAP: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ϵ",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  omicron: "ο",
  pi: "π",
  rho: "ρ",
  varrho: "ϱ",
  sigma: "σ",
  varsigma: "ς",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "ϕ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  varpi: "ϖ",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω"
};

function isFleursZhTranslationBenchmark(benchmarkName: string): boolean {
  if (!/fleurs/i.test(benchmarkName)) return false;

  const normalized = benchmarkName
    .toLowerCase()
    .replace(/\s+/g, "");

  const hasBiDirectionalHint = /(?:⇄|↔|<->|<=>)/.test(normalized);

  return hasBiDirectionalHint;
}

function isLowerBetterBenchmark(benchmarkName: string, benchmarkType?: string): boolean {
  if (benchmarkType && LOWER_IS_BETTER_ASR_TYPE_REGEX.test(benchmarkType)) {
    return true;
  }

  if (/fleurs/i.test(benchmarkName)) {
    return !isFleursZhTranslationBenchmark(benchmarkName);
  }

  return LOWER_IS_BETTER_BENCHMARK_RULES.some((rule) => rule.test(benchmarkName));
}

function normalizeStoredBenchmarkValue(benchmarkName: string, parsed: ParsedBenchmarkValue): ParsedBenchmarkValue {
  if (!OMNIDOCBENCH_15_MATCHER.test(benchmarkName)) {
    return parsed;
  }

  const toNormalized = (value: number | null) => {
    if (value === null || value <= 1) return value;
    return Number(((100 - value) / 100).toFixed(6));
  };

  const normalizedNum = toNormalized(parsed.valueNum);
  const normalizedNum2 = toNormalized(parsed.valueNum2);

  if (normalizedNum === parsed.valueNum && normalizedNum2 === parsed.valueNum2) {
    return parsed;
  }

  const normalizedNote = parsed.valueNote
    ? `${parsed.valueNote}; normalized-omnidocbench-1.5`
    : "normalized-omnidocbench-1.5";

  return {
    valueRaw: parsed.valueRaw,
    valueNum: normalizedNum,
    valueNum2: normalizedNum2,
    valueNote: normalizedNote
  };
}

function isMultimodalHint(input: string): boolean {
  return MULTIMODAL_HINT_PATTERN.test(input);
}

function normalizeImportedValueRaw(rawInput: string): string {
  return rawInput.replace(/[％%]/g, "").replace(/[∗﹡✱✳✻]/g, "*").trim();
}

function mergeImportValueNotes(primaryNote: string | null | undefined, secondaryNote: string | null | undefined): string | null {
  const primary = primaryNote?.trim() ?? "";
  const secondary = secondaryNote?.trim() ?? "";

  if (primary && secondary) {
    return primary === secondary ? primary : `${primary}; ${secondary}`;
  }

  if (primary) return primary;
  if (secondary) return secondary;

  return null;
}

function normalizeImportedValueAndExtractNote(rawInput: string, explicitNoteInput?: string | null): {
  valueRaw: string;
  valueNote: string | null;
} {
  const normalizedRaw = normalizeImportedValueRaw(rawInput);
  const explicitNote = explicitNoteInput?.trim() || null;

  const multiValueSegments = splitImportMultiValueTokens(normalizedRaw);
  if (multiValueSegments.length >= 2 && multiValueSegments.every((segment) => isNumericLikeImportValue(segment))) {
    return {
      valueRaw: multiValueSegments.join(" | "),
      valueNote: explicitNote
    };
  }

  const parsed = parseBenchmarkValue(normalizedRaw);
  const parsedNote = parsed.valueNote === "non-numeric" ? null : parsed.valueNote;

  let valueRaw = normalizedRaw;
  const valueNote = mergeImportValueNotes(explicitNote, parsedNote);

  const pairValue = parseImportPairValue(normalizedRaw);
  if (pairValue) {
    return {
      valueRaw: composeImportPairValueRaw(pairValue),
      valueNote: mergeImportValueNotes(explicitNote, pairValue.valueNote)
    };
  }

  const singleMatch = normalizedRaw.match(IMPORT_VALUE_SINGLE_REGEX);
  if (singleMatch) {
    const [, value, tail] = singleMatch;
    const tailText = tail.trim();

    if (tailText.length > 0 && !tailText.startsWith("*")) {
      valueRaw = value.trim();
    }
  }

  return {
    valueRaw,
    valueNote
  };
}

function splitImportMultiValueTokens(rawInput: string): string[] {
  return rawInput
    .split(IMPORT_MULTI_VALUE_SEPARATOR_REGEX)
    .map((item) => normalizeImportedValueRaw(item))
    .filter((item) => item.length > 0);
}

function extractBenchmarkMetricLabels(benchmarkName: string): {
  baseBenchmarkName: string;
  labels: string[];
  labelsNote: string;
} | null {
  const match = benchmarkName.match(/^(.*?)[\s]*[（(]([^()（）]*[|｜][^()（）]*)[)）]\s*$/);
  if (!match) return null;

  const [, baseRaw, labelsRaw] = match;
  const baseBenchmarkName = normalizeNameParenthesisSpacing(baseRaw).trim();
  const labels = labelsRaw
    .split(IMPORT_MULTI_VALUE_SEPARATOR_REGEX)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!baseBenchmarkName || labels.length < 2) {
    return null;
  }

  return {
    baseBenchmarkName,
    labels,
    labelsNote: `(${labels.join("|")})`
  };
}

function isNumericLikeImportValue(rawInput: string): boolean {
  const parsed = parseBenchmarkValue(rawInput);
  return parsed.valueNum !== null || parsed.valueNum2 !== null;
}

function expandMetricLabeledImportRows(rows: NormalizedTextImportRow[]): NormalizedTextImportRow[] {
  const expandedRows: NormalizedTextImportRow[] = [];

  rows.forEach((row) => {
    const metricLabels = extractBenchmarkMetricLabels(row.benchmarkName);
    if (!metricLabels) {
      expandedRows.push(row);
      return;
    }

    const valueSegments = splitImportMultiValueTokens(row.valueRaw);
    if (valueSegments.length < 2 || valueSegments.length !== metricLabels.labels.length) {
      expandedRows.push(row);
      return;
    }

    const normalizedSegments = valueSegments.map((segment) => normalizeImportedValueAndExtractNote(segment));
    const allSegmentsNumeric = normalizedSegments.every((segment) => isNumericLikeImportValue(segment.valueRaw));

    if (!allSegmentsNumeric) {
      expandedRows.push(row);
      return;
    }

    if (metricLabels.labels.length === 2) {
      const [firstSegment, secondSegment] = normalizedSegments;
      if (!firstSegment || !secondSegment) {
        expandedRows.push(row);
        return;
      }

      const pairRawValue = `${firstSegment.valueRaw} / ${secondSegment.valueRaw}`;
      const pairSegmentNote = mergeImportValueNotes(firstSegment.valueNote, secondSegment.valueNote);
      const rowNoteWithLabels = mergeImportValueNotes(row.valueNote, metricLabels.labelsNote);

      expandedRows.push({
        ...row,
        benchmarkName: metricLabels.baseBenchmarkName,
        valueRaw: pairRawValue,
        valueNote: mergeImportValueNotes(rowNoteWithLabels, pairSegmentNote)
      });

      return;
    }

    normalizedSegments.forEach((segment, index) => {
      const metricLabel = metricLabels.labels[index];
      if (!metricLabel) return;

      expandedRows.push({
        ...row,
        benchmarkName: `${metricLabels.baseBenchmarkName} (${metricLabel})`,
        valueRaw: segment.valueRaw,
        valueNote: mergeImportValueNotes(row.valueNote, segment.valueNote)
      });
    });
  });

  return expandedRows;
}

function normalizeNameParenthesisSpacing(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return "";

  return trimmed
    .replace(HYPHEN_VARIANT_REGEX, "-")
    .replace(/([^\s（(])([（(])/g, "$1 $2")
    .replace(/\s+([（(])/g, " $1");
}

function stripBenchmarkCitationRefs(rawBenchmarkName: string): string {
  return rawBenchmarkName
    .replace(/\s*\[[^\]]+\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBenchmarkImportName(rawBenchmarkName: string): string {
  return stripBenchmarkCitationRefs(rawBenchmarkName)
    .replace(/\s+/g, " ")
    .trim();
}

function parseBenchmarkNameAndDirection(rawBenchmarkName: string): {
  benchmarkName: string;
  higherIsBetter: boolean;
  hadDirectionMarker: boolean;
} {
  const trimmed = rawBenchmarkName.trim();
  if (!trimmed) {
    return {
      benchmarkName: "",
      higherIsBetter: true,
      hadDirectionMarker: false
    };
  }

  const removedDown = trimmed.replace(/\s*[↓⬇️]+$/u, "").trim();
  if (removedDown !== trimmed) {
    return {
      benchmarkName: removedDown,
      higherIsBetter: false,
      hadDirectionMarker: true
    };
  }

  const removedUp = trimmed.replace(/\s*[↑⬆️]+$/u, "").trim();
  if (removedUp !== trimmed) {
    return {
      benchmarkName: removedUp,
      higherIsBetter: true,
      hadDirectionMarker: true
    };
  }

  return {
    benchmarkName: trimmed,
    higherIsBetter: true,
    hadDirectionMarker: false
  };
}

function isEmptyImportValue(rawInput: string | undefined): boolean {
  if (!rawInput) return true;
  const normalized = normalizeImportedValueRaw(rawInput).toLowerCase();
  return EMPTY_VALUE_MARKERS.has(normalized);
}

function splitCommaSeparatedLine(line: string): string[] | null {
  if (!line.includes(",")) {
    return null;
  }

  try {
    const parsedRows = parse(line, {
      columns: false,
      trim: true,
      skipEmptyLines: false
    }) as string[][];

    const firstRow = parsedRows[0];
    if (!firstRow || firstRow.length <= 1) {
      return null;
    }

    return firstRow.map((item) => item.trim());
  } catch {
    return null;
  }
}

function splitTableLine(line: string): string[] {
  if (line.includes("\t")) {
    return line.split("\t").map((item) => item.trim());
  }

  const commaSeparatedCells = splitCommaSeparatedLine(line);
  if (commaSeparatedCells) {
    return commaSeparatedCells;
  }

  return line
    .trim()
    .split(/\s{2,}/)
    .map((item) => item.trim());
}

function getHtmlTableInput(input: string | null | undefined): string | null {
  if (!input) return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  return HTML_TABLE_TAG_REGEX.test(trimmed) ? trimmed : null;
}

function convertInlineLatexGreekLetters(input: string): string {
  return input.replace(/\$\\([A-Za-z]+)\$/g, (raw, command: string) => {
    const mapped = LATEX_INLINE_GREEK_MAP[command];
    return mapped ?? raw;
  });
}

function normalizeHtmlImportCellText(value: unknown): string {
  const normalized = value === null || value === undefined
    ? ""
    : convertInlineLatexGreekLetters(String(value))
      .replace(/\u00A0/g, " ")
      .replace(/\r?\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  return normalizeNameParenthesisSpacing(normalized);
}

function ensureHtmlRowCell(rows: string[][], rowIndex: number, columnIndex: number) {
  while (rows.length <= rowIndex) {
    rows.push([]);
  }

  const row = rows[rowIndex];
  if (!row) return;

  while (row.length <= columnIndex) {
    row.push("");
  }
}

function extractHtmlTableLeadingTypeHints(inputHtml: string): string[] {
  const normalizedHtml = inputHtml.replace(/\r?\n+/g, " ");
  const tableStartIndex = normalizedHtml.search(/<table[\s>]/i);
  if (tableStartIndex <= 0) {
    return [];
  }

  const beforeTableHtml = normalizedHtml.slice(0, tableStartIndex);
  const textChunks = Array.from(
    beforeTableHtml.matchAll(/<(h[1-6]|p|div|span)\b[^>]*>([^<]*)/gi)
  );

  const hints = textChunks
    .map((match) => normalizeHtmlImportCellText(match[2] ?? ""))
    .filter((text) => isMatrixTypeMarker(text));

  return Array.from(new Set(hints));
}

async function parseHtmlTableToText(inputHtml: string): Promise<string | null> {
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(inputHtml, { type: "string", raw: true });
    const selectedSheet = workbook.SheetNames[0];
    if (!selectedSheet) return null;

    const worksheet = workbook.Sheets[selectedSheet];
    if (!worksheet) return null;

    const rows = (XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
      defval: ""
    }) as unknown[][]).map((row) => row.map((cell) => normalizeHtmlImportCellText(cell)));

    const merges = Array.isArray(worksheet["!merges"])
      ? (worksheet["!merges"] as Array<{ s?: { r?: number; c?: number }; e?: { r?: number; c?: number } }> )
      : [];

    merges.forEach((merge) => {
      const startRow = merge.s?.r;
      const startCol = merge.s?.c;
      const endRow = merge.e?.r;
      const endCol = merge.e?.c;

      if (
        startRow === undefined
        || startCol === undefined
        || endRow === undefined
        || endCol === undefined
      ) {
        return;
      }

      if (startRow < 0 || startCol < 0 || endRow <= startRow || endCol !== startCol) {
        return;
      }

      ensureHtmlRowCell(rows, startRow, startCol);
      const seedValue = normalizeHtmlImportCellText(rows[startRow]?.[startCol] ?? "");
      if (!seedValue) {
        return;
      }

      for (let rowIndex = startRow + 1; rowIndex <= endRow; rowIndex += 1) {
        ensureHtmlRowCell(rows, rowIndex, startCol);
        const currentValue = normalizeHtmlImportCellText(rows[rowIndex]?.[startCol] ?? "");
        if (currentValue) {
          continue;
        }

        const targetRow = rows[rowIndex];
        if (!targetRow) continue;
        targetRow[startCol] = seedValue;
      }
    });

    const textLines = rows
      .map((row) => {
        const normalizedCells = row.map((cell) => normalizeHtmlImportCellText(cell));

        let lastNonEmptyCellIndex = -1;
        for (let index = normalizedCells.length - 1; index >= 0; index -= 1) {
          if (normalizedCells[index]) {
            lastNonEmptyCellIndex = index;
            break;
          }
        }

        if (lastNonEmptyCellIndex < 0) {
          return "";
        }

        return normalizedCells.slice(0, lastNonEmptyCellIndex + 1).join("\t");
      })
      .filter((line) => line.trim().length > 0);

    const leadingTypeHints = extractHtmlTableLeadingTypeHints(inputHtml);
    const mergedTextLines = [...leadingTypeHints, ...textLines];

    return mergedTextLines.length > 0 ? mergedTextLines.join("\n") : null;
  } catch {
    return null;
  }
}

function normalizePaperTableLine(line: string): string {
  return line
    .replace(/\u00A0/g, " ")
    .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\uFF0C]/g, ",")
    .replace(/[\uFF05]/g, "%")
    .replace(/\s+/g, " ")
    .trim();
}

function splitWhitespaceTokens(line: string): string[] {
  if (!line.trim()) return [];
  return line.trim().split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function normalizePaperValueToken(token: string): string {
  return token
    .trim()
    .replace(/^[\[(【]+/, "")
    .replace(/[\])】,;:]+$/, "")
    .replace(/[∗﹡✱✳✻]/g, "*")
    .trim();
}

function isPaperTableNumericToken(token: string): boolean {
  const normalized = normalizePaperValueToken(token);
  const withoutUnsupportedSymbols = normalized.replace(UNSUPPORTED_SPECIAL_VALUE_SYMBOL_REGEX, "").trim();
  if (!withoutUnsupportedSymbols) return false;
  return PAPER_TABLE_VALUE_TOKEN_REGEX.test(withoutUnsupportedSymbols);
}

function isPaperTableValueToken(token: string): boolean {
  const normalized = normalizePaperValueToken(token);
  const withoutUnsupportedSymbols = normalized.replace(UNSUPPORTED_SPECIAL_VALUE_SYMBOL_REGEX, "").trim();
  if (!withoutUnsupportedSymbols) return false;

  if (isPaperTableNumericToken(withoutUnsupportedSymbols)) return true;

  if (withoutUnsupportedSymbols.includes("/")) {
    const pairParts = withoutUnsupportedSymbols
      .split("/")
      .map((item) => item.trim())
      .filter(Boolean);

    if (pairParts.length === 2 && pairParts.every((part) => isPaperTableNumericToken(part))) {
      return true;
    }
  }

  const lower = normalizeImportedValueRaw(withoutUnsupportedSymbols).toLowerCase();
  return EMPTY_VALUE_MARKERS.has(lower);
}

function splitPaperTableTokens(line: string): string[] {
  const rawTokens = splitWhitespaceTokens(line);
  if (rawTokens.length === 0) return [];

  const mergedTokens: string[] = [];

  for (let index = 0; index < rawTokens.length; index += 1) {
    const currentToken = rawTokens[index] ?? "";
    const nextToken = rawTokens[index + 1] ?? "";
    const currentNormalized = normalizePaperValueToken(currentToken);
    const nextTrimmed = nextToken.trim();

    const wrappedParentheses = (
      (nextTrimmed.startsWith("(") && nextTrimmed.endsWith(")"))
      || (nextTrimmed.startsWith("（") && nextTrimmed.endsWith("）"))
    );

    if (isPaperTableNumericToken(currentNormalized) && wrappedParentheses) {
      const parenthesizedInner = normalizePaperValueToken(nextTrimmed.slice(1, -1));
      if (isPaperTableNumericToken(parenthesizedInner)) {
        mergedTokens.push(`${currentNormalized} / ${parenthesizedInner}`);
        index += 1;
        continue;
      }
    }

    mergedTokens.push(currentToken);
  }

  return mergedTokens;
}

function getTrailingPaperValueTokenCount(tokens: string[]): number {
  let count = 0;

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (!isPaperTableValueToken(tokens[index])) {
      if (count > 0) {
        break;
      }
      continue;
    }

    count += 1;
  }

  return count;
}

function inferPaperTableModelCount(lines: string[]): number | null {
  const trailingCounts = lines
    .map((line) => getTrailingPaperValueTokenCount(splitPaperTableTokens(line)))
    .filter((count) => count >= 2);

  if (trailingCounts.length === 0) {
    return null;
  }

  const maxCount = Math.max(...trailingCounts);
  let bestCandidate = 2;
  let bestSupport = -1;

  for (let candidate = 2; candidate <= maxCount; candidate += 1) {
    const support = trailingCounts.filter((count) => count >= candidate).length;

    if (support > bestSupport || (support === bestSupport && candidate > bestCandidate)) {
      bestSupport = support;
      bestCandidate = candidate;
    }
  }

  if (bestSupport <= 0) {
    return null;
  }

  return bestCandidate;
}

function mergeSplitBenchmarkPrefixLines(lines: string[]): string[] {
  const mergedLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const current = (lines[index] ?? "").trim();
    const next = (lines[index + 1] ?? "").trim();
    const nextNext = (lines[index + 2] ?? "").trim();

    const canMergeThreeLines =
      current.length > 0
      && next.length > 0
      && nextNext.length > 0
      && !/\s/.test(current)
      && /^\d+$/.test(next)
      && /^[-–—]/.test(nextNext)
      && getTrailingPaperValueTokenCount(splitPaperTableTokens(nextNext)) >= 2;

    if (canMergeThreeLines) {
      mergedLines.push(`${current}${next}${nextNext}`.replace(/\s+/g, " ").trim());
      index += 2;
      continue;
    }

    mergedLines.push(current);
  }

  return mergedLines.filter(Boolean);
}

function cleanPaperHeaderFragment(line: string): string {
  return line
    .replace(PAPER_HEADER_LABEL_REGEX, " ")
    .replace(/[|｜]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPaperHeaderContinuationFragment(fragment: string): boolean {
  const normalized = fragment
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return false;

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) return false;

  return tokens.every((token) => PAPER_HEADER_CONTINUATION_TOKENS.has(token));
}

function isPaperModalityHintFragment(fragment: string): boolean {
  const normalized = fragment
    .toLowerCase()
    .replace(/[^a-z\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return false;

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) return false;

  return tokens.every((token) => PAPER_MODALITY_HINT_TOKENS.has(token));
}

function extractPaperHeaderFragments(line: string): string[] {
  const cleaned = cleanPaperHeaderFragment(line);
  if (!cleaned) return [];

  return splitWhitespaceTokens(cleaned)
    .map((item) => normalizeNameParenthesisSpacing(item))
    .filter(Boolean)
    .filter((item) => !isPaperModalityHintFragment(item));
}

function joinPaperHeaderFragments(previous: string, next: string): string {
  if (!previous.trim()) return next.trim();
  if (!next.trim()) return previous.trim();

  if (/[\-/]$/.test(previous.trim())) {
    return `${previous.trim()}${next.trim()}`;
  }

  return `${previous.trim()} ${next.trim()}`;
}

function mergePaperHeaderFragments(fragments: string[]): string[] {
  const mergedFragments: string[] = [];

  fragments.forEach((fragment) => {
    const normalized = fragment.trim();
    if (!normalized) return;

    if (mergedFragments.length === 0) {
      mergedFragments.push(normalized);
      return;
    }

    const previous = mergedFragments[mergedFragments.length - 1] ?? "";
    if (/[\-/]$/.test(previous) || isPaperHeaderContinuationFragment(normalized)) {
      mergedFragments[mergedFragments.length - 1] = joinPaperHeaderFragments(previous, normalized);
      return;
    }

    mergedFragments.push(normalized);
  });

  return mergedFragments;
}

function isPaperHeaderNoiseFragment(fragment: string): boolean {
  const normalized = fragment
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return true;

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) return true;

  if (tokens.includes("evaluation")) {
    return true;
  }

  return tokens.every((token) => PAPER_HEADER_NOISE_TOKENS.has(token));
}

function normalizeStackedHeaderAtom(token: string): string {
  return token
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fa5.\-]+/g, "")
    .trim();
}

function splitStackedPaperHeaderLineFragments(line: string): string[] {
  const cleaned = normalizeNameParenthesisSpacing(cleanPaperHeaderFragment(line));
  if (!cleaned) return [];
  if (isPaperModalityHintFragment(cleaned)) return [];
  if (isPaperHeaderNoiseFragment(cleaned)) return [];

  const tokens = splitWhitespaceTokens(cleaned);
  if (tokens.length === 2) {
    const left = normalizeStackedHeaderAtom(tokens[0] ?? "");
    const right = normalizeStackedHeaderAtom(tokens[1] ?? "");

    if (left && right && left === right) {
      return [tokens[0] ?? "", tokens[1] ?? ""]
        .map((item) => normalizeNameParenthesisSpacing(item).trim())
        .filter(Boolean);
    }
  }

  const duplicatedTokenMatch = cleaned.match(/^(\S+)\s+\1$/i);
  if (duplicatedTokenMatch) {
    const duplicatedToken = normalizeNameParenthesisSpacing(duplicatedTokenMatch[1] ?? "").trim();
    if (!duplicatedToken) return [];
    return [duplicatedToken, duplicatedToken];
  }

  return [cleaned];
}

function isPaperModelTailFragment(fragment: string): boolean {
  if (isPaperHeaderContinuationFragment(fragment)) {
    return true;
  }

  const normalized = fragment
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5.\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return false;

  if (/^\d+(?:\.\d+)*(?:\s+[a-z0-9.\-]+){0,2}$/.test(normalized)) {
    return true;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) {
    return false;
  }

  return PAPER_MODEL_TAIL_PREFIX_TOKENS.has(tokens[0] ?? "");
}

function shouldUseStackedPaperHeaderFallback(headerLines: string[], modelCount: number): boolean {
  if (modelCount < 2) return false;
  if (headerLines.length < modelCount + 1) return false;

  const cleanedLines = headerLines
    .map((line) => normalizeNameParenthesisSpacing(cleanPaperHeaderFragment(line)))
    .filter(Boolean);

  if (cleanedLines.length < modelCount + 1) {
    return false;
  }

  const shortLineCount = cleanedLines
    .filter((line) => splitWhitespaceTokens(line).length <= 3)
    .length;

  return shortLineCount / cleanedLines.length >= 0.6;
}

function buildStackedPaperTableModelNames(headerLines: string[], modelCount: number): string[] | null {
  if (!shouldUseStackedPaperHeaderFallback(headerLines, modelCount)) {
    return null;
  }

  const fragments = headerLines
    .flatMap((line) => splitStackedPaperHeaderLineFragments(line))
    .map((item) => normalizeNameParenthesisSpacing(item).trim())
    .filter(Boolean);

  if (fragments.length < modelCount) {
    return null;
  }

  const merged: string[] = [];
  fragments.forEach((fragment) => {
    if (merged.length > 0 && isPaperModelTailFragment(fragment)) {
      merged[merged.length - 1] = joinPaperHeaderFragments(merged[merged.length - 1] ?? "", fragment);
      return;
    }

    merged.push(fragment);
  });

  const compacted = [...merged];
  while (compacted.length > modelCount) {
    const mergeIndex = compacted.findIndex((fragment, index) => index > 0 && isPaperModelTailFragment(fragment));
    if (mergeIndex <= 0) {
      break;
    }

    compacted[mergeIndex - 1] = joinPaperHeaderFragments(
      compacted[mergeIndex - 1] ?? "",
      compacted[mergeIndex] ?? ""
    );
    compacted.splice(mergeIndex, 1);
  }

  if (compacted.length !== modelCount) {
    return null;
  }

  return compacted
    .map((item) => normalizeNameParenthesisSpacing(item).trim())
    .filter(Boolean);
}

function isPaperCategoryFragment(line: string): boolean {
  const normalized = normalizeNameParenthesisSpacing(cleanPaperHeaderFragment(line));
  if (!normalized) return false;
  if (isPaperModalityHintFragment(normalized)) return false;
  return isMatrixTypeMarker(normalized) && !isPaperHeaderContinuationFragment(normalized);
}

function estimatePaperHeaderModelCount(headerLines: string[]): number {
  const fragments = headerLines.flatMap((line) => extractPaperHeaderFragments(line));
  const merged = mergePaperHeaderFragments(fragments);
  const compacted = [...merged];

  while (compacted.length > 0 && isPaperCategoryFragment(compacted[compacted.length - 1] ?? "")) {
    compacted.pop();
  }

  return compacted.length;
}

function buildPaperTableModelNames(headerLines: string[], modelCount: number): string[] {
  const stackedModelNames = buildStackedPaperTableModelNames(headerLines, modelCount);
  if (stackedModelNames && stackedModelNames.length === modelCount) {
    return stackedModelNames;
  }

  const fragments = headerLines.flatMap((line) => extractPaperHeaderFragments(line));
  const mergedFragments = mergePaperHeaderFragments(fragments);

  const compacted = [...mergedFragments];
  while (compacted.length > modelCount) {
    const removableIndex = compacted.findLastIndex((item, index) => {
      if (index < modelCount) return false;
      if (isPaperHeaderContinuationFragment(item)) return true;
      return !/\d/.test(item) && isMatrixTypeMarker(item);
    });

    if (removableIndex < 0) break;
    compacted.splice(removableIndex, 1);
  }

  const picked = compacted.slice(0, modelCount).map((item) => normalizeNameParenthesisSpacing(item));

  while (picked.length < modelCount) {
    picked.push(`Model ${picked.length + 1}`);
  }

  return picked;
}

function extractPaperRowBenchmarkAndValues(
  tokens: string[],
  modelCount: number,
  options?: {
    allowPartial?: boolean;
    minValueCount?: number;
  }
): {
  benchmarkName: string;
  values: string[];
} | null {
  if (tokens.length <= modelCount) {
    return null;
  }

  const trailingIndices: number[] = [];
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (!isPaperTableValueToken(tokens[index])) {
      if (trailingIndices.length > 0) {
        break;
      }
      continue;
    }

    trailingIndices.unshift(index);
  }

  const allowPartial = options?.allowPartial ?? false;
  const minValueCount = Math.max(2, options?.minValueCount ?? 2);

  if (trailingIndices.length < modelCount) {
    if (!allowPartial || trailingIndices.length < minValueCount) {
      return null;
    }
  }

  const selectedIndices = trailingIndices.length >= modelCount
    ? trailingIndices.slice(trailingIndices.length - modelCount)
    : trailingIndices;

  const firstValueIndex = selectedIndices[0];
  if (firstValueIndex === undefined) {
    return null;
  }

  const benchmarkTokens = tokens.slice(0, firstValueIndex);
  if (benchmarkTokens.length === 0) {
    return null;
  }

  const values = selectedIndices.map((index) => normalizePaperValueToken(tokens[index] ?? ""));

  return {
    benchmarkName: benchmarkTokens.join(" ").trim(),
    values
  };
}

function scoreParsedTextImportResult(result: ParsedTextImportResult): number {
  if (result.rows.length === 0) return 0;

  const benchmarkCount = new Set(result.rows.map((row) => `${row.benchmarkType}::${row.benchmarkName}`)).size;
  const modelCount = new Set(result.rows.map((row) => row.modelName)).size;
  const theoreticalCells = Math.max(1, benchmarkCount * Math.max(1, modelCount));
  const fillRatio = Math.min(1, result.rows.length / theoreticalCells);

  return (
    result.rows.length * 1.5
    + benchmarkCount * 2
    + modelCount * 3
    + fillRatio * 10
    + (result.confidence ?? 0) * 6
  );
}

function sanitizeUnsupportedValueSymbols(rows: NormalizedTextImportRow[]): {
  rows: NormalizedTextImportRow[];
  warnings: TextParseWarning[];
} {
  const warnings: TextParseWarning[] = [];
  const benchmarkWarningKeys = new Set<string>();

  const sanitizedRows = rows.map((row) => {
    let nextRow = row;

    const benchmarkMatches = row.benchmarkName.match(UNSUPPORTED_SPECIAL_VALUE_SYMBOL_REGEX);
    if (benchmarkMatches && benchmarkMatches.length > 0) {
      const symbols = Array.from(new Set(benchmarkMatches));
      const cleanedBenchmarkName = row.benchmarkName
        .replace(UNSUPPORTED_SPECIAL_VALUE_SYMBOL_REGEX, "")
        .replace(/\s+/g, " ")
        .trim();

      const benchmarkWarningKey = [
        row.rowNumber,
        row.benchmarkName,
        cleanedBenchmarkName,
        symbols.join("|")
      ].join("::");

      if (!benchmarkWarningKeys.has(benchmarkWarningKey)) {
        benchmarkWarningKeys.add(benchmarkWarningKey);
        warnings.push({
          type: "unsupported-special-symbol",
          rowNumber: row.rowNumber,
          modelName: "",
          benchmarkName: row.benchmarkName,
          field: "benchmark",
          before: row.benchmarkName,
          after: cleanedBenchmarkName,
          symbols,
          reason: `检测到 benchmark 中不支持的特殊符号 ${symbols.join(" ")}，已在解析时移除`
        });
      }

      nextRow = {
        ...nextRow,
        benchmarkName: cleanedBenchmarkName
      };
    }

    const valueMatches = row.valueRaw.match(UNSUPPORTED_SPECIAL_VALUE_SYMBOL_REGEX);
    if (valueMatches && valueMatches.length > 0) {
      const symbols = Array.from(new Set(valueMatches));
      const cleanedValue = row.valueRaw
        .replace(UNSUPPORTED_SPECIAL_VALUE_SYMBOL_REGEX, "")
        .replace(/\s+/g, " ")
        .trim();

      warnings.push({
        type: "unsupported-special-symbol",
        rowNumber: row.rowNumber,
        modelName: row.modelName,
        benchmarkName: nextRow.benchmarkName,
        field: "value",
        before: row.valueRaw,
        after: cleanedValue,
        symbols,
        reason: `检测到数值中不支持的特殊符号 ${symbols.join(" ")}，已在解析时移除`
      });

      nextRow = {
        ...nextRow,
        valueRaw: cleanedValue
      };
    }

    return nextRow;
  });

  return {
    rows: sanitizedRows,
    warnings
  };
}

function looksLikeStructuredCsv(firstLine: string): boolean {
  const headerCells = splitCommaSeparatedLine(firstLine)
    ?.map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (!headerCells || headerCells.length === 0) {
    return false;
  }

  const headerSet = new Set(headerCells);
  const hasModelColumn = headerSet.has("model") || headerSet.has("model_name");
  const hasBenchmarkColumn = headerSet.has("benchmark") || headerSet.has("benchmark_name");
  const hasValueColumn = headerSet.has("value") || headerSet.has("value_raw") || headerSet.has("raw_value");

  return hasModelColumn && hasBenchmarkColumn && hasValueColumn;
}

function normalizeModalities(modalities?: string[]): string[] {
  if (!modalities || modalities.length === 0) return ["Text"];

  const normalized = modalities
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item[0].toUpperCase() + item.slice(1).toLowerCase());

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

function parseBoolean(input: string | undefined, fallback = true): boolean {
  if (!input) return fallback;
  const normalized = input.trim().toLowerCase();

  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function toNullableText(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTextImportSource(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith("text:")) {
    const plain = trimmed.slice(5).trim();
    return plain ? `text:${plain}` : "text:";
  }

  return `text:${trimmed}`;
}

function inferProviderNameFromModel(modelName: string): string {
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

function validateProviderConfig(providerId: number, config: ProviderConfig, allProviders: Array<typeof providers.$inferSelect>) {
  if (config.displayName !== undefined && config.displayName.trim().length === 0) {
    throw new Error("displayName 不能为空字符串");
  }

  const seenPrefixes = new Set<string>();
  for (const rule of config.prefixRules ?? []) {
    const prefix = rule.prefix.trim();
    if (!prefix) {
      throw new Error("prefix 不能为空");
    }

    const normalizedPrefix = normalizeProviderConfigPrefix(prefix);
    if (seenPrefixes.has(normalizedPrefix)) {
      throw new Error(`当前 provider 存在重复 prefix: ${prefix}`);
    }
    seenPrefixes.add(normalizedPrefix);
  }

  if (config.branding?.color && !isValidHexColor(config.branding.color)) {
    throw new Error("branding.color 必须是合法的 #RRGGBB");
  }

  if (config.pricing?.modelsDevProviderId !== undefined && config.pricing.modelsDevProviderId.trim().length === 0) {
    throw new Error("modelsDevProviderId 不能为空字符串");
  }

  const pricingAliases = config.pricing?.modelsDevProviderAliases ?? [];
  if (pricingAliases.some((alias) => alias.trim().length === 0)) {
    throw new Error("modelsDevProviderAliases 不能包含空字符串");
  }

  if (config.displayTargetProviderId !== undefined) {
    if (!Number.isInteger(config.displayTargetProviderId) || config.displayTargetProviderId <= 0) {
      throw new Error("displayTargetProviderId 必须是合法 provider id");
    }

    if (config.displayTargetProviderId === providerId) {
      throw new Error("展示归并目标不能是当前 provider 自己");
    }

    const displayTargetProvider = allProviders.find((provider) => provider.id === config.displayTargetProviderId);
    if (!displayTargetProvider) {
      throw new Error(`展示归并目标 provider 不存在: ${config.displayTargetProviderId}`);
    }

    const displayTargetConfig = normalizeProviderConfig(displayTargetProvider.config);
    if (displayTargetConfig.displayTargetProviderId === providerId) {
      throw new Error("展示归并目标不能形成环状配置");
    }
  }

  const enabledPrefixes = new Map<string, number>();

  allProviders.forEach((provider) => {
    const providerConfig = normalizeProviderConfig(provider.config);
    for (const rule of providerConfig.prefixRules ?? []) {
      if (!rule.enabled) continue;
      enabledPrefixes.set(normalizeProviderConfigPrefix(rule.prefix), provider.id);
    }
  });

  for (const rule of config.prefixRules ?? []) {
    if (!rule.enabled) continue;
    const normalizedPrefix = normalizeProviderConfigPrefix(rule.prefix);
    const existingProviderId = enabledPrefixes.get(normalizedPrefix);
    if (existingProviderId !== undefined && existingProviderId !== providerId) {
      throw new Error(`prefix 已被其他 provider 使用: ${rule.prefix}`);
    }
  }
}

function mergeProviderConfig(current: unknown, incoming: unknown): ProviderConfig {
  const currentConfig = normalizeProviderConfig(current);
  const incomingConfig = incoming && typeof incoming === "object" && !Array.isArray(incoming)
    ? incoming as ProviderConfig
    : {};

  const mergedConfig: ProviderConfig = {
    ...currentConfig,
    ...(incomingConfig.displayName === null
      ? { displayName: undefined }
      : incomingConfig.displayName !== undefined
        ? { displayName: incomingConfig.displayName }
        : {}),
    ...(incomingConfig.displayTargetProviderId === null
      ? { displayTargetProviderId: undefined }
      : incomingConfig.displayTargetProviderId !== undefined
        ? { displayTargetProviderId: incomingConfig.displayTargetProviderId }
        : {}),
    ...(incomingConfig.prefixRules !== undefined ? { prefixRules: incomingConfig.prefixRules } : {}),
    ...(incomingConfig.branding !== undefined
      ? {
          branding: {
            ...currentConfig.branding,
            ...(incomingConfig.branding.color === null
              ? { color: undefined }
              : incomingConfig.branding.color !== undefined
                ? { color: incomingConfig.branding.color }
                : {})
          }
        }
      : {}),
    ...(incomingConfig.pricing !== undefined
      ? {
          pricing: {
            ...currentConfig.pricing,
            ...(incomingConfig.pricing.modelsDevProviderId === null
              ? { modelsDevProviderId: undefined }
              : incomingConfig.pricing.modelsDevProviderId !== undefined
                ? { modelsDevProviderId: incomingConfig.pricing.modelsDevProviderId }
                : {}),
            ...(incomingConfig.pricing.modelsDevProviderAliases !== undefined
              ? { modelsDevProviderAliases: incomingConfig.pricing.modelsDevProviderAliases }
              : {}),
            ...(incomingConfig.pricing.disabled !== undefined
              ? { disabled: incomingConfig.pricing.disabled }
              : {})
          }
        }
      : {})
  };

  return normalizeProviderConfig(mergedConfig);
}

function resolveProviderByConfig(
  modelName: string,
  providerRows: Array<typeof providers.$inferSelect>
): typeof providers.$inferSelect | null {
  const normalizedModelName = modelName.trim().toLowerCase();
  if (!normalizedModelName) return null;

  let matched: { provider: typeof providers.$inferSelect; prefix: string } | null = null;

  for (const provider of providerRows) {
    const config = normalizeProviderConfig(provider.config);
    for (const rule of config.prefixRules ?? []) {
      if (!rule.enabled) continue;
      const normalizedPrefix = normalizeProviderConfigPrefix(rule.prefix);
      if (!normalizedPrefix) continue;
      if (!normalizedModelName.startsWith(normalizedPrefix)) continue;

      if (!matched || normalizedPrefix.length > matched.prefix.length) {
        matched = {
          provider,
          prefix: normalizedPrefix
        };
      }
    }
  }

  return matched?.provider ?? null;
}

export async function getProviderNameForModel(modelName: string, options?: { db?: DbExecutor }) {
  const executor = options?.db ?? db;
  const cleanName = normalizeNameParenthesisSpacing(modelName);
  if (!cleanName) return "Unknown";

  const canonicalKey = buildModelCanonicalKey(cleanName, await getModelDedupeRule());
  const [exactModel] = await executor.select().from(models).where(eq(models.canonicalKey, canonicalKey)).limit(1);

  if (exactModel) {
    const [provider] = await executor.select().from(providers).where(eq(providers.id, exactModel.providerId)).limit(1);
    if (provider) {
      const config = normalizeProviderConfig(provider.config);
      return config.displayName?.trim() || provider.name;
    }

    return inferProviderNameFromModel(cleanName);
  }

  const providerRows = await executor.select().from(providers);
  const configMatchedProvider = resolveProviderByConfig(cleanName, providerRows);
  if (configMatchedProvider) {
    const config = normalizeProviderConfig(configMatchedProvider.config);
    return config.displayName?.trim() || configMatchedProvider.name;
  }

  return inferProviderNameFromModel(cleanName);
}

async function buildProviderCanonicalNameResolver(
  rows: Array<Pick<StructuredImportRowInput, "modelName" | "providerName">>,
  options?: { db?: DbExecutor }
) {
  const executor = options?.db ?? db;
  const pendingModelNames = new Map<string, string>();

  rows.forEach((row) => {
    if (row.providerName?.trim()) return;
    const cleanName = normalizeNameParenthesisSpacing(row.modelName || "");
    if (!cleanName) return;

    const canonicalSource = cleanName.toLowerCase();
    if (!pendingModelNames.has(canonicalSource)) {
      pendingModelNames.set(canonicalSource, cleanName);
    }
  });

  if (pendingModelNames.size === 0) {
    return (modelName: string) => inferProviderNameFromModel(modelName);
  }

  const dedupeRule = await (async () => {
    try {
      const [setting] = await executor
        .select({ valueJson: settings.valueJson })
        .from(settings)
        .where(eq(settings.key, "model_dedupe_rule"))
        .limit(1);

      return normalizeModelDedupeRule(setting?.valueJson);
    } catch (error) {
      if (shouldFallbackToDefaultModelDedupeRule(error)) {
        return normalizeModelDedupeRule(null);
      }

      throw error;
    }
  })();
  const providerRows = await executor.select().from(providers);

  const uniqueCanonicalKeys = Array.from(new Set(
    Array.from(pendingModelNames.values()).map((modelName) => buildModelCanonicalKey(modelName, dedupeRule))
  ));

  const matchedModels = uniqueCanonicalKeys.length > 0
    ? await executor
        .select({
          canonicalKey: models.canonicalKey,
          providerId: models.providerId
        })
        .from(models)
        .where(inArray(models.canonicalKey, uniqueCanonicalKeys))
    : [];

  const providerNameById = new Map<number, string>();
  providerRows.forEach((provider) => {
    providerNameById.set(provider.id, provider.name);
  });

  const providerByCanonicalKey = new Map<string, string>();
  matchedModels.forEach((model) => {
    if (providerByCanonicalKey.has(model.canonicalKey)) return;
    const providerName = providerNameById.get(model.providerId);
    if (providerName) {
      providerByCanonicalKey.set(model.canonicalKey, providerName);
    }
  });

  const resolvedByModelName = new Map<string, string>();
  pendingModelNames.forEach((cleanName, canonicalSource) => {
    const canonicalKey = buildModelCanonicalKey(cleanName, dedupeRule);
    const exactProviderName = providerByCanonicalKey.get(canonicalKey);
    if (exactProviderName) {
      resolvedByModelName.set(canonicalSource, exactProviderName);
      return;
    }

    const configMatchedProvider = resolveProviderByConfig(cleanName, providerRows);
    if (configMatchedProvider) {
      resolvedByModelName.set(canonicalSource, configMatchedProvider.name);
      return;
    }

    resolvedByModelName.set(canonicalSource, inferProviderNameFromModel(cleanName));
  });

  return (modelName: string) => {
    const cleanName = normalizeNameParenthesisSpacing(modelName || "");
    if (!cleanName) return "Unknown";

    return resolvedByModelName.get(cleanName.toLowerCase()) ?? inferProviderNameFromModel(cleanName);
  };
}

export async function updateProviderConfig(
  input: { providerId: number; config: unknown },
  options?: { db?: DbExecutor; transactionExecutor?: ProviderConfigTransactionExecutor }
) {
  const transactionExecutor = options?.transactionExecutor ?? db;
  const updatedResult = await transactionExecutor.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${sql.raw("2147483001")})`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${input.providerId})`);

    const [provider] = await tx.select().from(providers).where(eq(providers.id, input.providerId)).limit(1);
    if (!provider) {
      throw new Error(`provider not found: ${input.providerId}`);
    }

    const normalizedConfig = mergeProviderConfig(provider.config, input.config);
    const allProviders = await tx.select().from(providers);
    validateProviderConfig(input.providerId, normalizedConfig, allProviders);

    return tx
      .update(providers)
      .set({
        config: normalizedConfig,
        updatedAt: new Date()
      })
      .where(eq(providers.id, input.providerId))
      .returning();
  });

  const updatedProvider = firstResultRow<typeof providers.$inferSelect>(updatedResult);
  if (!updatedProvider) {
    throw new Error("failed to update provider config");
  }

  await invalidateAllCaches();
  return updatedProvider;
}

export async function deleteProviderAndTransferModels(
  input: { providerId: number; transferTargetProviderId: number },
  options?: { transactionExecutor?: ProviderDeleteTransactionExecutor }
) {
  if (input.providerId === input.transferTargetProviderId) {
    throw new Error("迁移目标 provider 不能与待删除 provider 相同");
  }

  const transactionExecutor = options?.transactionExecutor ?? db;
  const deletedResult = await transactionExecutor.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${sql.raw("2147483001")})`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${input.providerId})`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${input.transferTargetProviderId})`);

    const [provider] = await tx.select().from(providers).where(eq(providers.id, input.providerId)).limit(1);
    if (!provider) {
      throw new Error(`provider not found: ${input.providerId}`);
    }

    const [targetProvider] = await tx.select().from(providers).where(eq(providers.id, input.transferTargetProviderId)).limit(1);
    if (!targetProvider) {
      throw new Error(`transfer target provider not found: ${input.transferTargetProviderId}`);
    }

    const sourceModels = await tx
      .select({ id: models.id, modelName: models.modelName })
      .from(models)
      .where(eq(models.providerId, input.providerId));

    if (sourceModels.length > 0) {
      const targetModels = await tx
        .select({ id: models.id, modelName: models.modelName })
        .from(models)
        .where(eq(models.providerId, input.transferTargetProviderId));

      const targetModelByName = new Map(targetModels.map((model) => [model.modelName, model.id]));

      for (const sourceModel of sourceModels) {
        const conflictTargetId = targetModelByName.get(sourceModel.modelName);
        if (!conflictTargetId) continue;

        await tx
          .update(benchmarkValues)
          .set({ modelId: conflictTargetId })
          .where(eq(benchmarkValues.modelId, sourceModel.id));

        await tx
          .update(models)
          .set({ mergedIntoModelId: conflictTargetId })
          .where(eq(models.mergedIntoModelId, sourceModel.id));

        await tx.delete(models).where(eq(models.id, sourceModel.id));
      }

      await tx
        .update(models)
        .set({ providerId: input.transferTargetProviderId })
        .where(eq(models.providerId, input.providerId));
    }

    const providerRows = await tx.select().from(providers);
    for (const providerRow of providerRows) {
      if (providerRow.id === input.providerId) continue;
      const normalizedConfig = normalizeProviderConfig(providerRow.config);
      if (normalizedConfig.displayTargetProviderId !== input.providerId) continue;

      const nextConfig = {
        ...normalizedConfig,
        displayTargetProviderId: undefined
      };

      validateProviderConfig(providerRow.id, nextConfig, providerRows.filter((item) => item.id !== input.providerId));

      await tx
        .update(providers)
        .set({
          config: nextConfig,
          updatedAt: new Date()
        })
        .where(eq(providers.id, providerRow.id));
    }

    const deletedProviders = await tx
      .delete(providers)
      .where(eq(providers.id, input.providerId))
      .returning({ id: providers.id, name: providers.name });

    return {
      deletedProvider: deletedProviders[0] ?? null,
      transferredModelCount: sourceModels.length,
      transferTargetProviderId: input.transferTargetProviderId
    };
  });

  if (!deletedResult.deletedProvider) {
    throw new Error("failed to delete provider");
  }

  await invalidateAllCaches();
  return {
    ok: true,
    providerId: deletedResult.deletedProvider.id,
    providerName: deletedResult.deletedProvider.name,
    transferTargetProviderId: deletedResult.transferTargetProviderId,
    transferredModelCount: deletedResult.transferredModelCount
  };
}

function inferModalitiesFromCategory(category: string | null): string[] {
  if (!category) return ["Text"];
  const normalized = category.toLowerCase();

  if (normalized.includes("vision") || normalized.includes("vlm")) return ["Vision"];
  if (normalized.includes("audio")) return ["Audio"];
  if (normalized.includes("video")) return ["Video"];
  if (isMultimodalHint(normalized)) return ["Multimodal"];

  return ["Text"];
}

function isMatrixTypeMarker(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;

  // 常见“分组标题行”特征：短文本、无数值特征、通常独立一行
  if (/[\d%/()]/.test(trimmed)) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return true;
  return words.length <= 3 && trimmed.length <= 28;
}

function firstResultRow<T>(result: unknown): T | undefined {
  if (Array.isArray(result)) {
    return result[0] as T | undefined;
  }

  if (result && typeof result === "object" && "rows" in (result as Record<string, unknown>)) {
    const rows = (result as { rows?: unknown[] }).rows;
    return Array.isArray(rows) ? (rows[0] as T | undefined) : undefined;
  }

  return undefined;
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }

  if (result && typeof result === "object" && "rows" in (result as Record<string, unknown>)) {
    const rows = (result as { rows?: unknown[] }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }

  return [];
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toIsoDateTime(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }

  return "";
}

function hasMeaningfulNumericChange(previous: number | null, next: number | null): boolean {
  if (previous === null && next === null) return false;
  if (previous === null || next === null) return true;

  return Math.abs(previous - next) > 1e-12;
}

function normalizeScaleNumericValue(value: number | null, targetScale: 1 | 100): number | null {
  if (value === null || !Number.isFinite(value)) {
    return value;
  }

  if (targetScale === 1) {
    if (value > 10) {
      return Number((value / 100).toFixed(6));
    }

    return value;
  }

  if (value < 1) {
    return Number((value * 100).toFixed(6));
  }

  return value;
}

function formatScaledNumericValue(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function appendScaleNormalizationNote(valueNote: string | null | undefined, targetScale: 1 | 100): string {
  const marker = targetScale === 1
    ? SCALE_NORMALIZED_NOTE_TO_ONE
    : SCALE_NORMALIZED_NOTE_TO_HUNDRED;

  const current = valueNote?.trim() ?? "";
  if (!current) {
    return marker;
  }

  if (current.includes(marker)) {
    return current;
  }

  return `${current}; ${marker}`;
}

const BENCHMARK_SPLIT_NOTE_BASE = "split-benchmark-base";
const BENCHMARK_SPLIT_NOTE_ELO = "split-benchmark-elo";

function appendBenchmarkSplitNote(
  valueNote: string | null | undefined,
  segment: "base" | "elo"
): string {
  const marker = segment === "base" ? BENCHMARK_SPLIT_NOTE_BASE : BENCHMARK_SPLIT_NOTE_ELO;
  const current = valueNote?.trim() ?? "";

  if (!current) {
    return marker;
  }

  if (current.includes(marker)) {
    return current;
  }

  return `${current}; ${marker}`;
}

function isZeroToHundredScaleValue(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isEloScaleValue(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value > 100;
}

function hasBenchmarkEloSuffix(benchmarkName: string): boolean {
  return /\s*[（(]\s*elo\s*[)）]\s*$/i.test(benchmarkName.trim());
}

function toBenchmarkEloName(benchmarkName: string): string {
  const cleanName = normalizeNameParenthesisSpacing(benchmarkName).trim();
  return hasBenchmarkEloSuffix(cleanName) ? cleanName : `${cleanName} (Elo)`;
}

function shouldPreferExistingEloBenchmarkForImport(benchmarkName: string, parsedValue: ParsedBenchmarkValue): boolean {
  if (hasBenchmarkEloSuffix(benchmarkName)) {
    return false;
  }

  return isEloScaleValue(parsedValue.valueNum) || isEloScaleValue(parsedValue.valueNum2);
}

function mergeNumericBounds(values: number[]): { minValue: number | null; maxValue: number | null } {
  if (values.length === 0) {
    return { minValue: null, maxValue: null };
  }

  return {
    minValue: Math.min(...values),
    maxValue: Math.max(...values)
  };
}

function collectDetailValuesByPredicate(
  valueDetails: BenchmarkScaleValueDetail[],
  predicate: (value: number) => boolean
): number[] {
  return valueDetails
    .map((detail) => detail.value)
    .filter((value) => predicate(value));
}

function buildSplitBenchmarkValueRaw(valueNum: number | null, valueNum2: number | null): string {
  if (valueNum !== null && valueNum2 !== null) {
    return `${formatScaledNumericValue(valueNum)} / ${formatScaledNumericValue(valueNum2)}`;
  }

  if (valueNum !== null) {
    return formatScaledNumericValue(valueNum);
  }

  if (valueNum2 !== null) {
    return formatScaledNumericValue(valueNum2);
  }

  throw new Error("split benchmark value row must retain at least one numeric value");
}

function normalizeSplitBenchmarkPair(
  valueNum: number | null,
  valueNum2: number | null
): { valueNum: number | null; valueNum2: number | null } {
  if (valueNum !== null) {
    return {
      valueNum,
      valueNum2
    };
  }

  if (valueNum2 !== null) {
    return {
      valueNum: valueNum2,
      valueNum2: null
    };
  }

  return {
    valueNum: null,
    valueNum2: null
  };
}

function shouldFallbackToDefaultModelDedupeRule(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const fallbackHints = [
    "ECONNREFUSED",
    "connect ECONNREFUSED",
    "Failed query: select \"value_json\" from \"settings\""
  ];

  return fallbackHints.some((hint) => error.message.includes(hint));
}

async function getModelDedupeRule() {
  try {
    const [setting] = await db
      .select({ valueJson: settings.valueJson })
      .from(settings)
      .where(eq(settings.key, "model_dedupe_rule"))
      .limit(1);

    return normalizeModelDedupeRule(setting?.valueJson);
  } catch (error) {
    if (shouldFallbackToDefaultModelDedupeRule(error)) {
      return normalizeModelDedupeRule(null);
    }

    throw error;
  }
}

export async function rebuildModelCanonicalKeysByRule(rawRule: unknown) {
  const dedupeRule = normalizeModelDedupeRule(rawRule);
  const allModels = await db
    .select({
      id: models.id,
      modelName: models.modelName,
      mergedIntoModelId: models.mergedIntoModelId
    })
    .from(models)
    .orderBy(models.id);

  const groupMap = new Map<string, Array<{ id: number; modelName: string; mergedIntoModelId: number | null }>>();

  allModels.forEach((model) => {
    const canonicalKey = buildModelCanonicalKey(model.modelName, dedupeRule);
    if (!groupMap.has(canonicalKey)) {
      groupMap.set(canonicalKey, []);
    }
    groupMap.get(canonicalKey)?.push(model);
  });

  const tempSuffix = Date.now();
  let mergedCount = 0;

  await db.transaction(async (tx: DbTransactionClient) => {
    // Phase 1: Batch assign temporary keys to all models in a single UPDATE
    await tx.execute(
      sql`UPDATE models SET canonical_key = 'tmp-model-' || id::text || '-' || ${String(tempSuffix)}`
    );

    // Phase 2: Process each canonical group
    for (const [canonicalKey, groupedModels] of groupMap.entries()) {
      const keeper = groupedModels.find((item) => item.mergedIntoModelId === null) ?? groupedModels[0];
      if (!keeper) continue;

      await tx
        .update(models)
        .set({ canonicalKey, mergedIntoModelId: null })
        .where(eq(models.id, keeper.id));

      const duplicateIds = groupedModels
        .filter((item) => item.id !== keeper.id)
        .map((item) => item.id);

      if (duplicateIds.length === 0) continue;

      // Batch reassign benchmark values from all duplicates to keeper
      await tx
        .update(benchmarkValues)
        .set({ modelId: keeper.id })
        .where(inArray(benchmarkValues.modelId, duplicateIds));

      // Batch update merged_into pointers that referenced any duplicate
      await tx
        .update(models)
        .set({ mergedIntoModelId: keeper.id })
        .where(inArray(models.mergedIntoModelId, duplicateIds));

      // Mark each duplicate with its unique merged key
      for (const duplicate of groupedModels) {
        if (duplicate.id === keeper.id) continue;

        await tx
          .update(models)
          .set({
            canonicalKey: `${canonicalKey}#merged-${duplicate.id}`,
            mergedIntoModelId: keeper.id
          })
          .where(eq(models.id, duplicate.id));

        mergedCount += 1;
      }
    }
  });

  await invalidateAllCaches();

  return {
    ok: true,
    totalModels: allModels.length,
    canonicalGroups: groupMap.size,
    mergedCount
  };
}

export async function rebuildBenchmarkCanonicalKeysByRule(rawRule: unknown) {
  const dedupeRule = normalizeModelDedupeRule(rawRule);
  const allBenchmarks = await db
    .select({
      id: benchmarks.id,
      benchmarkName: benchmarks.benchmarkName,
      benchmarkType: benchmarks.benchmarkType,
      modalities: benchmarks.modalities,
      mergedIntoBenchmarkId: benchmarks.mergedIntoBenchmarkId
    })
    .from(benchmarks)
    .orderBy(benchmarks.id);

  const groupMap = new Map<
    string,
    Array<{
      id: number;
      benchmarkName: string;
      benchmarkType: string;
      modalities: string[] | null;
      mergedIntoBenchmarkId: number | null;
    }>
  >();

  allBenchmarks.forEach((benchmark) => {
    const canonicalKey = buildBenchmarkCanonicalKey(benchmark.benchmarkName, benchmark.benchmarkType, dedupeRule);
    if (!groupMap.has(canonicalKey)) {
      groupMap.set(canonicalKey, []);
    }
    groupMap.get(canonicalKey)?.push(benchmark);
  });

  const tempSuffix = Date.now();
  let mergedCount = 0;

  await db.transaction(async (tx: DbTransactionClient) => {
    // Phase 1: Batch assign temporary keys to all benchmarks in a single UPDATE
    await tx.execute(
      sql`UPDATE benchmarks SET canonical_key = 'tmp-benchmark-' || id::text || '-' || ${String(tempSuffix)}`
    );

    // Phase 2: Process each canonical group
    for (const [canonicalKey, groupedBenchmarks] of groupMap.entries()) {
      const keeper = groupedBenchmarks.find((item) => item.mergedIntoBenchmarkId === null) ?? groupedBenchmarks[0];
      if (!keeper) continue;

      await tx
        .update(benchmarks)
        .set({ canonicalKey, mergedIntoBenchmarkId: null })
        .where(eq(benchmarks.id, keeper.id));

      const duplicateIds = groupedBenchmarks
        .filter((item) => item.id !== keeper.id)
        .map((item) => item.id);

      if (duplicateIds.length === 0) continue;

      const duplicateById = new Map(groupedBenchmarks.map((item) => [item.id, item]));
      const duplicateValueSourceRows = await tx
        .select({
          benchmarkId: benchmarkValues.benchmarkId,
          source: benchmarkValues.source
        })
        .from(benchmarkValues)
        .where(inArray(benchmarkValues.benchmarkId, duplicateIds));

      const duplicateSourceMetaRows = await tx
        .select({
          benchmarkId: benchmarkSourceMeta.benchmarkId,
          source: benchmarkSourceMeta.source,
          benchmarkType: benchmarkSourceMeta.benchmarkType,
          modalities: benchmarkSourceMeta.modalities
        })
        .from(benchmarkSourceMeta)
        .where(inArray(benchmarkSourceMeta.benchmarkId, duplicateIds));

      const sourceMetaByDuplicateAndSource = new Map<string, { benchmarkType: string; modalities: string[] | null }>();
      const duplicateSourceSet = new Map<number, Set<string>>();
      const addDuplicateSource = (benchmarkId: number, source: string | null | undefined) => {
        const normalizedSource = source?.trim() ?? "";
        if (!normalizedSource) return;

        if (!duplicateSourceSet.has(benchmarkId)) {
          duplicateSourceSet.set(benchmarkId, new Set<string>());
        }
        duplicateSourceSet.get(benchmarkId)!.add(normalizedSource);
      };

      duplicateValueSourceRows.forEach((row: { benchmarkId: number; source: string | null }) => {
        addDuplicateSource(row.benchmarkId, row.source);
      });

      duplicateSourceMetaRows.forEach((row: {
        benchmarkId: number;
        source: string;
        benchmarkType: string;
        modalities: string[] | null;
      }) => {
        const normalizedSource = row.source.trim();
        if (!normalizedSource) return;

        const key = `${row.benchmarkId}::${normalizedSource}`;
        if (!sourceMetaByDuplicateAndSource.has(key)) {
          sourceMetaByDuplicateAndSource.set(key, {
            benchmarkType: row.benchmarkType,
            modalities: row.modalities
          });
        }
        addDuplicateSource(row.benchmarkId, normalizedSource);
      });

      const sourceMetaRowsToMigrate = Array.from(duplicateSourceSet.entries()).flatMap(([benchmarkId, sourceSet]) => {
        const duplicate = duplicateById.get(benchmarkId);
        if (!duplicate) return [];

        const fallbackModalities = duplicate.modalities?.length ? duplicate.modalities : [duplicate.benchmarkType];

        return Array.from(sourceSet).map((source) => {
          const sourceMeta = sourceMetaByDuplicateAndSource.get(`${benchmarkId}::${source}`);

          return {
            benchmarkId: keeper.id,
            source,
            benchmarkType: sourceMeta?.benchmarkType ?? duplicate.benchmarkType,
            modalities: sourceMeta?.modalities ?? fallbackModalities
          };
        });
      });

      if (sourceMetaRowsToMigrate.length > 0) {
        await tx
          .insert(benchmarkSourceMeta)
          .values(sourceMetaRowsToMigrate)
          .onConflictDoNothing({
            target: [benchmarkSourceMeta.benchmarkId, benchmarkSourceMeta.source]
          });
      }

      if (duplicateSourceMetaRows.length > 0) {
        await tx
          .delete(benchmarkSourceMeta)
          .where(inArray(benchmarkSourceMeta.benchmarkId, duplicateIds));
      }

      // Batch reassign benchmark values from all duplicates to keeper
      await tx
        .update(benchmarkValues)
        .set({ benchmarkId: keeper.id })
        .where(inArray(benchmarkValues.benchmarkId, duplicateIds));

      // Batch update merged_into pointers that referenced any duplicate
      await tx
        .update(benchmarks)
        .set({ mergedIntoBenchmarkId: keeper.id })
        .where(inArray(benchmarks.mergedIntoBenchmarkId, duplicateIds));

      // Mark each duplicate with its unique merged key
      for (const duplicate of groupedBenchmarks) {
        if (duplicate.id === keeper.id) continue;

        await tx
          .update(benchmarks)
          .set({
            canonicalKey: `${canonicalKey}#merged-${duplicate.id}`,
            mergedIntoBenchmarkId: keeper.id
          })
          .where(eq(benchmarks.id, duplicate.id));

        mergedCount += 1;
      }
    }
  });

  await invalidateAllCaches();

  return {
    ok: true,
    totalBenchmarks: allBenchmarks.length,
    canonicalGroups: groupMap.size,
    mergedCount
  };
}

export async function ensureProvider(name: string, options?: { db?: DbExecutor }) {
  const cleanName = name.trim();
  if (!cleanName) {
    throw new Error("provider name is required");
  }

  const executor = options?.db ?? db;

  const slug = toProviderSlug(cleanName);

  const providerResult = await executor
    .insert(providers)
    .values({
      name: cleanName,
      slug,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: providers.slug,
      set: {
        name: cleanName,
        updatedAt: new Date()
      }
    })
    .returning();

  const provider = firstResultRow<typeof providers.$inferSelect>(providerResult);
  if (!provider) {
    throw new Error("failed to upsert provider");
  }

  return provider;
}

export async function ensureModelByProviderId(input: {
  providerId: number;
  modelName: string;
  modelAlias?: string | null;
  sourceModelId?: string | null;
}, options?: { dedupeRule?: ReturnType<typeof normalizeModelDedupeRule>; db?: DbExecutor }) {
  const cleanName = normalizeNameParenthesisSpacing(input.modelName);
  if (!cleanName) {
    throw new Error("modelName is required");
  }

  const executor = options?.db ?? db;

  const [provider] = await executor.select().from(providers).where(eq(providers.id, input.providerId)).limit(1);

  if (!provider) {
    throw new Error(`provider not found: ${input.providerId}`);
  }

  const rule = options?.dedupeRule ?? await getModelDedupeRule();
  const canonicalKey = buildModelCanonicalKey(cleanName, rule);
  const [existing] = await executor.select().from(models).where(eq(models.canonicalKey, canonicalKey)).limit(1);

  if (existing) {
    return existing;
  }

  const createdResult = await executor
    .insert(models)
    .values({
      providerId: provider.id,
      modelName: cleanName,
      modelAlias: input.modelAlias ?? null,
      canonicalKey,
      sourceModelId: input.sourceModelId ?? null
    })
    .returning();

  const created = firstResultRow<typeof models.$inferSelect>(createdResult);
  if (!created) {
    throw new Error("failed to create model");
  }

  return created;
}

async function resolveActiveBenchmark(
  benchmark: typeof benchmarks.$inferSelect,
  executor: DbExecutor
): Promise<typeof benchmarks.$inferSelect> {
  let current = benchmark;
  const seenIds = new Set<number>([current.id]);
  while (current.mergedIntoBenchmarkId !== null) {
    const nextId = current.mergedIntoBenchmarkId;
    if (seenIds.has(nextId)) {
      break;
    }
    seenIds.add(nextId);
    const [next] = await executor
      .select()
      .from(benchmarks)
      .where(eq(benchmarks.id, nextId))
      .limit(1);
    if (!next) {
      break;
    }
    current = next;
  }
  return current;
}

export async function ensureBenchmark(
  input: EnsureBenchmarkInput,
  options?: { dedupeRule?: ModelDedupeRule; db?: DbExecutor }
) {
  const cleanName = normalizeNameParenthesisSpacing(input.benchmarkName);
  const cleanType = input.benchmarkType.trim() || "general";

  if (!cleanName) {
    throw new Error("benchmarkName is required");
  }

  const dedupeRule = options?.dedupeRule ?? await getModelDedupeRule();
  const canonicalKey = buildBenchmarkCanonicalKey(cleanName, cleanType, dedupeRule);
  const modalities = normalizeModalities(input.modalities);
  const forceLowerIsBetter = isLowerBetterBenchmark(cleanName, cleanType) || input.higherIsBetter === false;
  const higherIsBetter = forceLowerIsBetter ? false : (input.higherIsBetter ?? true);
  const executor = options?.db ?? db;

  const [existing] = await executor
    .select()
    .from(benchmarks)
    .where(eq(benchmarks.canonicalKey, canonicalKey))
    .limit(1);

  if (existing) {
    const activeBenchmark = await resolveActiveBenchmark(existing, executor);
    if (forceLowerIsBetter && activeBenchmark.higherIsBetter) {
      const updatedResult = await executor
        .update(benchmarks)
        .set({ higherIsBetter: false })
        .where(eq(benchmarks.id, activeBenchmark.id))
        .returning();
      const updated = firstResultRow<typeof benchmarks.$inferSelect>(updatedResult);
      return updated ?? { ...activeBenchmark, higherIsBetter: false };
    }

    return activeBenchmark;
  }

  const [existingByNameType] = await executor
    .select()
    .from(benchmarks)
    .where(and(
      eq(benchmarks.benchmarkName, cleanName),
      eq(benchmarks.benchmarkType, cleanType)
    ))
    .limit(1);

  if (existingByNameType) {
    // If the found record is itself merged into another, just resolve to the
    // active target and return it — do NOT touch the active target's canonical key,
    // because its key belongs to a completely different name/type.
    if (existingByNameType.mergedIntoBenchmarkId !== null) {
      const activeBenchmark = await resolveActiveBenchmark(existingByNameType, executor);
      if (forceLowerIsBetter && activeBenchmark.higherIsBetter) {
        const updatedResult = await executor
          .update(benchmarks)
          .set({ higherIsBetter: false })
          .where(eq(benchmarks.id, activeBenchmark.id))
          .returning();
        const updated = firstResultRow<typeof benchmarks.$inferSelect>(updatedResult);
        return updated ?? { ...activeBenchmark, higherIsBetter: false };
      }
      return activeBenchmark;
    }

    // existingByNameType is itself active — apply the original sync logic.
    const shouldSyncCanonical = existingByNameType.canonicalKey !== canonicalKey;
    const shouldSyncLowerIsBetter = forceLowerIsBetter && existingByNameType.higherIsBetter;

    if (shouldSyncCanonical || shouldSyncLowerIsBetter) {
      const updatedResult = await executor
        .update(benchmarks)
        .set({
          canonicalKey,
          higherIsBetter: forceLowerIsBetter ? false : existingByNameType.higherIsBetter
        })
        .where(eq(benchmarks.id, existingByNameType.id))
        .returning();

      const updated = firstResultRow<typeof benchmarks.$inferSelect>(updatedResult);
      return updated ?? {
        ...existingByNameType,
        canonicalKey,
        higherIsBetter: forceLowerIsBetter ? false : existingByNameType.higherIsBetter
      };
    }

    return existingByNameType;
  }

  const createdResult = await executor
    .insert(benchmarks)
    .values({
      benchmarkName: cleanName,
      benchmarkType: cleanType,
      unit: input.unit?.trim() || "score",
      higherIsBetter,
      modalities,
      canonicalKey,
      sourceBenchmarkId: input.sourceBenchmarkId ?? null
    })
    .returning();

  const created = firstResultRow<typeof benchmarks.$inferSelect>(createdResult);
  if (!created) {
    throw new Error("failed to create benchmark");
  }

  return created;
}

export async function createBenchmarkValue(input: {
  modelId: number;
  benchmarkId: number;
  benchTime: Date;
  valueRaw: string;
  source?: string | null;
  benchmarkName?: string | null;
}) {
  let benchmarkName = input.benchmarkName?.trim();
  if (!benchmarkName) {
    const [benchmark] = await db
      .select({ benchmarkName: benchmarks.benchmarkName })
      .from(benchmarks)
      .where(eq(benchmarks.id, input.benchmarkId))
      .limit(1);
    benchmarkName = benchmark?.benchmarkName;
  }

  const parsed = benchmarkName
    ? normalizeStoredBenchmarkValue(benchmarkName, parseBenchmarkValue(input.valueRaw))
    : parseBenchmarkValue(input.valueRaw);

  const createdResult = await db
    .insert(benchmarkValues)
    .values({
      modelId: input.modelId,
      benchmarkId: input.benchmarkId,
      benchTime: input.benchTime,
      valueRaw: parsed.valueRaw,
      valueNum: parsed.valueNum !== null ? String(parsed.valueNum) : null,
      valueNum2: parsed.valueNum2 !== null ? String(parsed.valueNum2) : null,
      valueNote: parsed.valueNote,
      source: input.source ?? null
    })
    .returning();

  const created = firstResultRow<typeof benchmarkValues.$inferSelect>(createdResult);
  if (!created) {
    throw new Error("failed to create benchmark value");
  }

  await invalidateAllCaches();

  return created;
}

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

export type BenchmarkPreviewValueOverlapInput = {
  items: Array<{
    previewBenchmarkKey: string;
    candidateBenchmarkIds: number[];
    cells: Array<{
      modelName: string;
      rawValue: string;
    }>;
  }>;
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

function normalizeBenchmarkOverlapNumericValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    return text;
  }

  const sign = match[1] === "-" ? "-" : "";
  const integerPart = (match[2] ?? "0").replace(/^0+(?=\d)/, "");
  const fractionPart = (match[3] ?? "").replace(/0+$/, "");
  const normalized = fractionPart ? `${integerPart}.${fractionPart}` : integerPart;

  return normalized === "0" ? "0" : `${sign}${normalized}`;
}

function getBenchmarkOverlapValueKey(row: { valueRaw: string; valueNum: unknown; valueNum2: unknown }): string {
  const valueNum = normalizeBenchmarkOverlapNumericValue(row.valueNum);
  const valueNum2 = normalizeBenchmarkOverlapNumericValue(row.valueNum2);

  if (valueNum !== null || valueNum2 !== null) {
    return `num:${valueNum ?? ""}|${valueNum2 ?? ""}`;
  }

  return `raw:${row.valueRaw.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

export async function getBenchmarkValueOverlapStats(input: {
  sourceId: number;
  targetId: number;
}): Promise<BenchmarkValueOverlapStats> {
  if (input.sourceId === input.targetId) {
    throw new Error("sourceId and targetId cannot be the same");
  }

  const rows = await db
    .select({
      benchmarkId: benchmarkValues.benchmarkId,
      modelId: benchmarkValues.modelId,
      valueRaw: benchmarkValues.valueRaw,
      valueNum: benchmarkValues.valueNum,
      valueNum2: benchmarkValues.valueNum2
    })
    .from(benchmarkValues)
    .where(inArray(benchmarkValues.benchmarkId, [input.sourceId, input.targetId]));

  const sourceValuesByModel = new Map<number, Set<string>>();
  const targetValuesByModel = new Map<number, Set<string>>();
  let sourceValueCount = 0;
  let targetValueCount = 0;

  rows.forEach((row) => {
    const valuesByModel = row.benchmarkId === input.sourceId
      ? sourceValuesByModel
      : row.benchmarkId === input.targetId
        ? targetValuesByModel
        : null;

    if (!valuesByModel) {
      return;
    }

    if (row.benchmarkId === input.sourceId) {
      sourceValueCount += 1;
    } else {
      targetValueCount += 1;
    }

    const valueKey = getBenchmarkOverlapValueKey(row);
    const existingValues = valuesByModel.get(row.modelId);
    if (existingValues) {
      existingValues.add(valueKey);
      return;
    }

    valuesByModel.set(row.modelId, new Set([valueKey]));
  });

  let sameCount = 0;
  let overlapCount = 0;

  sourceValuesByModel.forEach((sourceValues, modelId) => {
    const targetValues = targetValuesByModel.get(modelId);
    if (!targetValues) {
      return;
    }

    overlapCount += 1;

    for (const value of sourceValues) {
      if (targetValues.has(value)) {
        sameCount += 1;
        return;
      }
    }
  });

  return {
    sourceId: input.sourceId,
    targetId: input.targetId,
    sameCount,
    overlapCount,
    sourceValueCount,
    targetValueCount,
    sourceModelCount: sourceValuesByModel.size,
    targetModelCount: targetValuesByModel.size
  };
}

export async function getBenchmarkPreviewValueOverlapStats(
  input: BenchmarkPreviewValueOverlapInput
): Promise<{ stats: BenchmarkPreviewValueOverlapStats[] }> {
  const items = input.items.slice(0, 200).map((item) => ({
    previewBenchmarkKey: item.previewBenchmarkKey,
    candidateBenchmarkIds: Array.from(new Set(item.candidateBenchmarkIds.filter((id) => Number.isInteger(id) && id > 0))).slice(0, 30),
    cells: item.cells
      .filter((cell) => cell.modelName.trim().length > 0 && cell.rawValue.trim().length > 0)
      .slice(0, 200)
  }));

  const candidateBenchmarkIds = Array.from(
    new Set(items.flatMap((item) => item.candidateBenchmarkIds))
  );

  if (items.length === 0 || candidateBenchmarkIds.length === 0) {
    return { stats: [] };
  }

  const dedupeRule = await getModelDedupeRule();
  const canonicalKeyByModelName = new Map<string, string>();
  for (const item of items) {
    for (const cell of item.cells) {
      if (!canonicalKeyByModelName.has(cell.modelName)) {
        const key = buildModelCanonicalKey(cell.modelName, dedupeRule);
        if (key) {
          canonicalKeyByModelName.set(cell.modelName, key);
        }
      }
    }
  }
  const modelCanonicalKeys = Array.from(new Set(canonicalKeyByModelName.values()));

  const matchedModels = modelCanonicalKeys.length > 0
    ? await db
        .select({
          id: models.id,
          canonicalKey: models.canonicalKey
        })
        .from(models)
        .where(inArray(models.canonicalKey, modelCanonicalKeys))
    : [];

  const matchedModelIds = Array.from(new Set(matchedModels.map((model) => model.id)));

  if (matchedModelIds.length === 0) {
    return {
      stats: items.flatMap((item) => {
        const previewTotal = item.cells.filter((cell) => cell.rawValue.trim().length > 0).length;

        return item.candidateBenchmarkIds.map((candidateBenchmarkId) => ({
          previewBenchmarkKey: item.previewBenchmarkKey,
          candidateBenchmarkId,
          previewTotal,
          modelOverlapCount: 0,
          exactDuplicateCount: 0,
          conflictCount: 0,
          duplicateRate: 0
        }));
      })
    };
  }

  const [candidateBenchmarks, existingValues] = await Promise.all([
    db
      .select({
        id: benchmarks.id,
        benchmarkName: benchmarks.benchmarkName
      })
      .from(benchmarks)
      .where(inArray(benchmarks.id, candidateBenchmarkIds)),
    db
      .select({
        benchmarkId: benchmarkValues.benchmarkId,
        modelId: benchmarkValues.modelId,
        valueRaw: benchmarkValues.valueRaw,
        valueNum: benchmarkValues.valueNum,
        valueNum2: benchmarkValues.valueNum2
      })
      .from(benchmarkValues)
      .where(
        and(
          inArray(benchmarkValues.benchmarkId, candidateBenchmarkIds),
          inArray(benchmarkValues.modelId, matchedModelIds)
        )
      )
  ]);

  const modelIdByCanonicalKey = new Map<string, number>();
  matchedModels.forEach((model) => {
    if (!modelIdByCanonicalKey.has(model.canonicalKey)) {
      modelIdByCanonicalKey.set(model.canonicalKey, model.id);
    }
  });

  const benchmarkNameById = new Map(candidateBenchmarks.map((benchmark) => [benchmark.id, benchmark.benchmarkName]));
  const existingValuesByBenchmarkModel = new Map<string, Set<string>>();

  existingValues.forEach((value) => {
    const key = `${value.benchmarkId}:${value.modelId}`;
    const valueKey = getBenchmarkOverlapValueKey(value);
    const existingSet = existingValuesByBenchmarkModel.get(key);
    if (existingSet) {
      existingSet.add(valueKey);
      return;
    }

    existingValuesByBenchmarkModel.set(key, new Set([valueKey]));
  });

  const stats: BenchmarkPreviewValueOverlapStats[] = [];

  items.forEach((item) => {
    const previewCells = item.cells.filter((cell) => cell.rawValue.trim().length > 0);
    const resolvedPreviewCells = previewCells.map((cell) => ({
      rawValue: cell.rawValue,
      modelId: modelIdByCanonicalKey.get(canonicalKeyByModelName.get(cell.modelName) ?? "") ?? null
    }));

    item.candidateBenchmarkIds.forEach((candidateBenchmarkId) => {
      let modelOverlapCount = 0;
      let exactDuplicateCount = 0;
      let conflictCount = 0;
      const candidateBenchmarkName = benchmarkNameById.get(candidateBenchmarkId) ?? "";

      resolvedPreviewCells.forEach((cell) => {
        if (cell.modelId === null) {
          return;
        }

        const existingValueKeys = existingValuesByBenchmarkModel.get(`${candidateBenchmarkId}:${cell.modelId}`);
        if (!existingValueKeys) {
          return;
        }

        modelOverlapCount += 1;

        const previewValue = normalizeStoredBenchmarkValue(candidateBenchmarkName, parseBenchmarkValue(cell.rawValue));
        const previewValueKey = getBenchmarkOverlapValueKey(previewValue);
        if (existingValueKeys.has(previewValueKey)) {
          exactDuplicateCount += 1;
        } else {
          conflictCount += 1;
        }
      });

      stats.push({
        previewBenchmarkKey: item.previewBenchmarkKey,
        candidateBenchmarkId,
        previewTotal: previewCells.length,
        modelOverlapCount,
        exactDuplicateCount,
        conflictCount,
        duplicateRate: previewCells.length > 0 ? exactDuplicateCount / previewCells.length : 0
      });
    });
  });

  return { stats };
}

export async function mergeEntity(input: {
  entityType: "model" | "benchmark";
  sourceId: number;
  targetId: number;
  targetBenchmarkName?: string;
  targetBenchmarkType?: string;
}) {
  if (input.sourceId === input.targetId) {
    throw new Error("sourceId and targetId cannot be the same");
  }

  await db.transaction(async (tx: DbTransactionClient) => {
    if (input.entityType === "model") {
      await tx
        .update(benchmarkValues)
        .set({ modelId: input.targetId })
        .where(eq(benchmarkValues.modelId, input.sourceId));

      await tx
        .update(models)
        .set({ mergedIntoModelId: input.targetId })
        .where(and(eq(models.id, input.sourceId), isNull(models.mergedIntoModelId)));

      return;
    }

    const normalizedTargetBenchmarkName = input.targetBenchmarkName
      ? normalizeNameParenthesisSpacing(input.targetBenchmarkName)
      : "";
    const normalizedTargetBenchmarkType = input.targetBenchmarkType
      ? normalizeNameParenthesisSpacing(input.targetBenchmarkType).trim()
      : "";

    if (normalizedTargetBenchmarkName.length > 0 || normalizedTargetBenchmarkType.length > 0) {
      const [targetBenchmark] = await tx
        .select({
          benchmarkName: benchmarks.benchmarkName,
          benchmarkType: benchmarks.benchmarkType
        })
        .from(benchmarks)
        .where(eq(benchmarks.id, input.targetId))
        .limit(1);

      if (!targetBenchmark) {
        throw new Error(`target benchmark not found: ${input.targetId}`);
      }

      const nextBenchmarkName = normalizedTargetBenchmarkName.length > 0
        ? normalizedTargetBenchmarkName
        : targetBenchmark.benchmarkName;
      const nextBenchmarkType = normalizedTargetBenchmarkType.length > 0
        ? normalizedTargetBenchmarkType
        : targetBenchmark.benchmarkType;

      const dedupeRule = await getModelDedupeRule();
      const nextCanonicalKey = buildBenchmarkCanonicalKey(
        nextBenchmarkName,
        nextBenchmarkType,
        dedupeRule
      );

      const [canonicalOwner] = await tx
        .select({ id: benchmarks.id })
        .from(benchmarks)
        .where(eq(benchmarks.canonicalKey, nextCanonicalKey))
        .limit(1);

      const [nameTypeOwner] = await tx
        .select({ id: benchmarks.id })
        .from(benchmarks)
        .where(
          and(
            eq(benchmarks.benchmarkName, nextBenchmarkName),
            eq(benchmarks.benchmarkType, nextBenchmarkType)
          )
        )
        .limit(1);

      const hasCanonicalConflict = canonicalOwner && canonicalOwner.id !== input.targetId;
      const hasNameTypeConflict = nameTypeOwner && nameTypeOwner.id !== input.targetId;

      const canonicalConflictWithSource = hasCanonicalConflict && canonicalOwner.id === input.sourceId;
      const nameTypeConflictWithSource = hasNameTypeConflict && nameTypeOwner.id === input.sourceId;

      if (hasCanonicalConflict && !canonicalConflictWithSource) {
        throw new Error(
          `target benchmark rename conflicts with existing canonical key (benchmarkId=${canonicalOwner.id})`
        );
      }

      if (hasNameTypeConflict && !nameTypeConflictWithSource) {
        throw new Error(
          `target benchmark rename conflicts with existing benchmark name/type (benchmarkId=${nameTypeOwner.id})`
        );
      }

      if (canonicalConflictWithSource || nameTypeConflictWithSource) {
        const [sourceBenchmarkIdentity] = await tx
          .select({
            benchmarkName: benchmarks.benchmarkName,
            canonicalKey: benchmarks.canonicalKey
          })
          .from(benchmarks)
          .where(eq(benchmarks.id, input.sourceId))
          .limit(1);

        if (!sourceBenchmarkIdentity) {
          throw new Error(`source benchmark not found: ${input.sourceId}`);
        }

        const tempSuffix = `#merged-${input.sourceId}-${Date.now()}`;
        await tx
          .update(benchmarks)
          .set({
            benchmarkName: `${sourceBenchmarkIdentity.benchmarkName}${tempSuffix}`,
            canonicalKey: `${sourceBenchmarkIdentity.canonicalKey}${tempSuffix}`
          })
          .where(eq(benchmarks.id, input.sourceId));
      }

      await tx
        .update(benchmarks)
        .set({
          benchmarkName: nextBenchmarkName,
          benchmarkType: nextBenchmarkType,
          canonicalKey: nextCanonicalKey
        })
        .where(eq(benchmarks.id, input.targetId));
    }

    const [sourceBenchmark] = await tx
      .select({
        benchmarkType: benchmarks.benchmarkType,
        modalities: benchmarks.modalities
      })
      .from(benchmarks)
      .where(eq(benchmarks.id, input.sourceId))
      .limit(1);

    const sourceValueSourceRows = await tx
      .select({ source: benchmarkValues.source })
      .from(benchmarkValues)
      .where(eq(benchmarkValues.benchmarkId, input.sourceId));

    const sourceMetaRows = await tx
      .select({
        source: benchmarkSourceMeta.source,
        benchmarkType: benchmarkSourceMeta.benchmarkType,
        modalities: benchmarkSourceMeta.modalities
      })
      .from(benchmarkSourceMeta)
      .where(eq(benchmarkSourceMeta.benchmarkId, input.sourceId));

    await tx
      .update(benchmarkValues)
      .set({ benchmarkId: input.targetId })
      .where(eq(benchmarkValues.benchmarkId, input.sourceId));

    const sourceSet = new Set<string>();
    sourceValueSourceRows.forEach((row: { source: string | null }) => {
      const normalizedSource = row.source?.trim() ?? "";
      if (normalizedSource.length > 0) {
        sourceSet.add(normalizedSource);
      }
    });

    const sourceMetaBySource = new Map<string, { benchmarkType: string; modalities: string[] | null }>();
    sourceMetaRows.forEach((row: { source: string; benchmarkType: string; modalities: string[] | null }) => {
      const normalizedSource = row.source.trim();
      if (!normalizedSource) return;

      if (!sourceMetaBySource.has(normalizedSource)) {
        sourceMetaBySource.set(normalizedSource, {
          benchmarkType: row.benchmarkType,
          modalities: row.modalities
        });
      }

      sourceSet.add(normalizedSource);
    });

    const fallbackBenchmarkType = sourceBenchmark?.benchmarkType ?? "general";
    const fallbackModalities = sourceBenchmark?.modalities?.length ? sourceBenchmark.modalities : ["Text"];

    const sourceMetaRowsToMigrate = Array.from(sourceSet).map((source) => {
      const sourceMeta = sourceMetaBySource.get(source);

      return {
        benchmarkId: input.targetId,
        source,
        benchmarkType: sourceMeta?.benchmarkType ?? fallbackBenchmarkType,
        modalities: sourceMeta?.modalities ?? fallbackModalities
      };
    });

    if (sourceMetaRowsToMigrate.length > 0) {
      await tx
        .insert(benchmarkSourceMeta)
        .values(sourceMetaRowsToMigrate)
        .onConflictDoNothing({
          target: [benchmarkSourceMeta.benchmarkId, benchmarkSourceMeta.source]
        });
    }

    if (sourceMetaRows.length > 0) {
      await tx
        .delete(benchmarkSourceMeta)
        .where(eq(benchmarkSourceMeta.benchmarkId, input.sourceId));
    }

    await tx
      .update(benchmarks)
      .set({ mergedIntoBenchmarkId: input.targetId })
      .where(and(eq(benchmarks.id, input.sourceId), isNull(benchmarks.mergedIntoBenchmarkId)));
  });

  await invalidateAllCaches();
}

export type RenameEntityInput =
  | {
      entityType: "model";
      entityId: number;
      nextName: string;
      nextProviderId?: number;
      mergeOnConflict?: boolean;
    }
  | {
      entityType: "benchmark";
      entityId: number;
      nextName: string;
      nextBenchmarkType?: string;
      mergeOnConflict?: boolean;
    }
  | {
      entityType: "source";
      sourceName: string;
      nextName: string;
      mergeOnConflict?: boolean;
    };

export type RenameEntityResult = {
  ok: true;
  entityType: "model" | "benchmark" | "source";
  entityId?: number;
  previousName: string;
  nextName: string;
  previousProviderId?: number;
  nextProviderId?: number;
  previousBenchmarkType?: string;
  nextBenchmarkType?: string;
  action: "renamed" | "merged-and-renamed" | "unchanged";
  mergedSourceId?: number;
  mergedSourceName?: string;
  renamedValueCount?: number;
  renamedSourceMetaCount?: number;
  mergedSourceMetaCount?: number;
};

export async function renameEntity(input: RenameEntityInput): Promise<RenameEntityResult> {
  const mergeOnConflict = input.mergeOnConflict !== false;

  if (input.entityType === "source") {
    const previousSource = input.sourceName.trim();
    const nextSource = input.nextName.trim();

    if (!previousSource) {
      throw new Error("sourceName is required");
    }

    if (!nextSource) {
      throw new Error("nextName is required");
    }

    const result = await db.transaction(async (tx: DbTransactionClient): Promise<RenameEntityResult> => {
      const previousValueRows = await tx
        .select({ id: benchmarkValues.id })
        .from(benchmarkValues)
        .where(eq(benchmarkValues.source, previousSource))
        .limit(1);

      const previousMetaRows = await tx
        .select({
          id: benchmarkSourceMeta.id,
          benchmarkId: benchmarkSourceMeta.benchmarkId
        })
        .from(benchmarkSourceMeta)
        .where(eq(benchmarkSourceMeta.source, previousSource));

      if (previousValueRows.length === 0 && previousMetaRows.length === 0) {
        throw new Error(`source not found: ${previousSource}`);
      }

      if (previousSource === nextSource) {
        return {
          ok: true,
          entityType: "source",
          previousName: previousSource,
          nextName: nextSource,
          action: "unchanged",
          renamedValueCount: 0,
          renamedSourceMetaCount: 0,
          mergedSourceMetaCount: 0
        };
      }

      const nextValueRows = await tx
        .select({ id: benchmarkValues.id })
        .from(benchmarkValues)
        .where(eq(benchmarkValues.source, nextSource))
        .limit(1);

      const nextMetaRows = await tx
        .select({
          id: benchmarkSourceMeta.id,
          benchmarkId: benchmarkSourceMeta.benchmarkId
        })
        .from(benchmarkSourceMeta)
        .where(eq(benchmarkSourceMeta.source, nextSource));

      const hasConflict = nextValueRows.length > 0 || nextMetaRows.length > 0;
      if (hasConflict && !mergeOnConflict) {
        throw new Error(`source rename conflicts with existing source (${nextSource})，可开启 mergeOnConflict 自动合并`);
      }

      const targetBenchmarkIds = new Set(nextMetaRows.map((row) => row.benchmarkId));
      const sourceMetaIdsToUpdate = previousMetaRows
        .filter((row) => !targetBenchmarkIds.has(row.benchmarkId))
        .map((row) => row.id);
      const sourceMetaIdsToDelete = previousMetaRows
        .filter((row) => targetBenchmarkIds.has(row.benchmarkId))
        .map((row) => row.id);

      if (sourceMetaIdsToUpdate.length > 0) {
        await tx
          .update(benchmarkSourceMeta)
          .set({ source: nextSource, updatedAt: new Date() })
          .where(inArray(benchmarkSourceMeta.id, sourceMetaIdsToUpdate));
      }

      if (sourceMetaIdsToDelete.length > 0) {
        await tx
          .delete(benchmarkSourceMeta)
          .where(inArray(benchmarkSourceMeta.id, sourceMetaIdsToDelete));
      }

      const updatedValueRows = await tx
        .update(benchmarkValues)
        .set({ source: nextSource })
        .where(eq(benchmarkValues.source, previousSource))
        .returning({ id: benchmarkValues.id });

      return {
        ok: true,
        entityType: "source",
        previousName: previousSource,
        nextName: nextSource,
        action: hasConflict ? "merged-and-renamed" : "renamed",
        mergedSourceName: hasConflict ? nextSource : undefined,
        renamedValueCount: updatedValueRows.length,
        renamedSourceMetaCount: sourceMetaIdsToUpdate.length,
        mergedSourceMetaCount: sourceMetaIdsToDelete.length
      };
    });

    await invalidateAllCaches();

    return result;
  }

  const nextName = normalizeNameParenthesisSpacing(input.nextName);
  if (!nextName) {
    throw new Error("nextName is required");
  }

  const dedupeRule = await getModelDedupeRule();

  if (input.entityType === "benchmark") {
    const [current] = await db
      .select({
        id: benchmarks.id,
        benchmarkName: benchmarks.benchmarkName,
        benchmarkType: benchmarks.benchmarkType,
        canonicalKey: benchmarks.canonicalKey,
        mergedIntoBenchmarkId: benchmarks.mergedIntoBenchmarkId
      })
      .from(benchmarks)
      .where(eq(benchmarks.id, input.entityId))
      .limit(1);

    if (!current) {
      throw new Error(`benchmark not found: ${input.entityId}`);
    }

    if (current.mergedIntoBenchmarkId !== null) {
      throw new Error(`benchmark ${input.entityId} 已被合并到 ${current.mergedIntoBenchmarkId}，请改名目标实体`);
    }

    const normalizedNextBenchmarkType = normalizeNameParenthesisSpacing(
      input.nextBenchmarkType?.trim() || current.benchmarkType
    ).trim() || current.benchmarkType;

    const nextCanonicalKey = buildBenchmarkCanonicalKey(nextName, normalizedNextBenchmarkType, dedupeRule);

    const [conflict] = await db
      .select({
        id: benchmarks.id,
        benchmarkName: benchmarks.benchmarkName,
        benchmarkType: benchmarks.benchmarkType,
        mergedIntoBenchmarkId: benchmarks.mergedIntoBenchmarkId
      })
      .from(benchmarks)
      .where(
        and(
          ne(benchmarks.id, input.entityId),
          or(
            eq(benchmarks.canonicalKey, nextCanonicalKey),
            and(eq(benchmarks.benchmarkName, nextName), eq(benchmarks.benchmarkType, normalizedNextBenchmarkType))
          )
        )
      )
      .limit(1);

    if (!conflict) {
      if (
        current.benchmarkName === nextName
        && current.benchmarkType === normalizedNextBenchmarkType
        && current.canonicalKey === nextCanonicalKey
      ) {
        return {
          ok: true,
          entityType: "benchmark",
          entityId: current.id,
          previousName: current.benchmarkName,
          nextName,
          previousBenchmarkType: current.benchmarkType,
          nextBenchmarkType: normalizedNextBenchmarkType,
          action: "unchanged"
        };
      }

      await db
        .update(benchmarks)
        .set({
          benchmarkName: nextName,
          benchmarkType: normalizedNextBenchmarkType,
          canonicalKey: nextCanonicalKey
        })
        .where(eq(benchmarks.id, current.id));

      await invalidateAllCaches();

      return {
        ok: true,
        entityType: "benchmark",
        entityId: current.id,
        previousName: current.benchmarkName,
        nextName,
        previousBenchmarkType: current.benchmarkType,
        nextBenchmarkType: normalizedNextBenchmarkType,
        action: "renamed"
      };
    }

    if (!mergeOnConflict) {
      throw new Error(
        `benchmark rename conflicts with existing entity (benchmarkId=${conflict.id})，可开启 mergeOnConflict 自动合并`
      );
    }

    await mergeEntity({
      entityType: "benchmark",
      sourceId: conflict.id,
      targetId: current.id,
      targetBenchmarkName: nextName,
      targetBenchmarkType: normalizedNextBenchmarkType
    });

    return {
      ok: true,
      entityType: "benchmark",
      entityId: current.id,
      previousName: current.benchmarkName,
      nextName,
      previousBenchmarkType: current.benchmarkType,
      nextBenchmarkType: normalizedNextBenchmarkType,
      action: "merged-and-renamed",
      mergedSourceId: conflict.id,
      mergedSourceName: conflict.benchmarkName
    };
  }

  const result: RenameEntityResult = await db.transaction(async (tx: DbTransactionClient): Promise<RenameEntityResult> => {
    const [current] = await tx
      .select({
        id: models.id,
        providerId: models.providerId,
        modelName: models.modelName,
        canonicalKey: models.canonicalKey,
        mergedIntoModelId: models.mergedIntoModelId
      })
      .from(models)
      .where(eq(models.id, input.entityId))
      .limit(1);

    if (!current) {
      throw new Error(`model not found: ${input.entityId}`);
    }

    if (current.mergedIntoModelId !== null) {
      throw new Error(`model ${input.entityId} 已被合并到 ${current.mergedIntoModelId}，请改名目标实体`);
    }

    const nextProviderId = input.nextProviderId ?? current.providerId;
    if (!Number.isInteger(nextProviderId) || nextProviderId <= 0) {
      throw new Error("nextProviderId must be a positive integer");
    }

    if (nextProviderId !== current.providerId) {
      const [targetProvider] = await tx
        .select({ id: providers.id })
        .from(providers)
        .where(eq(providers.id, nextProviderId))
        .limit(1);

      if (!targetProvider) {
        throw new Error(`provider not found: ${nextProviderId}`);
      }
    }

    const nextCanonicalKey = buildModelCanonicalKey(nextName, dedupeRule);

    const [conflict] = await tx
      .select({
        id: models.id,
        modelName: models.modelName,
        canonicalKey: models.canonicalKey,
        mergedIntoModelId: models.mergedIntoModelId
      })
      .from(models)
      .where(
        and(
          ne(models.id, input.entityId),
          or(
            eq(models.canonicalKey, nextCanonicalKey),
            and(eq(models.providerId, nextProviderId), eq(models.modelName, nextName))
          )
        )
      )
      .limit(1);

    let action: RenameEntityResult["action"] = "renamed";
    let mergedSourceId: number | undefined;
    let mergedSourceName: string | undefined;

    if (!conflict) {
      if (current.modelName === nextName && current.canonicalKey === nextCanonicalKey && current.providerId === nextProviderId) {
        return {
          ok: true,
          entityType: "model" as const,
          entityId: current.id,
          previousName: current.modelName,
          nextName,
          previousProviderId: current.providerId,
          nextProviderId,
          action: "unchanged" as const
        };
      }
    } else {
      if (!mergeOnConflict) {
        throw new Error(
          `model rename conflicts with existing entity (modelId=${conflict.id})，可开启 mergeOnConflict 自动合并`
        );
      }

      const tempSuffix = `#merged-${conflict.id}-${Date.now()}`;

      if (conflict.mergedIntoModelId === null) {
        await tx
          .update(benchmarkValues)
          .set({ modelId: current.id })
          .where(eq(benchmarkValues.modelId, conflict.id));

        await tx
          .update(models)
          .set({ mergedIntoModelId: current.id })
          .where(eq(models.mergedIntoModelId, conflict.id));
      }

      await tx
        .update(models)
        .set({
          mergedIntoModelId: conflict.mergedIntoModelId ?? current.id,
          modelName: `${conflict.modelName}${tempSuffix}`,
          canonicalKey: `${conflict.canonicalKey}${tempSuffix}`
        })
        .where(eq(models.id, conflict.id));

      action = "merged-and-renamed";
      mergedSourceId = conflict.id;
      mergedSourceName = conflict.modelName;
    }

    await tx
      .update(models)
      .set({
        providerId: nextProviderId,
        modelName: nextName,
        canonicalKey: nextCanonicalKey
      })
      .where(eq(models.id, current.id));

    return {
      ok: true,
      entityType: "model" as const,
      entityId: current.id,
      previousName: current.modelName,
      nextName,
      previousProviderId: current.providerId,
      nextProviderId,
      action,
      mergedSourceId,
      mergedSourceName
    };
  });

  await invalidateAllCaches();

  return result;
}

export async function updateMergedEntityRecord(input: {
  entityType: "model" | "benchmark";
  sourceId: number;
  targetId: number;
}) {
  if (input.sourceId === input.targetId) {
    throw new Error("sourceId and targetId cannot be the same");
  }

  if (input.entityType === "model") {
    await db
      .update(models)
      .set({ mergedIntoModelId: input.targetId })
      .where(eq(models.id, input.sourceId));
  } else {
    await db
      .update(benchmarks)
      .set({ mergedIntoBenchmarkId: input.targetId })
      .where(eq(benchmarks.id, input.sourceId));
  }

  await invalidateAllCaches();

  return { ok: true };
}

export async function deleteMergedEntityRecord(input: {
  entityType: "model" | "benchmark";
  sourceId: number;
}) {
  if (input.entityType === "model") {
    await db
      .update(models)
      .set({ mergedIntoModelId: null })
      .where(eq(models.id, input.sourceId));
  } else {
    await db
      .update(benchmarks)
      .set({ mergedIntoBenchmarkId: null })
      .where(eq(benchmarks.id, input.sourceId));
  }

  await invalidateAllCaches();

  return { ok: true };
}

export async function importParsedRecords(
  records: ParsedImportRecord[],
  options?: {
    benchTime?: Date;
    source?: string | null;
  }
) {
  const rows: NormalizedTextImportRow[] = records
    .filter((record) => record.valid)
    .map((record, index) => ({
      rowNumber: record.rowNumber ?? index + 1,
      providerName: inferProviderNameFromModel(normalizeNameParenthesisSpacing(record.modelName)),
      modelName: normalizeNameParenthesisSpacing(record.modelName),
      benchmarkName: normalizeNameParenthesisSpacing(record.benchmarkName),
      benchmarkType: (record.category || "general").trim() || "general",
      benchmarkTypeProvided: Boolean(record.category && record.category.trim().length > 0),
      valueRaw: record.rawValue,
      valueNote: null,
      benchTime: options?.benchTime ?? new Date(),
      unit: "score",
      higherIsBetter: record.higherIsBetter
        ?? !isLowerBetterBenchmark(
          normalizeNameParenthesisSpacing(record.benchmarkName),
          (record.category || "general").trim() || "general"
        ),
      modalities: inferModalitiesFromCategory(record.category),
      source: options?.source ?? "xlsm-import",
      modelAlias: null,
      sourceModelId: null,
      sourceBenchmarkId: null
    }));

  const expandedRows = expandMetricLabeledImportRows(rows);
  const { inserted } = await importNormalizedRows(expandedRows);

  return {
    total: expandedRows.length,
    inserted
  };
}

async function importNormalizedRows(rows: NormalizedTextImportRow[]) {
  if (rows.length === 0) {
    return { inserted: 0 };
  }

  const dedupeRule = await getModelDedupeRule();

  const result = await db.transaction(async (tx: DbTransactionClient) => {
    const providerCache = new Map<string, Awaited<ReturnType<typeof ensureProvider>>>();
    const modelCache = new Map<string, Awaited<ReturnType<typeof ensureModelByProviderId>>>();
    const benchmarkByNameCache = new Map<string, Array<typeof benchmarks.$inferSelect>>();
    const benchmarkByCanonicalKeyCache = new Map<string, typeof benchmarks.$inferSelect>();
    const sourceMetaUpsertMap = new Map<
      string,
      {
        benchmarkId: number;
        source: string;
        benchmarkType: string;
        modalities: string[];
      }
    >();
    const valueRows: Array<typeof benchmarkValues.$inferInsert> = [];

    const existingBenchmarks = await tx
      .select()
      .from(benchmarks)
      .where(or(isNull(benchmarks.mergedIntoBenchmarkId), isNotNull(benchmarks.mergedIntoBenchmarkId))) as Array<typeof benchmarks.$inferSelect>;

    const existingActiveBenchmarks = existingBenchmarks.filter((benchmark) => benchmark.mergedIntoBenchmarkId === null);

    existingActiveBenchmarks
      .filter((benchmark) => benchmark.mergedIntoBenchmarkId === null)
      .sort((left, right) => left.id - right.id)
      .forEach((benchmark) => {
        const benchmarkNameKey = benchmark.benchmarkName.trim().toLowerCase();
        if (!benchmarkNameKey) return;
        if (!benchmarkByNameCache.has(benchmarkNameKey)) {
          benchmarkByNameCache.set(benchmarkNameKey, []);
        }
        benchmarkByNameCache.get(benchmarkNameKey)?.push(benchmark);
        benchmarkByCanonicalKeyCache.set(benchmark.canonicalKey, benchmark);
      });

    const existingMergedBenchmarks = existingBenchmarks.filter((benchmark) => benchmark.mergedIntoBenchmarkId !== null);

    existingMergedBenchmarks
      .sort((left, right) => left.id - right.id)
      .forEach((benchmark) => {
        if (!benchmark.mergedIntoBenchmarkId) return;

        const targetId = benchmark.mergedIntoBenchmarkId;
        let target = existingBenchmarks.find((item) => item.id === targetId) ?? null;
        const seenIds = new Set<number>([benchmark.id, targetId]);
        while (target && target.mergedIntoBenchmarkId !== null) {
          const nextId = target.mergedIntoBenchmarkId;
          if (seenIds.has(nextId)) break;
          seenIds.add(nextId);
          target = existingBenchmarks.find((item) => item.id === nextId) ?? null;
        }

        if (!target) return;

        benchmarkByCanonicalKeyCache.set(benchmark.canonicalKey, target);

        const benchmarkNameKey = benchmark.benchmarkName.trim().toLowerCase();
        if (benchmarkNameKey) {
          if (!benchmarkByNameCache.has(benchmarkNameKey)) {
            benchmarkByNameCache.set(benchmarkNameKey, []);
          }
          const list = benchmarkByNameCache.get(benchmarkNameKey)!;
          if (!list.some(item => item.id === target.id)) {
            list.push(target);
          }
        }
      });

    const upsertBenchmarkByNameCache = (benchmark: typeof benchmarks.$inferSelect) => {
      // Also update all existing alias entries that point to this benchmark
      for (const [key, list] of benchmarkByNameCache.entries()) {
        const index = list.findIndex(item => item.id === benchmark.id);
        if (index !== -1) {
          const next = [...list];
          next[index] = benchmark;
          benchmarkByNameCache.set(key, next);
        }
      }

      const benchmarkNameKey = benchmark.benchmarkName.trim().toLowerCase();
      if (!benchmarkNameKey) return;

      const existing = benchmarkByNameCache.get(benchmarkNameKey) ?? [];
      if (!existing.some(item => item.id === benchmark.id)) {
        const next = [...existing, benchmark].sort((left, right) => left.id - right.id);
        benchmarkByNameCache.set(benchmarkNameKey, next);
      }

      benchmarkByCanonicalKeyCache.set(benchmark.canonicalKey, benchmark);
    };

    const pickSharedBenchmark = (benchmarkName: string, benchmarkType: string) => {
      const benchmarkNameKey = benchmarkName.trim().toLowerCase();
      if (!benchmarkNameKey) return null;

      const candidates = benchmarkByNameCache.get(benchmarkNameKey) ?? [];
      if (candidates.length === 0) return null;

      const normalizedType = benchmarkType.trim().toLowerCase();
      return candidates.find((item) => item.benchmarkType.trim().toLowerCase() === normalizedType) ?? candidates[0] ?? null;
    };

    const pickExistingEloBenchmark = (benchmarkName: string, benchmarkType: string) => {
      const eloBenchmarkName = toBenchmarkEloName(benchmarkName);
      const eloBenchmark = pickSharedBenchmark(eloBenchmarkName, benchmarkType);
      if (eloBenchmark) return eloBenchmark;

      const normalizedType = benchmarkType.trim().toLowerCase();
      const candidates = benchmarkByNameCache.get(eloBenchmarkName.trim().toLowerCase()) ?? [];
      return candidates.find((item) => item.benchmarkType.trim().toLowerCase() === normalizedType) ?? null;
    };

    const pickBenchmarkByCanonicalKey = (benchmarkName: string, benchmarkType: string) => {
      const canonicalKey = buildBenchmarkCanonicalKey(benchmarkName, benchmarkType, dedupeRule);
      return benchmarkByCanonicalKeyCache.get(canonicalKey) ?? null;
    };

    for (const row of rows) {
      try {
        const providerName = row.providerName.trim() || "Unknown";
        const providerKey = toProviderSlug(providerName);
        let provider = providerCache.get(providerKey);
        if (!provider) {
          provider = await ensureProvider(providerName, { db: tx });
          providerCache.set(providerKey, provider);
        }

        const modelCanonicalKey = buildModelCanonicalKey(row.modelName, dedupeRule);
        let model = modelCache.get(modelCanonicalKey);
        if (!model) {
          model = await ensureModelByProviderId(
            {
              providerId: provider.id,
              modelName: row.modelName,
              modelAlias: row.modelAlias,
              sourceModelId: row.sourceModelId
            },
            { dedupeRule, db: tx }
          );
          modelCache.set(modelCanonicalKey, model);
        }

        const benchmarkType = row.benchmarkType.trim() || "general";
        const hasImportedBenchmarkType = row.benchmarkTypeProvided;
        const hasNonGeneralParsedBenchmarkType = benchmarkType.toLowerCase() !== "general";
        const benchmarkTypeForSelection = (hasImportedBenchmarkType || hasNonGeneralParsedBenchmarkType)
          ? benchmarkType
          : "general";
        const parsedValue = parseBenchmarkValue(row.valueRaw);
        let benchmark = pickSharedBenchmark(row.benchmarkName, benchmarkTypeForSelection)
          ?? pickBenchmarkByCanonicalKey(row.benchmarkName, benchmarkType);

        if (shouldPreferExistingEloBenchmarkForImport(row.benchmarkName, parsedValue)) {
          benchmark = pickExistingEloBenchmark(row.benchmarkName, benchmarkTypeForSelection) ?? benchmark;
        }

        if (!benchmark) {
          const createdBenchmark = await ensureBenchmark(
            {
              benchmarkName: row.benchmarkName,
              benchmarkType,
              unit: row.unit,
              higherIsBetter: row.higherIsBetter,
              modalities: row.modalities,
              sourceBenchmarkId: row.sourceBenchmarkId
            },
            { dedupeRule, db: tx }
          );
          benchmark = createdBenchmark;

          upsertBenchmarkByNameCache(createdBenchmark);

          const rowAliasKey = row.benchmarkName.trim().toLowerCase();
          if (rowAliasKey && rowAliasKey !== createdBenchmark.benchmarkName.trim().toLowerCase()) {
            if (!benchmarkByNameCache.has(rowAliasKey)) {
              benchmarkByNameCache.set(rowAliasKey, []);
            }
            const list = benchmarkByNameCache.get(rowAliasKey)!;
            if (!list.some(item => item.id === createdBenchmark.id)) {
              const next = [...list, createdBenchmark].sort((left, right) => left.id - right.id);
              benchmarkByNameCache.set(rowAliasKey, next);
            }
          }
        }

        if (!benchmark) {
          throw new Error(`未能解析 benchmark：${row.benchmarkName}`);
        }

        const shouldForceLowerIsBetter = isLowerBetterBenchmark(benchmark.benchmarkName, benchmark.benchmarkType)
          || row.higherIsBetter === false;
        if (shouldForceLowerIsBetter && benchmark.higherIsBetter) {
          const updatedBenchmarkResult = await tx
            .update(benchmarks)
            .set({ higherIsBetter: false })
            .where(eq(benchmarks.id, benchmark.id))
            .returning();

          benchmark = firstResultRow<typeof benchmarks.$inferSelect>(updatedBenchmarkResult)
            ?? { ...benchmark, higherIsBetter: false };

          upsertBenchmarkByNameCache(benchmark);
        }

        const normalizedSource = row.source?.trim() ?? "";
        const normalizedSourceOrNull = normalizedSource.length > 0 ? normalizedSource : null;

        if (normalizedSourceOrNull) {
          const sourceBenchmarkType = hasImportedBenchmarkType
            ? benchmarkType
            : benchmark.benchmarkType;
          const sourceModalities = hasImportedBenchmarkType
            ? normalizeModalities(
              row.modalities?.length ? row.modalities : [sourceBenchmarkType]
            )
            : normalizeModalities(benchmark.modalities);

          const sourceMetaKey = `${benchmark.id}::${normalizedSourceOrNull}`;
          sourceMetaUpsertMap.set(sourceMetaKey, {
            benchmarkId: benchmark.id,
            source: normalizedSourceOrNull,
            benchmarkType: sourceBenchmarkType,
            modalities: sourceModalities
          });
        }

        const normalizedValue = normalizeStoredBenchmarkValue(benchmark.benchmarkName, parsedValue);
        const mergedValueNote = mergeImportValueNotes(row.valueNote, normalizedValue.valueNote);
        valueRows.push({
          modelId: model.id,
          benchmarkId: benchmark.id,
          benchTime: row.benchTime,
          valueRaw: normalizedValue.valueRaw,
          valueNum: normalizedValue.valueNum !== null ? String(normalizedValue.valueNum) : null,
          valueNum2: normalizedValue.valueNum2 !== null ? String(normalizedValue.valueNum2) : null,
          valueNote: mergedValueNote,
          source: normalizedSourceOrNull
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown import error";
        throw new Error(
          `导入失败：row=${row.rowNumber}，model=${row.modelName}，benchmark=${row.benchmarkName}，raw=${row.valueRaw}，原因=${message}`
        );
      }
    }

    const batchSize = 500;
    for (let index = 0; index < valueRows.length; index += batchSize) {
      const chunk = valueRows.slice(index, index + batchSize);
      if (chunk.length === 0) continue;
      await tx.insert(benchmarkValues).values(chunk);
    }

    const sourceMetaRows = Array.from(sourceMetaUpsertMap.values());
    for (let index = 0; index < sourceMetaRows.length; index += batchSize) {
      const chunk = sourceMetaRows.slice(index, index + batchSize);
      if (chunk.length === 0) continue;

      await tx
        .insert(benchmarkSourceMeta)
        .values(chunk)
        .onConflictDoUpdate({
          target: [benchmarkSourceMeta.benchmarkId, benchmarkSourceMeta.source],
          set: {
            benchmarkType: sql`excluded.benchmark_type`,
            modalities: sql`excluded.modalities`,
            updatedAt: sql`now()`
          }
        });
    }

    return { inserted: valueRows.length };
  });

  await invalidateAllCaches();

  return result;
}

export async function importStructuredRows(
  rows: StructuredImportRowInput[],
  options?: {
    source?: string | null;
    benchTime?: Date;
  }
) {
  const normalizedRows: NormalizedTextImportRow[] = [];
  const resolveProviderName = await buildProviderCanonicalNameResolver(rows);

  for (const [index, row] of rows.entries()) {
      const modelName = normalizeNameParenthesisSpacing(row.modelName || "");
      const benchmarkName = normalizeNameParenthesisSpacing(row.benchmarkName || "");
      const benchmarkType = (row.benchmarkType || "general").trim() || "general";
      const rawBenchTime = row.benchTime ?? options?.benchTime ?? new Date();
      const benchTime = rawBenchTime instanceof Date ? rawBenchTime : new Date(rawBenchTime);

      if (!modelName || !benchmarkName || isEmptyImportValue(row.rawValue) || Number.isNaN(benchTime.getTime())) {
        continue;
      }

      let providerName = row.providerName?.trim() || "";
      if (!providerName) {
        try {
          providerName = resolveProviderName(modelName).trim();
        } catch {
          providerName = "";
        }
      }

      if (!providerName) {
        providerName = inferProviderNameFromModel(modelName);
      }

      normalizedRows.push({
        rowNumber: row.rowNumber ?? index + 1,
        providerName,
        modelName,
        benchmarkName,
        benchmarkType,
        benchmarkTypeProvided: row.benchmarkTypeProvided ?? Boolean(row.benchmarkType?.trim()),
        valueRaw: row.rawValue,
        valueNote: row.valueNote?.trim() || null,
        benchTime,
        unit: (row.unit || "score").trim() || "score",
        higherIsBetter: row.higherIsBetter
          ?? !isLowerBetterBenchmark(benchmarkName, benchmarkType),
        modalities: normalizeModalities(row.modalities?.length ? row.modalities : [benchmarkType]),
        source: normalizeTextImportSource(row.source) ?? normalizeTextImportSource(options?.source) ?? null,
        modelAlias: row.modelAlias ?? null,
        sourceModelId: row.sourceModelId ?? null,
        sourceBenchmarkId: row.sourceBenchmarkId ?? null
      });
  }

  const expandedRows = expandMetricLabeledImportRows(normalizedRows);
  const { inserted } = await importNormalizedRows(expandedRows);

  return {
    total: expandedRows.length,
    inserted,
    skipped: Math.max(0, rows.length - normalizedRows.length),
    format: "structured-preview"
  };
}

function parseStructuredCsvRows(inputText: string, defaultSource: string | null): ParsedTextImportResult {
  const parsedRows = parse(inputText, {
    columns: true,
    skipEmptyLines: true,
    trim: true
  }) as Record<string, string>[];

  const rows: NormalizedTextImportRow[] = [];
  let skipped = 0;

  parsedRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const modelName = normalizeNameParenthesisSpacing((row.model || row.model_name || ""));
    const benchmarkInput = normalizeNameParenthesisSpacing((row.benchmark || row.benchmark_name || ""));
    const normalizedBenchmarkInput = normalizeBenchmarkImportName(benchmarkInput);
    const benchmarkDirection = parseBenchmarkNameAndDirection(normalizedBenchmarkInput);
    const benchmarkName = benchmarkDirection.benchmarkName;
    const valueRawInput = row.value_raw || row.value || "";

    if (!modelName || !benchmarkName || isEmptyImportValue(valueRawInput)) {
      skipped += 1;
      return;
    }

    const { valueRaw, valueNote } = normalizeImportedValueAndExtractNote(
      valueRawInput,
      toNullableText(row.value_note || row.valueNote || row.note)
    );
    const providerName = (row.provider || row.provider_name || "").trim() || inferProviderNameFromModel(modelName);
    const benchmarkTypeInput = (row.benchmark_type || row.type || "").trim();
    const benchmarkTypeProvidedFlagRaw = (row.benchmark_type_provided || row.type_provided || "")
      .trim()
      .toLowerCase();
    const benchmarkTypeProvided = benchmarkTypeProvidedFlagRaw
      ? ["1", "true", "yes", "y"].includes(benchmarkTypeProvidedFlagRaw)
      : benchmarkTypeInput.length > 0;
    const benchmarkType = benchmarkTypeInput || "general";
    const inferredHigherIsBetter = parseBoolean(
      row.higher_is_better,
      getInferredHigherIsBetter(valueRaw, benchmarkDirection, benchmarkName, benchmarkType)
    );
    const modalitiesInput = (row.modalities || "").trim();
    const benchTimeRaw = row.bench_time || row.time || row.date || new Date().toISOString();
    const benchTime = new Date(benchTimeRaw);

    if (Number.isNaN(benchTime.getTime())) {
      skipped += 1;
      return;
    }

    rows.push({
      rowNumber,
      providerName,
      modelName,
      benchmarkName,
      benchmarkType,
      benchmarkTypeProvided,
      valueRaw,
      valueNote,
      benchTime,
      unit: (row.unit || "score").trim() || "score",
      higherIsBetter: inferredHigherIsBetter,
      modalities: modalitiesInput
        ? modalitiesInput.split(",").map((item) => item.trim()).filter(Boolean)
        : inferModalitiesFromCategory(benchmarkType),
      source: normalizeTextImportSource(toNullableText(row.source)) ?? defaultSource,
      modelAlias: toNullableText(row.model_alias),
      sourceModelId: toNullableText(row.source_model_id),
      sourceBenchmarkId: toNullableText(row.source_benchmark_id)
    });
  });

  return {
    format: "structured-csv",
    rows,
    skipped
  };
}

function inferTypeFromPreambleLine(line: string): string | null {
  const normalized = line.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("vision") || normalized.includes("vlm")) return "Vision";
  if (normalized.includes("audio")) return "Audio";
  if (normalized.includes("video")) return "Video";
  if (isMultimodalHint(normalized)) return "Multimodal";
  return null;
}

function looksLikeModelHeaderRow(cells: string[]): boolean {
  const nonEmpty = cells.map((cell) => cell.trim()).filter(Boolean);
  if (nonEmpty.length < 2) return false;

  const numericLikeCount = nonEmpty.filter((cell) => {
    const normalized = normalizeImportedValueRaw(cell);
    if (!/\d/.test(normalized)) return false;
    const parsed = parseBenchmarkValue(normalized);
    return parsed.valueNum !== null || parsed.valueNum2 !== null;
  }).length;

  return numericLikeCount <= 1;
}

function isMatrixValueLikeCell(cell: string): boolean {
  const normalizedCell = cell.trim();
  if (!normalizedCell) return false;

  if (isEmptyImportValue(normalizedCell)) {
    return true;
  }

  if (isPaperTableValueToken(normalizedCell)) {
    return true;
  }

  const normalizedValue = normalizeImportedValueAndExtractNote(normalizedCell).valueRaw;
  const parsedValue = parseBenchmarkValue(normalizedValue);

  return parsedValue.valueNum !== null || parsedValue.valueNum2 !== null;
}

function getTrailingMatrixValueCellCount(cells: string[]): number {
  let count = 0;

  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const currentCell = (cells[index] ?? "").trim();
    if (!currentCell) {
      if (count > 0) {
        break;
      }
      continue;
    }

    if (isMatrixValueLikeCell(currentCell)) {
      count += 1;
      continue;
    }

    if (count > 0) {
      break;
    }
  }

  return count;
}

function joinMatrixLabelFragments(fragments: string[]): string {
  return fragments
    .map((fragment) => fragment.trim())
    .filter(Boolean)
    .join(", ");
}

function inferMatrixModelCountFromDataLines(lines: string[], startLineIndex: number): number | null {
  const trailingValueCounts = lines
    .slice(startLineIndex)
    .map((line) => getTrailingMatrixValueCellCount(splitTableLine(line)))
    .filter((count) => count >= 2);

  if (trailingValueCounts.length === 0) {
    return null;
  }

  const frequency = new Map<number, number>();
  trailingValueCounts.forEach((count) => {
    frequency.set(count, (frequency.get(count) ?? 0) + 1);
  });

  let bestCount = trailingValueCounts[0] ?? 0;
  let bestSupport = -1;

  frequency.forEach((support, count) => {
    if (support > bestSupport || (support === bestSupport && count > bestCount)) {
      bestCount = count;
      bestSupport = support;
    }
  });

  return bestCount >= 2 ? bestCount : null;
}

function hasImplicitMatrixBenchmarkColumn(
  lines: string[],
  startLineIndex: number,
  expectedModelCount: number,
  headerColumnCount: number
): boolean {
  if (expectedModelCount < 2 || headerColumnCount !== expectedModelCount) {
    return false;
  }

  return lines
    .slice(startLineIndex)
    .some((line) => {
      const cells = splitTableLine(line);
      const trailingValueCount = getTrailingMatrixValueCellCount(cells);
      if (trailingValueCount !== expectedModelCount || cells.length < expectedModelCount + 1) {
        return false;
      }

      const leadingCell = joinMatrixLabelFragments(cells.slice(0, cells.length - expectedModelCount));
      return Boolean(leadingCell) && !isMatrixValueLikeCell(leadingCell);
    });
}

function isMatrixBenchmarkContinuationFragment(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;

  return /^[（(]/.test(trimmed) || /^[-–—/:]/.test(trimmed);
}

function normalizeMatrixHeaderMarkerCell(input: string): string {
  return input
    .toLowerCase()
    .replace(/[（）()]/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMatrixBenchmarkHeaderCell(input: string): boolean {
  const normalized = normalizeMatrixHeaderMarkerCell(input);
  if (!normalized) return false;

  if (/\b(benchmark|benchmarks|metric|metrics|dimension|dimensions)\b/.test(normalized)) {
    return true;
  }

  return /(指标|基准|评测基准|评测维度|维度|任务|项目|评测项)/.test(normalized);
}

function isMatrixCategoryHeaderCell(input: string): boolean {
  const normalized = normalizeMatrixHeaderMarkerCell(input);
  if (!normalized) return false;

  if (/\b(category|categories|type|types|domain|domains)\b/.test(normalized)) {
    return true;
  }

  return /(评测大类|大类|类别|分类|领域|赛道)/.test(normalized);
}

function getMatrixRowValues(cells: string[], startIndex: number, count: number): string[] {
  if (count <= 0) return [];

  return Array.from({ length: count }, (_, offset) => (cells[startIndex + offset] || "").trim());
}

function rebalanceMatrixRowCells(
  cells: string[],
  layout: {
    benchmarkColumnIndex: number;
    modelValueStartIndex: number;
    modelCount: number;
  }
): string[] {
  const { benchmarkColumnIndex, modelValueStartIndex, modelCount } = layout;
  const expectedCellCount = modelValueStartIndex + modelCount;

  if (
    modelCount <= 0
    || modelValueStartIndex <= 0
    || cells.length <= expectedCellCount
    || benchmarkColumnIndex < 0
    || benchmarkColumnIndex >= modelValueStartIndex
  ) {
    return cells;
  }

  const labelCellCount = cells.length - modelCount;
  if (
    labelCellCount <= modelValueStartIndex
    || getTrailingMatrixValueCellCount(cells) !== modelCount
  ) {
    return cells;
  }

  const extraLabelCellCount = labelCellCount - modelValueStartIndex;
  const mergeStartIndex = benchmarkColumnIndex;
  const mergeEndIndex = mergeStartIndex + extraLabelCellCount + 1;
  if (mergeEndIndex > labelCellCount) {
    return cells;
  }

  const leadingCells: string[] = [];
  for (let index = 0; index < modelValueStartIndex; index += 1) {
    if (index < mergeStartIndex) {
      leadingCells.push(cells[index] ?? "");
      continue;
    }

    if (index === mergeStartIndex) {
      leadingCells.push(joinMatrixLabelFragments(cells.slice(mergeStartIndex, mergeEndIndex)));
      continue;
    }

    leadingCells.push(cells[index + extraLabelCellCount] ?? "");
  }

  return [...leadingCells, ...cells.slice(labelCellCount)];
}

function hasAnyMatrixValue(values: string[]): boolean {
  return values.some((value) => !isEmptyImportValue(value));
}

function isPureMatrixCategoryRow(categoryInput: string, benchmarkInput: string, modelValues: string[]): boolean {
  if (!categoryInput || benchmarkInput) return false;

  return !hasAnyMatrixValue(modelValues);
}

function parseMatrixTextRows(inputText: string, defaultSource: string | null): ParsedTextImportResult {
  const rawLines = inputText
    .split(/\r?\n/)
    .map((line) => line.replace(/\r/g, "").trimEnd())
    .filter((line) => line.trim().length > 0);

  if (rawLines.length < 2) {
    return {
      format: "matrix-table",
      rows: [],
      skipped: 0
    };
  }

  let headerLineIndex = rawLines.findIndex((line) => looksLikeModelHeaderRow(splitTableLine(line)));
  if (headerLineIndex < 0) {
    headerLineIndex = 0;
  }

  let preambleTypeHint: string | null = null;
  for (let index = 0; index < headerLineIndex; index += 1) {
    const rawPreambleLine = normalizeNameParenthesisSpacing(rawLines[index] || "").trim();
    const hint = inferTypeFromPreambleLine(rawPreambleLine);
    if (hint) {
      preambleTypeHint = hint;
      continue;
    }

    if (isMatrixTypeMarker(rawPreambleLine)) {
      preambleTypeHint = rawPreambleLine;
    }
  }

  const headerCells = splitTableLine(rawLines[headerLineIndex]);
  const inferredModelCountFromData = inferMatrixModelCountFromDataLines(rawLines, headerLineIndex + 1);
  const inferredModelHeaderStartIndex = inferredModelCountFromData !== null
    && inferredModelCountFromData <= headerCells.length
    ? headerCells.length - inferredModelCountFromData
    : null;
  const benchmarkLabelIndex = headerCells.findIndex((cell) =>
    isMatrixBenchmarkHeaderCell(cell)
  );
  const categoryLabelIndex = headerCells.findIndex((cell, index) =>
    index !== benchmarkLabelIndex && isMatrixCategoryHeaderCell(cell)
  );
  const hasExplicitBenchmarkColumn = benchmarkLabelIndex >= 0;
  const hasImplicitBenchmarkColumn = !hasExplicitBenchmarkColumn
    && categoryLabelIndex < 0
    && inferredModelCountFromData !== null
    && hasImplicitMatrixBenchmarkColumn(
      rawLines,
      headerLineIndex + 1,
      inferredModelCountFromData,
      headerCells.length
    );
  const benchmarkColumnIndex = hasExplicitBenchmarkColumn
    ? benchmarkLabelIndex
    : hasImplicitBenchmarkColumn
      ? 0
    : (inferredModelHeaderStartIndex !== null && inferredModelHeaderStartIndex > 0
      ? inferredModelHeaderStartIndex - 1
      : 0);
  const categoryColumnIndex = categoryLabelIndex >= 0
    && categoryLabelIndex !== benchmarkColumnIndex
    ? categoryLabelIndex
    : (
      inferredModelHeaderStartIndex !== null
      && hasExplicitBenchmarkColumn
      && benchmarkColumnIndex > 0
      && inferredModelHeaderStartIndex > benchmarkColumnIndex
      ? benchmarkColumnIndex - 1
      : inferredModelHeaderStartIndex !== null
      && inferredModelHeaderStartIndex >= 2
      && isMatrixCategoryHeaderCell(headerCells[inferredModelHeaderStartIndex - 2] ?? "")
      ? inferredModelHeaderStartIndex - 2
      : -1
    );

  const firstHeaderCell = (headerCells[0] || "").trim();
  const startsWithBenchmarkLabel =
    !firstHeaderCell
    || /benchmark|metric|dimension|type|category|指标|评测|维度|类别|分类/i.test(firstHeaderCell);

  const explicitModelHeaderStartIndex = (() => {
    if (hasExplicitBenchmarkColumn) {
      const maxLabelColumnIndex = Math.max(benchmarkColumnIndex, categoryColumnIndex);
      return maxLabelColumnIndex + 1;
    }

    if (categoryColumnIndex >= 0) {
      return categoryColumnIndex + 1;
    }

    return null;
  })();

  const modelHeaderStartIndex = explicitModelHeaderStartIndex !== null
    ? explicitModelHeaderStartIndex
    : inferredModelHeaderStartIndex !== null
      ? inferredModelHeaderStartIndex
    : (hasExplicitBenchmarkColumn
      ? benchmarkColumnIndex + 1
      : (startsWithBenchmarkLabel ? 1 : 0));
  const modelValueStartIndex = hasImplicitBenchmarkColumn ? 1 : modelHeaderStartIndex;

  const modelNames = headerCells
    .slice(modelHeaderStartIndex)
    .map((cell) => normalizeNameParenthesisSpacing(cell))
    .filter(Boolean);

  if (modelNames.length === 0) {
    return {
      format: "matrix-table",
      rows: [],
      skipped: rawLines.length - 1
    };
  }

  const rows: NormalizedTextImportRow[] = [];
  let skipped = 0;
  const defaultModalities = preambleTypeHint ? inferModalitiesFromCategory(preambleTypeHint) : ["Text"];
  let currentBenchmarkType = preambleTypeHint ?? "General";
  let currentBenchmarkTypeProvided = Boolean((preambleTypeHint ?? "").trim());
  let currentModalities = currentBenchmarkTypeProvided
    ? inferModalitiesFromCategory(currentBenchmarkType)
    : defaultModalities;
  let pendingBenchmarkPrefix: string | null = null;
  const matrixRowLayout = {
    benchmarkColumnIndex,
    modelValueStartIndex,
    modelCount: modelNames.length
  };

  for (let lineIndex = headerLineIndex + 1; lineIndex < rawLines.length; lineIndex += 1) {
    const cells = rebalanceMatrixRowCells(splitTableLine(rawLines[lineIndex]), matrixRowLayout);
    const categoryInput = categoryColumnIndex >= 0
      ? normalizeNameParenthesisSpacing(cells[categoryColumnIndex] || "")
      : "";
    const rawBenchmarkInput = normalizeNameParenthesisSpacing(cells[benchmarkColumnIndex] || "");
    const modelValues = getMatrixRowValues(cells, modelValueStartIndex, modelNames.length);

    if (isPureMatrixCategoryRow(categoryInput, rawBenchmarkInput, modelValues)) {
      currentBenchmarkType = categoryInput;
      currentBenchmarkTypeProvided = true;
      currentModalities = inferModalitiesFromCategory(categoryInput);
      pendingBenchmarkPrefix = null;
      continue;
    }

    if (categoryInput) {
      currentBenchmarkType = categoryInput;
      currentBenchmarkTypeProvided = true;
      currentModalities = inferModalitiesFromCategory(categoryInput);
      pendingBenchmarkPrefix = null;
    }

    const allModelValuesEmpty = !hasAnyMatrixValue(modelValues);

    const knownTypeMarker = inferTypeFromPreambleLine(rawBenchmarkInput);

    if (allModelValuesEmpty && !categoryInput && rawBenchmarkInput && !knownTypeMarker) {
      const nextRawLine = rawLines[lineIndex + 1];
      if (nextRawLine) {
        const nextCells = rebalanceMatrixRowCells(splitTableLine(nextRawLine), matrixRowLayout);
        const nextBenchmarkInput = normalizeNameParenthesisSpacing(nextCells[benchmarkColumnIndex] || "");
        const nextHasAnyModelValue = hasAnyMatrixValue(
          getMatrixRowValues(nextCells, modelValueStartIndex, modelNames.length)
        );

        if (nextHasAnyModelValue && isMatrixBenchmarkContinuationFragment(nextBenchmarkInput)) {
          pendingBenchmarkPrefix = rawBenchmarkInput;
          continue;
        }
      }
    }

    const shouldAttachPendingBenchmarkPrefix = Boolean(
      pendingBenchmarkPrefix
      && rawBenchmarkInput
      && isMatrixBenchmarkContinuationFragment(rawBenchmarkInput)
    );

    const benchmarkInput = shouldAttachPendingBenchmarkPrefix
      ? normalizeNameParenthesisSpacing(`${pendingBenchmarkPrefix} ${rawBenchmarkInput}`)
      : rawBenchmarkInput;

    if (shouldAttachPendingBenchmarkPrefix || !allModelValuesEmpty) {
      pendingBenchmarkPrefix = null;
    }

    const normalizedBenchmarkInput = normalizeBenchmarkImportName(benchmarkInput);
    const benchmarkDirection = parseBenchmarkNameAndDirection(normalizedBenchmarkInput);
    const benchmarkName = benchmarkDirection.benchmarkName;

    if (!benchmarkName) {
      if (categoryInput && allModelValuesEmpty) {
        continue;
      }

      skipped += 1;
      continue;
    }

    if (allModelValuesEmpty && isMatrixTypeMarker(benchmarkName)) {
      pendingBenchmarkPrefix = null;
      currentBenchmarkType = benchmarkName;
      currentBenchmarkTypeProvided = true;

      const sectionTypeHint = inferTypeFromPreambleLine(benchmarkName);
      if (sectionTypeHint) {
        currentModalities = inferModalitiesFromCategory(sectionTypeHint);
      } else {
        currentModalities = defaultModalities;
      }

      continue;
    }

    for (let modelIndex = 0; modelIndex < modelNames.length; modelIndex += 1) {
      const modelName = modelNames[modelIndex];
      const rawInput = (cells[modelValueStartIndex + modelIndex] || "").trim();

      if (!modelName || isEmptyImportValue(rawInput)) {
        continue;
      }

      const normalizedValue = normalizeImportedValueAndExtractNote(rawInput);

      rows.push({
        rowNumber: lineIndex + 1,
        providerName: inferProviderNameFromModel(modelName),
        modelName,
        benchmarkName,
        benchmarkType: currentBenchmarkType,
        benchmarkTypeProvided: currentBenchmarkTypeProvided,
        valueRaw: normalizedValue.valueRaw,
        valueNote: normalizedValue.valueNote,
        benchTime: new Date(),
        unit: "score",
        higherIsBetter: getInferredHigherIsBetter(normalizedValue.valueRaw, benchmarkDirection, benchmarkName, currentBenchmarkType),
        modalities: currentModalities,
        source: defaultSource,
        modelAlias: null,
        sourceModelId: null,
        sourceBenchmarkId: null
      });
    }
  }

  return {
    format: "matrix-table",
    rows,
    skipped
  };
}

function parsePaperCopiedTableRows(inputText: string, defaultSource: string | null): ParsedTextImportResult {
  const normalizedLines = inputText
    .split(/\r?\n/)
    .map((line) => line.replace(/\r/g, ""))
    .map(normalizePaperTableLine)
    .filter(Boolean);

  const lines = mergeSplitBenchmarkPrefixLines(normalizedLines);

  if (lines.length < 2) {
    return {
      format: "paper-table",
      rows: [],
      skipped: 0,
      confidence: 0
    };
  }

  const dataModelCount = inferPaperTableModelCount(lines);
  if (!dataModelCount || dataModelCount < 2) {
    return {
      format: "paper-table",
      rows: [],
      skipped: lines.length,
      confidence: 0
    };
  }

  const tokenizedLines = lines.map(splitPaperTableTokens);
  const firstDataLineIndex = tokenizedLines.findIndex((tokens) => {
    const trailingCount = getTrailingPaperValueTokenCount(tokens);
    return trailingCount >= dataModelCount && tokens.length > dataModelCount;
  });

  if (firstDataLineIndex < 0) {
    return {
      format: "paper-table",
      rows: [],
      skipped: lines.length,
      confidence: 0
    };
  }

  const headerLines = lines.slice(0, firstDataLineIndex);
  const headerModelCount = estimatePaperHeaderModelCount(headerLines);
  const modelCount = (() => {
    if (headerModelCount < 2) return dataModelCount;
    if (headerModelCount <= dataModelCount) return dataModelCount;
    if (headerModelCount - dataModelCount <= 4) return headerModelCount;
    return dataModelCount;
  })();

  const modelNames = buildPaperTableModelNames(headerLines, modelCount);

  let preambleTypeHint: string | null = null;
  headerLines.forEach((line) => {
    const normalizedPreambleLine = normalizeNameParenthesisSpacing(line).trim();
    const hint = inferTypeFromPreambleLine(normalizedPreambleLine);
    if (hint) {
      preambleTypeHint = hint;
      return;
    }

    if (isMatrixTypeMarker(normalizedPreambleLine)) {
      preambleTypeHint = normalizedPreambleLine;
    }
  });

  const normalizedHeaderLines = headerLines
    .map((line) => normalizeNameParenthesisSpacing(cleanPaperHeaderFragment(line)))
    .filter(Boolean);

  const initialCategoryParts: string[] = [];
  for (let index = normalizedHeaderLines.length - 1; index >= 0; index -= 1) {
    const candidate = normalizedHeaderLines[index];
    if (isPaperCategoryFragment(candidate)) {
      initialCategoryParts.unshift(candidate);
      continue;
    }

    if (initialCategoryParts.length > 0) {
      break;
    }
  }

  const initialCategoryFromHeader = initialCategoryParts.length > 0
    ? initialCategoryParts.join(" ")
    : null;

  const defaultModalities = preambleTypeHint ? inferModalitiesFromCategory(preambleTypeHint) : ["Text"];
  let currentBenchmarkType = initialCategoryFromHeader ?? preambleTypeHint ?? "General";
  let currentBenchmarkTypeProvided = Boolean((initialCategoryFromHeader ?? preambleTypeHint ?? "").trim());
  let currentModalities = defaultModalities;

  const rows: NormalizedTextImportRow[] = [];
  let skipped = 0;
  let parsedDataLines = 0;
  let pendingCategoryParts: string[] = [];
  let pendingBenchmarkPrefix: string | null = null;

  for (let lineIndex = firstDataLineIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const tokens = tokenizedLines[lineIndex] ?? [];
    const extracted = extractPaperRowBenchmarkAndValues(tokens, modelCount, {
      allowPartial: modelCount !== dataModelCount,
      minValueCount: Math.max(2, Math.min(dataModelCount, 3))
    });

    if (!extracted) {
      if (isPaperCategoryFragment(line)) {
        const normalizedCategoryPart = normalizeNameParenthesisSpacing(cleanPaperHeaderFragment(line));
        if (normalizedCategoryPart) {
          if (UNSUPPORTED_SPECIAL_VALUE_SYMBOL_TEST_REGEX.test(normalizedCategoryPart)) {
            pendingBenchmarkPrefix = pendingBenchmarkPrefix
              ? `${pendingBenchmarkPrefix} ${normalizedCategoryPart}`.replace(/\s+/g, " ").trim()
              : normalizedCategoryPart;
          } else {
            pendingCategoryParts.push(normalizedCategoryPart);
            pendingBenchmarkPrefix = null;
          }
        }
      } else {
        const benchmarkPrefixCandidate = normalizeBenchmarkImportName(normalizeNameParenthesisSpacing(line));
        if (benchmarkPrefixCandidate && /[A-Za-z\u4e00-\u9fa5]/.test(benchmarkPrefixCandidate)) {
          pendingBenchmarkPrefix = pendingBenchmarkPrefix
            ? `${pendingBenchmarkPrefix} ${benchmarkPrefixCandidate}`.replace(/\s+/g, " ").trim()
            : benchmarkPrefixCandidate;
        } else {
          skipped += 1;
        }
      }
      continue;
    }

    const benchmarkInput = normalizeNameParenthesisSpacing(extracted.benchmarkName);
    const normalizedBenchmarkInput = normalizeBenchmarkImportName(benchmarkInput);

    if (pendingCategoryParts.length > 0) {
      if (!normalizedBenchmarkInput) {
        if (pendingBenchmarkPrefix) {
          currentBenchmarkType = pendingCategoryParts.join(" ");
          currentBenchmarkTypeProvided = true;
          const sectionTypeHint = inferTypeFromPreambleLine(currentBenchmarkType);
          currentModalities = sectionTypeHint ? inferModalitiesFromCategory(sectionTypeHint) : defaultModalities;
        } else {
          const pendingPrefix = pendingCategoryParts.join(" ").trim();
          if (pendingPrefix) {
            pendingBenchmarkPrefix = pendingPrefix;
          }
        }
      } else {
        currentBenchmarkType = pendingCategoryParts.join(" ");
        currentBenchmarkTypeProvided = true;
        const sectionTypeHint = inferTypeFromPreambleLine(currentBenchmarkType);
        currentModalities = sectionTypeHint ? inferModalitiesFromCategory(sectionTypeHint) : defaultModalities;
      }

      pendingCategoryParts = [];
    }

    const benchmarkSource = normalizedBenchmarkInput || pendingBenchmarkPrefix || "";
    const benchmarkDirection = parseBenchmarkNameAndDirection(benchmarkSource);
    const benchmarkName = benchmarkDirection.benchmarkName;
    if (!benchmarkName) {
      skipped += 1;
      pendingBenchmarkPrefix = null;
      continue;
    }

    pendingBenchmarkPrefix = null;

    const extractedValues = extracted.values.length >= modelNames.length
      ? extracted.values
      : [...extracted.values, ...Array.from({ length: modelNames.length - extracted.values.length }, () => "")];

    if (isMatrixTypeMarker(benchmarkName) && extractedValues.every((value) => isEmptyImportValue(value))) {
      currentBenchmarkType = benchmarkName;
      currentBenchmarkTypeProvided = true;
      const sectionTypeHint = inferTypeFromPreambleLine(benchmarkName);
      currentModalities = sectionTypeHint ? inferModalitiesFromCategory(sectionTypeHint) : defaultModalities;
      continue;
    }

    parsedDataLines += 1;

    for (let modelIndex = 0; modelIndex < modelNames.length; modelIndex += 1) {
      const modelName = modelNames[modelIndex];
      const rawInput = (extractedValues[modelIndex] || "").trim();

      if (!modelName || isEmptyImportValue(rawInput)) {
        continue;
      }

      const normalizedValue = normalizeImportedValueAndExtractNote(rawInput);

      rows.push({
        rowNumber: lineIndex + 1,
        providerName: inferProviderNameFromModel(modelName),
        modelName,
        benchmarkName,
        benchmarkType: currentBenchmarkType,
        benchmarkTypeProvided: currentBenchmarkTypeProvided,
        valueRaw: normalizedValue.valueRaw,
        valueNote: normalizedValue.valueNote,
        benchTime: new Date(),
        unit: "score",
        higherIsBetter: getInferredHigherIsBetter(normalizedValue.valueRaw, benchmarkDirection, benchmarkName, currentBenchmarkType),
        modalities: currentModalities,
        source: defaultSource,
        modelAlias: null,
        sourceModelId: null,
        sourceBenchmarkId: null
      });
    }
  }

  const headerNamedCount = modelNames.filter((name) => !/^Model\s+\d+$/i.test(name)).length;
  const headerConfidence = modelNames.length > 0 ? headerNamedCount / modelNames.length : 0;
  const parseConfidence = parsedDataLines > 0 ? parsedDataLines / Math.max(parsedDataLines + skipped, 1) : 0;

  return {
    format: "paper-table",
    rows,
    skipped,
    confidence: Number((parseConfidence * 0.72 + headerConfidence * 0.28).toFixed(3))
  };
}

function parseBenchmarkTextRowsCore(inputText: string, defaultSource: string | null): ParsedTextImportResult {
  const firstLine = inputText
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)
    ?.trim() || "";

  const selectedParsed: ParsedTextImportResult = (() => {
    if (looksLikeStructuredCsv(firstLine)) {
      return parseStructuredCsvRows(inputText, defaultSource);
    }

    const paperParsed = parsePaperCopiedTableRows(inputText, defaultSource);
    const matrixParsed = parseMatrixTextRows(inputText, defaultSource);
    const hasTabSeparatedLayout = inputText.includes("\t");

    if (paperParsed.rows.length === 0) {
      return matrixParsed;
    }

    if (matrixParsed.rows.length === 0) {
      return paperParsed;
    }

    if (hasTabSeparatedLayout) {
      return matrixParsed;
    }

    const paperHasTypedCategories = paperParsed.rows.some(
      (row) => row.benchmarkType.trim().toLowerCase() !== "general"
    );
    const matrixHasTypedCategories = matrixParsed.rows.some(
      (row) => row.benchmarkType.trim().toLowerCase() !== "general"
    );

    if (paperHasTypedCategories && !matrixHasTypedCategories) {
      return paperParsed;
    }

    return scoreParsedTextImportResult(paperParsed) >= scoreParsedTextImportResult(matrixParsed)
      ? paperParsed
      : matrixParsed;
  })();

  const sanitized = sanitizeUnsupportedValueSymbols(selectedParsed.rows);
  const expandedRows = expandMetricLabeledImportRows(sanitized.rows);

  return {
    ...selectedParsed,
    rows: expandedRows,
    parseSource: "text",
    warnings: [...(selectedParsed.warnings ?? []), ...sanitized.warnings]
  };
}

async function parseBenchmarkTextRows(
  inputText: string,
  sourceInput?: string | null,
  htmlInput?: string | null
): Promise<ParsedTextImportResult> {
  const defaultSource = normalizeTextImportSource(sourceInput);
  const textParsed = parseBenchmarkTextRowsCore(inputText, defaultSource);

  const explicitHtmlTableInput = getHtmlTableInput(htmlInput);
  const inlineHtmlTableInput = getHtmlTableInput(inputText);
  const htmlTableInput = explicitHtmlTableInput ?? inlineHtmlTableInput;
  if (!htmlTableInput) {
    return textParsed;
  }

  const htmlAsText = await parseHtmlTableToText(htmlTableInput);
  if (!htmlAsText) {
    return textParsed;
  }

  const htmlParsed = parseBenchmarkTextRowsCore(htmlAsText, defaultSource);
  if (htmlParsed.rows.length === 0) {
    return textParsed;
  }

  return {
    ...htmlParsed,
    parseSource: "html"
  };
}

export async function __parseBenchmarkTextRowsForTest(
  inputText: string,
  sourceInput?: string | null,
  htmlInput?: string | null
): Promise<ParsedTextImportResult> {
  return parseBenchmarkTextRows(inputText, sourceInput, htmlInput);
}

type BenchmarkDirectionWarning = {
  benchmarkName: string;
  benchmarkType: string;
  rowNumbers: number[];
  reason: string;
  action: string;
};

async function collectBenchmarkDirectionWarnings(rows: NormalizedTextImportRow[]): Promise<BenchmarkDirectionWarning[]> {
  const lowerIsBetterRows = rows.filter((row) => row.higherIsBetter === false);
  if (lowerIsBetterRows.length === 0) {
    return [];
  }

  const dedupeRule = await getModelDedupeRule();

  const grouped = new Map<string, {
    benchmarkName: string;
    benchmarkType: string;
    rowNumbers: Set<number>;
  }>();

  lowerIsBetterRows.forEach((row) => {
    const benchmarkType = row.benchmarkType.trim() || "general";
    const key = buildBenchmarkCanonicalKey(row.benchmarkName, benchmarkType, dedupeRule);

    if (!grouped.has(key)) {
      grouped.set(key, {
        benchmarkName: row.benchmarkName,
        benchmarkType,
        rowNumbers: new Set<number>()
      });
    }

    grouped.get(key)?.rowNumbers.add(row.rowNumber);
  });

  const canonicalKeys = Array.from(grouped.keys());
  if (canonicalKeys.length === 0) {
    return [];
  }

  const existingBenchmarks = await db
    .select({
      canonicalKey: benchmarks.canonicalKey,
      benchmarkName: benchmarks.benchmarkName,
      benchmarkType: benchmarks.benchmarkType,
      higherIsBetter: benchmarks.higherIsBetter
    })
    .from(benchmarks)
    .where(inArray(benchmarks.canonicalKey, canonicalKeys));

  return existingBenchmarks
    .filter((item) => item.higherIsBetter)
    .map((item) => {
      const group = grouped.get(item.canonicalKey);
      const rowNumbers = group ? Array.from(group.rowNumbers).sort((a, b) => a - b) : [];

      return {
        benchmarkName: item.benchmarkName,
        benchmarkType: item.benchmarkType,
        rowNumbers,
        reason: "检测到 benchmark 名包含 ↓，应为 low-is-better，但数据库当前为 high-is-better",
        action: "导入时将自动把 higherIsBetter 修正为 false"
      };
    })
    .sort((a, b) => {
      const nameCompare = a.benchmarkName.localeCompare(b.benchmarkName, "zh-Hans-CN", { sensitivity: "base" });
      if (nameCompare !== 0) return nameCompare;
      return a.benchmarkType.localeCompare(b.benchmarkType, "zh-Hans-CN", { sensitivity: "base" });
    });
}

export async function previewBenchmarkTextImport(inputText: string, sourceInput?: string | null, htmlInput?: string | null) {
  const parsed = await parseBenchmarkTextRows(inputText, sourceInput, htmlInput);
  const directionWarnings = await collectBenchmarkDirectionWarnings(parsed.rows);
  const parseWarnings = parsed.warnings ?? [];
  const allWarnings = [...parseWarnings, ...directionWarnings];

  const previewRows = parsed.rows.map((row) => {
    const parsedValue = parseBenchmarkValue(row.valueRaw);
    const mergedNote = mergeImportValueNotes(row.valueNote, parsedValue.valueNote);

    return {
      rowNumber: row.rowNumber,
      providerName: row.providerName,
      modelName: row.modelName,
      benchmarkName: row.benchmarkName,
      benchmarkType: row.benchmarkType,
      benchmarkTypeProvided: row.benchmarkTypeProvided,
      higherIsBetter: row.higherIsBetter,
      modalities: normalizeModalities(row.modalities),
      rawValue: row.valueRaw,
      valueNum: parsedValue.valueNum,
      valueNum2: parsedValue.valueNum2,
      valueNote: mergedNote,
      source: row.source,
      valid: parsedValue.valueRaw.length > 0
    };
  });

  return {
    format: parsed.format,
    parseSource: parsed.parseSource ?? "text",
    total: parsed.rows.length,
    skipped: parsed.skipped,
    warningCount: allWarnings.length,
    warnings: allWarnings,
    previewRows
  };
}

export async function importBenchmarkCsv(inputText: string, sourceInput?: string | null, htmlInput?: string | null) {
  const parsed = await parseBenchmarkTextRows(inputText, sourceInput, htmlInput);
  const directionWarnings = await collectBenchmarkDirectionWarnings(parsed.rows);
  const parseWarnings = parsed.warnings ?? [];
  const allWarnings = [...parseWarnings, ...directionWarnings];
  const { inserted } = await importNormalizedRows(parsed.rows);

  return {
    format: parsed.format,
    parseSource: parsed.parseSource ?? "text",
    total: parsed.rows.length,
    skipped: parsed.skipped,
    warningCount: allWarnings.length,
    warnings: allWarnings,
    inserted
  };
}

export async function deleteModelAndAllValues(modelId: number) {
  const [existing] = await db
    .select({ id: models.id, modelName: models.modelName })
    .from(models)
    .where(eq(models.id, modelId))
    .limit(1);

  if (!existing) {
    throw new Error(`model not found: ${modelId}`);
  }

  await db.transaction(async (tx: DbTransactionClient) => {
    await tx
      .update(models)
      .set({ mergedIntoModelId: null })
      .where(eq(models.mergedIntoModelId, modelId));

    await tx.delete(models).where(eq(models.id, modelId));
  });

  await invalidateAllCaches();

  return {
    ok: true,
    modelId: existing.id,
    modelName: existing.modelName
  };
}

export async function deleteBenchmarkValuesBySource(sourceInput: string) {
  const rawSource = sourceInput.trim();
  if (!rawSource) {
    const result = await db.transaction(async (tx: DbTransactionClient) => {
      const deletedRows = await tx
        .delete(benchmarkValues)
        .where(or(isNull(benchmarkValues.source), eq(benchmarkValues.source, "")))
        .returning({ id: benchmarkValues.id });

      const deletedSourceMetaRows = await tx
        .delete(benchmarkSourceMeta)
        .where(eq(benchmarkSourceMeta.source, ""))
        .returning({ id: benchmarkSourceMeta.id });

      return {
        deletedRows,
        deletedSourceMetaRows
      };
    });

    await invalidateAllCaches();

    return {
      ok: true,
      source: "",
      normalizedSource: null,
      matchedSources: ["", "<NULL>"],
      deleted: result.deletedRows.length,
      deletedSourceMeta: result.deletedSourceMetaRows.length,
      deletedEmptySource: true
    };
  }

  const normalizedSource = normalizeTextImportSource(rawSource);
  if (!normalizedSource) {
    throw new Error("source is required");
  }

  const unprefixed = normalizedSource.slice(5).trim();
  const candidates = new Set<string>([normalizedSource, rawSource]);
  if (unprefixed) {
    candidates.add(unprefixed);
  }

  const matchedSources = Array.from(candidates).filter(Boolean);
  const result = await db.transaction(async (tx: DbTransactionClient) => {
    const deletedRows = await tx
      .delete(benchmarkValues)
      .where(inArray(benchmarkValues.source, matchedSources))
      .returning({ id: benchmarkValues.id });

    const deletedSourceMetaRows = await tx
      .delete(benchmarkSourceMeta)
      .where(inArray(benchmarkSourceMeta.source, matchedSources))
      .returning({ id: benchmarkSourceMeta.id });

    return {
      deletedRows,
      deletedSourceMetaRows
    };
  });

  await invalidateAllCaches();

  return {
    ok: true,
    source: rawSource,
    normalizedSource,
    matchedSources,
    deleted: result.deletedRows.length,
    deletedSourceMeta: result.deletedSourceMetaRows.length,
    deletedEmptySource: false
  };
}

export type BenchmarkScaleValueDetail = {
  value: number;
  field: "valueNum" | "valueNum2";
  modelName: string;
  source: string | null;
  benchTime: string;
};

export type BenchmarkConsistencyIssueType = "mixed-scale-0-1-vs-100" | "mixed-scale-100-vs-elo";

export type BenchmarkConsistencyRecommendedAction = "normalize-scale" | "split-benchmark";

export type BenchmarkConsistencyValueSegment = {
  key: "small" | "large" | "base" | "elo";
  label: string;
  count: number;
  minValue: number | null;
  maxValue: number | null;
};

export type BenchmarkScaleConsistencyIssue = {
  issueType: BenchmarkConsistencyIssueType;
  recommendedAction: BenchmarkConsistencyRecommendedAction;
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
  segments: BenchmarkConsistencyValueSegment[];
  valueDetails: BenchmarkScaleValueDetail[];
};

export type BenchmarkScaleConsistencyCheckResult = {
  generatedAt: string;
  issues: BenchmarkScaleConsistencyIssue[];
};

export type BenchmarkScaleNormalizationTarget = 1 | 100;

export type BenchmarkScaleNormalizationResult = {
  ok: true;
  benchmarkId: number;
  benchmarkName: string;
  benchmarkType: string;
  targetScale: BenchmarkScaleNormalizationTarget;
  updatedRows: number;
  updatedCells: number;
};

export type BenchmarkSplitScaleMode = "hundred-vs-elo";

export type BenchmarkSplitScaleResult = {
  ok: true;
  benchmarkId: number;
  benchmarkName: string;
  benchmarkType: string;
  splitMode: BenchmarkSplitScaleMode;
  baseBenchmarkId: number;
  baseBenchmarkName: string;
  baseBenchmarkType: string;
  eloBenchmarkId: number;
  eloBenchmarkName: string;
  eloBenchmarkType: string;
  movedRows: number;
  splitRows: number;
  createdRows: number;
};

type DuplicateConfidence = "high" | "medium" | "low";

export type ModelDuplicateCandidate = {
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

export type BenchmarkDuplicateCandidate = {
  sourceId: number;
  sourceName: string;
  sourceType: string;
  sourceSourceSummary: string;
  sourceValueCount: number;
  targetId: number;
  targetName: string;
  targetType: string;
  targetSourceSummary: string;
  targetValueCount: number;
  confidence: DuplicateConfidence;
  similarity: number;
  characterRepeatScore: number;
  reasons: string[];
};

export type DuplicateEntityDetectionResult = {
  generatedAt: string;
  modelCandidates: ModelDuplicateCandidate[];
  benchmarkCandidates: BenchmarkDuplicateCandidate[];
};

function normalizeLooseText(input: string): string {
  return input
    .replace(SUPERSCRIPT_SUBSCRIPT_DIGIT_REGEX, (value) => SUPERSCRIPT_SUBSCRIPT_DIGIT_MAP[value] ?? value)
    .toLowerCase()
    .replace(HYPHEN_VARIANT_REGEX, "-")
    .replace(/[^a-z0-9\u0370-\u03ff\u1f00-\u1fff\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactAlphaNum(input: string): string {
  return normalizeLooseText(input).replace(/\s+/g, "");
}

function buildModelDuplicateKey(input: string): string {
  const normalized = normalizeLooseText(input);
  if (!normalized) return "";

  const tokens = normalized
    .split(" ")
    .filter(Boolean)
    .filter((token) => !MODEL_DUPLICATE_NOISE_TOKENS.has(token));

  return tokens.join(" ");
}

function buildBenchmarkDuplicateKey(input: string): string {
  return normalizeLooseText(stripBenchmarkCitationRefs(input));
}

function buildBenchmarkDuplicateVariantNoiseKey(input: string): {
  normalizedKey: string;
  removedTokenCount: number;
} {
  const normalized = buildBenchmarkDuplicateKey(input);
  if (!normalized) {
    return {
      normalizedKey: "",
      removedTokenCount: 0
    };
  }

  const tokens = normalized
    .split(" ")
    .filter(Boolean);

  const filteredTokens = tokens.filter((token) => !BENCHMARK_DUPLICATE_VARIANT_NOISE_TOKENS.has(token));

  return {
    normalizedKey: filteredTokens.join(" "),
    removedTokenCount: Math.max(0, tokens.length - filteredTokens.length)
  };
}

function hasBenchmarkVariantNoiseNormalizedNameMatch(leftName: string, rightName: string): boolean {
  const left = buildBenchmarkDuplicateVariantNoiseKey(leftName);
  const right = buildBenchmarkDuplicateVariantNoiseKey(rightName);

  if (left.removedTokenCount === 0 && right.removedTokenCount === 0) {
    return false;
  }

  if (!left.normalizedKey || !right.normalizedKey) {
    return false;
  }

  return compactAlphaNum(left.normalizedKey) === compactAlphaNum(right.normalizedKey);
}

function buildBigramCounts(input: string): Map<string, number> {
  const compact = compactAlphaNum(input);
  const map = new Map<string, number>();
  if (!compact) return map;

  if (compact.length === 1) {
    map.set(compact, 1);
    return map;
  }

  for (let index = 0; index < compact.length - 1; index += 1) {
    const token = compact.slice(index, index + 2);
    map.set(token, (map.get(token) ?? 0) + 1);
  }

  return map;
}

function getDiceSimilarity(left: string, right: string): number {
  const leftMap = buildBigramCounts(left);
  const rightMap = buildBigramCounts(right);
  if (leftMap.size === 0 || rightMap.size === 0) return 0;

  let shared = 0;
  let leftTotal = 0;
  let rightTotal = 0;

  leftMap.forEach((count, token) => {
    leftTotal += count;
    shared += Math.min(count, rightMap.get(token) ?? 0);
  });
  rightMap.forEach((count) => {
    rightTotal += count;
  });

  if (leftTotal + rightTotal === 0) return 0;
  return (2 * shared) / (leftTotal + rightTotal);
}

function getCharacterRepeatScore(left: string, right: string): number {
  const leftCompact = compactAlphaNum(left);
  const rightCompact = compactAlphaNum(right);
  if (!leftCompact || !rightCompact) return 0;

  const leftCounts = new Map<string, number>();
  const rightCounts = new Map<string, number>();

  for (const ch of leftCompact) {
    leftCounts.set(ch, (leftCounts.get(ch) ?? 0) + 1);
  }
  for (const ch of rightCompact) {
    rightCounts.set(ch, (rightCounts.get(ch) ?? 0) + 1);
  }

  let shared = 0;
  leftCounts.forEach((count, ch) => {
    shared += Math.min(count, rightCounts.get(ch) ?? 0);
  });

  return shared / Math.max(leftCompact.length, rightCompact.length);
}

function determineDuplicateConfidence(similarity: number): DuplicateConfidence {
  if (similarity >= 0.96) return "high";
  if (similarity >= 0.92) return "medium";
  return "low";
}

function duplicateConfidenceWeight(confidence: DuplicateConfidence): number {
  if (confidence === "high") return 3;
  if (confidence === "medium") return 2;
  return 1;
}

function downgradeDuplicateConfidence(confidence: DuplicateConfidence): DuplicateConfidence {
  if (confidence === "high") return "medium";
  if (confidence === "medium") return "low";
  return "low";
}

function extractPrimaryVersionNumber(input: string): number | null {
  const normalizedInput = input.replace(
    SUPERSCRIPT_SUBSCRIPT_DIGIT_REGEX,
    (value) => SUPERSCRIPT_SUBSCRIPT_DIGIT_MAP[value] ?? value
  );

  const match = normalizedInput.match(/\b\d+(?:\.\d+)?\b/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildVersionFamilyKey(input: string): string {
  return normalizeLooseText(input)
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}



function chooseMergeDirection<T extends { id: number }>(
  left: T,
  right: T,
  countById: Map<number, number>
): { source: T; target: T; sourceCount: number; targetCount: number } {
  const leftCount = countById.get(left.id) ?? 0;
  const rightCount = countById.get(right.id) ?? 0;

  if (leftCount !== rightCount) {
    return leftCount > rightCount
      ? { source: right, target: left, sourceCount: rightCount, targetCount: leftCount }
      : { source: left, target: right, sourceCount: leftCount, targetCount: rightCount };
  }

  if (left.id < right.id) {
    return { source: right, target: left, sourceCount: rightCount, targetCount: leftCount };
  }

  return { source: left, target: right, sourceCount: leftCount, targetCount: rightCount };
}



function extractBenchmarkNumericTokens(input: string): string[] {
  const normalizedInput = input.replace(
    SUPERSCRIPT_SUBSCRIPT_DIGIT_REGEX,
    (value) => SUPERSCRIPT_SUBSCRIPT_DIGIT_MAP[value] ?? value
  );

  const matches = normalizedInput.match(/\d+(?:\.\d+)?/g) ?? [];
  return matches
    .map((token) => {
      const parsed = Number.parseFloat(token);
      return Number.isFinite(parsed) ? String(parsed) : token;
    })
    .filter((token) => token.length > 0);
}

function hasBenchmarkNumericTokenMismatch(leftName: string, rightName: string): boolean {
  const leftTokens = extractBenchmarkNumericTokens(leftName);
  const rightTokens = extractBenchmarkNumericTokens(rightName);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }

  if (leftTokens.length !== rightTokens.length) {
    return true;
  }

  return leftTokens.some((token, index) => token !== rightTokens[index]);
}

function extractBenchmarkSymbolNumberPairs(input: string): string[] {
  const normalizedInput = input.replace(
    SUPERSCRIPT_SUBSCRIPT_DIGIT_REGEX,
    (value) => SUPERSCRIPT_SUBSCRIPT_DIGIT_MAP[value] ?? value
  );

  return Array.from(normalizedInput.matchAll(/([@^])\s*(\d+(?:\.\d+)?)/g)).map((match) => {
    const symbol = match[1] ?? "";
    const numericToken = match[2] ?? "";
    const parsed = Number.parseFloat(numericToken);
    const normalizedNumber = Number.isFinite(parsed) ? String(parsed) : numericToken;
    return `${symbol}${normalizedNumber}`;
  });
}

function hasBenchmarkSymbolSemanticMismatch(leftName: string, rightName: string): boolean {
  const leftTokens = extractBenchmarkSymbolNumberPairs(leftName);
  const rightTokens = extractBenchmarkSymbolNumberPairs(rightName);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }

  if (leftTokens.length !== rightTokens.length) {
    return true;
  }

  return leftTokens.some((token, index) => token !== rightTokens[index]);
}

function formatBenchmarkSourceSummary(source: string | null): string {
  const normalized = source?.trim() ?? "";
  return normalized.length > 0 ? normalized : "空 source";
}

const duplicateCandidatesStore = createVersionedCacheStore<DuplicateEntityDetectionResult>();

registerCacheInvalidator(() => {
  invalidateVersionedCacheStore(duplicateCandidatesStore);
});

export async function detectDuplicateEntityCandidates(): Promise<DuplicateEntityDetectionResult> {
  return withVersionedCache(
    duplicateCandidatesStore,
    "duplicate-candidates",
    {
      versionProbeTtlMs: 5_000,
      staleIfErrorMs: 30 * 60_000,
      getVersion: () => getCacheVersion("admin_entities"),
      loader: () => detectDuplicateEntityCandidatesInternal()
    }
  );
}

type ModelFeature = {
  raw: { id: number; modelName: string; providerName: string };
  strictName: string;
  noiseName: string;
  primaryVersion: number | null;
  versionFamily: string;
  bigramCounts: Map<string, number>;
  charCounts: Map<string, number>;
  compactLength: number;
  trailingVariant: string | null;
};

type BenchmarkFeature = {
  raw: { id: number; benchmarkName: string; benchmarkType: string | null; modalities: string[] };
  normalizedName: string;
  variantNoiseKey: string;
  variantNoiseRemovedCount: number;
  variantNoiseCompact: string;
  typeNormalized: string;
  variantConflictMatches: Array<{ leftMatch: boolean; rightMatch: boolean }>;
  numericTokens: string[];
  symbolNumberPairs: string[];
  bigramCounts: Map<string, number>;
  charCounts: Map<string, number>;
  compactLength: number;
};

function getCharacterCounts(compact: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const ch of compact) {
    map.set(ch, (map.get(ch) ?? 0) + 1);
  }
  return map;
}

function getDiceSimilarityPrecomputed(
  leftMap: Map<string, number>,
  rightMap: Map<string, number>
): number {
  if (leftMap.size === 0 || rightMap.size === 0) return 0;

  let shared = 0;
  let leftTotal = 0;
  let rightTotal = 0;

  leftMap.forEach((count, token) => {
    leftTotal += count;
    shared += Math.min(count, rightMap.get(token) ?? 0);
  });
  rightMap.forEach((count) => {
    rightTotal += count;
  });

  if (leftTotal + rightTotal === 0) return 0;
  return (2 * shared) / (leftTotal + rightTotal);
}

function getCharacterRepeatScorePrecomputed(
  leftCompactLength: number,
  rightCompactLength: number,
  leftCounts: Map<string, number>,
  rightCounts: Map<string, number>
): number {
  if (leftCompactLength === 0 || rightCompactLength === 0) return 0;

  let shared = 0;
  leftCounts.forEach((count, ch) => {
    shared += Math.min(count, rightCounts.get(ch) ?? 0);
  });

  return shared / Math.max(leftCompactLength, rightCompactLength);
}

function hasModelVersionGapHintPrecomputed(
  leftVersion: number | null,
  rightVersion: number | null,
  leftFamily: string,
  rightFamily: string
): boolean {
  if (leftVersion === null || rightVersion === null) return false;
  if (leftVersion === rightVersion) return false;
  return leftFamily.length > 0 && leftFamily === rightFamily;
}

function hasModelTrailingVariantMismatchPrecomputed(
  leftVariant: string | null,
  rightVariant: string | null
): boolean {
  if (leftVariant || rightVariant) {
    return leftVariant !== rightVariant;
  }
  return false;
}

function hasBenchmarkVariantNoiseNormalizedNameMatchPrecomputed(
  left: BenchmarkFeature,
  right: BenchmarkFeature
): boolean {
  if (left.variantNoiseRemovedCount === 0 && right.variantNoiseRemovedCount === 0) {
    return false;
  }
  if (!left.variantNoiseKey || !right.variantNoiseKey) {
    return false;
  }
  return left.variantNoiseCompact === right.variantNoiseCompact;
}

function hasBenchmarkVariantConflictPrecomputed(
  left: BenchmarkFeature,
  right: BenchmarkFeature
): boolean {
  for (let i = 0; i < BENCHMARK_VARIANT_CONFLICT_HINTS.length; i++) {
    const leftMatches = left.variantConflictMatches[i]!;
    const rightMatches = right.variantConflictMatches[i]!;
    if ((leftMatches.leftMatch && rightMatches.rightMatch) || (leftMatches.rightMatch && rightMatches.leftMatch)) {
      return true;
    }
  }
  return false;
}

function hasBenchmarkNumericTokenMismatchPrecomputed(
  leftTokens: string[],
  rightTokens: string[]
): boolean {
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }
  if (leftTokens.length !== rightTokens.length) {
    return true;
  }
  return leftTokens.some((token, index) => token !== rightTokens[index]);
}

function hasBenchmarkSymbolSemanticMismatchPrecomputed(
  leftTokens: string[],
  rightTokens: string[]
): boolean {
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }
  if (leftTokens.length !== rightTokens.length) {
    return true;
  }
  return leftTokens.some((token, index) => token !== rightTokens[index]);
}

async function detectDuplicateEntityCandidatesInternal(): Promise<DuplicateEntityDetectionResult> {
  const [activeModels, activeBenchmarks, modelValueStats, benchmarkValueStats, benchmarkSourceStats] = await Promise.all([
    db
      .select({
        id: models.id,
        modelName: models.modelName,
        providerName: providers.name
      })
      .from(models)
      .innerJoin(providers, eq(models.providerId, providers.id))
      .where(isNull(models.mergedIntoModelId)),
    db
      .select({
        id: benchmarks.id,
        benchmarkName: benchmarks.benchmarkName,
        benchmarkType: benchmarks.benchmarkType,
        modalities: benchmarks.modalities
      })
      .from(benchmarks)
      .where(isNull(benchmarks.mergedIntoBenchmarkId)),
    db
      .select({
        modelId: benchmarkValues.modelId,
        count: sql<number>`count(*)`
      })
      .from(benchmarkValues)
      .groupBy(benchmarkValues.modelId),
    db
      .select({
        benchmarkId: benchmarkValues.benchmarkId,
        count: sql<number>`count(*)`
      })
      .from(benchmarkValues)
      .groupBy(benchmarkValues.benchmarkId),
    db
      .select({
        benchmarkId: benchmarkValues.benchmarkId,
        source: benchmarkValues.source,
        count: sql<number>`count(*)`
      })
      .from(benchmarkValues)
      .groupBy(benchmarkValues.benchmarkId, benchmarkValues.source)
  ]);

  const modelValueCountById = new Map(
    modelValueStats.map((item) => [item.modelId, Number(item.count ?? 0)])
  );
  const benchmarkValueCountById = new Map(
    benchmarkValueStats.map((item) => [item.benchmarkId, Number(item.count ?? 0)])
  );
  const benchmarkSourceSummaryById = new Map<number, string>();
  const benchmarkTopSourceById = new Map<number, { source: string | null; count: number }>();

  benchmarkSourceStats.forEach((item) => {
    const benchmarkId = item.benchmarkId;
    const current = benchmarkTopSourceById.get(benchmarkId);
    const nextCount = Number(item.count ?? 0);

    if (!current || nextCount > current.count) {
      benchmarkTopSourceById.set(benchmarkId, {
        source: item.source,
        count: nextCount
      });
      return;
    }

    if (nextCount === current.count) {
      const currentLabel = formatBenchmarkSourceSummary(current.source);
      const nextLabel = formatBenchmarkSourceSummary(item.source);
      if (nextLabel.localeCompare(currentLabel, "zh-Hans-CN", { sensitivity: "base" }) < 0) {
        benchmarkTopSourceById.set(benchmarkId, {
          source: item.source,
          count: nextCount
        });
      }
    }
  });

  benchmarkTopSourceById.forEach((item, benchmarkId) => {
    benchmarkSourceSummaryById.set(benchmarkId, formatBenchmarkSourceSummary(item.source));
  });

  const trailingVariants = new Set(["low", "medium", "high", "max"]);

  const modelFeatures: ModelFeature[] = activeModels.map((model) => {
    const strictName = compactAlphaNum(model.modelName);
    const normalized = normalizeLooseText(model.modelName);
    const tokens = normalized.split(" ").filter(Boolean);
    const lastToken = tokens[tokens.length - 1] ?? null;
    const trailingVariant = lastToken && trailingVariants.has(lastToken) ? lastToken : null;

    return {
      raw: model,
      strictName,
      noiseName: buildModelDuplicateKey(model.modelName),
      primaryVersion: extractPrimaryVersionNumber(model.modelName),
      versionFamily: buildVersionFamilyKey(model.modelName),
      bigramCounts: buildBigramCounts(model.modelName),
      charCounts: getCharacterCounts(strictName),
      compactLength: strictName.length,
      trailingVariant
    };
  });

  const modelCandidates: ModelDuplicateCandidate[] = [];

  for (let leftIndex = 0; leftIndex < modelFeatures.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < modelFeatures.length; rightIndex += 1) {
      const left = modelFeatures[leftIndex]!;
      const right = modelFeatures[rightIndex]!;

      const charRepeatScore = getCharacterRepeatScorePrecomputed(
        left.compactLength,
        right.compactLength,
        left.charCounts,
        right.charCounts
      );
      const diceScore = getDiceSimilarityPrecomputed(
        left.bigramCounts,
        right.bigramCounts
      );
      const similarity = Math.max(charRepeatScore, diceScore);

      const reasons: string[] = [];
      let confidence: DuplicateConfidence | null = null;

      if (left.strictName && left.strictName === right.strictName) {
        confidence = "high";
        reasons.push("strict-normalized-equal");
      }

      if (left.noiseName && right.noiseName && left.noiseName === right.noiseName) {
        confidence = "high";
        reasons.push("ignore-high-reasoning-tokens-equal");
      }

      if (similarity >= 0.9) {
        const similarityConfidence = determineDuplicateConfidence(similarity);
        if (!confidence || duplicateConfidenceWeight(similarityConfidence) > duplicateConfidenceWeight(confidence)) {
          confidence = similarityConfidence;
        }
        reasons.push(`char-similarity-${similarity.toFixed(3)}`);
      }

      if (
        confidence
        && !reasons.includes("strict-normalized-equal")
        && !reasons.includes("ignore-high-reasoning-tokens-equal")
        && hasModelVersionGapHintPrecomputed(
          left.primaryVersion,
          right.primaryVersion,
          left.versionFamily,
          right.versionFamily
        )
      ) {
        confidence = downgradeDuplicateConfidence(confidence);
        reasons.push("version-gap-hint");
      }

      if (
        confidence &&
        hasModelTrailingVariantMismatchPrecomputed(left.trailingVariant, right.trailingVariant)
      ) {
        confidence = "low";
        reasons.push("trailing-variant-mismatch");
      }

      if (!confidence) {
        continue;
      }

      const direction = chooseMergeDirection(left.raw, right.raw, modelValueCountById);

      modelCandidates.push({
        sourceId: direction.source.id,
        sourceName: direction.source.modelName,
        sourceProviderName: direction.source.providerName,
        sourceValueCount: direction.sourceCount,
        targetId: direction.target.id,
        targetName: direction.target.modelName,
        targetProviderName: direction.target.providerName,
        targetValueCount: direction.targetCount,
        confidence,
        similarity: Number(similarity.toFixed(4)),
        characterRepeatScore: Number(charRepeatScore.toFixed(4)),
        reasons: Array.from(new Set(reasons))
      });
    }
  }

  const benchmarkFeatures: BenchmarkFeature[] = activeBenchmarks.map((benchmark) => {
    const compactName = compactAlphaNum(benchmark.benchmarkName);
    const variantNoise = buildBenchmarkDuplicateVariantNoiseKey(benchmark.benchmarkName);
    return {
      raw: benchmark,
      normalizedName: buildBenchmarkDuplicateKey(benchmark.benchmarkName),
      variantNoiseKey: variantNoise.normalizedKey,
      variantNoiseRemovedCount: variantNoise.removedTokenCount,
      variantNoiseCompact: compactAlphaNum(variantNoise.normalizedKey),
      typeNormalized: normalizeLooseText(benchmark.benchmarkType || "general") || "general",
      variantConflictMatches: BENCHMARK_VARIANT_CONFLICT_HINTS.map(([leftPattern, rightPattern]) => ({
        leftMatch: leftPattern.test(benchmark.benchmarkName),
        rightMatch: rightPattern.test(benchmark.benchmarkName)
      })),
      numericTokens: extractBenchmarkNumericTokens(benchmark.benchmarkName),
      symbolNumberPairs: extractBenchmarkSymbolNumberPairs(benchmark.benchmarkName),
      bigramCounts: buildBigramCounts(benchmark.benchmarkName),
      charCounts: getCharacterCounts(compactName),
      compactLength: compactName.length
    };
  });

  const benchmarkCandidates: BenchmarkDuplicateCandidate[] = [];

  for (let leftIndex = 0; leftIndex < benchmarkFeatures.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < benchmarkFeatures.length; rightIndex += 1) {
      const left = benchmarkFeatures[leftIndex]!;
      const right = benchmarkFeatures[rightIndex]!;

      const sameNormalizedName = left.normalizedName.length > 0 && left.normalizedName === right.normalizedName;
      const sameVariantNoiseNormalizedName = hasBenchmarkVariantNoiseNormalizedNameMatchPrecomputed(left, right);

      const charRepeatScore = getCharacterRepeatScorePrecomputed(
        left.compactLength,
        right.compactLength,
        left.charCounts,
        right.charCounts
      );
      const diceScore = getDiceSimilarityPrecomputed(
        left.bigramCounts,
        right.bigramCounts
      );
      const similarity = Math.max(charRepeatScore, diceScore);

      if (!sameNormalizedName && !sameVariantNoiseNormalizedName && similarity < 0.9) {
        continue;
      }

      const sameType = left.typeNormalized === right.typeNormalized;
      const hasGeneralTypeGap = left.typeNormalized === "general" || right.typeNormalized === "general";
      const hasVariantConflict = hasBenchmarkVariantConflictPrecomputed(left, right);
      const hasNumericTokenMismatch = hasBenchmarkNumericTokenMismatchPrecomputed(left.numericTokens, right.numericTokens);
      const hasSymbolSemanticMismatch = hasBenchmarkSymbolSemanticMismatchPrecomputed(left.symbolNumberPairs, right.symbolNumberPairs);

      const reasons: string[] = [];
      let confidence: DuplicateConfidence = "low";

      if (sameNormalizedName) {
        reasons.push("normalized-name-equal");
        confidence = sameType || hasGeneralTypeGap ? "high" : "medium";
      }

      if (sameVariantNoiseNormalizedName) {
        reasons.push("variant-noise-normalized-name-equal");
        if (confidence === "low") {
          confidence = sameType || hasGeneralTypeGap ? "medium" : "low";
        }
      }

      if (similarity >= 0.95) {
        reasons.push(`char-similarity-${similarity.toFixed(3)}`);
        if (confidence === "low") {
          confidence = sameType ? "high" : "medium";
        }
      } else if (similarity >= 0.9) {
        reasons.push(`char-similarity-${similarity.toFixed(3)}`);
        if (confidence === "low") {
          confidence = "medium";
        }
      }

      if (sameType) {
        reasons.push("same-type");
      } else if (hasGeneralTypeGap) {
        reasons.push("general-type-gap");
      } else {
        reasons.push("type-mismatch");
      }

      if (hasNumericTokenMismatch) {
        reasons.push("numeric-token-mismatch");
        confidence = "low";
      }

      if (hasSymbolSemanticMismatch) {
        reasons.push("symbol-semantic-mismatch");
        confidence = "low";
      }

      if (hasVariantConflict) {
        reasons.push("variant-conflict-hint");
        if (confidence === "high") confidence = "medium";
      }

      const direction = chooseMergeDirection(left.raw, right.raw, benchmarkValueCountById);

      benchmarkCandidates.push({
        sourceId: direction.source.id,
        sourceName: direction.source.benchmarkName,
        sourceType: direction.source.benchmarkType ?? "",
        sourceSourceSummary: benchmarkSourceSummaryById.get(direction.source.id) ?? "空 source",
        sourceValueCount: direction.sourceCount,
        targetId: direction.target.id,
        targetName: direction.target.benchmarkName,
        targetType: direction.target.benchmarkType ?? "",
        targetSourceSummary: benchmarkSourceSummaryById.get(direction.target.id) ?? "空 source",
        targetValueCount: direction.targetCount,
        confidence,
        similarity: Number(similarity.toFixed(4)),
        characterRepeatScore: Number(charRepeatScore.toFixed(4)),
        reasons: Array.from(new Set(reasons))
      });
    }
  }

  const sortByConfidence = <T extends { confidence: DuplicateConfidence; similarity: number; targetValueCount: number }>(
    left: T,
    right: T
  ) => {
    const confidenceDiff = duplicateConfidenceWeight(right.confidence) - duplicateConfidenceWeight(left.confidence);
    if (confidenceDiff !== 0) return confidenceDiff;

    if (right.similarity !== left.similarity) {
      return right.similarity - left.similarity;
    }

    return right.targetValueCount - left.targetValueCount;
  };

  return {
    generatedAt: new Date().toISOString(),
    modelCandidates: modelCandidates.sort(sortByConfidence).slice(0, DUPLICATE_RESULT_LIMIT),
    benchmarkCandidates: benchmarkCandidates.sort(sortByConfidence).slice(0, DUPLICATE_RESULT_LIMIT)
  };
}


export function __normalizeDuplicateCompareTextForTest(input: string): string {
  return normalizeLooseText(input);
}

export function __getDuplicateNameSimilarityForTest(left: string, right: string): number {
  const similarity = Math.max(getCharacterRepeatScore(left, right), getDiceSimilarity(left, right));
  return Number(similarity.toFixed(4));
}

export function __hasBenchmarkNumericTokenMismatchForTest(left: string, right: string): boolean {
  return hasBenchmarkNumericTokenMismatch(left, right);
}

export function __hasBenchmarkVariantNoiseNormalizedNameMatchForTest(left: string, right: string): boolean {
  return hasBenchmarkVariantNoiseNormalizedNameMatch(left, right);
}

export function __hasBenchmarkSymbolSemanticMismatchForTest(left: string, right: string): boolean {
  return hasBenchmarkSymbolSemanticMismatch(left, right);
}

type RawBenchmarkScaleConsistencyAggregateRow = {
  benchmark_id: number | string;
  benchmark_name: string;
  benchmark_type: string;
  value_count: number | string;
  small_count: number | string;
  large_count: number | string;
  zero_to_hundred_count: number | string;
  over_hundred_count: number | string;
  min_value: number | string;
  max_value: number | string;
};

type RawBenchmarkScaleValueDetailRow = {
  benchmark_id: number | string;
  value_num: number | string | null;
  value_num2: number | string | null;
  model_name: string;
  source: string | null;
  bench_time: string | Date;
};

function buildBenchmarkScaleConsistencyIssueBase(
  row: RawBenchmarkScaleConsistencyAggregateRow
): Omit<BenchmarkScaleConsistencyIssue, "segments" | "valueDetails"> | null {
  const benchmarkId = Number(row.benchmark_id);
  const minValue = toFiniteNumber(row.min_value);
  const maxValue = toFiniteNumber(row.max_value);
  const smallValueCount = Number(row.small_count ?? 0);
  const largeValueCount = Number(row.large_count ?? 0);
  const zeroToHundredCount = Number(row.zero_to_hundred_count ?? 0);
  const overHundredCount = Number(row.over_hundred_count ?? 0);

  if (!Number.isFinite(benchmarkId) || minValue === null || maxValue === null) {
    return null;
  }

  const hasMixedZeroOneAndHundred = smallValueCount > 0 && largeValueCount > 0;
  const hasMixedHundredAndElo = zeroToHundredCount > 0 && overHundredCount > 0;

  if (!hasMixedZeroOneAndHundred && !hasMixedHundredAndElo) {
    return null;
  }

  const issueType: BenchmarkConsistencyIssueType = hasMixedHundredAndElo
    ? "mixed-scale-100-vs-elo"
    : "mixed-scale-0-1-vs-100";

  const recommendedAction: BenchmarkConsistencyRecommendedAction = issueType === "mixed-scale-0-1-vs-100"
    ? "normalize-scale"
    : "split-benchmark";

  return {
    issueType,
    recommendedAction,
    benchmarkId,
    benchmarkName: row.benchmark_name,
    benchmarkType: row.benchmark_type,
    valueCount: Number(row.value_count ?? 0),
    smallValueCount,
    largeValueCount,
    zeroToHundredCount,
    overHundredCount,
    minValue,
    maxValue
  };
}

function appendBenchmarkScaleValueDetails(
  item: Omit<BenchmarkScaleConsistencyIssue, "segments" | "valueDetails">,
  valueDetails: BenchmarkScaleValueDetail[]
): BenchmarkScaleConsistencyIssue {
  const smallValues = collectDetailValuesByPredicate(valueDetails, (value) => value >= 0 && value < 1);
  const largeValues = collectDetailValuesByPredicate(valueDetails, (value) => value > 10);
  const baseValues = collectDetailValuesByPredicate(valueDetails, (value) => value >= 0 && value <= 100);
  const eloValues = collectDetailValuesByPredicate(valueDetails, (value) => value > 100);

  return {
    ...item,
    segments: item.issueType === "mixed-scale-0-1-vs-100"
      ? [
          {
            key: "small",
            label: "0-1",
            count: item.smallValueCount,
            ...mergeNumericBounds(smallValues)
          },
          {
            key: "large",
            label: ">10",
            count: item.largeValueCount,
            ...mergeNumericBounds(largeValues)
          }
        ]
      : [
          {
            key: "base",
            label: "0-100",
            count: item.zeroToHundredCount,
            ...mergeNumericBounds(baseValues)
          },
          {
            key: "elo",
            label: ">100 (Elo)",
            count: item.overHundredCount,
            ...mergeNumericBounds(eloValues)
          }
        ],
    valueDetails
  };
}

async function getBenchmarkScaleConsistencyIssueById(
  benchmarkId: number
): Promise<BenchmarkScaleConsistencyIssue | null> {
  const result = await db.execute(sql`
    WITH expanded_values AS (
      SELECT benchmark_id, value_num::numeric AS numeric_value
      FROM benchmark_values
      WHERE benchmark_id = ${benchmarkId} AND value_num IS NOT NULL
      UNION ALL
      SELECT benchmark_id, value_num2::numeric AS numeric_value
      FROM benchmark_values
      WHERE benchmark_id = ${benchmarkId} AND value_num2 IS NOT NULL
    ),
    grouped AS (
      SELECT
        benchmark_id,
        COUNT(*)::int AS value_count,
        COUNT(*) FILTER (WHERE numeric_value >= 0 AND numeric_value < 1)::int AS small_count,
        COUNT(*) FILTER (WHERE numeric_value > 10)::int AS large_count,
        COUNT(*) FILTER (WHERE numeric_value >= 0 AND numeric_value <= 100)::int AS zero_to_hundred_count,
        COUNT(*) FILTER (WHERE numeric_value > 100)::int AS over_hundred_count,
        MIN(numeric_value)::numeric AS min_value,
        MAX(numeric_value)::numeric AS max_value
      FROM expanded_values
      GROUP BY benchmark_id
    )
    SELECT
      grouped.benchmark_id,
      benchmarks.benchmark_name,
      benchmarks.benchmark_type,
      grouped.value_count,
      grouped.small_count,
      grouped.large_count,
      grouped.zero_to_hundred_count,
      grouped.over_hundred_count,
      grouped.min_value,
      grouped.max_value
    FROM grouped
    INNER JOIN benchmarks ON benchmarks.id = grouped.benchmark_id
    WHERE benchmarks.merged_into_benchmark_id IS NULL
  `);

  const baseIssue = resultRows<RawBenchmarkScaleConsistencyAggregateRow>(result)
    .map((row) => buildBenchmarkScaleConsistencyIssueBase(row))
    .find((item): item is Omit<BenchmarkScaleConsistencyIssue, "segments" | "valueDetails"> => item !== null);

  if (!baseIssue) {
    return null;
  }

  const valueDetailsResult = await db.execute(sql`
    SELECT
      benchmark_values.benchmark_id,
      benchmark_values.value_num,
      benchmark_values.value_num2,
      models.model_name,
      benchmark_values.source,
      benchmark_values.bench_time
    FROM benchmark_values
    INNER JOIN models ON models.id = benchmark_values.model_id
    WHERE benchmark_values.benchmark_id = ${benchmarkId}
      AND (benchmark_values.value_num IS NOT NULL OR benchmark_values.value_num2 IS NOT NULL)
    ORDER BY benchmark_values.bench_time DESC, benchmark_values.id DESC
  `);

  const valueDetails: BenchmarkScaleValueDetail[] = [];

  resultRows<RawBenchmarkScaleValueDetailRow>(valueDetailsResult).forEach((row) => {
    const rowBenchmarkId = Number(row.benchmark_id);
    if (!Number.isFinite(rowBenchmarkId)) {
      return;
    }

    const benchTime = toIsoDateTime(row.bench_time);
    const source = row.source?.trim() ? row.source.trim() : null;

    const pushDetail = (rawValue: unknown, field: BenchmarkScaleValueDetail["field"]) => {
      const value = toFiniteNumber(rawValue);
      if (value === null) {
        return;
      }

      valueDetails.push({
        value,
        field,
        modelName: row.model_name,
        source,
        benchTime
      });
    };

    pushDetail(row.value_num, "valueNum");
    pushDetail(row.value_num2, "valueNum2");
  });

  return appendBenchmarkScaleValueDetails(baseIssue, valueDetails);
}

export async function detectBenchmarkScaleConsistencyIssues(): Promise<BenchmarkScaleConsistencyCheckResult> {
  const result = await db.execute(sql`
    WITH expanded_values AS (
      SELECT benchmark_id, value_num::numeric AS numeric_value
      FROM benchmark_values
      WHERE value_num IS NOT NULL
      UNION ALL
      SELECT benchmark_id, value_num2::numeric AS numeric_value
      FROM benchmark_values
      WHERE value_num2 IS NOT NULL
    ),
    grouped AS (
      SELECT
        benchmark_id,
        COUNT(*)::int AS value_count,
        COUNT(*) FILTER (WHERE numeric_value >= 0 AND numeric_value < 1)::int AS small_count,
        COUNT(*) FILTER (WHERE numeric_value > 10)::int AS large_count,
        COUNT(*) FILTER (WHERE numeric_value >= 0 AND numeric_value <= 100)::int AS zero_to_hundred_count,
        COUNT(*) FILTER (WHERE numeric_value > 100)::int AS over_hundred_count,
        MIN(numeric_value)::numeric AS min_value,
        MAX(numeric_value)::numeric AS max_value
      FROM expanded_values
      GROUP BY benchmark_id
      HAVING (
        COUNT(*) FILTER (WHERE numeric_value >= 0 AND numeric_value < 1) > 0
        AND COUNT(*) FILTER (WHERE numeric_value > 10) > 0
      ) OR (
        COUNT(*) FILTER (WHERE numeric_value >= 0 AND numeric_value <= 100) > 0
        AND COUNT(*) FILTER (WHERE numeric_value > 100) > 0
      )
    )
    SELECT
      grouped.benchmark_id,
      benchmarks.benchmark_name,
      benchmarks.benchmark_type,
      grouped.value_count,
      grouped.small_count,
      grouped.large_count,
      grouped.zero_to_hundred_count,
      grouped.over_hundred_count,
      grouped.min_value,
      grouped.max_value
    FROM grouped
    INNER JOIN benchmarks ON benchmarks.id = grouped.benchmark_id
    WHERE benchmarks.merged_into_benchmark_id IS NULL
    ORDER BY grouped.large_count DESC, grouped.small_count DESC, benchmarks.benchmark_name ASC, benchmarks.benchmark_type ASC
  `);

  const baseIssues = resultRows<RawBenchmarkScaleConsistencyAggregateRow>(result)
    .map((row) => buildBenchmarkScaleConsistencyIssueBase(row))
    .filter((item): item is Omit<BenchmarkScaleConsistencyIssue, "segments" | "valueDetails"> => item !== null);

  if (baseIssues.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      issues: []
    };
  }

  const issueBenchmarkIds = baseIssues.map((item) => item.benchmarkId);

  const valueDetailsResult = await db.execute(sql`
    SELECT
      benchmark_values.benchmark_id,
      benchmark_values.value_num,
      benchmark_values.value_num2,
      models.model_name,
      benchmark_values.source,
      benchmark_values.bench_time
    FROM benchmark_values
    INNER JOIN models ON models.id = benchmark_values.model_id
    WHERE benchmark_values.benchmark_id IN (${sql.join(issueBenchmarkIds.map((item) => sql`${item}`), sql`, `)})
      AND (benchmark_values.value_num IS NOT NULL OR benchmark_values.value_num2 IS NOT NULL)
    ORDER BY benchmark_values.benchmark_id ASC, benchmark_values.bench_time DESC, benchmark_values.id DESC
  `);

  const valueDetailMap = new Map<number, BenchmarkScaleValueDetail[]>();

  resultRows<RawBenchmarkScaleValueDetailRow>(valueDetailsResult).forEach((row) => {
    const benchmarkId = Number(row.benchmark_id);
    if (!Number.isFinite(benchmarkId)) {
      return;
    }

    const benchTime = toIsoDateTime(row.bench_time);
    const source = row.source?.trim() ? row.source.trim() : null;

    const pushDetail = (rawValue: unknown, field: BenchmarkScaleValueDetail["field"]) => {
      const value = toFiniteNumber(rawValue);
      if (value === null) {
        return;
      }

      if (!valueDetailMap.has(benchmarkId)) {
        valueDetailMap.set(benchmarkId, []);
      }

      valueDetailMap.get(benchmarkId)?.push({
        value,
        field,
        modelName: row.model_name,
        source,
        benchTime
      });
    };

    pushDetail(row.value_num, "valueNum");
    pushDetail(row.value_num2, "valueNum2");
  });

  const issues: BenchmarkScaleConsistencyIssue[] = baseIssues.map((item) =>
    appendBenchmarkScaleValueDetails(item, valueDetailMap.get(item.benchmarkId) ?? [])
  );

  return {
    generatedAt: new Date().toISOString(),
    issues
  };
}

export async function normalizeBenchmarkScaleByTarget(input: {
  benchmarkId: number;
  targetScale: BenchmarkScaleNormalizationTarget;
}): Promise<BenchmarkScaleNormalizationResult> {
  const [benchmark] = await db
    .select({
      id: benchmarks.id,
      benchmarkName: benchmarks.benchmarkName,
      benchmarkType: benchmarks.benchmarkType
    })
    .from(benchmarks)
    .where(and(eq(benchmarks.id, input.benchmarkId), isNull(benchmarks.mergedIntoBenchmarkId)))
    .limit(1);

  if (!benchmark) {
    throw new Error(`benchmark not found or merged: ${input.benchmarkId}`);
  }

  const checkResult = await db.execute(sql`
    WITH expanded_values AS (
      SELECT benchmark_id, value_num::numeric AS numeric_value
      FROM benchmark_values
      WHERE benchmark_id = ${input.benchmarkId} AND value_num IS NOT NULL
      UNION ALL
      SELECT benchmark_id, value_num2::numeric AS numeric_value
      FROM benchmark_values
      WHERE benchmark_id = ${input.benchmarkId} AND value_num2 IS NOT NULL
    )
    SELECT
      COUNT(*) FILTER (WHERE numeric_value >= 0 AND numeric_value < 1)::int AS small_count,
      COUNT(*) FILTER (WHERE numeric_value > 10)::int AS large_count
    FROM expanded_values
  `);

  const checkRow = firstResultRow<{ small_count: number | string; large_count: number | string }>(checkResult);
  const smallCount = Number(checkRow?.small_count ?? 0);
  const largeCount = Number(checkRow?.large_count ?? 0);

  if (smallCount <= 0 || largeCount <= 0) {
    throw new Error("该 benchmark 未检测到同时存在 <1 与 >10 的混合量纲，无需同化");
  }

  const { updatedRows, updatedCells } = await db.transaction(async (tx: DbTransactionClient) => {
    const rows = await tx
      .select({
        id: benchmarkValues.id,
        valueNum: benchmarkValues.valueNum,
        valueNum2: benchmarkValues.valueNum2,
        valueNote: benchmarkValues.valueNote
      })
      .from(benchmarkValues)
      .where(eq(benchmarkValues.benchmarkId, input.benchmarkId));

    let nextUpdatedRows = 0;
    let nextUpdatedCells = 0;

    for (const row of rows) {
      const currentValueNum = toFiniteNumber(row.valueNum);
      const currentValueNum2 = toFiniteNumber(row.valueNum2);

      const nextValueNum = normalizeScaleNumericValue(currentValueNum, input.targetScale);
      const nextValueNum2 = normalizeScaleNumericValue(currentValueNum2, input.targetScale);

      const valueNumChanged = hasMeaningfulNumericChange(currentValueNum, nextValueNum);
      const valueNum2Changed = hasMeaningfulNumericChange(currentValueNum2, nextValueNum2);

      if (!valueNumChanged && !valueNum2Changed) {
        continue;
      }

      nextUpdatedRows += 1;
      nextUpdatedCells += (valueNumChanged ? 1 : 0) + (valueNum2Changed ? 1 : 0);

      await tx
        .update(benchmarkValues)
        .set({
          valueNum: nextValueNum === null ? null : formatScaledNumericValue(nextValueNum),
          valueNum2: nextValueNum2 === null ? null : formatScaledNumericValue(nextValueNum2),
          valueNote: appendScaleNormalizationNote(row.valueNote, input.targetScale)
        })
        .where(eq(benchmarkValues.id, row.id));
    }

    return {
      updatedRows: nextUpdatedRows,
      updatedCells: nextUpdatedCells
    };
  });

  await invalidateAllCaches();

  return {
    ok: true,
    benchmarkId: benchmark.id,
    benchmarkName: benchmark.benchmarkName,
    benchmarkType: benchmark.benchmarkType,
    targetScale: input.targetScale,
    updatedRows,
    updatedCells
  };
}

export async function splitBenchmarkScaleByMode(input: {
  benchmarkId: number;
  splitMode: BenchmarkSplitScaleMode;
  baseBenchmarkName: string;
  eloBenchmarkName: string;
}): Promise<BenchmarkSplitScaleResult> {
  if (input.splitMode !== "hundred-vs-elo") {
    throw new Error(`unsupported split mode: ${input.splitMode}`);
  }

  const [benchmark] = await db
    .select({
      id: benchmarks.id,
      benchmarkName: benchmarks.benchmarkName,
      benchmarkType: benchmarks.benchmarkType,
      unit: benchmarks.unit,
      higherIsBetter: benchmarks.higherIsBetter,
      modalities: benchmarks.modalities,
      sourceBenchmarkId: benchmarks.sourceBenchmarkId
    })
    .from(benchmarks)
    .where(and(eq(benchmarks.id, input.benchmarkId), isNull(benchmarks.mergedIntoBenchmarkId)))
    .limit(1);

  if (!benchmark) {
    throw new Error(`benchmark not found or merged: ${input.benchmarkId}`);
  }

  const baseBenchmarkName = normalizeNameParenthesisSpacing(input.baseBenchmarkName).trim();
  const eloBenchmarkName = normalizeNameParenthesisSpacing(input.eloBenchmarkName).trim();

  if (!baseBenchmarkName || !eloBenchmarkName) {
    throw new Error("拆分后的 benchmark 名称不能为空");
  }

  const dedupeRule = await getModelDedupeRule();
  const baseCanonicalKey = buildBenchmarkCanonicalKey(baseBenchmarkName, benchmark.benchmarkType, dedupeRule);
  const eloCanonicalKey = buildBenchmarkCanonicalKey(eloBenchmarkName, benchmark.benchmarkType, dedupeRule);

  if (baseCanonicalKey === eloCanonicalKey) {
    throw new Error("原 benchmark 与 Elo benchmark 名称/type 不能指向同一实体");
  }

  const issue = await getBenchmarkScaleConsistencyIssueById(input.benchmarkId);

  if (!issue || issue.issueType !== "mixed-scale-100-vs-elo") {
    throw new Error("该 benchmark 未检测到 0-100 与 >100 的混合分值，无需拆分");
  }

  if (issue.overHundredCount <= 0) {
    throw new Error("该 benchmark 当前没有可迁移到 Elo 的 >100 分值");
  }

  const result = await db.transaction(async (tx: DbTransactionClient) => {
    const baseBenchmark = benchmark.benchmarkName === baseBenchmarkName
      ? benchmark
      : await ensureBenchmark(
          {
            benchmarkName: baseBenchmarkName,
            benchmarkType: benchmark.benchmarkType,
            unit: benchmark.unit,
            higherIsBetter: benchmark.higherIsBetter,
            modalities: benchmark.modalities,
            sourceBenchmarkId: benchmark.sourceBenchmarkId
          },
          { dedupeRule, db: tx }
        );
    const baseBenchmarkId = baseBenchmark.id;

    const eloBenchmark = await ensureBenchmark(
      {
        benchmarkName: eloBenchmarkName,
        benchmarkType: benchmark.benchmarkType,
        unit: benchmark.unit,
        higherIsBetter: benchmark.higherIsBetter,
        modalities: benchmark.modalities,
        sourceBenchmarkId: benchmark.sourceBenchmarkId
      },
      { dedupeRule, db: tx }
    );

    const rows = await tx
      .select({
        id: benchmarkValues.id,
        modelId: benchmarkValues.modelId,
        benchmarkId: benchmarkValues.benchmarkId,
        benchTime: benchmarkValues.benchTime,
        valueRaw: benchmarkValues.valueRaw,
        valueNum: benchmarkValues.valueNum,
        valueNum2: benchmarkValues.valueNum2,
        valueNote: benchmarkValues.valueNote,
        source: benchmarkValues.source
      })
      .from(benchmarkValues)
      .where(eq(benchmarkValues.benchmarkId, benchmark.id));

    const sourceMetaRows = await tx
      .select({
        source: benchmarkSourceMeta.source,
        benchmarkType: benchmarkSourceMeta.benchmarkType,
        modalities: benchmarkSourceMeta.modalities
      })
      .from(benchmarkSourceMeta)
      .where(eq(benchmarkSourceMeta.benchmarkId, benchmark.id));

    const sourceMetaBySource = new Map<string, { benchmarkType: string; modalities: string[] | null }>();
    sourceMetaRows.forEach((row: { source: string; benchmarkType: string; modalities: string[] | null }) => {
      const normalizedSource = row.source.trim();
      if (!normalizedSource) return;

      if (!sourceMetaBySource.has(normalizedSource)) {
        sourceMetaBySource.set(normalizedSource, {
          benchmarkType: row.benchmarkType,
          modalities: row.modalities
        });
      }
    });

    const fallbackBenchmarkType = benchmark.benchmarkType;
    const fallbackModalities = benchmark.modalities?.length ? benchmark.modalities : ["Text"];
    const sourceMetaUpsertMap = new Map<string, {
      benchmarkId: number;
      source: string;
      benchmarkType: string;
      modalities: string[];
    }>();

    const queueSourceMetaUpsert = (targetBenchmarkId: number, source: string | null | undefined) => {
      const normalizedSource = source?.trim() ?? "";
      if (normalizedSource.length === 0) {
        return;
      }

      const key = `${targetBenchmarkId}\u0000${normalizedSource}`;
      if (sourceMetaUpsertMap.has(key)) {
        return;
      }

      const sourceMeta = sourceMetaBySource.get(normalizedSource);
      sourceMetaUpsertMap.set(key, {
        benchmarkId: targetBenchmarkId,
        source: normalizedSource,
        benchmarkType: sourceMeta?.benchmarkType ?? fallbackBenchmarkType,
        modalities: sourceMeta?.modalities ?? fallbackModalities
      });
    };

    let movedRows = 0;
    let splitRows = 0;
    let createdRows = 0;

    for (const row of rows) {
      const valueNum = toFiniteNumber(row.valueNum);
      const valueNum2 = toFiniteNumber(row.valueNum2);
      const valueNumIsBase = isZeroToHundredScaleValue(valueNum);
      const valueNumIsElo = isEloScaleValue(valueNum);
      const valueNum2IsBase = isZeroToHundredScaleValue(valueNum2);
      const valueNum2IsElo = isEloScaleValue(valueNum2);

      const hasBaseValue = valueNumIsBase || valueNum2IsBase;
      const hasEloValue = valueNumIsElo || valueNum2IsElo;

      if (!hasEloValue) {
        if (baseBenchmarkId !== benchmark.id) {
          queueSourceMetaUpsert(baseBenchmarkId, row.source);

          await tx
            .update(benchmarkValues)
            .set({
              benchmarkId: baseBenchmarkId,
              valueNote: appendBenchmarkSplitNote(row.valueNote, "base")
            })
            .where(eq(benchmarkValues.id, row.id));

          movedRows += 1;
        }

        continue;
      }

      if (!hasBaseValue) {
        queueSourceMetaUpsert(eloBenchmark.id, row.source);

        await tx
          .update(benchmarkValues)
          .set({
            benchmarkId: eloBenchmark.id,
            valueNote: appendBenchmarkSplitNote(row.valueNote, "elo")
          })
          .where(eq(benchmarkValues.id, row.id));

        movedRows += 1;
        continue;
      }

      const {
        valueNum: baseValueNum,
        valueNum2: baseValueNum2
      } = normalizeSplitBenchmarkPair(
        valueNumIsBase ? valueNum : null,
        valueNum2IsBase ? valueNum2 : null
      );
      const {
        valueNum: eloValueNum,
        valueNum2: eloValueNum2
      } = normalizeSplitBenchmarkPair(
        valueNumIsElo ? valueNum : null,
        valueNum2IsElo ? valueNum2 : null
      );

      await tx
        .update(benchmarkValues)
        .set({
          benchmarkId: baseBenchmarkId,
          valueRaw: buildSplitBenchmarkValueRaw(baseValueNum, baseValueNum2),
          valueNum: baseValueNum === null ? null : formatScaledNumericValue(baseValueNum),
          valueNum2: baseValueNum2 === null ? null : formatScaledNumericValue(baseValueNum2),
          valueNote: appendBenchmarkSplitNote(row.valueNote, "base")
        })
        .where(eq(benchmarkValues.id, row.id));

      await tx.insert(benchmarkValues).values({
        modelId: row.modelId,
        benchmarkId: eloBenchmark.id,
        benchTime: row.benchTime,
        valueRaw: buildSplitBenchmarkValueRaw(eloValueNum, eloValueNum2),
        valueNum: eloValueNum === null ? null : formatScaledNumericValue(eloValueNum),
        valueNum2: eloValueNum2 === null ? null : formatScaledNumericValue(eloValueNum2),
        valueNote: appendBenchmarkSplitNote(row.valueNote, "elo"),
        source: row.source
      });

      queueSourceMetaUpsert(baseBenchmarkId, row.source);
      queueSourceMetaUpsert(eloBenchmark.id, row.source);

      splitRows += 1;
      createdRows += 1;
    }

    const sourceMetaUpsertRows = Array.from(sourceMetaUpsertMap.values());
    if (sourceMetaUpsertRows.length > 0) {
      await tx
        .insert(benchmarkSourceMeta)
        .values(sourceMetaUpsertRows)
        .onConflictDoNothing({
          target: [benchmarkSourceMeta.benchmarkId, benchmarkSourceMeta.source]
        });
    }

    return {
      baseBenchmarkId,
      baseBenchmarkName: baseBenchmark.benchmarkName,
      baseBenchmarkType: benchmark.benchmarkType,
      eloBenchmarkId: eloBenchmark.id,
      eloBenchmarkName: eloBenchmark.benchmarkName,
      eloBenchmarkType: eloBenchmark.benchmarkType,
      movedRows,
      splitRows,
      createdRows
    };
  });

  await invalidateAllCaches();

  return {
    ok: true,
    benchmarkId: benchmark.id,
    benchmarkName: benchmark.benchmarkName,
    benchmarkType: benchmark.benchmarkType,
    splitMode: input.splitMode,
    ...result
  };
}

export async function clearNonSettingsData() {
  await db.transaction(async (tx: DbTransactionClient) => {
    await tx.delete(benchmarkValues);
    await tx.delete(benchmarkSourceMeta);
    await tx.delete(models);
    await tx.delete(benchmarks);
    await tx.delete(providers);
  });

  await invalidateAllCaches();

  return {
    ok: true
  };
}

// Test exports for provider config
export function __normalizeProviderConfigForTest(raw: unknown): ProviderConfig {
  return normalizeProviderConfig(raw);
}

export function __validateProviderConfigForTest(providerId: number, config: ProviderConfig, allProviders: Array<typeof providers.$inferSelect>) {
  validateProviderConfig(providerId, config, allProviders);
}

export function __mergeProviderConfigForTest(current: ProviderConfig, incoming: unknown): ProviderConfig {
  return mergeProviderConfig(current, incoming);
}

export async function __updateProviderConfigForTest(
  input: { providerId: number; config: unknown },
  options?: { db?: DbExecutor; transactionExecutor?: ProviderConfigTransactionExecutor }
) {
  return updateProviderConfig(input, options);
}

export async function __deleteProviderAndTransferModelsForTest(
  input: { providerId: number; transferTargetProviderId: number },
  options?: { transactionExecutor?: ProviderDeleteTransactionExecutor }
) {
  return deleteProviderAndTransferModels(input, options);
}

export async function __getProviderNameForModelForTest(modelName: string, options?: { db?: DbExecutor }) {
  return getProviderNameForModel(modelName, options);
}

export async function __buildProviderCanonicalNameResolverForTest(
  rows: Array<Pick<StructuredImportRowInput, "modelName" | "providerName">>,
  options?: { db?: DbExecutor }
) {
  return buildProviderCanonicalNameResolver(rows, options);
}

export function __invalidateDuplicateCandidatesCacheForTest() {
  invalidateVersionedCacheStore(duplicateCandidatesStore);
}
