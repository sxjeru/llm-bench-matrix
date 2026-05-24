"use client";

import type { ClipboardEvent, Dispatch, RefObject, SetStateAction } from "react";
import {
  Check,
  ChevronDown,
  Database,
  Layers,
  Merge as MergeIcon,
  Palette,
  PlusCircle,
  Search,
  Settings2,
  Trash2,
  X
} from "lucide-react";
import { isValidHexColor, resolveProviderBrandColor } from "@/lib/provider-config";
import type { ModelOption, ProviderConfigDraft, ProviderOption } from "../types";
import { createProviderPrefixRuleDraft, toProviderConfigDraft } from "../utils/provider";

type ProvidersTabProps = {
  providerSearchRef: RefObject<HTMLDivElement | null>;
  providerSearchOpen: boolean;
  setProviderSearchOpen: Dispatch<SetStateAction<boolean>>;
  providerSearchQuery: string;
  setProviderSearchQuery: Dispatch<SetStateAction<string>>;
  selectedProviderForConfig: ProviderOption | null;
  selectedProviderConfigId: number | null;
  setSelectedProviderConfigId: Dispatch<SetStateAction<number | null>>;
  providers: ProviderOption[];
  filteredProviderOptions: ProviderOption[];
  onCreateProviderFromSearch: () => void | Promise<void>;
  providerDropdownRef: RefObject<HTMLDivElement | null>;
  providerConfigDrafts: Record<number, ProviderConfigDraft>;
  savingProviderConfigId: number | null;
  deletingProviderId: number | null;
  models: ModelOption[];
  updateProviderDraft: (providerId: number, updater: (draft: ProviderConfigDraft) => ProviderConfigDraft) => void;
  openDeleteProviderConfirm: (providerId: number) => void;
  onSaveProviderConfig: (providerId: number) => void | Promise<void>;
  availableDisplayTargetProviders: ProviderOption[];
};

export function ProvidersTab({
  providerSearchRef,
  providerSearchOpen,
  setProviderSearchOpen,
  providerSearchQuery,
  setProviderSearchQuery,
  selectedProviderForConfig,
  selectedProviderConfigId,
  setSelectedProviderConfigId,
  providers,
  filteredProviderOptions,
  onCreateProviderFromSearch,
  providerDropdownRef,
  providerConfigDrafts,
  savingProviderConfigId,
  deletingProviderId,
  models,
  updateProviderDraft,
  openDeleteProviderConfirm,
  onSaveProviderConfig,
  availableDisplayTargetProviders
}: ProvidersTabProps) {
  return (
    <div className="space-y-5">
      {/* Provider search selector */}
      <section className="relative z-20 rounded-2xl border border-base-300/80 bg-base-100/95 p-5 shadow-md backdrop-blur">
        <div className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Settings2 size={18} className="opacity-70" />
          Provider
        </div>
        <div ref={providerSearchRef} className="relative w-full max-w-md">
          <div
            className={`flex items-center gap-2 rounded-xl border bg-base-200/60 px-3 py-2.5 transition-all duration-200 ${
              providerSearchOpen ? "border-primary/60 ring-2 ring-primary/20" : "border-base-300/80 hover:border-base-content/30"
            }`}
            onClick={() => setProviderSearchOpen(true)}
          >
            <Search size={15} className="shrink-0 opacity-50" />
            <input
              className="min-w-0 flex-1 border-none bg-transparent p-0 text-sm shadow-none outline-none focus:border-none focus:outline-none focus:ring-0 placeholder:text-base-content/40"
              style={{ border: 'none' }}
              value={providerSearchQuery}
              onChange={(e) => {
                setProviderSearchQuery(e.target.value);
                setProviderSearchOpen(true);
              }}
              onFocus={() => setProviderSearchOpen(true)}
              placeholder={selectedProviderForConfig ? `${selectedProviderForConfig.name} (${selectedProviderForConfig.slug})` : "搜索或输入新 Provider 名称\u2026"}
            />
            {selectedProviderConfigId !== null && !providerSearchQuery ? (
              <div
                role="button"
                className="shrink-0 cursor-pointer rounded-md p-0.5 opacity-50 transition-opacity hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); setSelectedProviderConfigId(null); setProviderSearchQuery(""); }}
              >
                <X size={14} />
              </div>
            ) : null}
            <ChevronDown size={15} className={`shrink-0 opacity-40 transition-transform duration-200 ${providerSearchOpen ? "rotate-180" : ""}`} />
          </div>

          {providerSearchOpen ? (() => {
            const trimmedQuery = providerSearchQuery.trim();
            const hasExactMatch = trimmedQuery.length > 0 && providers.some(
              (p) => p.name.toLowerCase() === trimmedQuery.toLowerCase() || p.slug.toLowerCase() === trimmedQuery.toLowerCase()
            );
            const showCreateOption = trimmedQuery.length > 0 && !hasExactMatch;

            return (
              <div ref={providerDropdownRef} className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-72 overflow-auto rounded-xl border border-base-300/80 bg-base-100 py-1 shadow-xl">
                {showCreateOption ? (
                  <div
                    role="button"
                    className="flex w-full cursor-pointer items-center gap-3 border-b border-base-300/50 px-4 py-2.5 text-left text-sm font-normal text-primary transition-colors hover:bg-primary/10"
                    onClick={onCreateProviderFromSearch}
                  >
                    <PlusCircle size={15} className="shrink-0" />
                    <span className="flex-1 truncate">
                      {"创建新 Provider："}
                      <span className="font-semibold">{trimmedQuery}</span>
                    </span>
                  </div>
                ) : null}
                {filteredProviderOptions.length === 0 && !showCreateOption ? (
                  <div className="px-4 py-6 text-center text-sm opacity-50">无匹配结果</div>
                ) : (
                  filteredProviderOptions.map((p) => {
                    const isActive = p.id === selectedProviderConfigId;
                    const pColor = resolveProviderBrandColor(p.name, p.config?.branding?.color);
                    const mergeTargetId = p.config?.displayTargetProviderId;
                    const mergeTargetProvider = typeof mergeTargetId === "number"
                      ? providers.find((tp) => tp.id === mergeTargetId)
                      : null;
                    return (
                      <div
                        key={`provider-search-${p.id}`}
                        role="button"
                        data-provider-active={isActive ? "true" : undefined}
                        className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm font-normal transition-colors ${
                          isActive
                            ? "bg-primary/10 font-medium text-primary"
                            : "hover:bg-base-200/70"
                        }`}
                        onClick={() => {
                          setSelectedProviderConfigId(p.id);
                          setProviderSearchQuery("");
                          setProviderSearchOpen(false);
                        }}
                      >
                        <span
                          className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
                          style={{ backgroundColor: pColor }}
                        />
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                          {p.name}
                          {mergeTargetProvider ? (
                            <span className="inline-flex items-center gap-0.5 rounded bg-base-200/80 px-1 py-0.5 text-[10px] font-normal opacity-60">
                              <MergeIcon size={10} className="shrink-0" />
                              {mergeTargetProvider.config?.displayName?.trim() || mergeTargetProvider.name}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 rounded-md bg-base-200/80 px-1.5 py-0.5 text-[11px] opacity-60">{p.slug}</span>
                        {isActive ? <Check size={14} className="shrink-0 text-primary" /> : null}
                      </div>
                    );
                  })
                )}
              </div>
            );
          })() : null}
        </div>
      </section>

      {/* Provider edit panel */}
      {selectedProviderForConfig ? (() => {
        const provider = selectedProviderForConfig;
        const draft = providerConfigDrafts[provider.id] ?? toProviderConfigDraft(provider);
        const previewDisplayName = draft.displayName.trim() || provider.name;
        const previewBrandColor = resolveProviderBrandColor(provider.name, draft.brandingColor);
        const isSaving = savingProviderConfigId === provider.id;
        const isDeleting = deletingProviderId === provider.id;
        const providerModels = models.filter((m) => m.providerId === provider.id);

        return (
          <section className="rounded-2xl border border-base-300/80 bg-base-100/95 shadow-md backdrop-blur">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 px-6 py-4">
              <div className="flex items-center gap-3">
                <span
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-white text-sm font-bold shadow-md transition-colors duration-300"
                  style={{ backgroundColor: previewBrandColor }}
                >
                  {previewDisplayName.charAt(0).toUpperCase()}
                </span>
                <div className="flex flex-col justify-center">
                  <div className="text-lg font-semibold leading-tight">{provider.name}</div>
                  <span className="mt-1 inline-block rounded-md bg-base-200/80 px-1.5 py-0.5 text-[11px] font-mono opacity-60 w-fit">{provider.slug}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm gap-1.5 rounded-xl border border-error/20 text-error shadow-sm hover:border-error/40 hover:bg-error/10 disabled:border-base-300 disabled:text-base-content/40"
                  onClick={() => openDeleteProviderConfirm(provider.id)}
                  disabled={isSaving || isDeleting}
                >
                  {isDeleting ? (
                    <><span className="loading loading-spinner loading-xs" /> 删除中…</>
                  ) : (
                    <><Trash2 size={14} /> 删除 Provider</>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm gap-1.5 rounded-xl shadow-sm"
                  onClick={() => onSaveProviderConfig(provider.id)}
                  disabled={isSaving || isDeleting}
                >
                  {isSaving ? (
                    <><span className="loading loading-spinner loading-xs" /> 保存中…</>
                  ) : (
                    <><Check size={14} /> 保存配置</>
                  )}
                </button>
              </div>
            </div>

            <div className="border-t border-base-300/50" />

            {/* Form fields — three-column row */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-6 py-5 lg:grid-cols-[1fr_1fr_280px] lg:items-end">
              {/* Display name */}
              <label className="form-control w-full">
                <span className="label-text mb-1.5 text-xs font-medium opacity-70">展示名</span>
                <input
                  className="input input-bordered w-full rounded-xl bg-base-200/40 transition-colors focus:bg-base-100 focus:border-primary focus:outline-none"
                  value={draft.displayName}
                  onChange={(e) =>
                    updateProviderDraft(provider.id, (current) => ({
                      ...current,
                      displayName: e.target.value
                    }))
                  }
                  placeholder={provider.name}
                />
              </label>

              {/* Brand color: picker + text */}
              <div className="form-control w-full">
                <span className="label-text mb-1.5 text-xs font-medium opacity-70">品牌色</span>
                <div className="flex items-center gap-2">
                  <label className="relative shrink-0 cursor-pointer">
                    <input
                      type="color"
                      className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                      value={isValidHexColor(draft.brandingColor) ? draft.brandingColor : previewBrandColor}
                      onClick={() => {
                        if (!draft.brandingColor) {
                          updateProviderDraft(provider.id, (current) => ({
                            ...current,
                            brandingColor: previewBrandColor
                          }));
                        }
                      }}
                      onChange={(e) =>
                        updateProviderDraft(provider.id, (current) => ({
                          ...current,
                          brandingColor: e.target.value
                        }))
                      }
                    />
                    <div
                      className="flex h-[2.75rem] w-[2.75rem] cursor-pointer items-center justify-center rounded-xl border border-base-300 shadow-sm transition-transform hover:scale-105 active:scale-95"
                      style={{ backgroundColor: previewBrandColor }}
                    >
                      <Palette size={16} className="text-white/80 drop-shadow-sm" />
                    </div>
                  </label>
                  <input
                    className="input input-bordered min-w-0 flex-1 rounded-xl font-mono text-sm uppercase bg-base-200/40 transition-colors focus:bg-base-100 focus:border-primary focus:outline-none"
                    value={draft.brandingColor}
                    onChange={(e) => {
                      let value = e.target.value;
                      // Auto-add # prefix: if user types/pastes a bare hex like "112233"
                      if (/^[0-9a-fA-F]{6}$/.test(value)) {
                        value = `#${value}`;
                      }
                      updateProviderDraft(provider.id, (current) => ({
                        ...current,
                        brandingColor: value
                      }));
                    }}
                    onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
                      const pasted = e.clipboardData.getData("text").trim();
                      if (/^[0-9a-fA-F]{6}$/.test(pasted)) {
                        e.preventDefault();
                        updateProviderDraft(provider.id, (current) => ({
                          ...current,
                          brandingColor: `#${pasted}`
                        }));
                      } else if (/^#[0-9a-fA-F]{6}$/.test(pasted)) {
                        e.preventDefault();
                        updateProviderDraft(provider.id, (current) => ({
                          ...current,
                          brandingColor: pasted
                        }));
                      }
                    }}
                    placeholder="#34D399"
                    maxLength={7}
                  />
                </div>
              </div>

              {/* Live preview */}
              <div className="form-control w-full">
                <span className="label-text mb-1.5 text-xs font-medium opacity-70">实时预览</span>
                <div
                  className="relative flex h-[2.75rem] items-center overflow-hidden rounded-xl border border-base-300/50 px-4"
                  style={{ background: `linear-gradient(135deg, ${previewBrandColor}14, ${previewBrandColor}06)` }}
                >
                  <div
                    className="absolute right-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full opacity-10 blur-lg transition-colors duration-500"
                    style={{ backgroundColor: previewBrandColor }}
                  />
                  <span className="relative z-10 truncate text-base font-bold tracking-tight transition-colors duration-200" style={{ color: previewBrandColor }}>
                    {previewDisplayName}
                  </span>
                  <span className="relative z-10 ml-auto flex shrink-0 items-center gap-1.5 pl-3 font-mono text-[11px] opacity-50">
                    <span
                      className="inline-block h-2 w-2 rounded-full transition-colors duration-200"
                      style={{ backgroundColor: previewBrandColor }}
                    />
                    {isValidHexColor(draft.brandingColor) ? draft.brandingColor.toLowerCase() : previewBrandColor.toLowerCase()}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-6 pb-5 lg:grid-cols-[minmax(280px,1fr)_1fr] lg:items-end">
              <label className="form-control w-full">
                <span className="label-text mb-1.5 text-xs font-medium opacity-70">归并到</span>
                <select
                  className="select select-bordered w-full rounded-xl bg-base-200/40 transition-colors focus:bg-base-100 focus:border-primary focus:outline-none"
                  value={draft.displayTargetProviderId ?? ""}
                  onChange={(e) =>
                    updateProviderDraft(provider.id, (current) => ({
                      ...current,
                      displayTargetProviderId: e.target.value ? Number(e.target.value) : null
                    }))
                  }
                >
                  <option value="">不归并，独立展示</option>
                  {availableDisplayTargetProviders.map((targetProvider) => (
                    <option key={`provider-display-target-${targetProvider.id}`} value={targetProvider.id}>
                      {targetProvider.config?.displayName?.trim() || targetProvider.name} ({targetProvider.slug})
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-xl border border-base-300/50 bg-base-200/25 px-4 py-3 text-sm leading-6 opacity-80">
                {draft.displayTargetProviderId
                  ? (() => {
                      const targetProvider = providers.find((item) => item.id === draft.displayTargetProviderId) ?? null;
                      const targetDisplayName = targetProvider?.config?.displayName?.trim() || targetProvider?.name;
                      return (
                        <>
                          <div className="font-medium">当前将归并展示到：{targetDisplayName}</div>
                          <div className="mt-1 text-xs opacity-70">仅影响前台展示分组、名称和品牌色，不修改已有模型所属 provider。</div>
                        </>
                      );
                    })()
                  : (
                    <>
                      <div className="font-medium">当前独立展示</div>
                      <div className="mt-1 text-xs opacity-70">适合保留该 provider 自己的名称、品牌色和分组。</div>
                    </>
                  )}
              </div>
            </div>

            <div className="border-t border-base-300/50" />

            {/* Prefix rules */}
            <div className="px-6 py-5">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Layers size={14} className="opacity-60" />
                  前缀规则
                </h4>
                <button
                  type="button"
                  className="btn btn-outline btn-sm gap-1 rounded-lg"
                  onClick={() =>
                    updateProviderDraft(provider.id, (current) => ({
                      ...current,
                      prefixRules: [...current.prefixRules, createProviderPrefixRuleDraft()]
                    }))
                  }
                >
                  <PlusCircle size={13} />
                  新增一条
                </button>
              </div>

              <div className="space-y-2">
                {draft.prefixRules.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-base-300/60 px-4 py-6 text-center text-sm opacity-50">
                    暂无前缀规则，点击上方「新增一条」添加
                  </div>
                ) : (
                  draft.prefixRules.map((rule, index) => (
                    <div key={rule.id} className="flex items-center gap-2 rounded-xl border border-base-300/50 bg-base-200/30 px-3 py-2 transition-colors hover:border-base-300">
                      <input
                        className="input input-bordered input-sm min-w-0 flex-1 rounded-lg bg-base-200/40 transition-colors focus:bg-base-100 focus:border-primary focus:outline-none"
                        value={rule.prefix}
                        onChange={(e) =>
                          updateProviderDraft(provider.id, (current) => ({
                            ...current,
                            prefixRules: current.prefixRules.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, prefix: e.target.value } : item
                            )
                          }))
                        }
                        placeholder="例如 gpt-"
                      />
                      <label className="label cursor-pointer gap-1.5">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm checkbox-primary"
                          checked={rule.enabled}
                          onChange={(e) =>
                            updateProviderDraft(provider.id, (current) => ({
                              ...current,
                              prefixRules: current.prefixRules.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, enabled: e.target.checked } : item
                              )
                            }))
                          }
                        />
                        <span className="label-text text-xs">启用</span>
                      </label>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-square rounded-lg text-error/70 hover:bg-error/10 hover:text-error"
                        onClick={() =>
                          updateProviderDraft(provider.id, (current) => ({
                            ...current,
                            prefixRules: current.prefixRules.filter((_, itemIndex) => itemIndex !== index)
                          }))
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="border-t border-base-300/50" />

            {/* Provider Models */}
            <div className="px-6 py-5">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Database size={14} className="opacity-60" />
                  包含模型 ({providerModels.length})
                </h4>
              </div>

              {providerModels.length === 0 ? (
                <div className="rounded-xl border border-dashed border-base-300/60 px-4 py-6 text-center text-sm opacity-50">
                  该 Provider 下暂无模型
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-base-300/50">
                  <table className="table table-sm table-zebra w-full">
                    <thead>
                      <tr className="bg-base-200/50 text-base-content/70">
                        <th className="font-medium">ID</th>
                        <th className="font-medium">模型名称</th>
                        <th className="font-medium">Canonical Key</th>
                      </tr>
                    </thead>
                    <tbody>
                      {providerModels.map(m => (
                        <tr key={m.id} className="border-base-300/50">
                          <td className="font-mono text-xs opacity-60 w-16">{m.id}</td>
                          <td className="font-medium">{m.modelName}</td>
                          <td className="font-mono text-xs opacity-70 break-all">{m.canonicalKey}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        );
      })() : (
        /* Empty state */
        <section className="rounded-2xl border border-dashed border-base-300/60 bg-base-100/60 p-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Palette size={28} className="text-primary/60" />
          </div>
          <h3 className="text-lg font-semibold opacity-80">{"选择一个 Provider 开始配置"}</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm opacity-50">
            {"在上方搜索框中输入 Provider 名称或 slug，选择后即可编辑展示名、品牌色和前缀规则。"}
          </p>
        </section>
      )}
    </div>
  );
}
