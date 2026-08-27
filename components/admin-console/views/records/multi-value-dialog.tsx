"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Database, Trash2 } from "lucide-react";
import type { AdminRecordCell, AdminRecordMatrixBenchmark, AdminRecordMatrixModel } from "../../types";
import { toLocalDateTime } from "../../utils/datetime-local";
import { isEmptyRecordValue } from "@/lib/admin-records-planner";
import { sourceTabDisplayLabel } from "@/lib/source-utils";

export type MultiValueRecordDraft = {
  id: number;
  valueRaw: string;
  source: string;
  benchTime: string;
  valueNote: string;
  isDeleted: boolean;
};

type Props = {
  cell: AdminRecordCell;
  model: AdminRecordMatrixModel;
  benchmark: AdminRecordMatrixBenchmark;
  busy: boolean;
  onClose: () => void;
  onSave: (records: MultiValueRecordDraft[]) => void;
};

function buildInitialDrafts(cell: AdminRecordCell): MultiValueRecordDraft[] {
  const records = cell.records?.length
    ? cell.records
    : [{
        id: cell.recordId,
        valueRaw: cell.valueRaw,
        valueNum: cell.valueNum,
        valueNum2: cell.valueNum2,
        valueNote: cell.valueNote,
        source: cell.source,
        benchTime: cell.benchTime
      }];
  return records.map((record) => ({
    id: record.id,
    valueRaw: record.valueRaw,
    source: record.source ?? "",
    benchTime: toLocalDateTime(record.benchTime),
    valueNote: record.valueNote ?? "",
    isDeleted: false
  }));
}

export function RecordsMultiValueDialog({ cell, model, benchmark, busy, onClose, onSave }: Props) {
  const [drafts, setDrafts] = useState(() => buildInitialDrafts(cell));
  const originalById = useMemo(() => new Map(buildInitialDrafts(cell).map((draft) => [draft.id, draft])), [cell]);
  const recordInfoById = useMemo(
    () => new Map((cell.records ?? []).map((record) => [record.id, record])),
    [cell.records]
  );

  function isDraftDirty(draft: MultiValueRecordDraft): boolean {
    const original = originalById.get(draft.id);
    return !original
      || draft.isDeleted
      || draft.valueRaw.trim() !== original.valueRaw.trim()
      || draft.source.trim() !== original.source.trim()
      || draft.benchTime !== original.benchTime
      || draft.valueNote.trim() !== original.valueNote.trim();
  }

  const dirty = drafts.some(isDraftDirty);
  const invalid = drafts.some((draft) => !draft.isDeleted && (isEmptyRecordValue(draft.valueRaw) || !draft.benchTime));
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  function update(id: number, patch: Partial<MultiValueRecordDraft>) {
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  return (
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="multi-value-dialog-title"
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-base-300/80 bg-base-100 p-6 shadow-2xl"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-base-300/70 pb-3">
          <div className="min-w-0">
            <h3 id="multi-value-dialog-title" className="flex items-center gap-2 text-lg font-bold">
              <Database size={18} className="text-primary" />
              编辑单元格内的 {cell.recordCount} 条记录
            </h3>
            <p className="mt-1 truncate text-xs opacity-65">
              {benchmark.benchmarkName} × {model.modelName}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-xs btn-circle" aria-label="关闭多值编辑弹窗" disabled={busy} onClick={onClose}>✕</button>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {drafts.map((draft, index) => {
            const info = recordInfoById.get(draft.id);
            return (
              <fieldset
                key={draft.id}
                disabled={busy}
                className={`rounded-2xl border p-4 transition-colors ${draft.isDeleted ? "border-error/50 bg-error/10 opacity-70" : "border-base-300/80 bg-base-200/25"}`}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="font-semibold">记录 {index + 1}</span>
                  <span className="badge badge-ghost badge-sm font-mono">ID {draft.id}</span>
                  {index === 0 ? <span className="badge badge-primary badge-outline badge-sm">当前展示值</span> : null}
                  {info ? (
                    <span className="text-xs opacity-60">
                      解析值：{info.valueNum ?? "—"}{info.valueNum2 !== null ? ` / ${info.valueNum2}` : ""}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={`btn btn-xs ml-auto gap-1 ${draft.isDeleted ? "btn-ghost" : "btn-error btn-outline"}`}
                    onClick={() => update(draft.id, { isDeleted: !draft.isDeleted })}
                  >
                    <Trash2 size={12} />
                    {draft.isDeleted ? "撤销删除" : "删除此条"}
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="form-control flex flex-col gap-1.5">
                    <span className="text-xs font-medium opacity-75">原始值</span>
                    <input aria-label={`记录 ${draft.id} 原始值`} className="input input-bordered input-sm w-full font-mono" value={draft.valueRaw} disabled={draft.isDeleted} onChange={(event) => update(draft.id, { valueRaw: event.target.value })} />
                  </label>
                  <label className="form-control flex flex-col gap-1.5">
                    <span className="text-xs font-medium opacity-75">测试时间</span>
                    <input aria-label={`记录 ${draft.id} 测试时间`} type="datetime-local" step="1" className="input input-bordered input-sm w-full" value={draft.benchTime} disabled={draft.isDeleted} onChange={(event) => update(draft.id, { benchTime: event.target.value })} />
                  </label>
                  <label className="form-control flex flex-col gap-1.5">
                    <span className="text-xs font-medium opacity-75">Source</span>
                    <input aria-label={`记录 ${draft.id} Source`} className="input input-bordered input-sm w-full" value={draft.source} placeholder="留空表示无 source" disabled={draft.isDeleted} onChange={(event) => update(draft.id, { source: event.target.value })} />
                    <span className="text-[11px] opacity-55">显示：{draft.source.trim() ? sourceTabDisplayLabel(draft.source) : "（无 source）"}</span>
                  </label>
                  <label className="form-control flex flex-col gap-1.5">
                    <span className="text-xs font-medium opacity-75">备注</span>
                    <textarea aria-label={`记录 ${draft.id} 备注`} className="textarea textarea-bordered textarea-sm min-h-20 w-full" value={draft.valueNote} placeholder="可留空" disabled={draft.isDeleted} onChange={(event) => update(draft.id, { valueNote: event.target.value })} />
                  </label>
                </div>
              </fieldset>
            );
          })}
        </div>

        {invalid ? <p className="mt-3 text-xs text-error">未删除的记录必须填写原始值和测试时间。</p> : null}
        <div className="mt-4 flex items-center justify-end gap-2.5 border-t border-base-300/60 pt-3">
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="btn btn-primary btn-sm px-5" disabled={busy || !dirty || invalid} onClick={() => onSave(drafts.filter(isDraftDirty))}>
            {busy ? "保存中..." : "保存全部记录"}
          </button>
        </div>
      </div>
    </div>
  );
}
