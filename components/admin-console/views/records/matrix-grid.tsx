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
import {
  getCellKey,
  isCellInSelection,
  isPendingDeleteDraft,
  normalizeSelectionRange
} from "../../utils/record-drafts";
import type { RecordEditingCell } from "../../hooks/use-record-matrix";
import { sourceTabDisplayLabel } from "@/lib/source-utils";

type RecordsMatrixGridProps = {
  models: AdminRecordMatrixModel[];
  benchmarks: AdminRecordMatrixBenchmark[];
  cellIndex: Map<string, AdminRecordCell>;
  drafts: Record<string, CellDraft>;
  selection: MatrixSelectionRange | null;
  editingCell: RecordEditingCell | null;
  loading: boolean;
  hasLoaded: boolean;
  onCellMouseDown: (
    row: number,
    col: number,
    event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
  ) => void;
  onCellMouseEnter: (row: number, col: number) => void;
  onCommitCellValue: (modelId: number, benchmarkId: number, valueRaw: string) => void;
  onStopEditing: () => void;
  onOpenReassign: (target: RecordReassignTarget) => void;
  onSelectRow?: (row: number) => void;
  onSelectCol?: (col: number) => void;
  onSelectAll?: () => void;
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
    lines.push(`source：${cell.source ? sourceTabDisplayLabel(cell.source) : "（空）"}`);
    lines.push(`benchTime：${new Date(cell.benchTime).toLocaleString("zh-CN", { hour12: false })}`);
    if (cell.valueNote) lines.push(`note：${cell.valueNote}`);
    if (cell.recordCount > 1) lines.push(`该单元格含 ${cell.recordCount} 条记录，单击可逐条查看和修改`);
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
      className="input input-xs w-full min-w-[70px] bg-base-100 text-center font-mono rounded border-primary ring-1 ring-primary/60 focus:outline-none"
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
  onOpenReassign,
  onSelectRow,
  onSelectCol,
  onSelectAll
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
    <div
      className="overflow-auto rounded-2xl border border-base-300 shadow-inner"
      style={{ maxHeight: "85vh", minHeight: "560px" }}
    >
      <table className="table table-xs border-separate border-spacing-0">
        <thead>
          <tr>
            <th
              className="sticky left-0 top-0 z-30 min-w-[200px] border-b border-r border-base-300 bg-base-200 p-2 text-left select-none cursor-pointer"
              title="按住 Ctrl/Cmd 点击可全选表格"
              onClick={(event) => {
                if (event.ctrlKey || event.metaKey) {
                  onSelectAll?.();
                }
              }}
            >
              指标 \ 模型
            </th>
            {models.map((model, col) => (
              <th
                key={`model-head-${model.modelId}`}
                className="sticky top-0 z-20 min-w-[120px] border-b border-base-300 bg-base-200 p-2 align-bottom select-none"
                title="按住 Ctrl/Cmd 点击可选取整列"
                onClick={(event) => {
                  if (event.ctrlKey || event.metaKey) {
                    event.preventDefault();
                    onSelectCol?.(col);
                  }
                }}
              >
                <button
                  type="button"
                  className="link link-hover group flex max-w-[160px] items-center gap-1 text-left text-xs font-semibold text-base-content hover:text-primary transition-colors"
                  title={`点击变更「${model.modelName}」这一列的归属`}
                  onClick={(event) => {
                    if (event.ctrlKey || event.metaKey) {
                      event.preventDefault();
                      event.stopPropagation();
                      onSelectCol?.(col);
                      return;
                    }
                    onOpenReassign({
                      entityType: "model",
                      modelId: model.modelId,
                      providerName: model.providerName,
                      label: model.modelName
                    });
                  }}
                >
                  <Link2 size={11} className="shrink-0 opacity-60 group-hover:opacity-100 group-hover:text-primary transition-opacity" aria-hidden="true" />
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
          {benchmarks.map((benchmark, row) => {
            const normalized = selection ? normalizeSelectionRange(selection) : null;
            const isSingleRowSelection = Boolean(
              normalized && normalized.rowStart === row && normalized.rowEnd === row
            );
            const selectedModels =
              normalized && normalized.rowStart === row && normalized.rowEnd === row
                ? models.slice(normalized.colStart, normalized.colEnd + 1)
                : [];
            const selectedModelIds = selectedModels.map((m) => m.modelId);
            const selectedModelLabels = selectedModels.map((m) => m.modelName);

            return (
              <tr key={`bench-row-${benchmark.benchmarkId}`}>
                <th
                  className={`sticky left-0 z-10 min-w-[200px] border-b border-r border-base-300 bg-base-100 p-2 text-left font-normal select-none transition-colors ${
                    isSingleRowSelection ? "bg-primary/5 ring-1 ring-inset ring-primary/40" : ""
                  }`}
                  title={
                    isSingleRowSelection
                      ? `当前已选该行 ${selectedModels.length} 个单元格，点击可仅修改这几个值的 benchmark 归属（按住 Ctrl/Cmd 点击可选取整行）`
                      : "按住 Ctrl/Cmd 点击可选取整行"
                  }
                  onClick={(event) => {
                    if (event.ctrlKey || event.metaKey) {
                      event.preventDefault();
                      onSelectRow?.(row);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="link link-hover group flex max-w-[220px] items-center gap-1 text-left text-xs font-semibold text-base-content hover:text-primary transition-colors"
                    title={`点击变更「${benchmark.benchmarkName}」这一行的归属`}
                    onClick={(event) => {
                      if (event.ctrlKey || event.metaKey) {
                        event.preventDefault();
                        event.stopPropagation();
                        onSelectRow?.(row);
                        return;
                      }
                      onOpenReassign({
                        entityType: "benchmark",
                        benchmarkId: benchmark.benchmarkId,
                        benchmarkType: benchmark.benchmarkType,
                        label: benchmark.benchmarkName,
                        modelIds: isSingleRowSelection ? selectedModelIds : undefined,
                        modelLabels: isSingleRowSelection ? selectedModelLabels : undefined
                      });
                    }}
                  >
                    <Link2 size={11} className="shrink-0 opacity-60 group-hover:opacity-100 group-hover:text-primary transition-opacity" aria-hidden="true" />
                    <span className="truncate">{benchmark.benchmarkName}</span>
                  </button>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] font-normal opacity-60">
                    <span className="badge badge-ghost badge-xs">{benchmark.benchmarkType}</span>
                    <span>{benchmark.recordCount} 条</span>
                    {isSingleRowSelection ? (
                      <span className="badge badge-primary badge-outline badge-xs font-sans font-medium text-primary">
                        已选 {selectedModels.length} 格
                      </span>
                    ) : null}
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
                    className={`relative cursor-cell border-b border-base-300/60 text-center font-mono text-xs ${stateClass} ${selectionClass} ${cell && cell.recordCount > 1 ? "hover:bg-primary/10" : ""}`}
                    title={buildCellTooltip(cell, draft)}
                    onMouseDown={(event) => {
                      if (isEditing) return;
                      const isCtrl = event.ctrlKey || event.metaKey;
                      if (!isCtrl) {
                        event.preventDefault();
                      }
                      onCellMouseDown(row, col, {
                        shiftKey: event.shiftKey,
                        ctrlKey: event.ctrlKey,
                        metaKey: event.metaKey
                      });
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
                          <span className="badge badge-primary badge-outline badge-xs ml-1 align-middle font-sans">{cell.recordCount} 条</span>
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
