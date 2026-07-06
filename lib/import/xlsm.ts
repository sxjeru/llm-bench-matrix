import { parseBenchmarkValue } from "@/lib/db/parse-value";
import { IMPORT_VALUE_PAIR_REGEX, IMPORT_VALUE_RANK_PREFIX_REGEX, IMPORT_VALUE_SINGLE_REGEX } from "@/lib/import/value-patterns";

const EMPTY_MARKERS = new Set(["", "-", "--", "—", "–", "n/a", "na", "null"]);
const CATEGORY_HEADERS = new Set(["category", "类别", "分类", "type", "group"]);
const HYPHEN_VARIANT_REGEX = /[\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

const pipeSeparatorRegex = /[|｜]/;

export type ImportWarning = {
  rowNumber: number;
  modelName: string;
  benchmarkName: string;
  rawValue: string;
  reason: string;
};

export type ParsedImportRecord = {
  rowNumber: number;
  category: string | null;
  benchmarkName: string;
  modelName: string;
  rawValue: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  valid: boolean;
  higherIsBetter?: boolean;
};

export type WorkbookParseResult = {
  sheetNames: string[];
  selectedSheet: string;
  benchmarkColumn: string;
  categoryColumn: string | null;
  modelColumns: string[];
  records: ParsedImportRecord[];
  warnings: ImportWarning[];
};

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeNameParenthesisSpacing(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return "";

  return trimmed
    .replace(HYPHEN_VARIANT_REGEX, "-")
    .replace(/([^\s（(])([（(])/g, "$1 $2")
    .replace(/\s+([（(])/g, " $1");
}

function mergeValueNotes(primary: string | null | undefined, secondary: string | null | undefined): string | null {
  const first = primary?.trim() ?? "";
  const second = secondary?.trim() ?? "";

  if (first && second) {
    return first === second ? first : `${first}; ${second}`;
  }

  if (first) return first;
  if (second) return second;
  return null;
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
    .split(pipeSeparatorRegex)
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

function expandMetricLabeledCellValue(benchmarkName: string, rawValue: string): Array<{
  benchmarkName: string;
  rawValue: string;
  valueNote: string | null;
}> | null {
  const metricLabels = extractBenchmarkMetricLabels(benchmarkName);
  if (!metricLabels) return null;

  const valueSegments = rawValue
    .split(pipeSeparatorRegex)
    .map((item) => item.trim())
    .filter(Boolean);

  if (valueSegments.length < 2 || valueSegments.length !== metricLabels.labels.length) {
    return null;
  }

  if (!valueSegments.every((segment) => IMPORT_VALUE_SINGLE_REGEX.test(segment))) {
    return null;
  }

  if (metricLabels.labels.length === 2) {
    const [first, second] = valueSegments;
    if (!first || !second) return null;

    return [
      {
        benchmarkName: metricLabels.baseBenchmarkName,
        rawValue: `${first} / ${second}`,
        valueNote: metricLabels.labelsNote
      }
    ];
  }

  return metricLabels.labels.map((label, index) => ({
    benchmarkName: `${metricLabels.baseBenchmarkName} (${label})`,
    rawValue: valueSegments[index] ?? "",
    valueNote: null
  }));
}

function isEmptyMarker(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return EMPTY_MARKERS.has(normalized);
}

function isValidRawValue(raw: string): boolean {
  const value = raw.trim();
  if (isEmptyMarker(value)) return true;

  if (IMPORT_VALUE_PAIR_REGEX.test(value) || IMPORT_VALUE_SINGLE_REGEX.test(value)) {
    return true;
  }

  if (!pipeSeparatorRegex.test(value)) {
    return false;
  }

  const pipeSegments = value
    .split(pipeSeparatorRegex)
    .map((item) => item.trim())
    .filter(Boolean);

  if (pipeSegments.length < 2) {
    return false;
  }

  return pipeSegments.every((segment) => IMPORT_VALUE_SINGLE_REGEX.test(segment));
}

function getNonEmptyColumnIndices(headerRow: string[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < headerRow.length; i += 1) {
    if (normalizeCell(headerRow[i])) {
      indices.push(i);
    }
  }
  return indices;
}

export async function parseWorkbookBuffer(buffer: Buffer, sheetName?: string): Promise<WorkbookParseResult> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });

  if (workbook.SheetNames.length === 0) {
    throw new Error("Workbook has no sheets");
  }

  const selectedSheet = sheetName && workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
  const worksheet = workbook.Sheets[selectedSheet];

  if (!worksheet) {
    throw new Error(`Sheet not found: ${selectedSheet}`);
  }

  const rawRows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: ""
  }) as unknown[][];

  if (rawRows.length === 0) {
    throw new Error("Selected sheet is empty");
  }

  const headerRow = rawRows[0].map((cell) => normalizeCell(cell));
  const nonEmptyIndices = getNonEmptyColumnIndices(headerRow);

  if (nonEmptyIndices.length < 2) {
    throw new Error("Sheet must contain at least benchmark column and one model column");
  }

  const firstIndex = nonEmptyIndices[0];
  const firstHeader = normalizeHeader(headerRow[firstIndex]);

  const hasCategoryColumn = CATEGORY_HEADERS.has(firstHeader) && nonEmptyIndices.length >= 3;
  const categoryIndex = hasCategoryColumn ? firstIndex : null;
  const benchmarkIndex = hasCategoryColumn ? nonEmptyIndices[1] : firstIndex;

  const modelIndices = nonEmptyIndices.filter((index) => index > benchmarkIndex);
  if (modelIndices.length === 0) {
    throw new Error("No model columns found to the right side of benchmark column");
  }

  const benchmarkColumn = headerRow[benchmarkIndex] || "Benchmark";
  const categoryColumn = categoryIndex !== null ? headerRow[categoryIndex] || "Category" : null;

  const warnings: ImportWarning[] = [];
  const records: ParsedImportRecord[] = [];
  let currentCategory: string | null = null;

  for (let rowIndex = 1; rowIndex < rawRows.length; rowIndex += 1) {
    const row = rawRows[rowIndex] ?? [];
    const nextCategoryValue = categoryIndex !== null ? normalizeCell(row[categoryIndex]) : "";
    if (categoryIndex !== null && nextCategoryValue) {
      currentCategory = nextCategoryValue;
    }

    const category = categoryIndex !== null ? currentCategory : null;
    const benchmarkName = normalizeNameParenthesisSpacing(normalizeCell(row[benchmarkIndex]));

    if (!benchmarkName) {
      continue;
    }

    for (const modelIndex of modelIndices) {
      const modelName = normalizeNameParenthesisSpacing(normalizeCell(headerRow[modelIndex]));
      if (!modelName) continue;

      const rawValue = normalizeCell(row[modelIndex]);
      if (isEmptyMarker(rawValue)) continue;

      const expandedCells = expandMetricLabeledCellValue(benchmarkName, rawValue) ?? [
        {
          benchmarkName,
          rawValue,
          valueNote: null
        }
      ];

      expandedCells.forEach((cell) => {
        const valid = isValidRawValue(cell.rawValue);
        const parsed = parseBenchmarkValue(cell.rawValue);

        if (!valid) {
          warnings.push({
            rowNumber: rowIndex + 1,
            modelName,
            benchmarkName: cell.benchmarkName,
            rawValue: cell.rawValue,
            reason: "值格式不符合规则（允许：98.7、98.7/57.2、75.6 | 46.8 | 77.9、65.2*、--/- 空值）"
          });
        }

        const parsedValueNote = parsed.valueNote === "non-numeric" ? null : parsed.valueNote;
        const mergedValueNote = mergeValueNotes(cell.valueNote, parsedValueNote);

        const higherIsBetter = IMPORT_VALUE_RANK_PREFIX_REGEX.test(cell.rawValue.trim()) ? false : undefined;

        records.push({
          rowNumber: rowIndex + 1,
          category,
          benchmarkName: cell.benchmarkName,
          modelName,
          rawValue: parsed.valueRaw,
          valueNum: parsed.valueNum,
          valueNum2: parsed.valueNum2,
          valueNote: mergedValueNote ?? (parsed.valueNote === "non-numeric" ? "non-numeric" : null),
          valid,
          higherIsBetter
        });
      });
    }
  }

  return {
    sheetNames: workbook.SheetNames,
    selectedSheet,
    benchmarkColumn,
    categoryColumn,
    modelColumns: modelIndices.map((idx) => normalizeNameParenthesisSpacing(headerRow[idx])),
    records,
    warnings
  };
}
