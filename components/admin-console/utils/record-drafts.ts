import type {
  AdminRecordCell,
  AdminRecordMatrix,
  AdminRecordMatrixBenchmark,
  AdminRecordMatrixModel,
  CellDraft,
  MatrixSelectionRange
} from "../types";

/** 草稿以 `${modelId}::${benchmarkId}` 为键，与后端的单元格口径一致 */
export function getCellKey(modelId: number, benchmarkId: number): string {
  return `${modelId}::${benchmarkId}`;
}

export function buildCellIndex(matrix: AdminRecordMatrix | null): Map<string, AdminRecordCell> {
  const index = new Map<string, AdminRecordCell>();
  matrix?.cells.forEach((cell) => {
    index.set(getCellKey(cell.modelId, cell.benchmarkId), cell);
  });
  return index;
}

export type NormalizedSelection = {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
};

export function normalizeSelectionRange(range: MatrixSelectionRange): NormalizedSelection {
  return {
    rowStart: Math.min(range.startRow, range.endRow),
    rowEnd: Math.max(range.startRow, range.endRow),
    colStart: Math.min(range.startCol, range.endCol),
    colEnd: Math.max(range.startCol, range.endCol)
  };
}

export function isCellInSelection(
  range: MatrixSelectionRange | null,
  row: number,
  col: number
): boolean {
  if (!range) return false;
  const normalized = normalizeSelectionRange(range);
  return (
    row >= normalized.rowStart
    && row <= normalized.rowEnd
    && col >= normalized.colStart
    && col <= normalized.colEnd
  );
}

export function getSelectionCellCount(range: MatrixSelectionRange | null): number {
  if (!range) return 0;
  const normalized = normalizeSelectionRange(range);
  return (normalized.rowEnd - normalized.rowStart + 1) * (normalized.colEnd - normalized.colStart + 1);
}

export type SelectedCellRef = {
  row: number;
  col: number;
  modelId: number;
  benchmarkId: number;
};

export function getSelectedCellRefs(
  range: MatrixSelectionRange | null,
  benchmarks: AdminRecordMatrixBenchmark[],
  models: AdminRecordMatrixModel[]
): SelectedCellRef[] {
  if (!range) return [];

  const normalized = normalizeSelectionRange(range);
  const refs: SelectedCellRef[] = [];

  for (let row = normalized.rowStart; row <= normalized.rowEnd; row += 1) {
    const benchmark = benchmarks[row];
    if (!benchmark) continue;

    for (let col = normalized.colStart; col <= normalized.colEnd; col += 1) {
      const model = models[col];
      if (!model) continue;

      refs.push({
        row,
        col,
        modelId: model.modelId,
        benchmarkId: benchmark.benchmarkId
      });
    }
  }

  return refs;
}

/**
 * 写入一个单元格草稿。
 *
 * 改回原值（含「本来是空的又清空」）时直接把草稿摘掉，这样「已修改 N 项」永远等于
 * 真正会落库的改动数，用户不会看到一个改回去却还亮着黄色的格子。
 */
export function setCellDraftValue(
  drafts: Record<string, CellDraft>,
  input: {
    modelId: number;
    benchmarkId: number;
    cell: AdminRecordCell | undefined;
    nextValueRaw: string;
    /** 新增单元格时写入的 source */
    newRecordSource: string | null;
  }
): Record<string, CellDraft> {
  const key = getCellKey(input.modelId, input.benchmarkId);
  const originalValueRaw = input.cell?.valueRaw ?? "";
  const nextValueRaw = input.nextValueRaw.trim();
  const next = { ...drafts };

  if (nextValueRaw === originalValueRaw.trim()) {
    delete next[key];
    return next;
  }

  next[key] = {
    modelId: input.modelId,
    benchmarkId: input.benchmarkId,
    recordId: input.cell?.recordId ?? null,
    recordIds: input.cell?.recordIds ?? [],
    originalValueRaw,
    nextValueRaw,
    source: input.cell?.source ?? input.newRecordSource
  };

  return next;
}

export function clearCellDrafts(
  drafts: Record<string, CellDraft>,
  refs: SelectedCellRef[],
  cellIndex: Map<string, AdminRecordCell>,
  newRecordSource: string | null
): Record<string, CellDraft> {
  return refs.reduce(
    (acc, ref) =>
      setCellDraftValue(acc, {
        modelId: ref.modelId,
        benchmarkId: ref.benchmarkId,
        cell: cellIndex.get(getCellKey(ref.modelId, ref.benchmarkId)),
        nextValueRaw: "",
        newRecordSource
      }),
    drafts
  );
}

export function fillCellDrafts(
  drafts: Record<string, CellDraft>,
  refs: SelectedCellRef[],
  cellIndex: Map<string, AdminRecordCell>,
  valueRaw: string,
  newRecordSource: string | null
): Record<string, CellDraft> {
  return refs.reduce(
    (acc, ref) =>
      setCellDraftValue(acc, {
        modelId: ref.modelId,
        benchmarkId: ref.benchmarkId,
        cell: cellIndex.get(getCellKey(ref.modelId, ref.benchmarkId)),
        nextValueRaw: valueRaw,
        newRecordSource
      }),
    drafts
  );
}

export function countDirtyDrafts(drafts: Record<string, CellDraft>): number {
  return Object.keys(drafts).length;
}

export function isPendingDeleteDraft(draft: CellDraft | undefined): boolean {
  return Boolean(draft) && draft?.nextValueRaw.trim() === "";
}

export function countPendingDeleteDrafts(drafts: Record<string, CellDraft>): number {
  return Object.values(drafts).filter((draft) => isPendingDeleteDraft(draft)).length;
}

/** 单元格当前应该显示什么：有草稿看草稿，否则看库里的值 */
export function getCellDisplayValue(
  cell: AdminRecordCell | undefined,
  draft: CellDraft | undefined
): string {
  if (draft) return draft.nextValueRaw;
  return cell?.valueRaw ?? "";
}

export type RecordDraftPayloadItem = {
  modelId: number;
  benchmarkId: number;
  recordId: number | null;
  recordIds: number[];
  valueRaw: string;
  originalValueRaw: string;
  source: string | null;
  isDeleted: boolean;
};

export function buildDraftSavePayload(drafts: Record<string, CellDraft>): RecordDraftPayloadItem[] {
  return Object.values(drafts).map((draft) => ({
    modelId: draft.modelId,
    benchmarkId: draft.benchmarkId,
    recordId: draft.recordId,
    recordIds: draft.recordIds,
    valueRaw: draft.nextValueRaw,
    originalValueRaw: draft.originalValueRaw,
    source: draft.source,
    isDeleted: draft.nextValueRaw.trim() === ""
  }));
}

/** 保存后返回的统计摘要，转成通知里的一句话 */
export function formatBatchSaveSummary(result: {
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
}): string {
  const parts: string[] = [];
  if (result.inserted > 0) parts.push(`新增 ${result.inserted}`);
  if (result.updated > 0) parts.push(`修改 ${result.updated}`);
  if (result.deleted > 0) parts.push(`删除 ${result.deleted}`);
  if (result.unchanged > 0) parts.push(`跳过 ${result.unchanged}`);

  return parts.length > 0 ? `保存完成：${parts.join(" · ")}` : "保存完成：无实际改动";
}
