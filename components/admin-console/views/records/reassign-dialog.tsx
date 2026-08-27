"use client";

import { useMemo, useState } from "react";
import { Link2 } from "lucide-react";
import type {
  BenchmarkOption,
  ModelOption,
  ProviderOption,
  RecordConflictStrategy,
  RecordReassignTarget
} from "../../types";

type RecordsReassignDialogProps = {
  /** 父级只在需要时挂载本弹窗，并用 key 绑定当前实体，保证换目标时状态自然重置 */
  target: RecordReassignTarget;
  models: ModelOption[];
  benchmarks: BenchmarkOption[];
  providers: ProviderOption[];
  sourceOptions: string[];
  scopeDescription: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
};

type TargetMode = "existing" | "new";

const CONFLICT_STRATEGY_LABELS: Array<{ value: RecordConflictStrategy; label: string; hint: string }> = [
  { value: "skip", label: "跳过冲突", hint: "目标格已有数据时保留原处不动" },
  { value: "overwrite", label: "覆盖目标", hint: "删掉目标格已有记录后再迁入" },
  { value: "keep-both", label: "都保留", hint: "同一格允许出现多条记录" }
];

function formatBenchmarkLabel(benchmark: BenchmarkOption): string {
  return `${benchmark.benchmarkName} (${benchmark.benchmarkType})`;
}

/**
 * 列头 / 行头 / source 的归属变更弹窗。
 *
 * 三种实体共用一套「选已有 or 新建」+ 冲突策略的骨架：矩阵里点表头就是想把这一整列
 * （或一整行、一个 source）的数据挪到别的实体下，语义比逐格改值更强，所以走独立确认。
 */
export function RecordsReassignDialog({
  target,
  models,
  benchmarks,
  providers,
  sourceOptions,
  scopeDescription,
  busy,
  onClose,
  onSubmit
}: RecordsReassignDialogProps) {
  const [mode, setMode] = useState<TargetMode>("existing");
  const [existingId, setExistingId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState(target.entityType === "benchmark" ? target.benchmarkType : "");
  const [newProviderName, setNewProviderName] = useState("");
  const [nextSource, setNextSource] = useState("");
  const [emptySource, setEmptySource] = useState(false);
  const [conflictStrategy, setConflictStrategy] = useState<RecordConflictStrategy>("skip");

  const benchmarkOptions = useMemo(
    () =>
      benchmarks
        .filter((benchmark) => target.entityType !== "benchmark" || benchmark.id !== target.benchmarkId)
        .sort((left, right) => left.benchmarkName.localeCompare(right.benchmarkName)),
    [benchmarks, target]
  );

  const modelOptions = useMemo(
    () =>
      models
        .filter((model) => target.entityType !== "model" || model.id !== target.modelId)
        .sort((left, right) => left.modelName.localeCompare(right.modelName)),
    [models, target]
  );

  // 用局部 const 承接，hoisted 的 handleSubmit 闭包才能拿到判别联合的收窄结果
  const activeTarget = target;

  const title =
    target.entityType === "benchmark"
      ? `变更列归属：${target.label}`
      : target.entityType === "model"
        ? `变更行归属：${target.label}`
        : `变更 source 归属：${target.label}`;

  const canSubmit = (() => {
    if (target.entityType === "source") {
      return emptySource || nextSource.trim().length > 0;
    }
    return mode === "existing" ? existingId.trim().length > 0 : newName.trim().length > 0;
  })();

  function handleSubmit() {
    if (!canSubmit || busy) return;

    if (activeTarget.entityType === "benchmark") {
      onSubmit({
        entityType: "benchmark",
        fromBenchmarkId: activeTarget.benchmarkId,
        conflictStrategy,
        target:
          mode === "existing"
            ? { benchmarkId: Number.parseInt(existingId, 10) }
            : { benchmarkName: newName.trim(), benchmarkType: newType.trim() || activeTarget.benchmarkType }
      });
      return;
    }

    if (activeTarget.entityType === "model") {
      onSubmit({
        entityType: "model",
        fromModelId: activeTarget.modelId,
        conflictStrategy,
        target:
          mode === "existing"
            ? { modelId: Number.parseInt(existingId, 10) }
            : {
                modelName: newName.trim(),
                ...(newProviderName.trim() ? { providerName: newProviderName.trim() } : {})
              }
      });
      return;
    }

    onSubmit({
      entityType: "source",
      fromSource: activeTarget.source,
      toSource: emptySource ? null : nextSource.trim()
    });
  }

  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-base-300/80 bg-base-100/95 p-6 shadow-2xl backdrop-blur">
        <h3 className="flex items-center gap-2 text-lg font-bold">
          <Link2 size={17} />
          {title}
        </h3>
        <p className="mt-2 text-xs opacity-75">作用范围：{scopeDescription}</p>

        {target.entityType === "source" ? (
          <div className="mt-4 space-y-3">
            <label className="form-control">
              <span className="label-text text-xs opacity-70">目标 source</span>
              <input
                type="text"
                className="input input-bordered input-sm"
                list="records-reassign-source-options"
                placeholder="例如 text:Seed2.0"
                aria-label="目标 source"
                value={nextSource}
                disabled={emptySource}
                onChange={(event) => setNextSource(event.target.value)}
              />
              <datalist id="records-reassign-source-options">
                {sourceOptions.map((source) => (
                  <option key={`reassign-source-${source}`} value={source} />
                ))}
              </datalist>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={emptySource}
                onChange={(event) => setEmptySource(event.target.checked)}
              />
              置为空 source
            </label>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div role="tablist" className="tabs tabs-boxed tabs-sm w-fit">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "existing"}
                className={`tab ${mode === "existing" ? "tab-active" : ""}`}
                onClick={() => setMode("existing")}
              >
                选择已有
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "new"}
                className={`tab ${mode === "new" ? "tab-active" : ""}`}
                onClick={() => setMode("new")}
              >
                新建
              </button>
            </div>

            {mode === "existing" ? (
              <label className="form-control">
                <span className="label-text text-xs opacity-70">
                  {target.entityType === "benchmark" ? "目标 benchmark" : "目标 model"}
                </span>
                <select
                  className="select select-bordered select-sm"
                  aria-label={target.entityType === "benchmark" ? "目标 benchmark" : "目标 model"}
                  value={existingId}
                  onChange={(event) => setExistingId(event.target.value)}
                >
                  <option value="">请选择…</option>
                  {target.entityType === "benchmark"
                    ? benchmarkOptions.map((benchmark) => (
                        <option key={`reassign-bench-${benchmark.id}`} value={benchmark.id}>
                          {formatBenchmarkLabel(benchmark)}
                        </option>
                      ))
                    : modelOptions.map((model) => (
                        <option key={`reassign-model-${model.id}`} value={model.id}>
                          {model.modelName}
                        </option>
                      ))}
                </select>
              </label>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="form-control">
                  <span className="label-text text-xs opacity-70">
                    {target.entityType === "benchmark" ? "新 benchmark 名称" : "新 model 名称"}
                  </span>
                  <input
                    type="text"
                    className="input input-bordered input-sm"
                    aria-label={target.entityType === "benchmark" ? "新 benchmark 名称" : "新 model 名称"}
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                  />
                </label>
                {target.entityType === "benchmark" ? (
                  <label className="form-control">
                    <span className="label-text text-xs opacity-70">benchmark type</span>
                    <input
                      type="text"
                      className="input input-bordered input-sm"
                      aria-label="benchmark type"
                      value={newType}
                      onChange={(event) => setNewType(event.target.value)}
                    />
                  </label>
                ) : (
                  <label className="form-control">
                    <span className="label-text text-xs opacity-70">厂商（留空沿用原厂商）</span>
                    <input
                      type="text"
                      className="input input-bordered input-sm"
                      list="records-reassign-provider-options"
                      aria-label="厂商"
                      value={newProviderName}
                      onChange={(event) => setNewProviderName(event.target.value)}
                    />
                    <datalist id="records-reassign-provider-options">
                      {providers.map((provider) => (
                        <option key={`reassign-provider-${provider.id}`} value={provider.name} />
                      ))}
                    </datalist>
                  </label>
                )}
              </div>
            )}

            <fieldset className="rounded-xl border border-base-300/70 p-3">
              <legend className="px-1 text-xs opacity-70">目标格已有数据时</legend>
              <div className="flex flex-col gap-1">
                {CONFLICT_STRATEGY_LABELS.map((option) => (
                  <label
                    key={`conflict-${option.value}`}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="radio"
                      className="radio radio-sm"
                      name="records-reassign-conflict"
                      checked={conflictStrategy === option.value}
                      onChange={() => setConflictStrategy(option.value)}
                    />
                    <span>{option.label}</span>
                    <span className="text-xs opacity-60">{option.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!canSubmit || busy}
            onClick={handleSubmit}
          >
            {busy ? "处理中..." : "确认变更归属"}
          </button>
        </div>
      </div>
    </div>
  );
}
