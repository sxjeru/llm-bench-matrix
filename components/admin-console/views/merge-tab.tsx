"use client";

import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { Merge as MergeIcon, Search, Sparkles } from "lucide-react";
import type {
  BenchmarkValueOverlapStats,
  DuplicateBenchmarkCandidate,
  DuplicateConfidence,
  DuplicateDetectionResult,
  DuplicateModelCandidate,
  MergeSubmitState,
  MergedRecord
} from "../types";

type EntityOption = { id: number; label: string };

type MergeTabProps = {
  isDetectingDuplicates: boolean;
  onDetectDuplicateCandidates: () => void | Promise<void>;
  duplicateDetectionResult: DuplicateDetectionResult | null;
  duplicateDetectionEntityType: "model" | "benchmark";
  setDuplicateDetectionEntityType: Dispatch<SetStateAction<"model" | "benchmark">>;
  duplicateConfidenceFilter: "high-medium" | "all";
  setDuplicateConfidenceFilter: Dispatch<SetStateAction<"high-medium" | "all">>;
  isAllActiveDuplicateCandidatesSelected: boolean;
  activeDuplicateCandidateCount: number;
  selectedActiveDuplicateCandidateCount: number;
  isBatchMergingDuplicates: boolean;
  toggleAllVisibleDuplicateCandidates: (selected: boolean) => void;
  onBatchMergeDuplicateCandidates: () => void | Promise<void>;
  visibleModelDuplicateCandidates: DuplicateModelCandidate[];
  visibleBenchmarkDuplicateCandidates: DuplicateBenchmarkCandidate[];
  duplicateCandidateCardClass: (confidence: DuplicateConfidence) => string;
  selectedDuplicateCandidateKeys: Record<string, boolean>;
  getDuplicateCandidateKey: (
    entityType: "model" | "benchmark",
    candidate: { sourceId: number; targetId: number }
  ) => string;
  setDuplicateCandidateSelected: (
    entityType: "model" | "benchmark",
    candidate: { sourceId: number; targetId: number },
    selected: boolean
  ) => void;
  duplicateConfidenceBadgeClass: (confidence: DuplicateConfidence) => string;
  duplicateConfidenceLabel: (confidence: DuplicateConfidence) => string;
  applyModelDuplicateCandidate: (candidate: DuplicateModelCandidate) => void;
  duplicateReasonLabel: (reason: string) => string;
  applyBenchmarkDuplicateCandidate: (candidate: DuplicateBenchmarkCandidate) => void;
  onMerge: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  mergeType: "model" | "benchmark";
  setMergeType: Dispatch<SetStateAction<"model" | "benchmark">>;
  setMergeSourceInput: Dispatch<SetStateAction<string>>;
  setMergeTargetInput: Dispatch<SetStateAction<string>>;
  setMergeTargetBenchmarkNameInput: Dispatch<SetStateAction<string>>;
  mergeSourceInput: string;
  mergeTargetInput: string;
  mergeEntityOptions: EntityOption[];
  resolvedMergeSourceId: number | null;
  resolvedMergeTargetId: number | null;
  shouldRenderBenchmarkValueOverlapBadge: boolean;
  benchmarkValueOverlapBadgeClass: string;
  isLoadingBenchmarkValueOverlap: boolean;
  benchmarkValueOverlapStats: BenchmarkValueOverlapStats | null;
  mergeTargetBenchmarkNameInput: string;
  mergeSubmitButtonRef: RefObject<HTMLButtonElement | null>;
  mergeSubmitState: MergeSubmitState;
  canSubmitMerge: boolean;
  mergedRecordList: MergedRecord[];
  mergedRecordTargetInputs: Record<string, string>;
  setMergedRecordTargetInputs: Dispatch<SetStateAction<Record<string, string>>>;
  onUpdateMergedRecord: (record: MergedRecord) => void | Promise<void>;
  onDeleteMergedRecord: (record: MergedRecord) => void | Promise<void>;
  modelEntityOptions: EntityOption[];
  benchmarkEntityOptions: EntityOption[];
};

export function MergeTab({
  isDetectingDuplicates,
  onDetectDuplicateCandidates,
  duplicateDetectionResult,
  duplicateDetectionEntityType,
  setDuplicateDetectionEntityType,
  duplicateConfidenceFilter,
  setDuplicateConfidenceFilter,
  isAllActiveDuplicateCandidatesSelected,
  activeDuplicateCandidateCount,
  selectedActiveDuplicateCandidateCount,
  isBatchMergingDuplicates,
  toggleAllVisibleDuplicateCandidates,
  onBatchMergeDuplicateCandidates,
  visibleModelDuplicateCandidates,
  visibleBenchmarkDuplicateCandidates,
  duplicateCandidateCardClass,
  selectedDuplicateCandidateKeys,
  getDuplicateCandidateKey,
  setDuplicateCandidateSelected,
  duplicateConfidenceBadgeClass,
  duplicateConfidenceLabel,
  applyModelDuplicateCandidate,
  duplicateReasonLabel,
  applyBenchmarkDuplicateCandidate,
  onMerge,
  mergeType,
  setMergeType,
  setMergeSourceInput,
  setMergeTargetInput,
  setMergeTargetBenchmarkNameInput,
  mergeSourceInput,
  mergeTargetInput,
  mergeEntityOptions,
  resolvedMergeSourceId,
  resolvedMergeTargetId,
  shouldRenderBenchmarkValueOverlapBadge,
  benchmarkValueOverlapBadgeClass,
  isLoadingBenchmarkValueOverlap,
  benchmarkValueOverlapStats,
  mergeTargetBenchmarkNameInput,
  mergeSubmitButtonRef,
  mergeSubmitState,
  canSubmitMerge,
  mergedRecordList,
  mergedRecordTargetInputs,
  setMergedRecordTargetInputs,
  onUpdateMergedRecord,
  onDeleteMergedRecord,
  modelEntityOptions,
  benchmarkEntityOptions
}: MergeTabProps) {
  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <MergeIcon size={18} />
        实体合并去重
      </h3>
      <div className="mb-5 rounded-2xl border border-primary/25 bg-gradient-to-br from-base-200/45 via-base-100/30 to-base-100/70 p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="flex items-center gap-2 text-base font-semibold">
            <Sparkles size={16} className="text-primary" />
            重复候选检测
          </h4>
          <button
            type="button"
            className="btn btn-sm btn-primary ml-auto"
            onClick={onDetectDuplicateCandidates}
            disabled={isDetectingDuplicates}
          >
            <Search size={14} />
            {isDetectingDuplicates ? "检测中..." : "检测重复候选"}
          </button>
        </div>

        <p className="mt-2 text-xs opacity-75">
          模型：去噪词（如 high/reasoning）+ 字符重复匹配度；Benchmark：名称归一化 + 字符重复匹配度（不依赖模型重合度）。
        </p>

        {duplicateDetectionResult ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs opacity-80">
              <span className="opacity-70">生成时间：{new Date(duplicateDetectionResult.generatedAt).toLocaleString()}</span>
            </div>

            <div className="tabs tabs-boxed inline-flex bg-base-200/70 p-1">
              <button
                type="button"
                className={`tab ${duplicateDetectionEntityType === "model" ? "tab-active" : ""}`}
                onClick={() => setDuplicateDetectionEntityType("model")}
              >
                {`Model 候选（${duplicateDetectionResult.modelCandidates.length}）`}
              </button>
              <button
                type="button"
                className={`tab ${duplicateDetectionEntityType === "benchmark" ? "tab-active" : ""}`}
                onClick={() => setDuplicateDetectionEntityType("benchmark")}
              >
                {`Benchmark 候选（${duplicateDetectionResult.benchmarkCandidates.length}）`}
              </button>
            </div>

            <div className="inline-flex items-center gap-1 rounded-lg border border-base-300/70 bg-base-100/60 p-1 text-xs">
              <button
                type="button"
                className={`btn btn-xs ${duplicateConfidenceFilter === "high-medium" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setDuplicateConfidenceFilter("high-medium")}
              >
                仅高/中置信
              </button>
              <button
                type="button"
                className={`btn btn-xs ${duplicateConfidenceFilter === "all" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setDuplicateConfidenceFilter("all")}
              >
                显示全部
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-base-300/70 bg-base-100/60 p-2 text-xs">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={isAllActiveDuplicateCandidatesSelected}
                  disabled={activeDuplicateCandidateCount === 0 || isBatchMergingDuplicates}
                  onChange={(e) => toggleAllVisibleDuplicateCandidates(e.target.checked)}
                />
                <span>选择当前列表全部候选</span>
              </label>
              <span className="opacity-70">已选 {selectedActiveDuplicateCandidateCount} / {activeDuplicateCandidateCount}</span>
              <button
                type="button"
                className="btn btn-xs btn-error ml-auto"
                disabled={selectedActiveDuplicateCandidateCount === 0 || isBatchMergingDuplicates}
                onClick={onBatchMergeDuplicateCandidates}
              >
                {isBatchMergingDuplicates ? "批量合并中..." : "批量合并已选"}
              </button>
            </div>

            {duplicateDetectionEntityType === "model" ? (
              visibleModelDuplicateCandidates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-base-300 p-3 text-sm opacity-70">
                  当前筛选条件下未检测到 model 重复候选。
                </div>
              ) : (
                <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                  {visibleModelDuplicateCandidates.map((candidate) => (
                    <div
                      key={`dup-model-${candidate.sourceId}-${candidate.targetId}`}
                      className={`rounded-xl border p-3 shadow-sm ${duplicateCandidateCardClass(candidate.confidence)}`}
                    >
                      <div className="flex flex-wrap items-start gap-2">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={Boolean(selectedDuplicateCandidateKeys[getDuplicateCandidateKey("model", candidate)])}
                            disabled={isBatchMergingDuplicates}
                            onChange={(e) => setDuplicateCandidateSelected("model", candidate, e.target.checked)}
                            aria-label={`选择 ${candidate.sourceName} 合并到 ${candidate.targetName}`}
                          />
                        </label>
                        <span className="font-semibold">
                          {candidate.sourceName} [{candidate.sourceId}] → {candidate.targetName} [{candidate.targetId}]
                        </span>
                        <span className={`badge badge-sm font-semibold ${duplicateConfidenceBadgeClass(candidate.confidence)}`}>
                          {duplicateConfidenceLabel(candidate.confidence)}
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline ml-auto"
                          onClick={() => applyModelDuplicateCandidate(candidate)}
                        >
                          填充到合并表单
                        </button>
                      </div>

                      <div className="mt-1 text-xs opacity-80">
                        {/* 提供方：{candidate.sourceProviderName} → {candidate.targetProviderName} */}
                        记录数：{candidate.sourceValueCount} → {candidate.targetValueCount}
                        ・相似度 {(candidate.similarity * 100).toFixed(1)}%
                        ・字符重复 {(candidate.characterRepeatScore * 100).toFixed(1)}%
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1">
                        {candidate.reasons.map((reason) => (
                          <span
                            key={`dup-model-reason-${candidate.sourceId}-${candidate.targetId}-${reason}`}
                            className="badge badge-outline badge-xs"
                          >
                            {duplicateReasonLabel(reason)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              visibleBenchmarkDuplicateCandidates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-base-300 p-3 text-sm opacity-70">
                  当前筛选条件下未检测到 benchmark 重复候选。
                </div>
              ) : (
                <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                  {visibleBenchmarkDuplicateCandidates.map((candidate) => (
                    <div
                      key={`dup-benchmark-${candidate.sourceId}-${candidate.targetId}`}
                      className={`rounded-xl border p-3 shadow-sm ${duplicateCandidateCardClass(candidate.confidence)}`}
                    >
                      <div className="flex flex-wrap items-start gap-2">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={Boolean(selectedDuplicateCandidateKeys[getDuplicateCandidateKey("benchmark", candidate)])}
                            disabled={isBatchMergingDuplicates}
                            onChange={(e) => setDuplicateCandidateSelected("benchmark", candidate, e.target.checked)}
                            aria-label={`选择 ${candidate.sourceName} 合并到 ${candidate.targetName}`}
                          />
                        </label>
                        <span className="font-semibold">
                          {candidate.sourceName} [{candidate.sourceType}] → {candidate.targetName} [{candidate.targetType}]
                        </span>
                        <span className={`badge badge-sm font-semibold ${duplicateConfidenceBadgeClass(candidate.confidence)}`}>
                          {duplicateConfidenceLabel(candidate.confidence)}
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline ml-auto"
                          onClick={() => applyBenchmarkDuplicateCandidate(candidate)}
                        >
                          填充到合并表单
                        </button>
                      </div>

                      <div className="mt-1 text-xs opacity-80">
                        记录数：{candidate.sourceValueCount} → {candidate.targetValueCount}
                        ・相似度 {(candidate.similarity * 100).toFixed(1)}%
                        ・字符重复 {(candidate.characterRepeatScore * 100).toFixed(1)}%
                        {candidate.sourceSourceSummary || candidate.targetSourceSummary
                          ? `・Source ${candidate.sourceSourceSummary ?? "空 source"} → ${candidate.targetSourceSummary ?? "空 source"}`
                          : ""}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1">
                        {candidate.reasons.map((reason) => (
                          <span
                            key={`dup-benchmark-reason-${candidate.sourceId}-${candidate.targetId}-${reason}`}
                            className="badge badge-outline badge-xs"
                          >
                            {duplicateReasonLabel(reason)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-base-300 p-3 text-sm opacity-75">
            点击“检测重复候选”后，会列出可疑的 model / benchmark，并支持一键填充到下方合并表单。
          </div>
        )}
      </div>

      <form onSubmit={onMerge} className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <div className="md:col-span-4">
          <select
            className="select select-bordered w-full"
            value={mergeType}
            onChange={(e) => {
              setMergeType(e.target.value as "model" | "benchmark");
              setMergeSourceInput("");
              setMergeTargetInput("");
              setMergeTargetBenchmarkNameInput("");
            }}
          >
            <option value="model">model</option>
            <option value="benchmark">benchmark</option>
          </select>
        </div>
        <div className="md:col-span-4">
          <input
            list={`merge-options-${mergeType}`}
            className="input input-bordered w-full"
            value={mergeSourceInput}
            onChange={(e) => setMergeSourceInput(e.target.value)}
            placeholder="source：输入名称或ID"
            required
          />
        </div>
        <div className="md:col-span-4">
          <input
            list={`merge-options-${mergeType}`}
            className="input input-bordered w-full"
            value={mergeTargetInput}
            onChange={(e) => setMergeTargetInput(e.target.value)}
            placeholder="target：输入名称或ID"
            required
          />
          <datalist id={`merge-options-${mergeType}`}>
            {mergeEntityOptions.map((item) => (
              <option key={`${mergeType}-${item.id}`} value={`${item.label} [${item.id}]`} />
            ))}
          </datalist>
        </div>
        <div className="md:col-span-12 flex flex-wrap items-center gap-2 text-xs">
          <span className="opacity-75">解析结果：source = {resolvedMergeSourceId ?? "-"}，target = {resolvedMergeTargetId ?? "-"}</span>
          {shouldRenderBenchmarkValueOverlapBadge ? (
            <span
              className={`badge badge-xs ${benchmarkValueOverlapBadgeClass}`}
              style={isLoadingBenchmarkValueOverlap ? undefined : { color: "#0f172a" }}
            >
              相同值 = {isLoadingBenchmarkValueOverlap
                ? "计算中..."
                : `${benchmarkValueOverlapStats?.sameCount ?? 0} / ${benchmarkValueOverlapStats?.overlapCount ?? 0}`}
            </span>
          ) : null}
        </div>
        {mergeType === "benchmark" ? (
          <div className="md:col-span-8">
            <input
              className="input input-bordered w-full"
              value={mergeTargetBenchmarkNameInput}
              onChange={(e) => setMergeTargetBenchmarkNameInput(e.target.value)}
              placeholder="可选：合并时同时修改 target benchmark 显示名称"
            />
          </div>
        ) : null}
        <div className={mergeType === "benchmark" ? "md:col-span-4" : "md:col-span-12"}>
          <button
            ref={mergeSubmitButtonRef}
            type="submit"
            className={`btn ${mergeSubmitState === "success" ? "btn-success" : "btn-error"}`}
            disabled={!canSubmitMerge}
            style={{ scrollMarginBottom: "72px" }}
          >
            {mergeSubmitState === "submitting"
              ? "合并中..."
              : mergeSubmitState === "success"
                ? "已合并"
                : "合并实体"}
          </button>
        </div>
      </form>

      <h4 className="mt-6 mb-2 font-semibold">已有合并去重记录</h4>
      {mergedRecordList.length === 0 ? (
        <p className="text-sm opacity-70">暂无已合并记录</p>
      ) : (
        <div className="overflow-x-auto rounded-box border border-base-300">
          <table className="table table-zebra table-sm">
            <thead>
              <tr>
                <th>Type</th>
                <th>Source</th>
                <th>Target（可编辑）</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {mergedRecordList.map((record) => {
                const recordKey = `${record.entityType}:${record.sourceId}`;
                const inputValue = mergedRecordTargetInputs[recordKey] ?? `${record.targetName} [${record.targetId}]`;

                return (
                  <tr key={recordKey}>
                    <td>{record.entityType}</td>
                    <td>{record.sourceName} [{record.sourceId}]</td>
                    <td>
                      <input
                        list={`merge-edit-options-${record.entityType}`}
                        className="input input-bordered input-sm w-full min-w-[300px]"
                        value={inputValue}
                        onChange={(e) =>
                          setMergedRecordTargetInputs((prev) => ({
                            ...prev,
                            [recordKey]: e.target.value
                          }))
                        }
                        placeholder="输入名称或ID"
                      />
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-xs btn-outline"
                          onClick={() => onUpdateMergedRecord(record)}
                        >
                          保存修改
                        </button>
                        <button
                          type="button"
                          className="btn btn-xs btn-outline btn-error"
                          onClick={() => onDeleteMergedRecord(record)}
                        >
                          删除记录
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <datalist id="merge-edit-options-model">
        {modelEntityOptions.map((item) => (
          <option key={`merge-edit-model-${item.id}`} value={`${item.label} [${item.id}]`} />
        ))}
      </datalist>
      <datalist id="merge-edit-options-benchmark">
        {benchmarkEntityOptions.map((item) => (
          <option key={`merge-edit-benchmark-${item.id}`} value={`${item.label} [${item.id}]`} />
        ))}
      </datalist>
    </section>
  );
}
