"use client";

import { useEffect, useState } from "react";
import { Database, Trash2 } from "lucide-react";
import type { BenchmarkOption, ModelOption, ProviderOption } from "../types";
import { useRecordMatrix } from "../hooks/use-record-matrix";
import { getSelectionCellCount } from "../utils/record-drafts";
import { RecordsDraftToolbar } from "./records/draft-toolbar";
import { RecordsFiltersBar } from "./records/filters-bar";
import { RecordsMatrixGrid } from "./records/matrix-grid";
import { RecordsReassignDialog } from "./records/reassign-dialog";
import { RecordsSplitDualDialog } from "./records/split-dual-dialog";

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
      className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-error/50 bg-base-100/95 p-6 shadow-2xl backdrop-blur">
        <h3 className="flex items-center gap-2 text-lg font-bold text-error">
          <Trash2 size={17} />
          删除当前筛选范围内的全部数据
        </h3>
        <p className="mt-2 text-sm opacity-80">
          将删除约 <span className="font-semibold">{recordCount}</span> 条记录，操作不可撤销。
        </p>
        <p className="mt-1 text-xs opacity-70">作用范围：{scopeDescription}</p>

        {unfiltered ? (
          <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm mt-0.5"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>当前没有任何筛选条件，这会清空 benchmark_values 全表。我确认要这么做。</span>
          </label>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-error btn-sm"
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
        : `source=${filters.source ?? ""}`,
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
          单击格子改值，按住拖拽可框选多格，Backspace / Delete 批量清空，Esc 取消选区。
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
