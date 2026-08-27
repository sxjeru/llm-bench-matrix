"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getJson, postJson } from "../api";
import type {
  AdminRecordCell,
  AdminRecordMatrix,
  CellDraft,
  MatrixSelectionRange,
  RecordBatchSaveResult,
  RecordConflictStrategy,
  RecordDualValueCandidate,
  RecordFilterState,
  RecordReassignResult,
  RecordReassignTarget,
  RecordSourceMode
} from "../types";
import {
  buildCellIndex,
  buildDraftSavePayload,
  clearCellDrafts,
  countDirtyDrafts,
  countPendingDeleteDrafts,
  fillCellDrafts,
  formatBatchSaveSummary,
  getCellKey,
  getSelectedCellRefs,
  setCellDraftValue,
  type SelectedCellRef
} from "../utils/record-drafts";

export type RecordEditingCell = { row: number; col: number };

export type RecordToolBusyKind = null | "delete" | "normalize" | "split" | "reassign";

export type RecordMutationScope = {
  modelIds: number[];
  benchmarkIds: number[];
  sourceMode: RecordSourceMode;
  source: string | null;
};

const DEFAULT_FILTERS: RecordFilterState = {
  sourceMode: "all",
  source: null,
  modelIds: [],
  benchmarkIds: [],
  search: ""
};

type UseRecordMatrixOptions = {
  notifySuccess: (message: string, details?: string[]) => void;
  notifyError: (message: string, details?: string[]) => void;
};

function buildMatrixQuery(filters: RecordFilterState): string {
  const params = new URLSearchParams();
  params.set("sourceMode", filters.sourceMode);
  if (filters.sourceMode === "specific" && filters.source) {
    params.set("source", filters.source);
  }
  if (filters.modelIds.length > 0) {
    params.set("modelIds", filters.modelIds.join(","));
  }
  if (filters.benchmarkIds.length > 0) {
    params.set("benchmarkIds", filters.benchmarkIds.join(","));
  }
  const search = filters.search.trim();
  if (search) {
    params.set("search", search);
  }
  return params.toString();
}

export function useRecordMatrix({ notifySuccess, notifyError }: UseRecordMatrixOptions) {
  const [filters, setFilters] = useState<RecordFilterState>(DEFAULT_FILTERS);
  const [matrix, setMatrix] = useState<AdminRecordMatrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, CellDraft>>({});
  const [selection, setSelection] = useState<MatrixSelectionRange | null>(null);
  const [editingCell, setEditingCell] = useState<RecordEditingCell | null>(null);
  const [fillValue, setFillValue] = useState("");
  const [toolBusy, setToolBusy] = useState<RecordToolBusyKind>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<RecordReassignTarget | null>(null);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [dualValueCandidates, setDualValueCandidates] = useState<RecordDualValueCandidate[]>([]);
  const [loadingDualValueCandidates, setLoadingDualValueCandidates] = useState(false);

  const isDraggingRef = useRef(false);

  const models = useMemo(() => matrix?.models ?? [], [matrix]);
  const benchmarks = useMemo(() => matrix?.benchmarks ?? [], [matrix]);
  const cellIndex = useMemo(() => buildCellIndex(matrix), [matrix]);
  const dirtyCount = countDirtyDrafts(drafts);
  const pendingDeleteCount = countPendingDeleteDrafts(drafts);

  /** 只有限定了具体 source（含「无 source」）才允许新增单元格，避免新数据归属不明 */
  const canCreateCells = filters.sourceMode !== "all";
  const newRecordSource = filters.sourceMode === "specific" ? filters.source : null;

  const selectedCellRefs = useMemo(
    () => getSelectedCellRefs(selection, models, benchmarks),
    [selection, models, benchmarks]
  );

  const mutationScope = useMemo<RecordMutationScope>(() => {
    const hasSearch = filters.search.trim().length > 0;
    return {
      sourceMode: filters.sourceMode,
      source: filters.sourceMode === "specific" ? filters.source : null,
      modelIds:
        filters.modelIds.length > 0
          ? filters.modelIds
          : hasSearch
            ? models.map((model) => model.modelId)
            : [],
      benchmarkIds:
        filters.benchmarkIds.length > 0
          ? filters.benchmarkIds
          : hasSearch
            ? benchmarks.map((benchmark) => benchmark.benchmarkId)
            : []
    };
  }, [filters, models, benchmarks]);

  const loadMatrix = useCallback(
    async (override?: RecordFilterState) => {
      setLoading(true);
      try {
        const query = buildMatrixQuery(override ?? filters);
        const result = (await getJson(`/api/admin/records?${query}`)) as AdminRecordMatrix;
        setMatrix(result);
        setHasLoaded(true);
        setSelection(null);
        setEditingCell(null);
      } catch (error) {
        notifyError(error instanceof Error ? error.message : "加载数据矩阵失败");
      } finally {
        setLoading(false);
      }
    },
    [filters, notifyError]
  );

  const loadMatrixOnce = useCallback(() => {
    if (hasLoaded || loading) return;
    void loadMatrix();
  }, [hasLoaded, loading, loadMatrix]);

  function confirmDiscardDrafts(action: string): boolean {
    if (dirtyCount === 0) return true;
    if (typeof window === "undefined") return true;
    return window.confirm(`还有 ${dirtyCount} 处修改未保存，${action}会丢弃这些改动。是否继续？`);
  }

  /**
   * 筛选条件的每次变化都立刻带着新条件重新拉矩阵。
   *
   * 不用「effect 监听 filters」是因为那样会在 effect 里同步 setState；这里直接把
   * 算好的 next 传给 loadMatrix，也顺手避免了 setFilters 异步导致的旧条件请求。
   */
  function onFiltersChange(updater: (prev: RecordFilterState) => RecordFilterState) {
    if (!confirmDiscardDrafts("切换筛选条件")) return;

    const next = updater(filters);
    setDrafts({});
    setFilters(next);

    if (hasLoaded) {
      void loadMatrix(next);
    }
  }

  // --- 选区与编辑 ---

  const getCell = useCallback(
    (modelId: number, benchmarkId: number): AdminRecordCell | undefined =>
      cellIndex.get(getCellKey(modelId, benchmarkId)),
    [cellIndex]
  );

  function onCellMouseDown(row: number, col: number, event?: { shiftKey?: boolean }) {
    if (editingCell) {
      setEditingCell(null);
    }

    if (event?.shiftKey && selection) {
      setSelection({ ...selection, endRow: row, endCol: col });
      return;
    }

    isDraggingRef.current = true;
    setSelection({ startRow: row, startCol: col, endRow: row, endCol: col });
  }

  function onCellMouseEnter(row: number, col: number) {
    if (!isDraggingRef.current) return;
    setSelection((prev) => (prev ? { ...prev, endRow: row, endCol: col } : prev));
  }

  /** 鼠标在同一个格子按下又松开 = 单击，进入编辑；拖出范围则保持框选 */
  const endDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    setSelection((prev) => {
      if (prev && prev.startRow === prev.endRow && prev.startCol === prev.endCol) {
        setEditingCell({ row: prev.startRow, col: prev.startCol });
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.addEventListener("mouseup", endDrag);
    return () => document.removeEventListener("mouseup", endDrag);
  }, [endDrag]);

  const commitCellValue = useCallback(
    (modelId: number, benchmarkId: number, nextValueRaw: string) => {
      const cell = cellIndex.get(getCellKey(modelId, benchmarkId));

      if (!cell && !canCreateCells && nextValueRaw.trim()) {
        notifyError("新增单元格前请先在 source 筛选里选定具体数据源（或「无 source」）");
        return;
      }

      setDrafts((prev) =>
        setCellDraftValue(prev, { modelId, benchmarkId, cell, nextValueRaw, newRecordSource })
      );
    },
    [cellIndex, canCreateCells, newRecordSource, notifyError]
  );

  const clearSelectedCells = useCallback(() => {
    if (selectedCellRefs.length === 0) return;
    setDrafts((prev) => clearCellDrafts(prev, selectedCellRefs, cellIndex, newRecordSource));
  }, [selectedCellRefs, cellIndex, newRecordSource]);

  const fillSelectedCells = useCallback(
    (valueRaw: string) => {
      const value = valueRaw.trim();
      if (!value || selectedCellRefs.length === 0) return;

      const hasNewCells = selectedCellRefs.some(
        (ref: SelectedCellRef) => !cellIndex.has(getCellKey(ref.modelId, ref.benchmarkId))
      );
      if (hasNewCells && !canCreateCells) {
        notifyError("选区里包含空单元格：请先在 source 筛选里选定具体数据源（或「无 source」）");
        return;
      }

      setDrafts((prev) => fillCellDrafts(prev, selectedCellRefs, cellIndex, value, newRecordSource));
    },
    [selectedCellRefs, cellIndex, canCreateCells, newRecordSource, notifyError]
  );

  /** 有选区且不在编辑态时：Backspace/Delete 批量清空、Esc 取消选区 */
  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selection) return;

      if (event.key === "Escape") {
        event.preventDefault();
        setSelection(null);
        setEditingCell(null);
        return;
      }

      if (editingCell) return;

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        clearSelectedCells();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selection, editingCell, clearSelectedCells]);

  // --- 保存 / 放弃 ---

  async function saveDrafts() {
    if (saving || dirtyCount === 0) return;

    setSaving(true);
    try {
      const payload = buildDraftSavePayload(drafts);
      const result = (await postJson("/api/admin/records", { drafts: payload })) as RecordBatchSaveResult;

      const details = result.nonNumeric.length > 0
        ? [
            `${result.nonNumeric.length} 个单元格解析不出数值，已按文本记录：`,
            ...result.nonNumeric.slice(0, 5).map((item) => `${item.valueRaw}`)
          ]
        : undefined;

      notifySuccess(formatBatchSaveSummary(result), details);
      setDrafts({});
      await loadMatrix();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "批量保存失败");
    } finally {
      setSaving(false);
    }
  }

  function discardDrafts() {
    if (dirtyCount === 0) return;
    if (!confirmDiscardDrafts("放弃修改")) return;
    setDrafts({});
  }

  // --- 快速修改工具 ---

  async function runBatchDelete(options?: { allowUnfiltered?: boolean }) {
    if (toolBusy) return;

    setToolBusy("delete");
    try {
      const result = (await postJson("/api/admin/records/batch-delete", {
        scope: mutationScope,
        allowUnfiltered: options?.allowUnfiltered === true
      })) as { deleted: number; prunedSourceMeta: number };

      notifySuccess(`已删除 ${result.deleted} 条记录`);
      setDrafts({});
      setDeleteConfirmOpen(false);
      await loadMatrix();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "批量删除失败");
    } finally {
      setToolBusy(null);
    }
  }

  async function runNormalizeScale(targetScale: 1 | 100) {
    if (toolBusy) return;
    if (!confirmDiscardDrafts("批量归一化")) return;

    setToolBusy("normalize");
    try {
      const result = (await postJson("/api/admin/records/batch-normalize", {
        scope: mutationScope,
        targetScale
      })) as { updated: number; unchanged: number };

      notifySuccess(`已归一化为 ${targetScale} 量纲：更新 ${result.updated} 条，跳过 ${result.unchanged} 条`);
      setDrafts({});
      await loadMatrix();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "批量归一化失败");
    } finally {
      setToolBusy(null);
    }
  }

  async function loadDualValueCandidates() {
    setLoadingDualValueCandidates(true);
    try {
      const params = new URLSearchParams();
      params.set("sourceMode", mutationScope.sourceMode);
      if (mutationScope.source) params.set("source", mutationScope.source);
      if (mutationScope.modelIds.length > 0) params.set("modelIds", mutationScope.modelIds.join(","));
      if (mutationScope.benchmarkIds.length > 0) {
        params.set("benchmarkIds", mutationScope.benchmarkIds.join(","));
      }

      const result = (await getJson(`/api/admin/records/split-pair-values?${params.toString()}`)) as {
        candidates: RecordDualValueCandidate[];
      };
      setDualValueCandidates(result.candidates ?? []);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "加载双值候选失败");
    } finally {
      setLoadingDualValueCandidates(false);
    }
  }

  function openSplitDialog() {
    if (!confirmDiscardDrafts("打开分拆向导")) return;
    setSplitDialogOpen(true);
    void loadDualValueCandidates();
  }

  async function runSplitDualValues(input: {
    benchmarkId: number;
    first: { benchmarkId?: number; benchmarkName?: string; benchmarkType?: string };
    second: { benchmarkName: string; benchmarkType?: string };
  }) {
    if (toolBusy) return;

    setToolBusy("split");
    try {
      const result = (await postJson("/api/admin/records/split-pair-values", {
        ...input,
        scope: mutationScope
      })) as { splitCount: number; createdCount: number; firstBenchmarkLabel: string; secondBenchmarkLabel: string };

      notifySuccess(
        `双值分拆完成：${result.splitCount} 条拆分为 ${result.firstBenchmarkLabel} 与 ${result.secondBenchmarkLabel}`
      );
      setDrafts({});
      setSplitDialogOpen(false);
      await loadMatrix();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "双值分拆失败");
    } finally {
      setToolBusy(null);
    }
  }

  function openReassignDialog(target: RecordReassignTarget) {
    if (!confirmDiscardDrafts("变更归属")) return;
    setReassignTarget(target);
  }

  async function runReassign(payload: Record<string, unknown> & { conflictStrategy?: RecordConflictStrategy }) {
    if (toolBusy) return;

    setToolBusy("reassign");
    try {
      const result = (await postJson("/api/admin/records/reassign", {
        ...payload,
        scope: mutationScope
      })) as RecordReassignResult;

      const details: string[] = [];
      if (result.skippedCount > 0) details.push(`目标已有数据，跳过 ${result.skippedCount} 条`);
      if (result.deletedTargetCount > 0) details.push(`覆盖删除目标侧 ${result.deletedTargetCount} 条`);
      if (result.createdTarget) details.push("目标实体为本次新建");

      notifySuccess(
        `归属已变更：${result.fromLabel} → ${result.targetLabel}，迁移 ${result.movedCount} 条`,
        details.length > 0 ? details : undefined
      );
      setDrafts({});
      setReassignTarget(null);
      await loadMatrix();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "变更归属失败");
    } finally {
      setToolBusy(null);
    }
  }

  return {
    filters,
    onFiltersChange,
    matrix,
    models,
    benchmarks,
    cellIndex,
    getCell,
    loading,
    hasLoaded,
    loadMatrix,
    loadMatrixOnce,
    saving,
    drafts,
    dirtyCount,
    pendingDeleteCount,
    canCreateCells,
    selection,
    selectedCellRefs,
    editingCell,
    setEditingCell,
    onCellMouseDown,
    onCellMouseEnter,
    commitCellValue,
    clearSelection: () => setSelection(null),
    clearSelectedCells,
    fillSelectedCells,
    fillValue,
    setFillValue,
    saveDrafts,
    discardDrafts,
    toolBusy,
    mutationScope,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    runBatchDelete,
    runNormalizeScale,
    splitDialogOpen,
    setSplitDialogOpen,
    dualValueCandidates,
    loadingDualValueCandidates,
    openSplitDialog,
    runSplitDualValues,
    reassignTarget,
    setReassignTarget,
    openReassignDialog,
    runReassign
  };
}

export type RecordMatrixController = ReturnType<typeof useRecordMatrix>;
