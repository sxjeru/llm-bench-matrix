import { getMatrixCellPairDisplayParts } from "./scoring";
import type { MatrixRow, OverallModelSummary } from "./types";
import { getSourceValueDisplayItem, type SourceValueMode } from "./utils";

export type BuildMatrixMarkdownTableOptions = {
  rows: readonly MatrixRow[];
  modelColumns: readonly string[];
  showCategory: boolean;
  displaySourceValuesInCells?: boolean;
  activeSource?: string;
  sourceValueMode?: SourceValueMode;
  shouldShowOverallSummary?: boolean;
  overallSummaryByModel?: ReadonlyMap<string, OverallModelSummary>;
  overallScoreDisplayDecimalsByModel?: ReadonlyMap<string, number>;
  /** 是否在行名和表格末尾标注 AA 指数版本；默认 true */
  includeVersionLegend?: boolean;
};

export function escapeMarkdownTableCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n|\r|\n/g, " ")
    .trim();
}

function formatMarkdownTableRow(cells: readonly string[]): string {
  return `| ${cells.map((cell) => escapeMarkdownTableCell(cell)).join(" | ")} |`;
}

function getMatrixMarkdownCellText(
  row: MatrixRow,
  modelName: string,
  options: {
    displaySourceValuesInCells: boolean;
    activeSource: string;
    sourceValueMode: SourceValueMode;
  }
): string {
  const cell = row.cells.get(modelName);
  if (!cell) return "--";

  // 与表格渲染一致：非货币双值优先，再才是 source 原值 / displayValue
  const pairDisplayParts = getMatrixCellPairDisplayParts(
    cell.valueNum,
    cell.valueNum2,
    cell.valueRaw,
    cell.valueNote
  );
  if (pairDisplayParts && !pairDisplayParts.hasCurrencySymbol) {
    return `${pairDisplayParts.first} / ${pairDisplayParts.second}`;
  }

  if (options.displaySourceValuesInCells && cell.hasMeaningfulMultipleValues) {
    const sourceValueItem = getSourceValueDisplayItem(
      cell.uniqueEntries,
      options.activeSource,
      row.higherIsBetter,
      options.sourceValueMode
    );
    if (sourceValueItem) {
      return sourceValueItem.displayValue || "--";
    }
  }

  const displayValue = cell.displayValue.trim();
  return displayValue || "--";
}

function formatOverallScoreText(
  summary: OverallModelSummary | undefined,
  decimals: number
): string {
  if (summary?.rawScore == null || summary.rawRank == null) return "--";

  return `${summary.rawScore.toFixed(decimals)} (${summary.rawRank})`;
}

function buildMarkdownVersionLegend(rows: readonly MatrixRow[]): string | null {
  const versions = new Map<string, string>();
  rows.forEach((row) => {
    const version = row.aaRevision?.latestVersion;
    if (version) versions.set(row.benchmark, version);
  });
  if (versions.size === 0) return null;

  const parts = Array.from(versions, ([benchmark, version]) => `${benchmark} ${version}`);
  return `> 数据版本：${parts.join("；")}。跨版本分数不可直接比较。`;
}

export function buildMatrixMarkdownTable({
  rows,
  modelColumns,
  showCategory,
  displaySourceValuesInCells = false,
  activeSource = "",
  sourceValueMode = "latest",
  shouldShowOverallSummary = false,
  overallSummaryByModel,
  overallScoreDisplayDecimalsByModel,
  includeVersionLegend = true
}: BuildMatrixMarkdownTableOptions): string {
  const header = [
    "Modality",
    ...(showCategory ? ["Category"] : []),
    "Benchmark",
    ...modelColumns
  ];
  const separator = header.map(() => "---");
  const bodyRows = rows.map((row) => {
    const version = includeVersionLegend ? row.aaRevision?.latestVersion : null;
    const cells = [
      row.modalities.join(", "),
      ...(showCategory ? [row.category] : []),
      version ? `${row.benchmark} (${version})` : row.benchmark,
      ...modelColumns.map((modelName) => getMatrixMarkdownCellText(row, modelName, {
        displaySourceValuesInCells,
        activeSource,
        sourceValueMode
      }))
    ];
    return formatMarkdownTableRow(cells);
  });
  const overallRow = shouldShowOverallSummary
    ? formatMarkdownTableRow([
      "∑",
      ...(showCategory ? ["Overall"] : []),
      "总评 / Ranking",
      ...modelColumns.map((modelName) => formatOverallScoreText(
        overallSummaryByModel?.get(modelName),
        overallScoreDisplayDecimalsByModel?.get(modelName) ?? 1
      ))
    ])
    : null;

  const tableLines = [
    formatMarkdownTableRow(header),
    formatMarkdownTableRow(separator),
    ...bodyRows,
    ...(overallRow ? [overallRow] : [])
  ];
  const versionLegend = includeVersionLegend ? buildMarkdownVersionLegend(rows) : null;

  return [
    ...tableLines,
    ...(versionLegend ? ["", versionLegend] : [])
  ].join("\n");
}
