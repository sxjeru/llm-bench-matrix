"use client";

import type { Dispatch, SetStateAction } from "react";
import { Cpu, RefreshCw, Save, Wand2 } from "lucide-react";
import type { ModelParamsRow } from "../types";

export type ModelParamsDraft = {
  totalParamsB: string;
  activatedParamsB: string;
  isEstimated: boolean;
  note: string;
};

export type ModelParamsStatusFilter = "all" | "filled" | "missing" | "suggested";

type ParamsTabProps = {
  params: ModelParamsRow[];
  loadingParams: boolean;
  applyingSuggestions: boolean;
  savingParamsModelId: number | null;
  paramsSearchQuery: string;
  setParamsSearchQuery: Dispatch<SetStateAction<string>>;
  paramsStatusFilter: ModelParamsStatusFilter;
  setParamsStatusFilter: Dispatch<SetStateAction<ModelParamsStatusFilter>>;
  paramsDrafts: Record<number, ModelParamsDraft>;
  updateParamsDraft: (modelId: number, updater: (draft: ModelParamsDraft) => ModelParamsDraft) => void;
  onLoadParams: () => void | Promise<void>;
  onSaveParams: (modelId: number) => void | Promise<void>;
  onApplyAllSuggestions: () => void | Promise<void>;
  onApplySuggestion: (modelId: number) => void;
};

function formatParams(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${Number(value.toFixed(3)).toString()}B`;
}

function isParamsFilled(row: ModelParamsRow) {
  return row.totalParamsB !== null || row.activatedParamsB !== null;
}

/** 有可直接写入的建议，且当前尚未填写 */
function hasApplicableSuggestion(row: ModelParamsRow) {
  return !isParamsFilled(row) && row.suggestion?.totalParamsB != null;
}

function formatSuggestion(row: ModelParamsRow) {
  const suggestion = row.suggestion;
  if (!suggestion) return null;
  if (suggestion.totalParamsB === null) return suggestion.note;

  const total = formatParams(suggestion.totalParamsB);
  const text = suggestion.activatedParamsB !== null
    ? `${formatParams(suggestion.activatedParamsB)} / ${total}`
    : total;

  return suggestion.isEstimated ? `≈${text}` : text;
}

function getParamsSortTime(row: ModelParamsRow) {
  const parsed = Date.parse(row.modelCreatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function ParamsTab({
  params,
  loadingParams,
  applyingSuggestions,
  savingParamsModelId,
  paramsSearchQuery,
  setParamsSearchQuery,
  paramsStatusFilter,
  setParamsStatusFilter,
  paramsDrafts,
  updateParamsDraft,
  onLoadParams,
  onSaveParams,
  onApplyAllSuggestions,
  onApplySuggestion
}: ParamsTabProps) {
  const filteredParams = params
    .filter((row) => {
      const query = paramsSearchQuery.trim().toLowerCase();
      const matchesQuery = !query
        || row.modelName.toLowerCase().includes(query)
        || row.providerName.toLowerCase().includes(query);

      if (!matchesQuery) return false;
      if (paramsStatusFilter === "all") return true;
      if (paramsStatusFilter === "filled") return isParamsFilled(row);
      if (paramsStatusFilter === "missing") return !isParamsFilled(row);
      return hasApplicableSuggestion(row);
    })
    .sort((a, b) => getParamsSortTime(b) - getParamsSortTime(a));

  const filledCount = params.filter(isParamsFilled).length;
  const missingCount = params.length - filledCount;
  const suggestionCount = params.filter(hasApplicableSuggestion).length;

  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Cpu size={18} />
          模型参数量
        </h3>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={onLoadParams}
            disabled={loadingParams || applyingSuggestions}
          >
            <RefreshCw size={14} />
            刷新
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onApplyAllSuggestions}
            disabled={loadingParams || applyingSuggestions || suggestionCount === 0}
            title="仅填充当前为空的模型，不会覆盖已录入的值"
          >
            {applyingSuggestions ? <span className="loading loading-spinner loading-xs" /> : <Wand2 size={14} />}
            采纳全部建议（{suggestionCount}）
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="stats rounded-box border border-base-300 bg-base-200/40">
          <div className="stat py-3">
            <div className="stat-title text-xs">模型</div>
            <div className="stat-value text-xl">{params.length}</div>
          </div>
        </div>
        <div className="stats rounded-box border border-base-300 bg-base-200/40">
          <div className="stat py-3">
            <div className="stat-title text-xs">已填写</div>
            <div className="stat-value text-xl">{filledCount}</div>
          </div>
        </div>
        <div className="stats rounded-box border border-base-300 bg-base-200/40">
          <div className="stat py-3">
            <div className="stat-title text-xs">未填写</div>
            <div className="stat-value text-xl">{missingCount}</div>
          </div>
        </div>
        <div className="stats rounded-box border border-base-300 bg-base-200/40">
          <div className="stat py-3">
            <div className="stat-title text-xs">可采纳建议</div>
            <div className="stat-value text-xl">{suggestionCount}</div>
          </div>
        </div>
      </div>

      <div className="alert alert-info mb-4 text-sm">
        <span>
          总参数量必填才会在前台展示；激活参数量留空表示稠密模型，填写后按 MoE 展示为「激活 / 总量」。
          建议值由模型名推断（如 Qwen3-235B-A22B），仅供参考，采纳前请核对。
        </span>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
        <input
          className="input input-bordered w-full"
          value={paramsSearchQuery}
          onChange={(event) => setParamsSearchQuery(event.target.value)}
          placeholder="搜索模型或 Provider"
        />
        <select
          className="select select-bordered w-full"
          value={paramsStatusFilter}
          onChange={(event) => setParamsStatusFilter(event.target.value as ModelParamsStatusFilter)}
        >
          <option value="all">全部</option>
          <option value="filled">已填写</option>
          <option value="missing">未填写</option>
          <option value="suggested">有可采纳建议</option>
        </select>
      </div>

      {loadingParams ? (
        <div className="flex items-center gap-2 text-sm opacity-75">
          <span className="loading loading-spinner loading-sm" />
          正在加载参数量…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-box border border-base-300">
          <table className="table table-zebra table-sm min-w-[1080px]">
            <thead>
              <tr>
                <th>模型</th>
                <th>总参数量 (B)</th>
                <th>激活参数量 (B)</th>
                <th>估算</th>
                <th>备注</th>
                <th>名称解析建议</th>
                <th className="min-w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredParams.map((row) => {
                const draft = paramsDrafts[row.modelId];
                if (!draft) return null;
                const isSaving = savingParamsModelId === row.modelId;
                const suggestionText = formatSuggestion(row);

                return (
                  <tr key={row.modelId}>
                    <td className="min-w-[220px]">
                      <div className="font-semibold">{row.modelName}</div>
                      <div className="text-xs opacity-60">{row.providerName}</div>
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-xs w-24"
                        value={draft.totalParamsB}
                        onChange={(event) =>
                          updateParamsDraft(row.modelId, (current) => ({ ...current, totalParamsB: event.target.value }))
                        }
                        placeholder={formatParams(row.totalParamsB)}
                      />
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-xs w-24"
                        value={draft.activatedParamsB}
                        onChange={(event) =>
                          updateParamsDraft(row.modelId, (current) => ({ ...current, activatedParamsB: event.target.value }))
                        }
                        placeholder={row.activatedParamsB === null ? "稠密" : formatParams(row.activatedParamsB)}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs"
                        aria-label={`${row.modelName} 估算值`}
                        checked={draft.isEstimated}
                        onChange={(event) =>
                          updateParamsDraft(row.modelId, (current) => ({ ...current, isEstimated: event.target.checked }))
                        }
                      />
                    </td>
                    <td className="min-w-[180px]">
                      <input
                        className="input input-bordered input-xs w-full"
                        value={draft.note}
                        onChange={(event) =>
                          updateParamsDraft(row.modelId, (current) => ({ ...current, note: event.target.value }))
                        }
                        placeholder="来源或说明"
                      />
                    </td>
                    <td className="min-w-[160px]">
                      {suggestionText ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs opacity-75">{suggestionText}</span>
                          {row.suggestion?.totalParamsB != null ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => onApplySuggestion(row.modelId)}
                            >
                              填入
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs opacity-40">--</span>
                      )}
                    </td>
                    <td className="min-w-20 whitespace-nowrap">
                      <button
                        type="button"
                        className="btn btn-primary btn-xs min-w-16 whitespace-nowrap px-3"
                        onClick={() => onSaveParams(row.modelId)}
                        disabled={isSaving}
                      >
                        {isSaving ? <span className="loading loading-spinner loading-xs" /> : <Save size={12} />}
                        保存
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredParams.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm opacity-60">无匹配模型</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
