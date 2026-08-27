"use client";

import { useState } from "react";
import { Database, Trash2 } from "lucide-react";
import type { BenchmarkOption, ModelOption, ProviderOption } from "../types";
import { useRecordMatrix } from "../hooks/use-record-matrix";
import { getSelectionCellCount } from "../utils/record-drafts";
import { RecordsDraftToolbar } from "./records/draft-toolbar";
import { RecordsFiltersBar } from "./records/filters-bar";
import { RecordsMatrixGrid } from "./records/matrix-grid";
import { RecordsMultiValueDialog } from "./records/multi-value-dialog";
import { RecordsReassignDialog } from "./records/reassign-dialog";
import { RecordsSplitDualDialog } from "./records/split-dual-dialog";
import { sourceTabDisplayLabel } from "@/lib/source-utils";

type RecordsTabProps = {
  providers: ProviderOption[];
  models: ModelOption[];
  benchmarks: BenchmarkOption[];
  sourceOptions: string[];
  notifySuccess: (message: string, details?: string[]) => void;
  notifyError: (message: string, details?: string[]) => void;
};

function DeleteScopeConfirmDialog({
  recordCount,
  scopeDescription,
  unfiltered,
  busy,
  onClose,
  onConfirm
}: {
  recordCount: number;
  scopeDescription: string;
  unfiltered: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (allowUnfiltered: boolean) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex w-full max-w-lg max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-error/40 bg-base-100 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-base-300/70">
          <h3 className="flex min-w-0 items-center gap-2 text-lg font-bold text-error">
            <Trash2 size={18} className="shrink-0" />
            <span className="min-w-0 break-words">删除当前筛选范围内的全部数据</span>
          </h3>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-circle shrink-0 text-base-content/60 hover:text-base-content"
            onClick={onClose}
            aria-label="关闭弹窗"
            disabled={busy}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="mt-3.5 text-sm text-base-content/90">
          将删除约 <span className="font-semibold text-error">{recordCount}</span> 条记录，操作不可撤销。
        </p>
        <div className="mt-2 rounded-xl border border-base-300/70 bg-base-200/40 px-3.5 py-2.5 text-xs text-base-content/70">
          <span className="opacity-70">作用范围：</span>
          <span>{scopeDescription}</span>
        </div>

        {unfiltered ? (
          <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-base-content/90">
            <input
              type="checkbox"
              className="checkbox checkbox-error checkbox-sm mt-0.5"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>当前没有任何筛选条件，这会清空 benchmark_values 全表。我确认要这么做。</span>
          </label>
        ) : null}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2.5 pt-3 border-t border-base-300/60">
          <button type="button" className="btn btn-ghost btn-sm rounded-xl" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-error btn-sm rounded-xl font-semibold px-4"
            disabled={busy || (unfiltered && !acknowledged)}
            onClick={() => onConfirm(unfiltered)}
          >
            {busy ? "删除中..." : `确认删除 ${recordCount} 条`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RecordsTab({
  providers,
  models,
  benchmarks,
  sourceOptions,
  notifySuccess,
  notifyError
}: RecordsTabProps) {
  const controller = useRecordMatrix({ notifySuccess, notifyError });
  const {
    filters,
    onFiltersChange,
    availableModelIds,
    availableBenchmarkIds,
    matrix,
    models: matrixModels,
    benchmarks: matrixBenchmarks,
    cellIndex,
    drafts,
    dirtyCount,
    pendingDeleteCount,
    canCreateCells,
    loading,
    hasLoaded,
    saving,
    toolBusy,
    selection,
    editingCell,
    setEditingCell,
    multiValueCell,
    setMultiValueCell,
    saveMultiValueRecords,
    onCellMouseDown,
    onCellMouseEnter,
    commitCellValue,
    clearSelectedCells,
    fillSelectedCells,
    fillValue,
    setFillValue,
    saveDrafts,
    discardDrafts,
    loadMatrix,
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
  } = controller;

  const selectionCount = getSelectionCellCount(selection);
  const unfilteredScope =
    mutationScope.modelIds.length === 0
    && mutationScope.benchmarkIds.length === 0
    && mutationScope.sourceMode === "all";

  const scopeDescription = [
    filters.sourceMode === "all"
      ? "全部 source"
      : filters.sourceMode === "empty"
        ? "无 source"
        : `source=${sourceTabDisplayLabel(filters.source ?? "")}`,
    mutationScope.modelIds.length > 0 ? `${mutationScope.modelIds.length} 个模型` : "全部模型",
    mutationScope.benchmarkIds.length > 0 ? `${mutationScope.benchmarkIds.length} 个指标` : "全部指标"
  ].join(" · ");

  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Database size={18} />
          矩阵编辑
        </h3>
        <p className="text-xs opacity-70">
          单击格子改值；格内有多条记录时会打开详情弹窗。按住拖拽可框选多格，Backspace / Delete 批量清空，Esc 取消选区。
          所有改动先高亮暂存，点「保存更改」才写库。
        </p>
      </div>

      <div className="space-y-3">
        <RecordsFiltersBar
          filters={filters}
          onFiltersChange={onFiltersChange}
          sourceOptions={sourceOptions}
          providers={providers}
          models={models}
          benchmarks={benchmarks}
          availableModelIds={availableModelIds}
          availableBenchmarkIds={availableBenchmarkIds}
          disabled={saving || toolBusy !== null}
        />

        <RecordsDraftToolbar
          matrix={matrix}
          filters={filters}
          dirtyCount={dirtyCount}
          pendingDeleteCount={pendingDeleteCount}
          selectionCount={selectionCount}
          canCreateCells={canCreateCells}
          loading={loading}
          saving={saving}
          toolBusy={toolBusy}
          fillValue={fillValue}
          setFillValue={setFillValue}
          onSave={() => void saveDrafts()}
          onDiscard={discardDrafts}
          onRefresh={() => void loadMatrix()}
          onFillSelection={() => fillSelectedCells(fillValue)}
          onClearSelection={clearSelectedCells}
          onOpenDeleteConfirm={() => setDeleteConfirmOpen(true)}
          onNormalizeScale={(targetScale) => void runNormalizeScale(targetScale)}
          onOpenSplitDialog={openSplitDialog}
        />

        <RecordsMatrixGrid
          models={matrixModels}
          benchmarks={matrixBenchmarks}
          cellIndex={cellIndex}
          drafts={drafts}
          selection={selection}
          editingCell={editingCell}
          loading={loading}
          hasLoaded={hasLoaded}
          onCellMouseDown={onCellMouseDown}
          onCellMouseEnter={onCellMouseEnter}
          onCommitCellValue={commitCellValue}
          onStopEditing={() => setEditingCell(null)}
          onOpenReassign={openReassignDialog}
        />
      </div>

      {deleteConfirmOpen ? (
        <DeleteScopeConfirmDialog
          recordCount={matrix?.totalRecordCount ?? 0}
          scopeDescription={scopeDescription}
          unfiltered={unfilteredScope}
          busy={toolBusy === "delete"}
          onClose={() => setDeleteConfirmOpen(false)}
          onConfirm={(allowUnfiltered) => void runBatchDelete({ allowUnfiltered })}
        />
      ) : null}

      {multiValueCell ? (() => {
        const model = matrixModels.find((item) => item.modelId === multiValueCell.modelId);
        const benchmark = matrixBenchmarks.find((item) => item.benchmarkId === multiValueCell.benchmarkId);
        if (!model || !benchmark) return null;
        return (
          <RecordsMultiValueDialog
            key={`multi-value-${multiValueCell.modelId}-${multiValueCell.benchmarkId}`}
            cell={multiValueCell}
            model={model}
            benchmark={benchmark}
            busy={saving}
            onClose={() => setMultiValueCell(null)}
            onSave={(records) => void saveMultiValueRecords(records)}
          />
        );
      })() : null}

      {reassignTarget ? (
        <RecordsReassignDialog
          key={`reassign-${reassignTarget.entityType}-${
            reassignTarget.entityType === "benchmark"
              ? reassignTarget.benchmarkId
              : reassignTarget.entityType === "model"
                ? reassignTarget.modelId
                : reassignTarget.source ?? "empty"
          }`}
          target={reassignTarget}
          models={models}
          benchmarks={benchmarks}
          providers={providers}
          sourceOptions={sourceOptions}
          scopeDescription={scopeDescription}
          busy={toolBusy === "reassign"}
          onClose={() => setReassignTarget(null)}
          onSubmit={(payload) => void runReassign(payload)}
        />
      ) : null}

      {splitDialogOpen ? (
        <RecordsSplitDualDialog
          candidates={dualValueCandidates}
          loading={loadingDualValueCandidates}
          busy={toolBusy === "split"}
          scopeDescription={scopeDescription}
          onClose={() => setSplitDialogOpen(false)}
          onSubmit={(input) => void runSplitDualValues(input)}
        />
      ) : null}
    </section>
  );
}
