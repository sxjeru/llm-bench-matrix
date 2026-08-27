"use client";

import { useMemo, useState } from "react";
import { Scissors } from "lucide-react";
import type { RecordDualValueCandidate } from "../../types";

type RecordsSplitDualDialogProps = {
  candidates: RecordDualValueCandidate[];
  loading: boolean;
  busy: boolean;
  scopeDescription: string;
  onClose: () => void;
  onSubmit: (input: {
    benchmarkId: number;
    first: { benchmarkId?: number; benchmarkName?: string; benchmarkType?: string };
    second: { benchmarkName: string; benchmarkType?: string };
  }) => void;
};

type SplitNameDraft = {
  firstName: string;
  firstType: string;
  secondName: string;
  secondType: string;
};

function buildDefaultDraft(candidate: RecordDualValueCandidate): SplitNameDraft {
  return {
    firstName: candidate.benchmarkName,
    firstType: candidate.benchmarkType,
    secondName: `${candidate.benchmarkName} (2)`,
    secondType: candidate.benchmarkType
  };
}

/**
 * `77 / 88` 这类复合值的分拆向导。
 *
 * 第一个值默认留在原 benchmark（最常见的场景是「原指标其实是两个子指标」），
 * 第二个值必须落到另一个 benchmark，所以名称必填。
 *
 * 名称草稿按候选 benchmark id 存：切换候选时自动回到该候选的默认名，
 * 又不会把用户已经改过的名字冲掉，也不需要在 effect 里同步 state。
 */
export function RecordsSplitDualDialog({
  candidates,
  loading,
  busy,
  scopeDescription,
  onClose,
  onSubmit
}: RecordsSplitDualDialogProps) {
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [keepFirstInPlace, setKeepFirstInPlace] = useState(true);
  const [nameDrafts, setNameDrafts] = useState<Record<number, SplitNameDraft>>({});

  const selectedId = pickedId ?? candidates[0]?.benchmarkId ?? null;
  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.benchmarkId === selectedId) ?? null,
    [candidates, selectedId]
  );

  const draft = selectedCandidate
    ? nameDrafts[selectedCandidate.benchmarkId] ?? buildDefaultDraft(selectedCandidate)
    : { firstName: "", firstType: "", secondName: "", secondType: "" };

  function updateDraft(patch: Partial<SplitNameDraft>) {
    if (!selectedCandidate) return;
    const benchmarkId = selectedCandidate.benchmarkId;
    setNameDrafts((prev) => ({
      ...prev,
      [benchmarkId]: { ...(prev[benchmarkId] ?? buildDefaultDraft(selectedCandidate)), ...patch }
    }));
  }

  const canSubmit =
    selectedCandidate !== null
    && draft.secondName.trim().length > 0
    && (keepFirstInPlace || draft.firstName.trim().length > 0)
    && !busy;

  function handleSubmit() {
    if (!selectedCandidate || !canSubmit) return;

    onSubmit({
      benchmarkId: selectedCandidate.benchmarkId,
      first: keepFirstInPlace
        ? { benchmarkId: selectedCandidate.benchmarkId }
        : {
            benchmarkName: draft.firstName.trim(),
            benchmarkType: draft.firstType.trim() || selectedCandidate.benchmarkType
          },
      second: {
        benchmarkName: draft.secondName.trim(),
        benchmarkType: draft.secondType.trim() || selectedCandidate.benchmarkType
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-base-300/80 bg-base-100 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-base-300/70">
          <h3 className="flex min-w-0 items-center gap-2 text-lg font-bold text-base-content">
            <Scissors size={18} className="shrink-0 text-warning" />
            <span className="min-w-0 break-words">分拆双值（如 77 / 88）</span>
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

        <div className="mt-3 rounded-xl border border-base-300/70 bg-base-200/40 px-3.5 py-2.5 text-xs text-base-content/70">
          <span className="opacity-70">作用范围：</span>
          <span>{scopeDescription}</span>
        </div>

        {loading ? (
          <div className="mt-4 rounded-xl border border-base-300/70 bg-base-200/40 px-4 py-6 text-center text-sm opacity-70">
            正在扫描双值记录...
          </div>
        ) : candidates.length === 0 ? (
          <div className="mt-4 rounded-xl border border-base-300/70 bg-base-200/40 px-4 py-6 text-center text-sm opacity-70">
            当前筛选范围内没有检测到双值记录。
          </div>
        ) : (
          <>
            <div className="mt-4 max-h-48 space-y-1 overflow-auto rounded-xl border border-base-300/70 bg-base-200/20 p-2">
              {candidates.map((candidate) => (
                <label
                  key={`dual-candidate-${candidate.benchmarkId}`}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                    selectedId === candidate.benchmarkId
                      ? "border border-primary/30 bg-primary/15"
                      : "border border-transparent hover:bg-base-200/70"
                  }`}
                >
                  <input
                    type="radio"
                    className="radio radio-primary radio-sm mt-0.5"
                    name="records-split-dual-candidate"
                    checked={selectedId === candidate.benchmarkId}
                    onChange={() => setPickedId(candidate.benchmarkId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-base-content">{candidate.benchmarkName}</span>
                    <span className="ml-1.5 text-xs opacity-60">[{candidate.benchmarkType}]</span>
                    <span className="ml-2 badge badge-xs badge-ghost">
                      双值 {candidate.dualValueCount}/{candidate.totalCount}
                    </span>
                    {candidate.sampleValues.length > 0 ? (
                      <span className="ml-2 font-mono text-[11px] opacity-60">
                        {candidate.sampleValues.join("、")}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>

            <label className="mt-3.5 flex cursor-pointer items-center gap-2 text-sm text-base-content/90">
              <input
                type="checkbox"
                className="checkbox checkbox-primary checkbox-sm"
                checked={keepFirstInPlace}
                onChange={(event) => setKeepFirstInPlace(event.target.checked)}
              />
              <span>第一个值留在原 benchmark</span>
            </label>

            <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
              <label className="form-control flex flex-col gap-1.5 w-full">
                <span className="label-text text-xs font-medium text-base-content/80">第一个值的 benchmark 名称</span>
                <input
                  type="text"
                  className="input input-bordered input-sm w-full rounded-xl bg-base-200/50 focus:bg-base-100 focus:border-primary focus:outline-none transition-colors"
                  aria-label="第一个值的 benchmark 名称"
                  placeholder="第一个指标名称"
                  value={draft.firstName}
                  disabled={keepFirstInPlace}
                  onChange={(event) => updateDraft({ firstName: event.target.value })}
                />
              </label>
              <label className="form-control flex flex-col gap-1.5 w-full">
                <span className="label-text text-xs font-medium text-base-content/80">第一个值的 type</span>
                <input
                  type="text"
                  className="input input-bordered input-sm w-full rounded-xl bg-base-200/50 focus:bg-base-100 focus:border-primary focus:outline-none transition-colors"
                  aria-label="第一个值的 type"
                  placeholder="第一个指标类别"
                  value={draft.firstType}
                  disabled={keepFirstInPlace}
                  onChange={(event) => updateDraft({ firstType: event.target.value })}
                />
              </label>
              <label className="form-control flex flex-col gap-1.5 w-full">
                <span className="label-text text-xs font-medium text-base-content/80">第二个值的 benchmark 名称</span>
                <input
                  type="text"
                  className="input input-bordered input-sm w-full rounded-xl bg-base-200/50 focus:bg-base-100 focus:border-primary focus:outline-none transition-colors"
                  aria-label="第二个值的 benchmark 名称"
                  placeholder="第二个指标名称"
                  value={draft.secondName}
                  onChange={(event) => updateDraft({ secondName: event.target.value })}
                />
              </label>
              <label className="form-control flex flex-col gap-1.5 w-full">
                <span className="label-text text-xs font-medium text-base-content/80">第二个值的 type</span>
                <input
                  type="text"
                  className="input input-bordered input-sm w-full rounded-xl bg-base-200/50 focus:bg-base-100 focus:border-primary focus:outline-none transition-colors"
                  aria-label="第二个值的 type"
                  placeholder="第二个指标类别"
                  value={draft.secondType}
                  onChange={(event) => updateDraft({ secondType: event.target.value })}
                />
              </label>
            </div>

            {selectedCandidate ? (
              <div className="mt-3.5 rounded-xl border border-info/40 bg-info/10 px-3.5 py-2.5 text-xs text-base-content/85">
                将把 <span className="font-semibold text-info">{selectedCandidate.dualValueCount}</span> 条双值记录拆成两条：第一个值 →{" "}
                <span className="font-semibold">
                  {keepFirstInPlace ? selectedCandidate.benchmarkName : draft.firstName || "（未填）"}
                </span>
                ，第二个值 → <span className="font-semibold">{draft.secondName || "（未填）"}</span>
                。unit / higherIsBetter / modality 继承原 benchmark。
              </div>
            ) : null}
          </>
        )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2.5 pt-3 border-t border-base-300/60">
          <button type="button" className="btn btn-ghost btn-sm rounded-xl" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-warning btn-sm rounded-xl font-semibold px-4"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {busy ? "处理中..." : "执行分拆"}
          </button>
        </div>
      </div>
    </div>
  );
}
