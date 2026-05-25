import { ChevronDown, ChevronUp, Filter, Layers } from "lucide-react";
import { resolveProviderBrandColor } from "@/lib/provider-config";
import type { Dispatch, SetStateAction } from "react";
import { PROVIDER_MODEL_AUTO_COLLAPSE_LIMIT } from "./constants";
import type { ProviderGroup } from "./selectors";

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
  toggleModel
}: ModelFilterPanelProps) {
  return (
    <div className={`${isFullscreen ? "mt-2" : ""} rounded-box border border-base-300/70 bg-base-200/35 p-3`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs opacity-80">
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

        <div className="ml-auto flex flex-wrap items-center gap-2 opacity-100">
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
                    <span className="text-sm font-medium" style={{ color: resolveProviderBrandColor(group.providerName, providerDisplayNameBrandColorMap.get(group.providerName) ?? null) }}>
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
