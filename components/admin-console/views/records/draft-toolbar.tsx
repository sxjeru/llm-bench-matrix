"use client";

import {
  Eraser,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Sigma,
  Trash2,
  Wand2
} from "lucide-react";
import type { AdminRecordMatrix, RecordFilterState } from "../../types";

type RecordsDraftToolbarProps = {
  matrix: AdminRecordMatrix | null;
  filters: RecordFilterState;
  dirtyCount: number;
  pendingDeleteCount: number;
  selectionCount: number;
  canCreateCells: boolean;
  loading: boolean;
  saving: boolean;
  toolBusy: null | "delete" | "normalize" | "split" | "reassign";
  fillValue: string;
  setFillValue: (value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onRefresh: () => void;
  onFillSelection: () => void;
  onClearSelection: () => void;
  onOpenDeleteConfirm: () => void;
  onNormalizeScale: (targetScale: 1 | 100) => void;
  onOpenSplitDialog: () => void;
};

export function RecordsDraftToolbar({
  matrix,
  filters,
  dirtyCount,
  pendingDeleteCount,
  selectionCount,
  canCreateCells,
  loading,
  saving,
  toolBusy,
  fillValue,
  setFillValue,
  onSave,
  onDiscard,
  onRefresh,
  onFillSelection,
  onClearSelection,
  onOpenDeleteConfirm,
  onNormalizeScale,
  onOpenSplitDialog
}: RecordsDraftToolbarProps) {
  const hasDrafts = dirtyCount > 0;
  const busy = loading || saving || toolBusy !== null;
  const scopeParts: string[] = [
    filters.sourceMode === "all"
      ? "全部 source"
      : filters.sourceMode === "empty"
        ? "无 source"
        : `source=${filters.source ?? ""}`,
    filters.modelIds.length > 0 ? `${filters.modelIds.length} 个模型` : "全部模型",
    filters.benchmarkIds.length > 0 ? `${filters.benchmarkIds.length} 个指标` : "全部指标"
  ];

  return (
    <div className="space-y-3">
      <div
        className={`flex flex-wrap items-center gap-2 rounded-2xl border p-3 transition-colors ${
          hasDrafts ? "border-warning/60 bg-warning/10" : "border-base-300/70 bg-base-200/40"
        }`}
      >
        <button
          type="button"
          className={`btn btn-sm gap-1 ${hasDrafts ? "btn-warning shadow-md" : "btn-disabled btn-outline"}`}
          disabled={!hasDrafts || saving}
          onClick={onSave}
        >
          <Save size={14} />
          {saving ? "保存中..." : `保存更改${hasDrafts ? `（已修改 ${dirtyCount} 项）` : ""}`}
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-sm gap-1"
          disabled={!hasDrafts || saving}
          onClick={onDiscard}
        >
          <RotateCcw size={14} />
          放弃修改
        </button>

        <button type="button" className="btn btn-ghost btn-sm gap-1" disabled={busy} onClick={onRefresh}>
          <RefreshCw size={14} />
          {loading ? "刷新中..." : "刷新"}
        </button>

        {pendingDeleteCount > 0 ? (
          <span className="badge badge-warning badge-outline badge-sm">
            待清空 {pendingDeleteCount} 格
          </span>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs opacity-75">
          {matrix ? (
            <>
              <span>
                记录 {matrix.visibleRecordCount}/{matrix.totalRecordCount}
              </span>
              <span>
                矩阵 {matrix.models.length}×{matrix.benchmarks.length}
              </span>
            </>
          ) : (
            <span>尚未加载</span>
          )}
          <span>作用范围：{scopeParts.join(" · ")}</span>
        </div>
      </div>

      {matrix && (matrix.truncated.models || matrix.truncated.benchmarks) ? (
        <div className="rounded-xl border border-info/40 bg-info/10 px-3 py-2 text-xs">
          数据量超出矩阵上限，已按记录数截断展示
          {matrix.truncated.models ? `：模型 ${matrix.models.length}/${matrix.modelTotalCount}` : ""}
          {matrix.truncated.benchmarks
            ? `${matrix.truncated.models ? "，" : "："}指标 ${matrix.benchmarks.length}/${matrix.benchmarkTotalCount}`
            : ""}
          。请用上方筛选缩小范围后再编辑。
        </div>
      ) : null}

      {!canCreateCells ? (
        <div className="rounded-xl border border-base-300/70 bg-base-200/40 px-3 py-2 text-xs opacity-80">
          当前是「全部 source」视图：可以修改与清空已有数据，但新增空单元格需要先选定具体 source（或「无 source」），
          否则新记录的归属无法确定。
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-base-300/70 bg-base-100 p-3">
        <span className="flex items-center gap-1 text-sm font-medium">
          <Wand2 size={15} />
          快速修改工具
        </span>

        <div className="flex items-center gap-1">
          <input
            type="text"
            className="input input-bordered input-sm w-28"
            placeholder="批量填值"
            aria-label="批量填值"
            value={fillValue}
            onChange={(event) => setFillValue(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-sm btn-outline btn-primary gap-1"
            disabled={selectionCount === 0 || !fillValue.trim()}
            onClick={onFillSelection}
          >
            填入选区{selectionCount > 0 ? `（${selectionCount} 格）` : ""}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost gap-1"
            disabled={selectionCount === 0}
            onClick={onClearSelection}
          >
            <Eraser size={14} />
            清空选区
          </button>
        </div>

        <div className="divider divider-horizontal mx-0" />

        <button
          type="button"
          className="btn btn-sm btn-outline gap-1"
          disabled={busy}
          onClick={() => onNormalizeScale(1)}
        >
          <Sigma size={14} />
          归一化为 1
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline gap-1"
          disabled={busy}
          onClick={() => onNormalizeScale(100)}
        >
          <Sigma size={14} />
          归一化为 100
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline gap-1"
          disabled={busy}
          onClick={onOpenSplitDialog}
        >
          <Scissors size={14} />
          分拆双值
        </button>
        <button
          type="button"
          className="btn btn-sm btn-error btn-outline gap-1"
          disabled={busy}
          onClick={onOpenDeleteConfirm}
        >
          <Trash2 size={14} />
          全部删除
        </button>
      </div>
    </div>
  );
}
