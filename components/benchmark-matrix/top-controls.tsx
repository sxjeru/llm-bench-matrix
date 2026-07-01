import {
  ChevronDown,
  Copy,
  Expand,
  Eye,
  EyeOff,
  ImageDown,
  Minimize2
} from "lucide-react";
import type { Dispatch, MouseEvent as ReactMouseEvent, RefObject, SetStateAction } from "react";
import {
  ALL_SOURCE_COLUMN_COVERAGE_THRESHOLD,
  ALL_SOURCE_ROW_COVERAGE_THRESHOLD,
  EXPORT_PRESET_MAP,
  SOURCE_ALL
} from "./constants";
import { isExportPresetKey } from "./export-image";
import type { ExportPresetKey } from "./types";
import type { SourceOption } from "./selectors";

type TopControlsProps = {
  sourceTabsMenuRef: RefObject<HTMLDivElement | null>;
  sourceTabsViewportRef: RefObject<HTMLDivElement | null>;
  sourceTabsMeasureRef: RefObject<HTMLDivElement | null>;
  sourceOptions: SourceOption[];
  visibleSourceOptions: SourceOption[];
  overflowSourceOptions: SourceOption[];
  overflowSourceMenuOptions: SourceOption[];
  promotedOverflowSourceKey: string | null;
  sourceNewStateByKey: Map<string, { updatedAtMs: number; isNew: boolean }>;
  activeSource: string;
  isSourceOverflowMenuOpen: boolean;
  setIsSourceOverflowMenuOpen: Dispatch<SetStateAction<boolean>>;
  setSourceAndUrl: (sourceKey: string) => void;
  getSourceTabDisplayText: (source: SourceOption) => string;
  getSourceTabTextColor: (source: SourceOption) => string | null;
  getSourceTabTitle: (source: SourceOption) => string;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  compareModelOrderLength: number;
  compareBaselineModelName: string | null;
  clearCompareSelection: () => void;
  exportMenuRef: RefObject<HTMLDivElement | null>;
  setIsExportMenuHovered: Dispatch<SetStateAction<boolean>>;
  setSuppressHoverMenu: Dispatch<SetStateAction<boolean>>;
  showExportMenu: boolean;
  isExportMenuOpen: boolean;
  setIsExportMenuOpen: Dispatch<SetStateAction<boolean>>;
  isImageActionBusy: boolean;
  downloadTableImage: () => void;
  copyTableImageToClipboard: () => void;
  isDownloadingTableImage: boolean;
  isCopyingTableImage: boolean;
  exportPreset: ExportPresetKey;
  setExportPreset: Dispatch<SetStateAction<ExportPresetKey>>;
  availableExportPresetKeys: ExportPresetKey[];
  exportIncludeFootnote: boolean;
  setExportIncludeFootnote: Dispatch<SetStateAction<boolean>>;
  hasFootnoteText: boolean;
  showCategory: boolean;
  setShowCategory: Dispatch<SetStateAction<boolean>>;
  showDuplicateRows: boolean;
  setShowDuplicateRows: Dispatch<SetStateAction<boolean>>;
  showLowCoverageRows: boolean;
  setShowLowCoverageRows: Dispatch<SetStateAction<boolean>>;
  showPriceRows: boolean;
  setShowPriceRows: Dispatch<SetStateAction<boolean>>;
  hasPriceData: boolean;
  hasSourceData: boolean;
  displaySourceValuesInCells: boolean;
  onSourceValuesButtonClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

function SourceTabLabel({
  text,
  textColor,
  isActive
}: {
  text: string;
  textColor: string | null;
  isActive: boolean;
}) {
  const [firstCharacter = "", ...restCharacters] = Array.from(text);
  const restText = restCharacters.join("");

  return (
    <span
      className="source-tab-label"
      data-label={text}
      style={!isActive && textColor ? { color: textColor } : undefined}
    >
      <span className={`source-tab-label-text ${isActive ? "font-bold" : "font-medium"}`}>
        {firstCharacter ? <span className="font-bold">{firstCharacter}</span> : null}
        {restText}
      </span>
    </span>
  );
}

export function BenchmarkMatrixTopControls({
  sourceTabsMenuRef,
  sourceTabsViewportRef,
  sourceTabsMeasureRef,
  sourceOptions,
  visibleSourceOptions,
  overflowSourceOptions,
  overflowSourceMenuOptions,
  promotedOverflowSourceKey,
  sourceNewStateByKey,
  activeSource,
  isSourceOverflowMenuOpen,
  setIsSourceOverflowMenuOpen,
  setSourceAndUrl,
  getSourceTabDisplayText,
  getSourceTabTextColor,
  getSourceTabTitle,
  isFullscreen,
  toggleFullscreen,
  compareModelOrderLength,
  compareBaselineModelName,
  clearCompareSelection,
  exportMenuRef,
  setIsExportMenuHovered,
  setSuppressHoverMenu,
  showExportMenu,
  isExportMenuOpen,
  setIsExportMenuOpen,
  isImageActionBusy,
  downloadTableImage,
  copyTableImageToClipboard,
  isDownloadingTableImage,
  isCopyingTableImage,
  exportPreset,
  setExportPreset,
  availableExportPresetKeys,
  exportIncludeFootnote,
  setExportIncludeFootnote,
  hasFootnoteText,
  showCategory,
  setShowCategory,
  showDuplicateRows,
  setShowDuplicateRows,
  showLowCoverageRows,
  setShowLowCoverageRows,
  showPriceRows,
  setShowPriceRows,
  hasPriceData,
  hasSourceData,
  displaySourceValuesInCells,
  onSourceValuesButtonClick
}: TopControlsProps) {
  const renderSourceTabLabel = (source: SourceOption) => (
    <SourceTabLabel
      text={getSourceTabDisplayText(source)}
      textColor={getSourceTabTextColor(source)}
      isActive={activeSource === source.key}
    />
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <div
          className="relative z-[70] min-w-0 flex-1"
          ref={sourceTabsMenuRef}
          onMouseLeave={() => setIsSourceOverflowMenuOpen(false)}
        >
          {/* 固定高度占位槽，防止下拉时撑开导致页面抖动：tab(36px) + p-0.5(4px) + border(2px) = 42px */}
          <div className="h-[42px] w-full" />

          <div ref={sourceTabsViewportRef} className="absolute left-0 top-0 w-full min-w-0" data-source-tabs-viewport="1">
            <div
              role="tablist"
              className="tabs tabs-boxed w-full overflow-hidden whitespace-nowrap rounded-2xl border border-white/10 bg-[radial-gradient(140%_180%_at_0%_0%,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0)_35%),radial-gradient(120%_160%_at_100%_100%,rgba(72,140,255,0.18)_0%,rgba(72,140,255,0)_42%),linear-gradient(135deg,rgba(21,36,64,0.58),rgba(14,24,43,0.38))] p-0.5 shadow-[0_10px_30px_rgba(2,8,20,0.24),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md"
            >
              <div className="flex min-w-0 items-center justify-between gap-1 w-full relative">
                <div className="flex flex-1 min-w-0 items-center overflow-hidden">
                  {visibleSourceOptions.map((source) => (
                    <button
                      key={source.key}
                      type="button"
                      role="tab"
                      aria-selected={activeSource === source.key}
                      className={`tab relative h-9 min-h-0 shrink-0 overflow-visible rounded-xl !pl-2 !pr-[9px] text-base-content/80 transition-all duration-150 ${
                        activeSource === source.key
                          ? "tab-active !rounded-xl !bg-primary/55 !text-primary-content shadow-[0_6px_20px_rgba(93,167,255,0.24)]"
                          : "hover:!rounded-xl hover:bg-white/10 hover:text-base-content"
                      }`}
                      onClick={() => setSourceAndUrl(source.key)}
                      title={getSourceTabTitle(source)}
                    >
                      {renderSourceTabLabel(source)}
                      {sourceNewStateByKey.get(source.key)?.isNew ? (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute right-[3px] top-[6px] h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_1px_rgba(6,78,59,0.75),0_0_8px_rgba(110,231,183,0.45)]"
                        />
                      ) : null}
                    </button>
                  ))}
                </div>

                {overflowSourceOptions.length > 0 ? (
                  <div className="absolute right-0 top-0 bottom-0 flex items-center bg-gradient-to-l from-[#19243a]/90 via-[#19243a]/80 to-transparent pl-4 pr-1">
                    <button
                      type="button"
                      className="tab h-9 min-h-0 w-7 shrink-0 !rounded-lg bg-transparent px-0 text-xs font-medium text-base-content/65 hover:bg-white/8 hover:text-base-content"
                      aria-label="展开溢出页签"
                      aria-controls="benchmark-matrix-source-tabs-overflow"
                      aria-expanded={isSourceOverflowMenuOpen}
                      onMouseEnter={() => setIsSourceOverflowMenuOpen(true)}
                      onFocus={() => setIsSourceOverflowMenuOpen(true)}
                      onClick={() => setIsSourceOverflowMenuOpen((prev) => !prev)}
                    >
                      <ChevronDown
                        size={14}
                        className={`transition-transform duration-150 ${isSourceOverflowMenuOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>
                ) : null}
              </div>

              {overflowSourceOptions.length > 0 ? (
                <div
                  id="benchmark-matrix-source-tabs-overflow"
                  aria-hidden={!isSourceOverflowMenuOpen}
                  onMouseEnter={() => setIsSourceOverflowMenuOpen(true)}
                  className={`grid transition-all duration-[180ms] ${
                    isSourceOverflowMenuOpen
                      ? "pointer-events-auto opacity-100"
                      : "pointer-events-none opacity-0"
                  }`}
                  style={{
                    gridTemplateRows: isSourceOverflowMenuOpen ? "1fr" : "0fr"
                  }}
                >
                  <div className="overflow-hidden border-t border-white/8 mt-0.5">
                    <div className="flex flex-wrap items-center gap-1 py-1">
                      {overflowSourceMenuOptions.map((source) => (
                        source.key === promotedOverflowSourceKey ? (
                          <span
                            key={`overflow-placeholder-${source.key}`}
                            aria-hidden="true"
                            data-source-tab-placeholder={source.key}
                            className="inline-flex h-9 items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] !pl-2 !pr-[9px] text-xs font-medium text-base-content/45"
                          >
                            <span>{getSourceTabDisplayText(source)}</span>
                          </span>
                        ) : (
                          <button
                            key={`overflow-${source.key}`}
                            type="button"
                            role="tab"
                            aria-selected={activeSource === source.key}
                            tabIndex={isSourceOverflowMenuOpen ? undefined : -1}
                            className={`tab relative h-9 min-h-0 overflow-visible rounded-xl !pl-2 !pr-[9px] text-base-content/80 transition-all duration-150 ${
                              activeSource === source.key
                                ? "tab-active !rounded-xl !bg-primary/55 !text-primary-content shadow-[0_6px_20px_rgba(93,167,255,0.24)]"
                                : "hover:!rounded-xl hover:bg-white/10 hover:text-base-content"
                            }`}
                            onClick={() => setSourceAndUrl(source.key)}
                            title={getSourceTabTitle(source)}
                          >
                            {renderSourceTabLabel(source)}
                            {sourceNewStateByKey.get(source.key)?.isNew ? (
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute right-[3px] top-[6px] h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_1px_rgba(6,78,59,0.75),0_0_8px_rgba(110,231,183,0.45)]"
                              />
                            ) : null}
                          </button>
                        )
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div
            ref={sourceTabsMeasureRef}
            aria-hidden="true"
            className="pointer-events-none absolute -left-[9999px] top-0 opacity-0"
          >
            <div className="tabs tabs-boxed whitespace-nowrap rounded-2xl border border-white/10 p-1">
              {sourceOptions.map((source) => (
                <button
                  key={`measure-${source.key}`}
                  type="button"
                  data-source-tab-measure="item"
                  data-source-tab-measure-key={source.key}
                  className={`tab relative h-9 min-h-0 shrink-0 overflow-visible rounded-xl !pl-2 !pr-[9px] text-base-content/80 transition-all duration-150 ${
                    activeSource === source.key
                      ? "tab-active !rounded-xl !bg-primary/55 !text-primary-content shadow-[0_6px_20px_rgba(93,167,255,0.24)]"
                      : "hover:!rounded-xl hover:bg-white/10 hover:text-base-content"
                  }`}
                >
                  {renderSourceTabLabel(source)}
                  {sourceNewStateByKey.get(source.key)?.isNew ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute right-[3px] top-[6px] h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_1px_rgba(6,78,59,0.75),0_0_8px_rgba(110,231,183,0.45)]"
                    />
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                data-source-tab-measure="more"
                className="tab h-9 min-h-0 w-7 shrink-0 !rounded-lg bg-transparent px-0 text-xs font-medium text-base-content/65"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-sm h-[42px] min-h-[42px] shrink-0 rounded-2xl border border-white/25 bg-[linear-gradient(135deg,rgba(24,38,66,0.32),rgba(14,24,43,0.2))] px-5 text-base-content/90 shadow-[0_8px_22px_rgba(2,8,20,0.22),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm hover:border-white/35 hover:bg-white/10"
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize2 size={15} /> : <Expand size={15} />}
          {isFullscreen ? "退出全屏" : "全屏显示表格"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 mt-4">
        <div className="mr-auto flex min-w-0 flex-wrap items-center gap-2 text-xs">
          {compareModelOrderLength > 0 ? (
            <>
              <span className="font-semibold text-amber-200">比较模式</span>
              <span className="opacity-80">
                基准：
                <span className="font-semibold text-amber-100">{compareBaselineModelName ?? "--"}</span>
              </span>
              <span className="opacity-75">已选 {compareModelOrderLength} 个模型</span>
              <button type="button" className="btn btn-xs btn-ghost h-7 min-h-0 px-2" onClick={clearCompareSelection}>
                清空比较
              </button>
            </>
          ) : (
            <span className="opacity-70">按住 Ctrl 点击模型表头，可选择并比较模型间差异</span>
          )}
        </div>

        <div
          className="relative"
          ref={exportMenuRef}
          onMouseEnter={() => setIsExportMenuHovered(true)}
          onMouseLeave={() => {
            setIsExportMenuHovered(false);
            setSuppressHoverMenu(false);
          }}
        >
          <div className="inline-flex h-8 items-center overflow-hidden rounded-lg border border-base-300/80 bg-base-100/55 shadow-sm">
            <button
              type="button"
              className="btn btn-sm btn-ghost h-8 gap-1 rounded-none border-0 px-1.5"
              aria-label="导出图片"
              onClick={downloadTableImage}
              disabled={isImageActionBusy}
            >
              <ImageDown size={15} />
              {isDownloadingTableImage ? "下载中..." : "导出图片"}
            </button>

            <span className="h-4 w-px bg-base-300/70" />

            <label className="inline-flex h-full items-center px-0">
              <select
                className="select select-ghost select-xs h-6 min-h-6 w-[82px] border-0 bg-base-200/45 px-0.5 pr-4 text-[11px] font-medium text-base-content shadow-none focus:bg-base-200/60 focus:outline-none"
                aria-label="导出规格"
                value={exportPreset}
                onChange={(event) => {
                  const next = event.target.value;
                  if (isExportPresetKey(next)) {
                    setExportPreset(next);
                  }
                }}
                disabled={isImageActionBusy}
              >
                {availableExportPresetKeys.map((key) => (
                  <option
                    key={key}
                    value={key}
                    style={{ backgroundColor: "#0f172a", color: "#e2e8f0" }}
                  >
                    {EXPORT_PRESET_MAP[key].label}
                  </option>
                ))}
              </select>
            </label>

            <span className="h-4 w-px bg-base-300/70" />

            <button
              type="button"
              className="btn btn-sm btn-ghost h-8 rounded-none border-0 px-1.5"
              aria-label="导出图片菜单"
              aria-haspopup="menu"
              aria-expanded={isExportMenuOpen}
              onClick={() => {
                setSuppressHoverMenu(false);
                setIsExportMenuOpen((prev) => !prev);
              }}
              disabled={isImageActionBusy}
            >
              <ChevronDown size={14} />
            </button>
          </div>

          <div
            role="menu"
            onMouseEnter={() => setIsExportMenuHovered(true)}
            className={`absolute right-0 top-full z-40 min-w-[170px] rounded-lg border border-base-300/80 bg-base-100/95 p-1 shadow-xl backdrop-blur transition-all duration-150 ${
              showExportMenu ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <button
              type="button"
              role="menuitem"
              className="btn btn-sm btn-ghost w-full justify-start"
              onClick={copyTableImageToClipboard}
              disabled={isImageActionBusy}
            >
              <Copy size={14} />
              {isCopyingTableImage ? "复制中..." : "复制到剪贴板"}
            </button>
            {hasFootnoteText && (
              <label className="label mt-1 cursor-pointer justify-start gap-2 px-3 hover:bg-base-200/50">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={exportIncludeFootnote}
                  onChange={(e) => setExportIncludeFootnote(e.target.checked)}
                />
                <span className="label-text text-xs">包含底部脚注</span>
              </label>
            )}
          </div>
        </div>

        <button
          type="button"
          className="btn btn-xs btn-ghost"
          onClick={() => setShowCategory((prev) => !prev)}
        >
          {showCategory ? <Eye size={14} /> : <EyeOff size={14} />}
          显示类别列
        </button>

        <button
          type="button"
          className="btn btn-xs btn-ghost"
          onClick={() => setShowDuplicateRows((prev) => !prev)}
        >
          {showDuplicateRows ? <Eye size={14} /> : <EyeOff size={14} />}
          显示重名行
        </button>

        {activeSource === SOURCE_ALL ? (
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            title={`隐藏时会过滤行覆盖率低于 ${ALL_SOURCE_ROW_COVERAGE_THRESHOLD * 100}% 的 benchmark 行，并基于保留行过滤列覆盖率低于 ${ALL_SOURCE_COLUMN_COVERAGE_THRESHOLD * 100}% 的模型列`}
            onClick={() => setShowLowCoverageRows((prev) => !prev)}
          >
            {showLowCoverageRows ? <Eye size={14} /> : <EyeOff size={14} />}
            {showLowCoverageRows ? "隐藏低覆盖行" : "显示低覆盖行"}
          </button>
        ) : null}

        {hasPriceData ? (
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={() => setShowPriceRows((prev) => !prev)}
          >
            {showPriceRows ? <Eye size={14} /> : <EyeOff size={14} />}
            显示价格
          </button>
        ) : null}

        {hasSourceData && activeSource !== SOURCE_ALL ? (
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            title="普通点击切换当前 source 值；按住 Ctrl 点击切换差值徽标"
            onClick={onSourceValuesButtonClick}
          >
            {displaySourceValuesInCells ? <Eye size={14} /> : <EyeOff size={14} />}
            显示原始值
          </button>
        ) : null}
      </div>
    </div>
  );
}
