"use client";

import type { Dispatch, SetStateAction } from "react";
import { Database } from "lucide-react";
import type { ScaleConsistencyIssue } from "../types";

type MaintenanceTabProps = {
  scaleConsistencyCheckedAt: string | null;
  scaleConsistencyIssues: ScaleConsistencyIssue[];
  scaleConsistencyAffectedValueCount: number;
  isCheckingScaleConsistency: boolean;
  normalizingScaleBenchmarkId: number | null;
  splittingScaleBenchmarkId: number | null;
  scaleSplitNameDrafts: Record<number, { baseName: string; eloName: string }>;
  setScaleSplitNameDrafts: Dispatch<SetStateAction<Record<number, { baseName: string; eloName: string }>>>;
  onCheckScaleConsistency: () => void | Promise<void>;
  onNormalizeBenchmarkScale: (issue: ScaleConsistencyIssue, targetScale: 1 | 100) => void | Promise<void>;
  onSplitBenchmarkScale: (issue: ScaleConsistencyIssue) => void | Promise<void>;
};

export function MaintenanceTab({
  scaleConsistencyCheckedAt,
  scaleConsistencyIssues,
  scaleConsistencyAffectedValueCount,
  isCheckingScaleConsistency,
  normalizingScaleBenchmarkId,
  splittingScaleBenchmarkId,
  scaleSplitNameDrafts,
  setScaleSplitNameDrafts,
  onCheckScaleConsistency,
  onNormalizeBenchmarkScale,
  onSplitBenchmarkScale
}: MaintenanceTabProps) {
  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
      <div className="relative overflow-hidden rounded-2xl border border-warning/35 bg-gradient-to-br from-warning/10 via-base-100 to-primary/10 p-5">
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-warning/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />

        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Database size={18} />
              数据一致性检测
            </h3>
            <p className="mt-1 text-sm opacity-80">
              检测同一 benchmark 是否同时出现 <code>&lt;1</code> 与 <code>&gt;10</code> 的混合量纲，或同时出现 <code>0-100</code> 与 <code>&gt;100</code> 的 Elo 风格分值，并提供修复动作。
            </p>
          </div>
          <button
            type="button"
            className="btn btn-warning shadow-md"
            onClick={() => onCheckScaleConsistency()}
            disabled={isCheckingScaleConsistency || normalizingScaleBenchmarkId !== null || splittingScaleBenchmarkId !== null}
          >
            {isCheckingScaleConsistency ? "检测中..." : "开始一致性检测"}
          </button>
        </div>

        <div className="relative mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-base-300/70 bg-base-100/75 px-3 py-2">
            <div className="text-xs uppercase tracking-wide opacity-60">最近检测</div>
            <div className="mt-1 text-sm font-medium">
              {scaleConsistencyCheckedAt
                ? new Date(scaleConsistencyCheckedAt).toLocaleString("zh-CN", { hour12: false })
                : "尚未检测"}
            </div>
          </div>
          <div className="rounded-xl border border-base-300/70 bg-base-100/75 px-3 py-2">
            <div className="text-xs uppercase tracking-wide opacity-60">异常 benchmark</div>
            <div className="mt-1 text-sm font-medium">{scaleConsistencyIssues.length} 个</div>
          </div>
          <div className="rounded-xl border border-base-300/70 bg-base-100/75 px-3 py-2">
            <div className="text-xs uppercase tracking-wide opacity-60">待处理混合值</div>
            <div className="mt-1 text-sm font-medium">{scaleConsistencyAffectedValueCount} 条</div>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {scaleConsistencyIssues.length === 0 ? (
          <div className="rounded-xl border border-base-300/70 bg-base-200/40 px-4 py-6 text-sm opacity-80">
            {scaleConsistencyCheckedAt
              ? "最近一次检测未发现混合量纲问题。"
              : "点击“开始一致性检测”后将在这里展示异常 benchmark。"}
          </div>
        ) : (
          scaleConsistencyIssues.map((issue) => {
            const isNormalizingCurrent = normalizingScaleBenchmarkId === issue.benchmarkId;
            const isSplittingCurrent = splittingScaleBenchmarkId === issue.benchmarkId;
            const issueValueDetails = issue.valueDetails ?? [];
            const hasTtsSource = issueValueDetails.some((detail) =>
              (detail.source ?? "").toLowerCase().includes("tts")
            );
            const belowOneDetails = issueValueDetails.filter((detail) => detail.value < 1);
            const hasOnlyZeroInSmallValues =
              belowOneDetails.length > 0
              && belowOneDetails.every((detail) => Math.abs(detail.value) < 1e-12);
            const hasFewSmallValues =
              issue.issueType === "mixed-scale-0-1-vs-100" && belowOneDetails.length < 3;
            const shouldDefaultCollapse =
              hasTtsSource || hasOnlyZeroInSmallValues || hasFewSmallValues;


            const splitDraft = scaleSplitNameDrafts[issue.benchmarkId] ?? {
              baseName: issue.benchmarkName,
              eloName: `${issue.benchmarkName} (Elo)`
            };

            return (
              <details
                open={!shouldDefaultCollapse}
                key={`scale-consistency-${issue.benchmarkId}`}
                className="rounded-2xl border border-warning/40 bg-base-100 shadow-sm transition-shadow open:shadow-md"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="badge badge-warning badge-outline">混合量纲告警</span>
                    <h4 className="truncate text-base font-semibold">{issue.benchmarkName}</h4>
                    <span className="text-xs opacity-70">[{issue.benchmarkType}]</span>
                    {shouldDefaultCollapse ? (
                      <span className="badge badge-ghost badge-sm">默认折叠</span>
                    ) : null}
                    {hasTtsSource ? <span className="badge badge-info badge-outline badge-sm">source: tts</span> : null}
                    {hasOnlyZeroInSmallValues ? <span className="badge badge-outline badge-sm">&lt;1 仅 0 值</span> : null}
                  </div>
                  <span className="text-xs opacity-55">点击展开/折叠</span>
                </summary>

                <div className="border-t border-base-300/50 px-4 pb-4 pt-2">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <p className="text-sm opacity-80">
                        {issue.issueType === "mixed-scale-0-1-vs-100"
                          ? <>该 benchmark 同时出现 <code>&lt;1</code> 与 <code>&gt;10</code> 的值，请选择目标量纲进行同化。</>
                          : <>该 benchmark 同时出现 <code>0-100</code> 与 <code>&gt;100</code> 的值，建议拆分为原 benchmark 与 Elo benchmark。</>}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <div className="group relative inline-flex items-center">
                          <span className="cursor-help rounded-full border border-base-300 bg-base-200/60 px-2 py-1">
                            总值 {issue.valueCount}
                          </span>

                          {issueValueDetails.length > 0 ? (
                            <div className="invisible absolute left-0 top-full z-20 mt-2 max-h-64 w-[min(82vw,300px)] overflow-auto rounded-lg border border-base-300/70 bg-base-100 p-1.5 opacity-0 shadow-lg transition-all duration-150 group-hover:visible group-hover:opacity-100">
                              <ul className="space-y-1">
                                {issueValueDetails.map((detail, index) => {
                                  const benchTimeText = detail.benchTime
                                    ? new Date(detail.benchTime).toLocaleString("zh-CN", { hour12: false })
                                    : "-";
                                  const sourceText = detail.source?.trim() ? detail.source : "空 source";

                                  return (
                                    <li
                                      key={`scale-detail-${issue.benchmarkId}-${index}`}
                                      className="rounded-md border border-base-300/50 bg-base-200/30 px-2 py-0.5"
                                    >
                                      <div className="flex items-center gap-1 text-[11px] text-base-content">
                                        <span className="font-mono font-semibold">
                                          {Number(detail.value.toFixed(6)).toString()}
                                        </span>
                                        <span className="truncate opacity-75">· {detail.modelName}</span>
                                      </div>
                                      <div className="mt-0.5 break-all text-[11px] leading-4 opacity-75">
                                        {sourceText} · {benchTimeText}
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                        {issue.issueType === "mixed-scale-0-1-vs-100" ? (
                          <>
                            <span className="rounded-full border border-info/35 bg-info/10 px-2 py-1">
                              &lt;1：{issue.smallValueCount}
                            </span>
                            <span className="rounded-full border border-warning/35 bg-warning/10 px-2 py-1">
                              &gt;10：{issue.largeValueCount}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="rounded-full border border-info/35 bg-info/10 px-2 py-1">
                              0-100：{issue.zeroToHundredCount}
                            </span>
                            <span className="rounded-full border border-warning/35 bg-warning/10 px-2 py-1">
                              &gt;100：{issue.overHundredCount}
                            </span>
                          </>
                        )}
                        <span className="rounded-full border border-base-300 bg-base-200/60 px-2 py-1">
                          min={Number(issue.minValue.toFixed(6)).toString()}
                        </span>
                        <span className="rounded-full border border-base-300 bg-base-200/60 px-2 py-1">
                          max={Number(issue.maxValue.toFixed(6)).toString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                      {issue.issueType === "mixed-scale-0-1-vs-100" ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline btn-primary"
                            onClick={() => onNormalizeBenchmarkScale(issue, 1)}
                            disabled={isCheckingScaleConsistency || normalizingScaleBenchmarkId !== null || splittingScaleBenchmarkId !== null}
                          >
                            {isNormalizingCurrent ? "处理中..." : "同化为 1 量纲"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline btn-secondary"
                            onClick={() => onNormalizeBenchmarkScale(issue, 100)}
                            disabled={isCheckingScaleConsistency || normalizingScaleBenchmarkId !== null || splittingScaleBenchmarkId !== null}
                          >
                            {isNormalizingCurrent ? "处理中..." : "同化为 100 量纲"}
                          </button>
                        </>
                      ) : (
                        <div className="w-full space-y-2 xl:w-[420px]">
                          <input
                            className="input input-bordered input-sm w-full"
                            value={splitDraft.baseName}
                            onChange={(event) =>
                              setScaleSplitNameDrafts((prev) => ({
                                ...prev,
                                [issue.benchmarkId]: {
                                  ...(prev[issue.benchmarkId] ?? {
                                    baseName: issue.benchmarkName,
                                    eloName: `${issue.benchmarkName} (Elo)`
                                  }),
                                  baseName: event.target.value
                                }
                              }))
                            }
                            placeholder="原 benchmark 名称"
                          />
                          <input
                            className="input input-bordered input-sm w-full"
                            value={splitDraft.eloName}
                            onChange={(event) =>
                              setScaleSplitNameDrafts((prev) => ({
                                ...prev,
                                [issue.benchmarkId]: {
                                  ...(prev[issue.benchmarkId] ?? {
                                    baseName: issue.benchmarkName,
                                    eloName: `${issue.benchmarkName} (Elo)`
                                  }),
                                  eloName: event.target.value
                                }
                              }))
                            }
                            placeholder="Elo benchmark 名称"
                          />
                          <div className="text-[11px] opacity-70">
                            type / modality / unit / higherIsBetter 将继承原 benchmark。
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm btn-warning"
                            onClick={() => onSplitBenchmarkScale(issue)}
                            disabled={isCheckingScaleConsistency || normalizingScaleBenchmarkId !== null || splittingScaleBenchmarkId !== null}
                          >
                            {isSplittingCurrent ? "处理中..." : "拆分为原 benchmark + Elo"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </details>
            );
          })
        )}
      </div>
    </section>
  );
}
