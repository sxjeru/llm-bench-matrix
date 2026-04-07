import * as XLSX from "xlsx";
import { parseBenchmarkValue } from "@/lib/db/parse-value";

const EMPTY_MARKERS = new Set(["", "-", "--", "—", "–", "n/a", "na", "null"]);
const CATEGORY_HEADERS = new Set(["category", "类别", "分类", "type", "group"]);

const numberPattern = "(?:[$¥€£]\\s*)?[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const pairRegex = new RegExp(`^${numberPattern}\\s*\\/\\s*${numberPattern}(?:\\s*[\\*\\^][0-9A-Za-z]*)?$`);
const singleRegex = new RegExp(`^${numberPattern}(?:\\s*[\\*\\^][0-9A-Za-z]*)?$`);

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
    .replace(/([^\s（(])([（(])/g, "$1 $2")
    .replace(/\s+([（(])/g, " $1");
}

function isEmptyMarker(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return EMPTY_MARKERS.has(normalized);
}

function isValidRawValue(raw: string): boolean {
  const value = raw.trim();
  if (isEmptyMarker(value)) return true;
  return pairRegex.test(value) || singleRegex.test(value);
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

export function parseWorkbookBuffer(buffer: Buffer, sheetName?: string): WorkbookParseResult {
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

      const valid = isValidRawValue(rawValue);
      const parsed = parseBenchmarkValue(rawValue);

      if (!valid) {
        warnings.push({
          rowNumber: rowIndex + 1,
          modelName,
          benchmarkName,
          rawValue,
          reason: "值格式不符合规则（允许：98.7、98.7/57.2、65.2*、--/- 空值）"
        });
      }

      records.push({
        rowNumber: rowIndex + 1,
        category,
        benchmarkName,
        modelName,
        rawValue,
        valueNum: parsed.valueNum,
        valueNum2: parsed.valueNum2,
        valueNote: parsed.valueNote,
        valid
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
