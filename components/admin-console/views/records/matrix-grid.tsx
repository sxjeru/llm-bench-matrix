"use client";

import { useEffect, useRef } from "react";
import { Link2, PencilLine } from "lucide-react";
import type {
  AdminRecordCell,
  AdminRecordMatrixBenchmark,
  AdminRecordMatrixModel,
  CellDraft,
  MatrixSelectionRange,
  RecordReassignTarget
} from "../../types";
import { getCellKey, isCellInSelection, isPendingDeleteDraft } from "../../utils/record-drafts";
import type { RecordEditingCell } from "../../hooks/use-record-matrix";

type RecordsMatrixGridProps = {
  models: AdminRecordMatrixModel[];
  benchmarks: AdminRecordMatrixBenchmark[];
  cellIndex: Map<string, AdminRecordCell>;
  drafts: Record<string, CellDraft>;
  selection: MatrixSelectionRange | null;
  editingCell: RecordEditingCell | null;
  loading: boolean;
  hasLoaded: boolean;
  onCellMouseDown: (row: number, col: number, event: { shiftKey?: boolean }) => void;
  onCellMouseEnter: (row: number, col: number) => void;
  onCommitCellValue: (modelId: number, benchmarkId: number, valueRaw: string) => void;
  onStopEditing: () => void;
  onOpenReassign: (target: RecordReassignTarget) => void;
};

function buildCellTooltip(cell: AdminRecordCell | undefined, draft: CellDraft | undefined): string {
  const lines: string[] = [];

  if (draft) {
    lines.push(
      `原值：${draft.originalValueRaw || "（空）"} → 新值：${draft.nextValueRaw || "（清空）"}`
    );
  } else if (cell) {
    lines.push(`当前值：${cell.valueRaw}`);
  } else {
    lines.push("当前为空，单击可新增");
  }

  if (cell) {
    lines.push(`source：${cell.source ?? "（空）"}`);
    lines.push(`benchTime：${new Date(cell.benchTime).toLocaleString("zh-CN", { hour12: false })}`);
    if (cell.valueNote) lines.push(`note：${cell.valueNote}`);
    if (cell.recordCount > 1) lines.push(`该单元格含 ${cell.recordCount} 条记录，清空会一并删除`);
  }

  return lines.join("\n");
}

function CellEditor({
  initialValue,
  onCommit,
  onCancel
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      className="input input-xs w-full min-w-[70px] bg-base-100 text-center font-mono"
      aria-label="单元格数值"
      defaultValue={initialValue}
      onKeyDown={(event) => {
        // 编辑态里所有按键都不该触发矩阵的框选快捷键（Backspace 批量清空 / Esc 取消选区）
        event.stopPropagation();

        if (event.key === "Enter") {
          event.preventDefault();
          committedRef.current = true;
          onCommit(event.currentTarget.value);
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          committedRef.current = true;
          onCancel();
        }
      }}
      onBlur={(event) => {
        if (committedRef.current) return;
        committedRef.current = true;
        onCommit(event.currentTarget.value);
      }}
    />
  );
}

export function RecordsMatrixGrid({
  models,
  benchmarks,
  cellIndex,
  drafts,
  selection,
  editingCell,
  loading,
  hasLoaded,
  onCellMouseDown,
  onCellMouseEnter,
  onCommitCellValue,
  onStopEditing,
  onOpenReassign
}: RecordsMatrixGridProps) {
  if (loading && models.length === 0) {
    return (
      <div className="rounded-2xl border border-base-300/70 bg-base-200/40 px-4 py-10 text-center text-sm opacity-70">
        正在加载数据矩阵...
      </div>
    );
  }

  if (!hasLoaded) {
    return (
      <div className="rounded-2xl border border-base-300/70 bg-base-200/40 px-4 py-12 text-center text-sm">
        <p className="font-medium opacity-80">请先在上方选择筛选条件以加载数据矩阵</p>
        <p className="mt-1 text-xs opacity-60">支持按 Source、模型、指标或关键字进行筛选</p>
      </div>
    );
  }

  if (models.length === 0 || benchmarks.length === 0) {
    return (
      <div className="rounded-2xl border border-base-300/70 bg-base-200/40 px-4 py-10 text-center text-sm opacity-70">
        当前筛选条件下没有数据。调整 source / 模型 / 指标筛选后再试。
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-2xl border border-base-300" style={{ maxHeight: "68vh" }}>
      <table className="table table-xs select-none border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 min-w-[200px] border-b border-r border-base-300 bg-base-200 p-2 text-left">
              指标 \ 模型
            </th>
            {models.map((model) => (
              <th
                key={`model-head-${model.modelId}`}
                className="sticky top-0 z-20 min-w-[120px] border-b border-base-300 bg-base-200 p-2 align-bottom"
              >
                <button
                  type="button"
                  className="link link-hover flex max-w-[160px] items-center gap-1 text-left text-xs font-semibold text-base-content hover:text-primary"
                  title={`点击变更「${model.modelName}」这一列的归属`}
                  onClick={() =>
                    onOpenReassign({
                      entityType: "model",
                      modelId: model.modelId,
                      providerName: model.providerName,
                      label: model.modelName
                    })
                  }
                >
                  <Link2 size={11} className="shrink-0 opacity-60" aria-hidden="true" />
                  <span className="truncate">{model.modelName}</span>
                </button>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] font-normal opacity-60">
                  <span className="badge badge-ghost badge-xs max-w-[90px] truncate">{model.providerDisplayName}</span>
                  <span>{model.recordCount}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {benchmarks.map((benchmark, row) => (
            <tr key={`bench-row-${benchmark.benchmarkId}`}>
              <th className="sticky left-0 z-10 min-w-[200px] border-b border-r border-base-300 bg-base-100 p-2 text-left font-normal">
                <button
                  type="button"
                  className="link link-hover flex max-w-[220px] items-center gap-1 text-left text-xs font-semibold text-base-content hover:text-primary"
                  title={`点击变更「${benchmark.benchmarkName}」这一行的归属`}
                  onClick={() =>
                    onOpenReassign({
                      entityType: "benchmark",
                      benchmarkId: benchmark.benchmarkId,
                      benchmarkType: benchmark.benchmarkType,
                      label: benchmark.benchmarkName
                    })
                  }
                >
                  <Link2 size={11} className="shrink-0 opacity-60" aria-hidden="true" />
                  <span className="truncate">{benchmark.benchmarkName}</span>
                </button>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] font-normal opacity-60">
                  <span className="badge badge-ghost badge-xs">{benchmark.benchmarkType}</span>
                  <span>{benchmark.recordCount} 条</span>
                </div>
              </th>

              {models.map((model, col) => {
                const key = getCellKey(model.modelId, benchmark.benchmarkId);
                const cell = cellIndex.get(key);
                const draft = drafts[key];
                const pendingDelete = isPendingDeleteDraft(draft);
                const isDirty = Boolean(draft);
                const isSelected = isCellInSelection(selection, row, col);
                const isEditing = editingCell?.row === row && editingCell?.col === col;
                const displayValue = draft ? draft.nextValueRaw : cell?.valueRaw ?? "";

                const stateClass = pendingDelete
                  ? "bg-warning/20 text-warning-content line-through"
                  : isDirty
                    ? "bg-warning/25 font-semibold text-warning-content"
                    : "";
                const selectionClass = isSelected
                  ? "outline outline-2 -outline-offset-2 outline-primary bg-primary/10"
                  : "";

                return (
                  <td
                    key={`cell-${key}`}
                    data-testid={`record-cell-${model.modelId}-${benchmark.benchmarkId}`}
                    data-dirty={isDirty ? "true" : "false"}
                    data-pending-delete={pendingDelete ? "true" : "false"}
                    data-selected={isSelected ? "true" : "false"}
                    className={`relative cursor-cell border-b border-base-300/60 text-center font-mono text-xs ${stateClass} ${selectionClass}`}
                    title={buildCellTooltip(cell, draft)}
                    onMouseDown={(event) => {
                      if (isEditing) return;
                      event.preventDefault();
                      onCellMouseDown(row, col, { shiftKey: event.shiftKey });
                    }}
                    onMouseEnter={() => onCellMouseEnter(row, col)}
                  >
                    {isEditing ? (
                      <CellEditor
                        initialValue={displayValue}
                        onCommit={(value) => {
                          onCommitCellValue(model.modelId, benchmark.benchmarkId, value);
                          onStopEditing();
                        }}
                        onCancel={onStopEditing}
                      />
                    ) : (
                      <>
                        <span className={displayValue ? "" : "opacity-30"}>
                          {displayValue || "—"}
                        </span>
                        {cell && cell.recordCount > 1 ? (
                          <span className="ml-1 align-super text-[9px] opacity-60">×{cell.recordCount}</span>
                        ) : null}
                        {isDirty ? (
                          <PencilLine
                            size={9}
                            className="absolute right-0.5 top-0.5 text-warning"
                            aria-label="未保存的改动"
                          />
                        ) : null}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
