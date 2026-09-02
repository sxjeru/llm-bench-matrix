"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { localDateTimeToIso } from "../utils/datetime-local";
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

type SourceEntities = { modelIds: number[]; benchmarkIds: number[] };

function sourceEntitiesKey(sourceMode: RecordSourceMode, source: string | null): string {
  return `${sourceMode}::${source ?? ""}`;
}

function pruneIdsToAvailable(ids: number[], availableIds: number[]): number[] {
  const available = new Set(availableIds);
  return ids.filter((id) => available.has(id));
}

function pruneFiltersToSourceEntities(
  filters: RecordFilterState,
  entities: SourceEntities | null | undefined
): RecordFilterState {
  if (!entities) return filters;
  return {
    ...filters,
    modelIds: pruneIdsToAvailable(filters.modelIds, entities.modelIds),
    benchmarkIds: pruneIdsToAvailable(filters.benchmarkIds, entities.benchmarkIds)
  };
}

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
  const router = useRouter();
  const [filters, setFilters] = useState<RecordFilterState>(DEFAULT_FILTERS);
  const [matrix, setMatrix] = useState<AdminRecordMatrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, CellDraft>>({});
  const [selection, setSelection] = useState<MatrixSelectionRange | null>(null);
  const [editingCell, setEditingCell] = useState<RecordEditingCell | null>(null);
  const [multiValueCell, setMultiValueCell] = useState<AdminRecordCell | null>(null);
  const [fillValue, setFillValue] = useState("");
  const [toolBusy, setToolBusy] = useState<RecordToolBusyKind>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<RecordReassignTarget | null>(null);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [dualValueCandidates, setDualValueCandidates] = useState<RecordDualValueCandidate[]>([]);
  const [loadingDualValueCandidates, setLoadingDualValueCandidates] = useState(false);

  const [sourceEntitiesCache, setSourceEntitiesCache] = useState<Record<string, SourceEntities>>({});
  const sourceEntitiesInFlightRef = useRef<Set<string>>(new Set());
  const filtersRef = useRef(filters);

  const applyFilters = useCallback((next: RecordFilterState) => {
    filtersRef.current = next;
    setFilters(next);
  }, []);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const isDraggingRef = useRef(false);
  const selectionRef = useRef<MatrixSelectionRange | null>(null);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  const models = useMemo(() => matrix?.models ?? [], [matrix]);
  const benchmarks = useMemo(() => matrix?.benchmarks ?? [], [matrix]);
  const cellIndex = useMemo(() => buildCellIndex(matrix), [matrix]);
  const dirtyCount = countDirtyDrafts(drafts);
  const pendingDeleteCount = countPendingDeleteDrafts(drafts);

  const sourceKey = sourceEntitiesKey(filters.sourceMode, filters.source);
  const currentSourceEntities = filters.sourceMode === "all" ? null : sourceEntitiesCache[sourceKey] ?? null;
  const availableModelIds = currentSourceEntities ? currentSourceEntities.modelIds : null;
  const availableBenchmarkIds = currentSourceEntities ? currentSourceEntities.benchmarkIds : null;

  const rememberSourceEntities = useCallback((key: string, entities: SourceEntities) => {
    setSourceEntitiesCache((prev) => {
      const existing = prev[key];
      if (
        existing
        && existing.modelIds.length === entities.modelIds.length
        && existing.benchmarkIds.length === entities.benchmarkIds.length
        && existing.modelIds.every((id, index) => id === entities.modelIds[index])
        && existing.benchmarkIds.every((id, index) => id === entities.benchmarkIds[index])
      ) {
        return prev;
      }
      return { ...prev, [key]: entities };
    });
  }, []);

  /** 只有限定了具体 source（含「无 source」）才允许新增单元格，避免新数据归属不明 */
  const canCreateCells = filters.sourceMode !== "all";
  const newRecordSource = filters.sourceMode === "specific" ? filters.source : null;

  const selectedCellRefs = useMemo(
    () => getSelectedCellRefs(selection, benchmarks, models),
    [selection, benchmarks, models]
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
        const activeFilters = override ?? filters;
        const query = buildMatrixQuery(activeFilters);
        const result = (await getJson(`/api/admin/records?${query}`)) as AdminRecordMatrix;
        setMatrix(result);
        setHasLoaded(true);
        setSelection(null);
        setEditingCell(null);
        setMultiValueCell(null);
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

  const confirmDiscardDrafts = useCallback((action: string): boolean => {
    if (dirtyCount === 0) return true;
    if (typeof window === "undefined") return true;
    return window.confirm(`还有 ${dirtyCount} 处修改未保存，${action}会丢弃这些改动。是否继续？`);
  }, [dirtyCount]);

  const fetchSourceEntities = useCallback(
    async (
      sourceMode: RecordSourceMode,
      source: string | null,
      force = false
    ): Promise<SourceEntities | null> => {
      if (sourceMode === "all") return null;

      const cacheKey = sourceEntitiesKey(sourceMode, source);
      if (!force) {
        const cached = sourceEntitiesCache[cacheKey];
        if (cached) return cached;
      }

      if (sourceEntitiesInFlightRef.current.has(cacheKey) && !force) {
        return null;
      }

      sourceEntitiesInFlightRef.current.add(cacheKey);
      const params = new URLSearchParams();
      params.set("sourceMode", sourceMode);
      if (source) params.set("source", source);

      try {
        const data = await getJson(`/api/admin/records/source-entities?${params.toString()}`);
        const payload = data as Partial<SourceEntities>;
        const entities: SourceEntities = {
          modelIds: Array.isArray(payload.modelIds) ? payload.modelIds : [],
          benchmarkIds: Array.isArray(payload.benchmarkIds) ? payload.benchmarkIds : []
        };
        rememberSourceEntities(cacheKey, entities);
        return entities;
      } catch (error) {
        notifyError(error instanceof Error ? error.message : "加载 Source 实体范围失败");
        return null;
      } finally {
        sourceEntitiesInFlightRef.current.delete(cacheKey);
      }
    },
    [notifyError, rememberSourceEntities, sourceEntitiesCache]
  );

  const refreshMatrixAndEntities = useCallback(
    async (overrideFilters?: RecordFilterState) => {
      setSourceEntitiesCache({});
      const baseFilters = overrideFilters ?? filtersRef.current;
      router.refresh();

      if (baseFilters.sourceMode === "all") {
        applyFilters(baseFilters);
        await loadMatrix(baseFilters);
        return;
      }

      const entities = await fetchSourceEntities(baseFilters.sourceMode, baseFilters.source, true);
      const current = overrideFilters ?? filtersRef.current;
      const targetKey = sourceEntitiesKey(baseFilters.sourceMode, baseFilters.source);
      if (sourceEntitiesKey(current.sourceMode, current.source) !== targetKey) {
        return;
      }

      const aligned = entities ? pruneFiltersToSourceEntities(current, entities) : current;
      applyFilters(aligned);
      await loadMatrix(aligned);
    },
    [applyFilters, fetchSourceEntities, loadMatrix, router]
  );

  /**
   * 筛选条件的每次变化都立刻带着新条件重新拉矩阵。
   *
   * 不用「effect 监听 filters」是因为那样会在 effect 里同步 setState；这里直接把
   * 算好的 next 传给 loadMatrix，也顺手避免了 setFilters 异步导致的旧条件请求。
   *
   * 切到具体 source / 无 source 时，先按该 source 已有实体裁掉不在范围内的模型/指标，
   * 避免带着旧 id 去拉矩阵得到空结果。
   */
  function onFiltersChange(updater: (prev: RecordFilterState) => RecordFilterState) {
    if (!confirmDiscardDrafts("切换筛选条件")) return;

    const next = updater(filtersRef.current);
    const cacheKey = sourceEntitiesKey(next.sourceMode, next.source);
    const cachedEntities = next.sourceMode === "all" ? null : sourceEntitiesCache[cacheKey] ?? null;
    const pruned = pruneFiltersToSourceEntities(next, cachedEntities);

    setDrafts({});
    applyFilters(pruned);
    void loadMatrix(pruned);

    if (next.sourceMode === "all" || cachedEntities) {
      return;
    }

    void fetchSourceEntities(next.sourceMode, next.source).then((entities) => {
      if (!entities) return;
      const current = filtersRef.current;
      if (sourceEntitiesKey(current.sourceMode, current.source) !== cacheKey) return;

      const aligned = pruneFiltersToSourceEntities(current, entities);
      if (
        aligned.modelIds.length === current.modelIds.length
        && aligned.benchmarkIds.length === current.benchmarkIds.length
      ) {
        return;
      }

      applyFilters(aligned);
      void loadMatrix(aligned);
    });
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
    const next = { startRow: row, startCol: col, endRow: row, endCol: col };
    selectionRef.current = next;
    setSelection(next);
  }

  function onCellMouseEnter(row: number, col: number) {
    if (!isDraggingRef.current) return;
    setSelection((prev) => {
      const next = prev ? { ...prev, endRow: row, endCol: col } : prev;
      selectionRef.current = next;
      return next;
    });
  }

  /** 鼠标在同一个格子按下又松开 = 单击，进入编辑；拖出范围则保持框选 */
  const endDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    const prev = selectionRef.current;
    if (!prev || prev.startRow !== prev.endRow || prev.startCol !== prev.endCol) return;

    const model = models[prev.startCol];
    const benchmark = benchmarks[prev.startRow];
    const cell = model && benchmark ? cellIndex.get(getCellKey(model.modelId, benchmark.benchmarkId)) : undefined;
    if (cell && cell.recordCount > 1) {
      if (confirmDiscardDrafts("打开多值编辑器")) {
        setDrafts({});
        setMultiValueCell(cell);
      }
      return;
    }
    setEditingCell({ row: prev.startRow, col: prev.startCol });
  }, [benchmarks, cellIndex, confirmDiscardDrafts, models]);

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
      if (multiValueCell) {
        if (event.key === "Escape" && !saving) {
          event.preventDefault();
          setMultiValueCell(null);
        }
        return;
      }

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
  }, [selection, editingCell, clearSelectedCells, multiValueCell, saving]);

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
      await refreshMatrixAndEntities();
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

  async function saveMultiValueRecords(records: Array<{
    id: number;
    valueRaw: string;
    source: string;
    benchTime: string;
    valueNote: string;
    isDeleted: boolean;
  }>) {
    if (saving || !multiValueCell) return;

    setSaving(true);
    try {
      const result = (await postJson("/api/admin/records/details", {
        records: records.map((record) => ({
          id: record.id,
          modelId: multiValueCell.modelId,
          benchmarkId: multiValueCell.benchmarkId,
          valueRaw: record.valueRaw,
          source: record.source.trim() || null,
          benchTime: localDateTimeToIso(record.benchTime),
          valueNote: record.valueNote.trim() || null,
          isDeleted: record.isDeleted
        }))
      })) as { updated: number; deleted: number; nonNumeric: Array<{ id: number; valueRaw: string }> };

      const parts: string[] = [];
      if (result.updated > 0) parts.push(`修改 ${result.updated}`);
      if (result.deleted > 0) parts.push(`删除 ${result.deleted}`);
      notifySuccess(
        `多值记录保存完成：${parts.join(" · ") || "无实际改动"}`,
        result.nonNumeric.length > 0
          ? [`${result.nonNumeric.length} 条记录无法解析为数值，已按文本保存`]
          : undefined
      );
      setMultiValueCell(null);
      await refreshMatrixAndEntities();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存多值记录失败");
    } finally {
      setSaving(false);
    }
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
      await refreshMatrixAndEntities();
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
      await refreshMatrixAndEntities();
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
    second: { benchmarkId?: number; benchmarkName?: string; benchmarkType?: string };
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
      await refreshMatrixAndEntities();
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

      let nextFilters = filtersRef.current;
      if (result.fromId && result.targetId && result.fromId !== result.targetId) {
        if (result.entityType === "benchmark" && nextFilters.benchmarkIds.includes(result.fromId)) {
          nextFilters = {
            ...nextFilters,
            benchmarkIds: Array.from(
              new Set(nextFilters.benchmarkIds.map((id) => (id === result.fromId ? result.targetId! : id)))
            )
          };
        } else if (result.entityType === "model" && nextFilters.modelIds.includes(result.fromId)) {
          nextFilters = {
            ...nextFilters,
            modelIds: Array.from(
              new Set(nextFilters.modelIds.map((id) => (id === result.fromId ? result.targetId! : id)))
            )
          };
        }
      }

      setDrafts({});
      applyFilters(nextFilters);
      setReassignTarget(null);
      await refreshMatrixAndEntities(nextFilters);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "变更归属失败");
    } finally {
      setToolBusy(null);
    }
  }

  async function runDeleteTarget(target: RecordReassignTarget) {
    if (toolBusy) return;

    setToolBusy("delete");
    try {
      const targetScope: RecordMutationScope = {
        ...mutationScope,
        benchmarkIds:
          target.entityType === "benchmark"
            ? [target.benchmarkId]
            : mutationScope.benchmarkIds,
        modelIds:
          target.entityType === "model"
            ? [target.modelId]
            : mutationScope.modelIds,
        sourceMode:
          target.entityType === "source"
            ? (target.source ? "specific" : "empty")
            : mutationScope.sourceMode,
        source:
          target.entityType === "source"
            ? target.source
            : mutationScope.source
      };

      const result = (await postJson("/api/admin/records/batch-delete", {
        scope: targetScope
      })) as { deleted: number; prunedSourceMeta: number };

      const noun = target.entityType === "benchmark" ? "行" : target.entityType === "model" ? "列" : "数据源";
      notifySuccess(`已删除${noun}「${target.label}」的 ${result.deleted} 条记录`);

      let nextFilters = filtersRef.current;
      if (target.entityType === "benchmark" && nextFilters.benchmarkIds.includes(target.benchmarkId)) {
        nextFilters = {
          ...nextFilters,
          benchmarkIds: nextFilters.benchmarkIds.filter((id) => id !== target.benchmarkId)
        };
      } else if (target.entityType === "model" && nextFilters.modelIds.includes(target.modelId)) {
        nextFilters = {
          ...nextFilters,
          modelIds: nextFilters.modelIds.filter((id) => id !== target.modelId)
        };
      }

      setDrafts({});
      applyFilters(nextFilters);
      setReassignTarget(null);
      await refreshMatrixAndEntities(nextFilters);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "删除失败");
    } finally {
      setToolBusy(null);
    }
  }

  return {
    filters,
    onFiltersChange,
    availableModelIds,
    availableBenchmarkIds,
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
    multiValueCell,
    setMultiValueCell,
    saveMultiValueRecords,
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
    runReassign,
    runDeleteTarget
  };
}

export type RecordMatrixController = ReturnType<typeof useRecordMatrix>;
