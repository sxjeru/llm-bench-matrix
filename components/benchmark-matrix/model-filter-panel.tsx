import { ChevronDown, ChevronUp, CircleHelp, Filter, Layers, Search, X } from "lucide-react";
import { resolveProviderBrandColorForDarkTheme } from "@/lib/provider-config";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { PROVIDER_MODEL_AUTO_COLLAPSE_LIMIT } from "./constants";
import type { ProviderGroup } from "./selectors";

const SEARCH_SYNTAX_HINTS = [
  {
    syntax: "!internal",
    label: "排除",
    description: "排除包含该词的行",
    color: "text-rose-400 bg-rose-500/10 border-rose-500/30 hover:border-rose-400/50 hover:bg-rose-500/20"
  },
  {
    syntax: "^GSM",
    label: "前缀",
    description: "以…开头",
    color: "text-amber-400 bg-amber-500/10 border-amber-500/30 hover:border-amber-400/50 hover:bg-amber-500/20"
  },
  {
    syntax: "500$",
    label: "后缀",
    description: "以…结尾",
    color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-400/50 hover:bg-emerald-500/20"
  },
  {
    syntax: "^GSM8K$",
    label: "精准",
    description: "完全匹配",
    color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30 hover:border-cyan-400/50 hover:bg-cyan-500/20"
  },
  {
    syntax: '"Math 500"',
    label: "短语",
    description: "连续短语",
    color: "text-indigo-300 bg-indigo-500/10 border-indigo-500/30 hover:border-indigo-400/50 hover:bg-indigo-500/20"
  },
  {
    syntax: "100\\$",
    label: "转义",
    description: "转义为字面量",
    color: "text-purple-300 bg-purple-500/10 border-purple-500/30 hover:border-purple-400/50 hover:bg-purple-500/20"
  }
] as const;

interface SearchSyntaxHelpProps {
  onSelectExample?: (syntax: string) => void;
}

/** 搜索语法帮助：常驻入口 + 轻量弹层，避免只能靠 hover title 发现语法。 */
function SearchSyntaxHelp({ onSelectExample }: SearchSyntaxHelpProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleApply = (syntax: string) => {
    onSelectExample?.(syntax);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn-xs h-6 min-h-0 gap-1 rounded-md px-2 text-[11px] font-normal transition-all ${
          isOpen
            ? "border border-sky-400/50 bg-sky-500/20 text-sky-200 shadow-[0_0_10px_rgba(56,189,248,0.2)]"
            : "btn-ghost border-transparent text-base-content/70 hover:bg-base-300/40 hover:text-base-content"
        }`}
        aria-label="查看搜索语法"
        aria-expanded={isOpen}
        aria-controls={isOpen ? "benchmark-search-syntax" : undefined}
        onClick={() => setIsOpen((open) => !open)}
      >
        <CircleHelp size={13} className={isOpen ? "text-sky-300" : "opacity-70"} aria-hidden="true" />
        语法
      </button>

      {isOpen ? (
        <div
          id="benchmark-search-syntax"
          role="dialog"
          aria-label="搜索语法"
          className="absolute right-0 top-full z-[100] mt-2.5 w-[310px] rounded-2xl border border-slate-700/90 bg-slate-900/98 p-3 text-slate-100 shadow-[0_16px_40px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.08)] backdrop-blur-xl"
        >
          {/* 指向触发按钮的箭头 */}
          <div className="absolute -top-1.5 right-3.5 h-3 w-3 rotate-45 border-l border-t border-slate-700/90 bg-slate-900" />

          {/* 标题栏 */}
          <div className="mb-2.5 flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-sky-500/15 text-sky-400">
                <CircleHelp size={13} />
              </span>
              <span className="text-xs font-semibold tracking-wide text-slate-200">搜索语法说明</span>
            </div>
            <button
              type="button"
              className="btn btn-xs btn-circle btn-ghost h-5 w-5 min-h-0 border-none p-0 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
              aria-label="关闭搜索语法"
              onClick={() => setIsOpen(false)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>

          {/* 语法规则列表 */}
          <ul className="space-y-1.5">
            {SEARCH_SYNTAX_HINTS.map((hint) => (
              <li
                key={hint.syntax}
                className="group flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 transition hover:bg-slate-800/50"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleApply(hint.syntax)}
                    className={`inline-flex min-w-[76px] shrink-0 items-center justify-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium transition ${hint.color}`}
                    title="点击填入搜索框"
                  >
                    {hint.syntax}
                  </button>
                  <span className="text-[11px] text-slate-300">{hint.description}</span>
                </div>
                <span className="rounded bg-slate-800/90 px-1 py-0.2 text-[9px] font-medium text-slate-400 group-hover:text-slate-200">
                  {hint.label}
                </span>
              </li>
            ))}
          </ul>

          {/* 提示与示例 */}
          <div className="mt-2.5 space-y-1.5 rounded-lg border border-slate-800/90 bg-slate-950/70 p-2 text-[10px] leading-relaxed text-slate-400">
            <div className="flex items-start gap-1">
              <span className="text-sky-400 shrink-0 font-bold">•</span>
              <div>
                空格分隔多个条件，需同时满足。示例：
                <button
                  type="button"
                  onClick={() => handleApply("^GSM !internal")}
                  className="ml-1 inline-flex items-center rounded border border-sky-500/30 bg-sky-950/60 px-1 py-0.2 font-mono text-[10px] text-sky-200 transition hover:border-sky-400 hover:bg-sky-900/60"
                  title="点击填入示例"
                >
                  ^GSM !internal
                </button>
              </div>
            </div>
            <div className="flex items-start gap-1 border-t border-slate-800/60 pt-1 text-slate-400">
              <span className="text-sky-400/80 shrink-0 font-bold">•</span>
              <div>
                排除符支持全角 <code className="font-mono text-slate-200">！</code>：
                <code className="font-mono text-slate-200">！internal</code> 等价于 <code className="font-mono text-slate-200">!internal</code>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type ModelFilterPanelProps = {
  isFullscreen: boolean;
  isModelFilterExpanded: boolean;
  setIsModelFilterExpanded: Dispatch<SetStateAction<boolean>>;
  selectedModelCount: number;
  allModelCount: number;
  selectAllModels: () => void;
  clearAllModels: () => void;
  restoreDefaultModelsForActiveSource: () => void;
  providerGroups: ProviderGroup[];
  selectedModelSet: Set<string>;
  providerAverageCoveragePercentMap: Map<string, number>;
  baseModelNameSet: Set<string>;
  modelCoveragePercentMap: Map<string, number>;
  providerDisplayNameBrandColorMap: Map<string, string | null>;
  expandedLowCoverageProviders: Record<string, boolean>;
  setExpandedLowCoverageProviders: Dispatch<SetStateAction<Record<string, boolean>>>;
  toggleProvider: (providerName: string, checked: boolean) => void;
  toggleModel: (modelName: string, checked: boolean) => void;
  benchmarkSearchInputValue: string;
  setBenchmarkSearchInputValue: (value: string) => void;
};

export function ModelFilterPanel({
  isFullscreen,
  isModelFilterExpanded,
  setIsModelFilterExpanded,
  selectedModelCount,
  allModelCount,
  selectAllModels,
  clearAllModels,
  restoreDefaultModelsForActiveSource,
  providerGroups,
  selectedModelSet,
  providerAverageCoveragePercentMap,
  baseModelNameSet,
  modelCoveragePercentMap,
  providerDisplayNameBrandColorMap,
  expandedLowCoverageProviders,
  setExpandedLowCoverageProviders,
  toggleProvider,
  toggleModel,
  benchmarkSearchInputValue,
  setBenchmarkSearchInputValue
}: ModelFilterPanelProps) {
  return (
    <div className={`${isFullscreen ? "mt-2" : ""} relative z-30 rounded-box border border-base-300/70 bg-base-200/35 p-3`} data-nosnippet>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <div className="flex items-center gap-2 opacity-80">
          <Layers size={14} />
          <span>模型层叠筛选：点击可展开具体模型列表</span>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            style={{ marginLeft: 4 }}
            onClick={() => setIsModelFilterExpanded((prev) => !prev)}
          >
            {isModelFilterExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {isModelFilterExpanded ? "收起模型筛选" : "展开模型筛选"}
          </button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="mr-2 flex items-center gap-0.5">
            <div className="relative flex items-center">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
              <input
                type="text"
                className="input input-xs input-bordered pl-7 pr-7 w-36 bg-base-100/50 transition-all focus:w-48"
                placeholder="筛选 Benchmark"
                title={'搜索语法：! / ！ 排除，^ 开头，$ 结尾，^x$ 完全匹配，"引号短语"，\\ 转义（如 100\\$）'}
                value={benchmarkSearchInputValue}
                onChange={(e) => setBenchmarkSearchInputValue(e.target.value)}
              />
              {benchmarkSearchInputValue && (
                <button
                  type="button"
                  aria-label="清除搜索"
                  className="btn btn-xs btn-circle btn-ghost absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 min-h-0 p-0 text-base-content/50 hover:text-base-content hover:bg-base-300/30 border-none"
                  onClick={() => setBenchmarkSearchInputValue("")}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <SearchSyntaxHelp onSelectExample={(syntax) => setBenchmarkSearchInputValue(syntax)} />
          </div>

          <div className="flex items-center gap-1 text-xs opacity-75">
            <Filter size={14} />
            已选模型 {selectedModelCount}/{allModelCount}
          </div>

          <button type="button" className="btn btn-xs btn-ghost" onClick={selectAllModels}>
            全选模型
          </button>
          <button type="button" className="btn btn-xs btn-ghost" onClick={clearAllModels}>
            清空模型
          </button>
          <button type="button" className="btn btn-xs btn-ghost" onClick={restoreDefaultModelsForActiveSource}>
            恢复默认
          </button>
        </div>
      </div>

      {isModelFilterExpanded ? (
        <div className={`grid grid-cols-1 gap-2 md:grid-cols-2 ${isFullscreen ? "xl:grid-cols-6" : "xl:grid-cols-4"}`}>
          {providerGroups.map((group) => {
            const selectedCount = group.models.filter((model) => selectedModelSet.has(model)).length;
            const providerChecked = selectedCount > 0 && selectedCount === group.models.length;
            const providerAverageCoverage = providerAverageCoveragePercentMap.get(group.providerName) ?? 0;
            const providerHasBaseModel = group.models.some((model) => baseModelNameSet.has(model));
            const baseOrderIndexByModel = new Map(group.models.map((model, index) => [model, index]));
            const modelsSortedByCoverage = [...group.models].sort((leftModel, rightModel) => {
              const leftCoverage = modelCoveragePercentMap.get(leftModel) ?? 0;
              const rightCoverage = modelCoveragePercentMap.get(rightModel) ?? 0;

              if (rightCoverage !== leftCoverage) {
                return rightCoverage - leftCoverage;
              }

              return (baseOrderIndexByModel.get(leftModel) ?? 0) - (baseOrderIndexByModel.get(rightModel) ?? 0);
            });
            const hasOverflowModels = modelsSortedByCoverage.length > PROVIDER_MODEL_AUTO_COLLAPSE_LIMIT;
            const leadingModels = hasOverflowModels
              ? modelsSortedByCoverage.slice(0, PROVIDER_MODEL_AUTO_COLLAPSE_LIMIT)
              : modelsSortedByCoverage;
            const trailingModels = hasOverflowModels
              ? modelsSortedByCoverage.slice(PROVIDER_MODEL_AUTO_COLLAPSE_LIMIT)
              : [];
            const isLowCoverageExpanded = expandedLowCoverageProviders[group.providerName] === true;
            const providerModelsToRender = hasOverflowModels
              ? [
                  ...leadingModels,
                  ...(isLowCoverageExpanded ? trailingModels : [])
                ]
              : modelsSortedByCoverage;
            const hiddenTrailingModelCount = hasOverflowModels && !isLowCoverageExpanded
              ? trailingModels.length
              : 0;

            return (
              <details
                key={group.providerName}
                className={`rounded-lg border bg-base-100/70 px-2 py-1 ${
                  providerHasBaseModel ? "border-base-300/70" : "border-dashed border-base-300/70"
                }`}
              >
                <summary className="flex list-none items-center justify-between gap-2 cursor-pointer py-1">
                  <label
                    className="inline-flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      aria-label={group.providerName}
                      checked={providerChecked}
                      aria-checked={providerChecked ? "true" : selectedCount > 0 ? "mixed" : "false"}
                      ref={(element) => {
                        if (!element) return;
                        element.indeterminate = selectedCount > 0 && selectedCount < group.models.length;
                      }}
                      onChange={(e) => toggleProvider(group.providerName, e.target.checked)}
                    />
                    <span className="text-sm font-medium" style={{ color: resolveProviderBrandColorForDarkTheme(group.providerName, providerDisplayNameBrandColorMap.get(group.providerName) ?? null) }}>
                      {group.providerName}
                      {providerHasBaseModel ? null : <span className="ml-1 text-[10px] opacity-70">(跨页签)</span>}
                    </span>
                  </label>
                  <span className="text-xs opacity-70">{selectedCount}/{group.models.length} · 覆盖率 {providerAverageCoverage}%</span>
                </summary>

                <div className="grid grid-cols-1 gap-1 pb-2 pt-1">
                  {providerModelsToRender.map((model) => {
                    const isBaseModel = baseModelNameSet.has(model);
                    const coveragePercent = modelCoveragePercentMap.get(model) ?? 0;
                    const coverageText = isBaseModel ? `${coveragePercent}%\u200b` : `${coveragePercent}%`;

                    return (
                      <label
                        key={`${group.providerName}-${model}`}
                        className={`inline-flex items-center gap-2 rounded-md px-1 py-0.5 text-xs ${
                          isBaseModel ? "" : "border border-dashed border-base-300/70 bg-base-200/25"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          aria-label={model}
                          checked={selectedModelSet.has(model)}
                          onChange={(e) => toggleModel(model, e.target.checked)}
                        />
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="truncate" title={model}>{model}</span>
                          {isBaseModel ? null : (
                            <span className="shrink-0 whitespace-nowrap rounded border border-dashed border-base-content/40 px-1 text-[10px] leading-none opacity-70">跨页签</span>
                          )}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-[10px] opacity-70">{coverageText}</span>
                      </label>
                    );
                  })}

                  {trailingModels.length > 0 ? (
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost h-7 min-h-0 justify-start px-1 text-[11px] opacity-80 hover:opacity-100"
                      onClick={() => {
                        setExpandedLowCoverageProviders((prev) => ({
                          ...prev,
                          [group.providerName]: !prev[group.providerName]
                        }));
                      }}
                    >
                      {isLowCoverageExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {isLowCoverageExpanded
                        ? `收起后续模型（${trailingModels.length}）`
                        : `展开后续模型（${hiddenTrailingModelCount}）`}
                    </button>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
