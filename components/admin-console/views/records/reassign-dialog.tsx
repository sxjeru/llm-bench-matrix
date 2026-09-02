"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Link2, Search, Trash2 } from "lucide-react";
import type {
  BenchmarkOption,
  ModelOption,
  ProviderOption,
  RecordConflictStrategy,
  RecordReassignTarget
} from "../../types";
import { sourceTabDisplayLabel } from "@/lib/source-utils";

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
  onDelete?: (target: RecordReassignTarget) => void;
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

type ReassignTargetOption = {
  id: number;
  label: string;
};

function ReassignTargetCombobox({
  ariaLabel,
  options,
  value,
  onChange
}: {
  ariaLabel: string;
  options: ReassignTargetOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = options.find((option) => String(option.id) === value);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(
    () =>
      options.filter((option) =>
        !normalizedQuery ? true : option.label.toLowerCase().includes(normalizedQuery)
      ),
    [options, normalizedQuery]
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const targetNode = event.target as Node | null;
      if (!targetNode || rootRef.current?.contains(targetNode)) return;
      setOpen(false);
      setQuery("");
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function selectOption(id: number) {
    onChange(String(id));
    close();
  }

  return (
    <div className="w-full" ref={rootRef}>
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 opacity-60" aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          className="input input-bordered input-sm w-full rounded-xl bg-base-200/50 pl-8 pr-8 focus:border-primary focus:bg-base-100 focus:outline-none"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          placeholder={selected?.label ?? "请选择目标实体…"}
          value={open ? query : selected?.label ?? ""}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        />
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 opacity-60" aria-hidden="true" />
      </div>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="mt-1 max-h-48 overflow-auto rounded-xl border border-base-300 bg-base-100 p-1 shadow-xl"
        >
          {filteredOptions.length === 0 ? (
            <li className="px-2 py-3 text-center text-xs opacity-60" role="presentation">
              没有匹配项
            </li>
          ) : (
            filteredOptions.map((option) => {
              const isSelected = String(option.id) === value;
              return (
                <li
                  key={option.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`cursor-pointer rounded-lg px-2.5 py-1.5 text-sm ${
                    isSelected ? "bg-primary/15 font-medium text-primary" : "hover:bg-base-200/70"
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option.id)}
                >
                  {option.label}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
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
  onSubmit,
  onDelete
}: RecordsReassignDialogProps) {
  const [mode, setMode] = useState<TargetMode>("existing");
  const [existingId, setExistingId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState(target.entityType === "benchmark" ? target.benchmarkType : "");
  const [newProviderName, setNewProviderName] = useState("");
  const [nextSource, setNextSource] = useState("");
  const [emptySource, setEmptySource] = useState(false);
  const [conflictStrategy, setConflictStrategy] = useState<RecordConflictStrategy>("keep-both");

  function handleDelete() {
    if (typeof window !== "undefined") {
      const noun = target.entityType === "benchmark" ? "行" : target.entityType === "model" ? "列" : "数据源";
      const confirmed = window.confirm(
        `确定要删除${noun}「${target.label}」在当前作用范围内的全部数据吗？此操作不可撤销。`
      );
      if (!confirmed) return;
    }
    onDelete?.(target);
  }

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
      ? `变更行归属：${target.label}`
      : target.entityType === "model"
        ? `变更列归属：${target.label}`
        : `变更 source 归属：${sourceTabDisplayLabel(target.label)}`;

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
      className="fixed inset-0 z-[170] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex w-full max-w-xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-base-300/80 bg-base-100 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-base-300/70">
          <h3 className="flex min-w-0 items-center gap-2 text-lg font-bold text-base-content">
            <Link2 size={18} className="shrink-0 text-primary" />
            <span className="min-w-0 break-words">{title}</span>
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
        <div className="mt-3 rounded-xl border border-base-300/70 bg-base-200/40 px-3.5 py-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 font-medium text-base-content">
              <span className="opacity-60">当前实体:</span>
              <span className="badge badge-sm max-w-full truncate border-primary/30 bg-primary/15 font-semibold text-primary">
                {target.entityType === "source" ? sourceTabDisplayLabel(target.label) : target.label}
              </span>
              {target.entityType === "model" && target.providerName ? (
                <span className="badge badge-sm badge-ghost text-base-content/70">
                  {target.providerName}
                </span>
              ) : null}
              {target.entityType === "benchmark" && target.benchmarkType ? (
                <span className="badge badge-sm badge-ghost text-base-content/70">
                  {target.benchmarkType}
                </span>
              ) : null}
            </div>
            <div className="text-base-content/60 text-[11px]">
              <span className="opacity-70">作用范围: </span>
              <span>{scopeDescription}</span>
            </div>
          </div>
        </div>

        {target.entityType === "source" ? (
          <div className="mt-4 space-y-3">
            <label className="form-control flex flex-col gap-1.5 w-full">
              <span className="label-text text-xs font-medium text-base-content/80">目标 Source</span>
              <input
                type="text"
                className="input input-bordered input-sm w-full rounded-xl bg-base-200/50 focus:bg-base-100 focus:border-primary focus:outline-none transition-colors"
                list="records-reassign-source-options"
                placeholder="例如 Seed2.0"
                aria-label="目标 source"
                value={nextSource}
                disabled={emptySource}
                onChange={(event) => setNextSource(event.target.value)}
              />
              <datalist id="records-reassign-source-options">
                {sourceOptions.map((source) => (
                  <option key={`reassign-source-${source}`} value={sourceTabDisplayLabel(source)} />
                ))}
              </datalist>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-base-content/90">
              <input
                type="checkbox"
                className="checkbox checkbox-primary checkbox-sm"
                checked={emptySource}
                onChange={(event) => setEmptySource(event.target.checked)}
              />
              <span>置为空 source</span>
            </label>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div role="tablist" className="flex w-fit items-center gap-1 rounded-xl border border-base-300/70 bg-base-200/80 p-1">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "existing"}
                className={`btn btn-xs border-0 rounded-lg font-medium transition-all ${
                  mode === "existing"
                    ? "bg-primary text-primary-content font-semibold shadow-sm"
                    : "bg-transparent text-base-content/70 hover:bg-base-100/70 hover:text-base-content"
                }`}
                onClick={() => setMode("existing")}
              >
                选择已有
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "new"}
                className={`btn btn-xs border-0 rounded-lg font-medium transition-all ${
                  mode === "new"
                    ? "bg-primary text-primary-content font-semibold shadow-sm"
                    : "bg-transparent text-base-content/70 hover:bg-base-100/70 hover:text-base-content"
                }`}
                onClick={() => setMode("new")}
              >
                新建
              </button>
            </div>

            {mode === "existing" ? (
              <div className="form-control flex w-full flex-col gap-1.5">
                <span className="label-text text-xs font-medium text-base-content/80">
                  {target.entityType === "benchmark" ? "目标 Benchmark" : "目标 Model"}
                </span>
                <ReassignTargetCombobox
                  ariaLabel={target.entityType === "benchmark" ? "目标 benchmark" : "目标 model"}
                  options={
                    target.entityType === "benchmark"
                      ? benchmarkOptions.map((benchmark) => ({
                          id: benchmark.id,
                          label: formatBenchmarkLabel(benchmark)
                        }))
                      : modelOptions.map((model) => ({
                          id: model.id,
                          label: model.modelName
                        }))
                  }
                  value={existingId}
                  onChange={setExistingId}
                />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="form-control flex flex-col gap-1.5 w-full">
                  <span className="label-text text-xs font-medium text-base-content/80">
                    {target.entityType === "benchmark" ? "新 Benchmark 名称" : "新 Model 名称"}
                  </span>
                  <input
                    type="text"
                    className="input input-bordered input-sm w-full rounded-xl bg-base-200/50 focus:bg-base-100 focus:border-primary focus:outline-none transition-colors"
                    aria-label={target.entityType === "benchmark" ? "新 benchmark 名称" : "新 model 名称"}
                    placeholder={target.entityType === "benchmark" ? "输入指标名称" : "输入模型名称"}
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                  />
                </label>
                {target.entityType === "benchmark" ? (
                  <label className="form-control flex flex-col gap-1.5 w-full">
                    <span className="label-text text-xs font-medium text-base-content/80">Benchmark 类别</span>
                    <input
                      type="text"
                      className="input input-bordered input-sm w-full rounded-xl bg-base-200/50 focus:bg-base-100 focus:border-primary focus:outline-none transition-colors"
                      aria-label="benchmark type"
                      placeholder="类别（如 General / Code）"
                      value={newType}
                      onChange={(event) => setNewType(event.target.value)}
                    />
                  </label>
                ) : (
                  <label className="form-control flex flex-col gap-1.5 w-full">
                    <span className="label-text text-xs font-medium text-base-content/80">厂商（留空沿用原厂商）</span>
                    <input
                      type="text"
                      className="input input-bordered input-sm w-full rounded-xl bg-base-200/50 focus:bg-base-100 focus:border-primary focus:outline-none transition-colors"
                      list="records-reassign-provider-options"
                      aria-label="厂商"
                      placeholder="输入或选择厂商"
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

            <fieldset className="rounded-xl border border-base-300/80 bg-base-200/30 p-3.5">
              <legend className="px-1.5 text-xs font-medium text-base-content/80">目标格已有数据时冲突策略</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {CONFLICT_STRATEGY_LABELS.map((option) => {
                  const isSelected = conflictStrategy === option.value;
                  return (
                    <label
                      key={`conflict-${option.value}`}
                      className={`flex min-w-0 cursor-pointer flex-col gap-1 rounded-xl border p-2.5 transition-all ${
                        isSelected
                          ? "border-primary/60 bg-primary/10 shadow-sm"
                          : "border-base-300/60 bg-base-200/40 hover:border-base-300 hover:bg-base-200/80"
                      }`}
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        <input
                          type="radio"
                          className="radio radio-primary radio-xs mt-0.5 shrink-0"
                          name="records-reassign-conflict"
                          checked={isSelected}
                          onChange={() => setConflictStrategy(option.value)}
                        />
                        <span className="min-w-0 text-xs font-semibold leading-snug break-words text-base-content">
                          {option.label}
                        </span>
                      </div>
                      <span className="min-w-0 pl-5 text-[11px] leading-snug break-words text-base-content/70">
                        {option.hint}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
        )}

        </div>

        <div className="mt-6 flex items-center justify-between gap-2.5 pt-3 border-t border-base-300/60">
          <div>
            {onDelete ? (
              <button
                type="button"
                className="btn btn-error btn-outline btn-sm rounded-xl font-semibold gap-1.5"
                disabled={busy}
                onClick={handleDelete}
              >
                <Trash2 size={14} />
                {target.entityType === "benchmark"
                  ? "删除该行"
                  : target.entityType === "model"
                    ? "删除该列"
                    : "删除数据源"}
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2.5">
            <button type="button" className="btn btn-ghost btn-sm rounded-xl" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm rounded-xl font-semibold px-4"
              disabled={!canSubmit || busy}
              onClick={handleSubmit}
            >
              {busy ? "处理中..." : "确认变更归属"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
