"use client";

import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { Search } from "lucide-react";
import { RENAME_LIST_ROW_HEIGHT, RENAME_LIST_VIEWPORT_HEIGHT } from "../constants";
import type { BenchmarkOption, ModelOption, ProviderOption, RenameEntityType, RenameSubmitState } from "../types";

type EntityOption = { id: number; label: string };

type RenameTabProps = {
  renameEntityType: RenameEntityType;
  resetRenameStateForEntityType: (nextEntityType: RenameEntityType) => void;
  renameSearchKeyword: string;
  updateRenameSearchKeyword: (nextKeyword: string) => void;
  filteredRenameEntityOptions: EntityOption[];
  renameListViewportRef: RefObject<HTMLDivElement | null>;
  setRenameListScrollTop: Dispatch<SetStateAction<number>>;
  renameListSpacerHeight: number;
  visibleRenameEntityOptions: EntityOption[];
  renameVirtualWindow: { start: number; end: number };
  renameSelectedEntityId: number | null;
  modelById: Map<number, ModelOption>;
  providerById: Map<number, ProviderOption>;
  benchmarkById: Map<number, BenchmarkOption>;
  sourceById: Map<number, string>;
  onPickRenameEntity: (entityId: number) => void;
  onRenameEntity: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  renameSelectedEntityLabel: string;
  renameNextName: string;
  setRenameNextName: Dispatch<SetStateAction<string>>;
  renameNextBenchmarkType: string;
  setRenameNextBenchmarkType: Dispatch<SetStateAction<string>>;
  renameNextProviderInput: string;
  setRenameNextProviderInput: Dispatch<SetStateAction<string>>;
  providerEntityOptions: EntityOption[];
  renameMergeOnConflict: boolean;
  setRenameMergeOnConflict: Dispatch<SetStateAction<boolean>>;
  renameSubmitState: RenameSubmitState;
};

export function RenameTab({
  renameEntityType,
  resetRenameStateForEntityType,
  renameSearchKeyword,
  updateRenameSearchKeyword,
  filteredRenameEntityOptions,
  renameListViewportRef,
  setRenameListScrollTop,
  renameListSpacerHeight,
  visibleRenameEntityOptions,
  renameVirtualWindow,
  renameSelectedEntityId,
  modelById,
  providerById,
  benchmarkById,
  sourceById,
  onPickRenameEntity,
  onRenameEntity,
  renameSelectedEntityLabel,
  renameNextName,
  setRenameNextName,
  renameNextBenchmarkType,
  setRenameNextBenchmarkType,
  renameNextProviderInput,
  setRenameNextProviderInput,
  providerEntityOptions,
  renameMergeOnConflict,
  setRenameMergeOnConflict,
  renameSubmitState
}: RenameTabProps) {
  const detailHeader = renameEntityType === "model"
    ? "Provider"
    : renameEntityType === "benchmark"
      ? "Type"
      : "类型";
  const nextNamePlaceholder = renameEntityType === "model"
    ? "输入新的 model 名称"
    : renameEntityType === "benchmark"
      ? "输入新的 benchmark 名称"
      : "输入新的 source 名称";

  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <Search size={18} />
        实体名称维护
      </h3>
      <p className="mb-3 text-sm opacity-80">
        支持搜索并更改已有 model 名称与 provider、benchmark 名称与 type，以及 source 名称。若命中重名冲突，可自动合并并保留当前选中实体。
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <div className="md:col-span-3">
          <select
            className="select select-bordered w-full"
            value={renameEntityType}
            onChange={(event) => resetRenameStateForEntityType(event.target.value as RenameEntityType)}
          >
            <option value="model">model</option>
            <option value="benchmark">benchmark</option>
            <option value="source">source</option>
          </select>
        </div>
        <div className="md:col-span-9">
          <input
            className="input input-bordered w-full"
            value={renameSearchKeyword}
            onChange={(event) => updateRenameSearchKeyword(event.target.value)}
            placeholder="输入名称或 ID 关键字搜索实体"
          />
        </div>
        <div className="md:col-span-12 text-xs opacity-70">
          匹配 {filteredRenameEntityOptions.length} 条（虚拟列表渲染）
        </div>
      </div>

      {filteredRenameEntityOptions.length > 0 ? (
        <div className="mt-3 rounded-box border border-base-300">
          <div className="grid grid-cols-[80px_minmax(0,1fr)_180px] border-b border-base-300 bg-base-100/60 px-1 py-2 text-xs font-semibold">
            <span className="px-2">ID</span>
            <span className="px-2">名称</span>
            <span className="px-2">{detailHeader}</span>
          </div>
          <div
            ref={renameListViewportRef}
            className="overflow-auto"
            style={{ height: `${RENAME_LIST_VIEWPORT_HEIGHT}px` }}
            onScroll={(event) => setRenameListScrollTop(event.currentTarget.scrollTop)}
          >
            <div className="relative" style={{ height: `${renameListSpacerHeight}px` }}>
              {visibleRenameEntityOptions.map((item, visibleIndex) => {
                const index = renameVirtualWindow.start + visibleIndex;
                const top = index * RENAME_LIST_ROW_HEIGHT;
                const isSelected = renameSelectedEntityId === item.id;
                const detailText = renameEntityType === "model"
                  ? (() => {
                      const model = modelById.get(item.id);
                      if (!model) return "-";
                      return providerById.get(model.providerId)?.config?.displayName?.trim() || providerById.get(model.providerId)?.name || "-";
                    })()
                  : renameEntityType === "benchmark"
                    ? (benchmarkById.get(item.id)?.benchmarkType ?? "-")
                    : (sourceById.get(item.id) ? "source" : "-");

                return (
                  <div
                    key={`rename-entity-${renameEntityType}-${item.id}`}
                    role="button"
                    tabIndex={0}
                    className={`absolute left-0 right-0 grid cursor-pointer grid-cols-[80px_minmax(0,1fr)_180px] items-center border-b px-1 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 ${
                      isSelected
                        ? "z-10 rounded-lg border border-primary/35 bg-primary/15 font-semibold text-base-content shadow-sm ring-1 ring-primary/25 before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-1 before:rounded-r-full before:bg-primary before:content-['']"
                        : "border-base-300/50 bg-transparent hover:bg-base-200/35"
                    }`}
                    style={{
                      top: `${top}px`,
                      height: `${RENAME_LIST_ROW_HEIGHT}px`
                    }}
                    onClick={() => onPickRenameEntity(item.id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onPickRenameEntity(item.id);
                    }}
                  >
                    <span className="truncate px-2 text-xs opacity-80">{item.id}</span>
                    <span className="truncate px-2 text-sm">{item.label}</span>
                    <span className="truncate px-2 text-xs opacity-80">{detailText}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm opacity-70">未匹配到实体，请调整关键词。</p>
      )}

      <form onSubmit={onRenameEntity} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
        <div className="md:col-span-4">
          <div className="mb-1 text-xs opacity-70">当前实体</div>
          <input
            className="input input-bordered w-full"
            value={renameSelectedEntityLabel}
            readOnly
            placeholder="请先在上方列表选中实体"
          />
        </div>
        <div className={renameEntityType === "benchmark" ? "md:col-span-3" : "md:col-span-4"}>
          <div className="mb-1 text-xs opacity-70">新名称</div>
          <input
            className="input input-bordered w-full"
            value={renameNextName}
            onChange={(event) => setRenameNextName(event.target.value)}
            placeholder={nextNamePlaceholder}
            required
          />
        </div>
        {renameEntityType === "benchmark" ? (
          <div className="md:col-span-2">
            <div className="mb-1 text-xs opacity-70">新 Type</div>
            <input
              className="input input-bordered w-full"
              value={renameNextBenchmarkType}
              onChange={(event) => setRenameNextBenchmarkType(event.target.value)}
              placeholder="输入新的 benchmark type"
              required
            />
          </div>
        ) : null}
        {renameEntityType === "model" && renameSelectedEntityId !== null ? (
          <div className="md:col-span-3">
            <div className="mb-1 text-xs opacity-70">Provider</div>
            <input
              list="rename-provider-options"
              className="input input-bordered w-full"
              value={renameNextProviderInput}
              onChange={(event) => setRenameNextProviderInput(event.target.value)}
              placeholder="输入或选择 provider"
              required
            />
            <datalist id="rename-provider-options">
              {providerEntityOptions.map((item) => (
                <option key={`rename-provider-${item.id}`} value={`${item.label} [${item.id}]`} />
              ))}
            </datalist>
          </div>
        ) : null}
        <div className={renameEntityType === "benchmark" ? "md:col-span-3 flex items-end" : "md:col-span-2 flex items-end"}>
          <label className="label cursor-pointer justify-start gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={renameMergeOnConflict}
              onChange={(event) => setRenameMergeOnConflict(event.target.checked)}
            />
            <span className="label-text text-xs">重名时自动合并</span>
          </label>
        </div>
        <div className="md:col-span-12 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className={`btn ${renameSubmitState === "success" ? "btn-success" : "btn-primary"}`}
            disabled={renameSubmitState === "submitting" || renameSelectedEntityId === null}
          >
            {renameSubmitState === "submitting"
              ? "提交中..."
              : renameSubmitState === "success"
                ? "已提交"
                : "保存名称变更"}
          </button>
          <span className="text-xs opacity-70">
            自动合并开启时：若命中重名冲突，会把冲突实体并入当前选中实体后再完成改名。
          </span>
        </div>
      </form>
    </section>
  );
}
