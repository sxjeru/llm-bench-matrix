"use client";

import type { Dispatch, SetStateAction } from "react";
import { DollarSign, RefreshCw, Save } from "lucide-react";
import type { ModelPricingRow, ModelPricingSyncResult } from "../types";

type PricingTabProps = {
  prices: ModelPricingRow[];
  loadingPrices: boolean;
  syncingPrices: boolean;
  savingPriceModelId: number | null;
  pricingSearchQuery: string;
  setPricingSearchQuery: Dispatch<SetStateAction<string>>;
  pricingStatusFilter: "all" | "matched" | "unmatched" | "manual" | "missing";
  setPricingStatusFilter: Dispatch<SetStateAction<"all" | "matched" | "unmatched" | "manual" | "missing">>;
  pricingDrafts: Record<number, ModelPricingDraft>;
  updatePricingDraft: (modelId: number, updater: (draft: ModelPricingDraft) => ModelPricingDraft) => void;
  onLoadPrices: () => void | Promise<void>;
  onSyncPrices: () => void | Promise<void>;
  onSavePrice: (modelId: number) => void | Promise<void>;
  syncResult: ModelPricingSyncResult | null;
};

export type ModelPricingDraft = {
  inputCost: string;
  outputCost: string;
  cacheReadCost: string;
  reasoningCost: string;
  cacheWriteCost: string;
  inputAudioCost: string;
  outputAudioCost: string;
  sourceProviderId: string;
  sourceProviderName: string;
  sourceModelId: string;
  sourceModelName: string;
  manualOverride: boolean;
  note: string;
};

function formatCost(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return `$${value.toFixed(value >= 10 ? 2 : 3).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function getStatusBadgeClass(status: ModelPricingRow["matchStatus"], manualOverride: boolean) {
  if (manualOverride || status === "manual") return "border-amber-400 text-amber-200";
  if (status === "matched") return "border-green-500 text-green-300";
  if (status === "ignored") return "border-base-content/30 text-base-content/60";
  return "border-red-500 text-red-300";
}

function getStatusLabel(status: ModelPricingRow["matchStatus"], manualOverride: boolean) {
  if (manualOverride || status === "manual") return "手动";
  if (status === "matched") return "已匹配";
  if (status === "ignored") return "忽略";
  return "未匹配";
}

function getDraftAwareStatus(price: ModelPricingRow, draft: ModelPricingDraft | undefined) {
  const manualOverride = draft?.manualOverride ?? price.manualOverride;
  if (manualOverride) return "manual";
  if (draft && price.matchStatus === "manual") return "matched";
  return price.matchStatus;
}

export function PricingTab({
  prices,
  loadingPrices,
  syncingPrices,
  savingPriceModelId,
  pricingSearchQuery,
  setPricingSearchQuery,
  pricingStatusFilter,
  setPricingStatusFilter,
  pricingDrafts,
  updatePricingDraft,
  onLoadPrices,
  onSyncPrices,
  onSavePrice,
  syncResult
}: PricingTabProps) {
  const filteredPrices = prices.filter((price) => {
    const draft = pricingDrafts[price.modelId];
    const draftAwareStatus = getDraftAwareStatus(price, draft);
    const query = pricingSearchQuery.trim().toLowerCase();
    const matchesQuery = !query
      || price.modelName.toLowerCase().includes(query)
      || price.providerName.toLowerCase().includes(query)
      || (price.sourceModelId ?? "").toLowerCase().includes(query)
      || (price.sourceProviderId ?? "").toLowerCase().includes(query);

    if (!matchesQuery) return false;
    if (pricingStatusFilter === "all") return true;
    if (pricingStatusFilter === "manual") return draftAwareStatus === "manual";
    if (pricingStatusFilter === "missing") {
      return price.inputCost === null || price.outputCost === null || price.cacheReadCost === null;
    }
    return draftAwareStatus === pricingStatusFilter;
  });

  const matchedCount = prices.filter((item) => item.matchStatus === "matched" || item.matchStatus === "manual").length;
  const missingCoreCount = prices.filter((item) => item.inputCost === null || item.outputCost === null || item.cacheReadCost === null).length;

  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <DollarSign size={18} />
          价格管理
        </h3>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-outline btn-sm" onClick={onLoadPrices} disabled={loadingPrices || syncingPrices}>
            <RefreshCw size={14} />
            刷新
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onSyncPrices} disabled={loadingPrices || syncingPrices}>
            {syncingPrices ? <span className="loading loading-spinner loading-xs" /> : <RefreshCw size={14} />}
            从 models.dev 同步
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="stats rounded-box border border-base-300 bg-base-200/40">
          <div className="stat py-3">
            <div className="stat-title text-xs">模型</div>
            <div className="stat-value text-xl">{prices.length}</div>
          </div>
        </div>
        <div className="stats rounded-box border border-base-300 bg-base-200/40">
          <div className="stat py-3">
            <div className="stat-title text-xs">已匹配</div>
            <div className="stat-value text-xl">{matchedCount}</div>
          </div>
        </div>
        <div className="stats rounded-box border border-base-300 bg-base-200/40">
          <div className="stat py-3">
            <div className="stat-title text-xs">核心价格缺失</div>
            <div className="stat-value text-xl">{missingCoreCount}</div>
          </div>
        </div>
        <div className="stats rounded-box border border-base-300 bg-base-200/40">
          <div className="stat py-3">
            <div className="stat-title text-xs">最近同步</div>
            <div className="stat-value text-sm">{syncResult?.syncedAt ? new Date(syncResult.syncedAt).toLocaleString() : "--"}</div>
          </div>
        </div>
      </div>

      {syncResult ? (
        <div className="alert alert-info mb-4 text-sm">
          <span>
            同步完成：provider {syncResult.providerCount} 个，source model {syncResult.sourceModelCount} 个，匹配 {syncResult.matchedCount} 个，未匹配 {syncResult.unmatchedCount} 个，跳过手动覆盖 {syncResult.skippedManualCount} 个。
          </span>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
        <input
          className="input input-bordered w-full"
          value={pricingSearchQuery}
          onChange={(event) => setPricingSearchQuery(event.target.value)}
          placeholder="搜索模型、Provider 或 models.dev ID"
        />
        <select
          className="select select-bordered w-full"
          value={pricingStatusFilter}
          onChange={(event) => setPricingStatusFilter(event.target.value as typeof pricingStatusFilter)}
        >
          <option value="all">全部</option>
          <option value="matched">已匹配</option>
          <option value="unmatched">未匹配</option>
          <option value="manual">手动覆盖</option>
          <option value="missing">核心价格缺失</option>
        </select>
      </div>

      {loadingPrices ? (
        <div className="flex items-center gap-2 text-sm opacity-75">
          <span className="loading loading-spinner loading-sm" />
          正在加载价格…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-box border border-base-300">
          <table className="table table-zebra table-sm min-w-[1180px]">
            <thead>
              <tr>
                <th>模型</th>
                <th>models.dev</th>
                <th>Input</th>
                <th>Output</th>
                <th>Cache Input</th>
                <th>高级价格</th>
                <th>状态</th>
                <th className="min-w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredPrices.map((price) => {
                const draft = pricingDrafts[price.modelId];
                const isSaving = savingPriceModelId === price.modelId;
                if (!draft) return null;
                const draftAwareStatus = getDraftAwareStatus(price, draft);

                return (
                  <tr key={price.modelId}>
                    <td className="min-w-[220px]">
                      <div className="font-semibold">{price.modelName}</div>
                      <div className="text-xs opacity-60">{price.providerName}</div>
                    </td>
                    <td className="min-w-[220px]">
                      <input
                        className="input input-bordered input-xs mb-1 w-full"
                        value={draft.sourceProviderId}
                        onChange={(event) => updatePricingDraft(price.modelId, (current) => ({ ...current, sourceProviderId: event.target.value }))}
                        placeholder="provider id"
                      />
                      <input
                        className="input input-bordered input-xs w-full"
                        value={draft.sourceModelId}
                        onChange={(event) => updatePricingDraft(price.modelId, (current) => ({ ...current, sourceModelId: event.target.value }))}
                        placeholder="model id"
                      />
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-xs w-24"
                        value={draft.inputCost}
                        onChange={(event) => updatePricingDraft(price.modelId, (current) => ({ ...current, inputCost: event.target.value }))}
                        placeholder={formatCost(price.inputCost)}
                      />
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-xs w-24"
                        value={draft.outputCost}
                        onChange={(event) => updatePricingDraft(price.modelId, (current) => ({ ...current, outputCost: event.target.value }))}
                        placeholder={formatCost(price.outputCost)}
                      />
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-xs w-24"
                        value={draft.cacheReadCost}
                        onChange={(event) => updatePricingDraft(price.modelId, (current) => ({ ...current, cacheReadCost: event.target.value }))}
                        placeholder={formatCost(price.cacheReadCost)}
                      />
                    </td>
                    <td className="min-w-[220px]">
                      <div className="grid grid-cols-2 gap-1">
                        <input className="input input-bordered input-xs" value={draft.reasoningCost} onChange={(event) => updatePricingDraft(price.modelId, (current) => ({ ...current, reasoningCost: event.target.value }))} placeholder="reasoning" />
                        <input className="input input-bordered input-xs" value={draft.cacheWriteCost} onChange={(event) => updatePricingDraft(price.modelId, (current) => ({ ...current, cacheWriteCost: event.target.value }))} placeholder="cache write" />
                        <input className="input input-bordered input-xs" value={draft.inputAudioCost} onChange={(event) => updatePricingDraft(price.modelId, (current) => ({ ...current, inputAudioCost: event.target.value }))} placeholder="audio in" />
                        <input className="input input-bordered input-xs" value={draft.outputAudioCost} onChange={(event) => updatePricingDraft(price.modelId, (current) => ({ ...current, outputAudioCost: event.target.value }))} placeholder="audio out" />
                      </div>
                    </td>
                    <td>
                      <div className={`inline-flex h-6 items-center rounded-full border-2 bg-transparent px-3 text-xs font-semibold ${getStatusBadgeClass(draftAwareStatus, draft.manualOverride)}`}>
                        {getStatusLabel(draftAwareStatus, draft.manualOverride)}
                      </div>
                      <div className="mt-1 text-xs opacity-60">置信 {price.matchConfidence}</div>
                      <label className="label mt-1 cursor-pointer justify-start gap-2 p-0 text-xs">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={draft.manualOverride}
                          onChange={(event) => updatePricingDraft(price.modelId, (current) => ({ ...current, manualOverride: event.target.checked }))}
                        />
                        手动覆盖
                      </label>
                    </td>
                    <td className="min-w-20 whitespace-nowrap">
                      <button type="button" className="btn btn-primary btn-xs min-w-16 whitespace-nowrap px-3" onClick={() => onSavePrice(price.modelId)} disabled={isSaving}>
                        {isSaving ? <span className="loading loading-spinner loading-xs" /> : <Save size={12} />}
                        保存
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredPrices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm opacity-60">无匹配价格记录</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
