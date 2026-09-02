"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Filter, Search, X } from "lucide-react";
import type {
  ModelOption,
  BenchmarkOption,
  ProviderOption,
  RecordFilterState
} from "../../types";
import { getProviderDisplayNameById } from "../../utils/provider";
import { sourceTabDisplayLabel } from "@/lib/source-utils";

export type RecordFilterOption = {
  id: number;
  label: string;
  secondary?: string;
  group?: string;
};

type FilterMultiComboboxProps = {
  label: string;
  placeholder: string;
  options: RecordFilterOption[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
};

function useOutsideClose(onClose: () => void, active: boolean) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active || typeof document === "undefined") return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target)) return;
      onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [active, onClose]);

  return rootRef;
}

/** 带搜索与分组的多选下拉框，用于模型 / 指标筛选 */
export function FilterMultiCombobox({
  label,
  placeholder,
  options,
  selectedIds,
  onChange,
  disabled = false
}: FilterMultiComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useOutsideClose(() => setOpen(false), open);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      searchInputRef.current?.focus();
    }
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(
    () =>
      options.filter((option) => {
        if (!normalizedQuery) return true;
        return (
          option.label.toLowerCase().includes(normalizedQuery)
          || (option.secondary ?? "").toLowerCase().includes(normalizedQuery)
          || (option.group ?? "").toLowerCase().includes(normalizedQuery)
        );
      }),
    [options, normalizedQuery]
  );

  const groups = useMemo(() => {
    const byGroup = new Map<string, RecordFilterOption[]>();
    filteredOptions.forEach((option) => {
      const groupKey = option.group ?? "";
      const existing = byGroup.get(groupKey);
      if (existing) {
        existing.push(option);
        return;
      }
      byGroup.set(groupKey, [option]);
    });
    return Array.from(byGroup.entries());
  }, [filteredOptions]);

  const selectedSet = new Set(selectedIds);
  const summary =
    selectedIds.length === 0
      ? placeholder
      : selectedIds.length === 1
        ? options.find((option) => option.id === selectedIds[0])?.label ?? `已选 1 项`
        : `已选 ${selectedIds.length} 项`;

  function toggleOption(id: number) {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((item) => item !== id));
      return;
    }
    onChange([...selectedIds, id]);
  }

  return (
    <div className="relative min-w-0 flex-1" ref={rootRef}>
      <div className="mb-1 text-xs uppercase tracking-wide opacity-60">{label}</div>
      <button
        type="button"
        className="input input-bordered input-sm flex w-full cursor-pointer items-center justify-between gap-2 bg-base-100 text-left font-normal hover:border-primary/50"
        aria-expanded={open}
        aria-label={`${label}筛选`}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={`truncate ${selectedIds.length === 0 ? "opacity-60" : ""}`}>{summary}</span>
        <ChevronDown size={14} className="shrink-0 opacity-60" aria-hidden="true" />
      </button>

      {selectedIds.length > 0 ? (
        <button
          type="button"
          className="btn btn-ghost btn-xs absolute right-7 top-[26px]"
          aria-label={`清空${label}筛选`}
          onClick={() => onChange([])}
        >
          <X size={12} />
        </button>
      ) : null}

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-[min(90vw,360px)] rounded-xl border border-base-300 bg-base-100 p-2 shadow-xl">
          <label className="input input-bordered input-sm mb-2 flex items-center gap-2">
            <Search size={13} className="opacity-60" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="text"
              className="grow"
              placeholder={`搜索${label}…`}
              aria-label={`搜索${label}`}
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="max-h-64 space-y-2 overflow-auto">
            {groups.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs opacity-60">没有匹配项</div>
            ) : (
              groups.map(([groupKey, groupOptions]) => (
                <div key={`group-${groupKey || "default"}`}>
                  {groupKey ? (
                    <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide opacity-55">
                      {groupKey}
                    </div>
                  ) : null}
                  <div className="space-y-0.5">
                    {groupOptions.map((option) => (
                      <label
                        key={`option-${option.id}`}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-base-200/70"
                      >
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={selectedSet.has(option.id)}
                          onChange={() => toggleOption(option.id)}
                        />
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {option.secondary ? (
                          <span className="shrink-0 text-[11px] opacity-60">{option.secondary}</span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 border-t border-base-300/60 pt-2">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => onChange(filteredOptions.map((option) => option.id))}
            >
              全选当前结果
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => onChange([])}>
              清空
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type RecordsFiltersBarProps = {
  filters: RecordFilterState;
  onFiltersChange: (updater: (prev: RecordFilterState) => RecordFilterState) => void;
  sourceOptions: string[];
  providers: ProviderOption[];
  models: ModelOption[];
  benchmarks: BenchmarkOption[];
  availableModelIds?: number[] | null;
  availableBenchmarkIds?: number[] | null;
  disabled?: boolean;
};

export function RecordsFiltersBar({
  filters,
  onFiltersChange,
  sourceOptions,
  providers,
  models,
  benchmarks,
  availableModelIds,
  availableBenchmarkIds,
  disabled = false
}: RecordsFiltersBarProps) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");
  const sourceRootRef = useOutsideClose(() => setSourceOpen(false), sourceOpen);
  const sourceSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchDraft, setSearchDraft] = useState(filters.search);

  useEffect(() => {
    if (sourceOpen) {
      sourceSearchInputRef.current?.focus();
    }
  }, [sourceOpen]);

  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers]
  );

  const availableModelIdSet = useMemo(
    () => (availableModelIds ? new Set(availableModelIds) : null),
    [availableModelIds]
  );

  const availableBenchmarkIdSet = useMemo(
    () => (availableBenchmarkIds ? new Set(availableBenchmarkIds) : null),
    [availableBenchmarkIds]
  );

  const modelOptions = useMemo<RecordFilterOption[]>(
    () =>
      models
        .filter((model) => (availableModelIdSet ? availableModelIdSet.has(model.id) : true))
        .map((model) => ({
          id: model.id,
          label: model.modelName,
          group: getProviderDisplayNameById(model.providerId, providerById) ?? "未知厂商"
        })),
    [models, providerById, availableModelIdSet]
  );

  const benchmarkOptions = useMemo<RecordFilterOption[]>(
    () =>
      benchmarks
        .filter((benchmark) => (availableBenchmarkIdSet ? availableBenchmarkIdSet.has(benchmark.id) : true))
        .map((benchmark) => ({
          id: benchmark.id,
          label: benchmark.benchmarkName,
          secondary: benchmark.benchmarkType,
          group: benchmark.benchmarkType
        })),
    [benchmarks, availableBenchmarkIdSet]
  );

  const normalizedSourceQuery = sourceQuery.trim().toLowerCase();
  const filteredSourceOptions = sourceOptions.filter((source) => {
    if (!normalizedSourceQuery) return true;
    return (
      source.toLowerCase().includes(normalizedSourceQuery)
      || sourceTabDisplayLabel(source).toLowerCase().includes(normalizedSourceQuery)
    );
  });

  const sourceSummary =
    filters.sourceMode === "all"
      ? "全部 source"
      : filters.sourceMode === "empty"
        ? "无 source"
        : sourceTabDisplayLabel(filters.source ?? "") || "全部 source";

  function pickSource(mode: RecordFilterState["sourceMode"], source: string | null) {
    onFiltersChange((prev) => ({ ...prev, sourceMode: mode, source }));
    setSourceOpen(false);
  }

  return (
    <div className="rounded-2xl border border-base-300/70 bg-base-200/40 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="relative min-w-0 flex-1" ref={sourceRootRef}>
          <div className="mb-1 text-xs uppercase tracking-wide opacity-60">Source</div>
          <button
            type="button"
            className="input input-bordered input-sm flex w-full cursor-pointer items-center justify-between gap-2 bg-base-100 text-left font-normal hover:border-primary/50"
            aria-expanded={sourceOpen}
            aria-label="Source 筛选"
            disabled={disabled}
            onClick={() => setSourceOpen((prev) => !prev)}
          >
            <span className="truncate">{sourceSummary}</span>
            <ChevronDown size={14} className="shrink-0 opacity-60" aria-hidden="true" />
          </button>

          {sourceOpen ? (
            <div className="absolute left-0 top-full z-30 mt-1 w-[min(90vw,340px)] rounded-xl border border-base-300 bg-base-100 p-2 shadow-xl">
              <label className="input input-bordered input-sm mb-2 flex items-center gap-2">
                <Search size={13} className="opacity-60" aria-hidden="true" />
                <input
                  ref={sourceSearchInputRef}
                  type="text"
                  className="grow"
                  placeholder="搜索 source…"
                  aria-label="搜索 source"
                  autoFocus
                  value={sourceQuery}
                  onChange={(event) => setSourceQuery(event.target.value)}
                />
              </label>

              <div className="max-h-64 space-y-0.5 overflow-auto">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm h-auto min-h-0 w-full justify-start gap-2 px-2 py-1.5 font-normal"
                  onClick={() => pickSource("all", null)}
                >
                  {filters.sourceMode === "all" ? <Check size={13} className="text-primary" /> : <span className="w-[13px]" />}
                  全部 source
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm h-auto min-h-0 w-full justify-start gap-2 px-2 py-1.5 font-normal"
                  onClick={() => pickSource("empty", null)}
                >
                  {filters.sourceMode === "empty" ? <Check size={13} className="text-primary" /> : <span className="w-[13px]" />}
                  无 source
                </button>
                {filteredSourceOptions.map((source) => {
                  const displayLabel = sourceTabDisplayLabel(source);
                  return (
                    <button
                      key={`source-${source}`}
                      type="button"
                      className="btn btn-ghost btn-sm h-auto min-h-0 w-full justify-start gap-2 px-2 py-1.5 font-normal"
                      title={source !== displayLabel ? `${source}` : undefined}
                      onClick={() => pickSource("specific", source)}
                    >
                      {filters.sourceMode === "specific" && filters.source === source ? (
                        <Check size={13} className="text-primary" />
                      ) : (
                        <span className="w-[13px]" />
                      )}
                      <span className="truncate">{displayLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <FilterMultiCombobox
          label="模型"
          placeholder="全部模型"
          options={modelOptions}
          selectedIds={filters.modelIds}
          disabled={disabled}
          onChange={(ids) => onFiltersChange((prev) => ({ ...prev, modelIds: ids }))}
        />

        <FilterMultiCombobox
          label="指标"
          placeholder="全部指标"
          options={benchmarkOptions}
          selectedIds={filters.benchmarkIds}
          disabled={disabled}
          onChange={(ids) => onFiltersChange((prev) => ({ ...prev, benchmarkIds: ids }))}
        />

        <div className="min-w-0 flex-1">
          <div className="mb-1 text-xs uppercase tracking-wide opacity-60">关键字</div>
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              onFiltersChange((prev) => ({ ...prev, search: searchDraft }));
            }}
          >
            <label className="input input-bordered input-sm flex min-w-0 flex-1 items-center gap-2">
              <Filter size={13} className="opacity-60" aria-hidden="true" />
              <input
                type="text"
                className="grow"
                placeholder="模型 / 指标 / 厂商"
                aria-label="关键字快速搜索"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
              />
            </label>
            <button type="submit" className="btn btn-sm btn-outline" disabled={disabled}>
              搜索
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
