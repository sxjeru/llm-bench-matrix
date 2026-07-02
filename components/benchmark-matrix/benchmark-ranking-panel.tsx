import { X } from "lucide-react";
import type { BenchmarkRankingData, BenchmarkRankingItem } from "./types";
import type { BenchmarkRankingScaleMode, BenchmarkRankingScope } from "./types";

type BenchmarkRankingPanelProps = {
  ranking: BenchmarkRankingData;
  scope: BenchmarkRankingScope;
  scaleMode: BenchmarkRankingScaleMode;
  placement: "above" | "below";
  showBoxPlot: boolean;
  onScopeChange: (scope: BenchmarkRankingScope) => void;
  onScaleModeChange: (mode: BenchmarkRankingScaleMode) => void;
  onShowBoxPlotChange: (show: boolean) => void;
  onClose: () => void;
  onHoverItem?: (rect: DOMRect | null, item: BenchmarkRankingItem | null) => void;
};

function formatRankingDisplayValue(value: string): string {
  return value
    .split("/")[0]
    ?.replace(/[*∗﹡✱✳✻]/g, "")
    .trim() || value.replace(/[*∗﹡✱✳✻]/g, "").trim();
}

export function BenchmarkRankingPanel({
  ranking,
  scope,
  scaleMode,
  placement,
  showBoxPlot,
  onScopeChange,
  onScaleModeChange,
  onShowBoxPlotChange,
  onClose,
  onHoverItem
}: BenchmarkRankingPanelProps) {
  const hasItems = ranking.items.length > 0;
  const scopeOptions: Array<{ value: BenchmarkRankingScope; label: string }> = [
    { value: "source", label: "本页" },
    { value: "all", label: "全部" }
  ];
  const scaleOptions: Array<{ value: BenchmarkRankingScaleMode; label: string }> = [
    { value: "relative", label: "相对" },
    { value: "fixed", label: "0-100" }
  ];

  return (
    <div
      data-benchmark-ranking-panel={ranking.rowKey}
      className="w-full"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="flex max-h-[min(72vh,720px)] w-full flex-col gap-2 rounded-lg border border-slate-500/35 bg-slate-950/95 px-3 py-2.5 shadow-2xl backdrop-blur"
        data-placement={placement}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-100" title={ranking.benchmark}>
                {ranking.benchmark}
              </span>
              {ranking.lowerIsBetter ? (
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-sky-200/35 text-[11px] font-bold text-sky-100"
                  title="Lower is better"
                >
                  ↓
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-400">
              {ranking.category}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              className={`ranking-popover-button h-8 rounded-md border border-slate-600/50 bg-slate-900/80 px-2 text-xs font-semibold transition ${
                showBoxPlot
                  ? "bg-sky-300/20 text-sky-100 border-sky-400/45"
                  : "text-slate-400 hover:text-slate-100 hover:border-slate-500/50"
              }`}
              onClick={() => onShowBoxPlotChange(!showBoxPlot)}
            >
              箱线图
            </button>
            <div className="inline-flex overflow-hidden rounded-md border border-slate-600/50 bg-slate-900/80 p-0.5">
              {scopeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`ranking-popover-button h-7 px-2.5 text-xs font-semibold transition ${
                    scope === option.value
                      ? "rounded bg-sky-300/20 text-sky-100"
                      : "text-slate-400 hover:text-slate-100"
                  }`}
                  onClick={() => onScopeChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="inline-flex overflow-hidden rounded-md border border-slate-600/50 bg-slate-900/80 p-0.5">
              {scaleOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`ranking-popover-button h-7 px-2.5 text-xs font-semibold transition ${
                    scaleMode === option.value
                      ? "rounded bg-cyan-300/20 text-cyan-100"
                      : "text-slate-400 hover:text-slate-100"
                  }`}
                  onClick={() => onScaleModeChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ranking-popover-button inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-600/50 bg-slate-900/80 text-slate-300 transition hover:text-slate-50"
              onClick={onClose}
              aria-label="关闭排行浮窗"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-slate-400">
          <span>
            {ranking.rankedModelCount} ranked
            {ranking.missingModelCount > 0 ? (
              <span className="text-slate-500"> / {ranking.missingModelCount} missing</span>
            ) : null}
          </span>
          <span>{ranking.scaleLabel}</span>
        </div>

        {hasItems ? (
          <div className="overflow-y-auto pr-1">
            <div className="grid gap-1">
              {ranking.items.map((item) => {
                const isTop = item.rank === 1;
                const isSecond = item.rank === 2;
                const displayValue = formatRankingDisplayValue(item.displayValue);

                return (
                  <div
                    key={`${ranking.rowKey}::ranking::${item.modelName}`}
                    data-ranking-model={item.modelName}
                    className="grid min-h-7 items-center gap-x-1 text-xs"
                    style={{
                      gridTemplateColumns: "24px minmax(104px, 170px) minmax(120px, 1fr) minmax(40px, 56px)"
                    }}
                  >
                    <div
                      className={`text-right tabular-nums ${isTop ? "font-extrabold text-amber-100" : "font-semibold text-slate-400"}`}
                    >
                      #{item.rank}
                    </div>
                    <div
                      className={`truncate pl-1.5 ${isTop ? "font-extrabold text-slate-50" : item.isVisibleColumn ? "font-semibold text-slate-200" : "font-normal text-slate-400"}`}
                      title={item.modelName}
                    >
                      {item.modelName}
                    </div>
                    <div
                      className={`relative h-[18px] min-w-0 rounded bg-slate-800/80 ${showBoxPlot && item.boxplot ? "cursor-help" : ""}`}
                      onMouseEnter={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        onHoverItem?.(rect, item);
                      }}
                      onMouseLeave={() => {
                        onHoverItem?.(null, null);
                      }}
                    >
                      {item.boxplot && showBoxPlot ? (
                        <>
                          {/* Background progress bar underneath (color is darker/subtler) */}
                          <div
                            className={`absolute inset-y-0 left-0 rounded ${isTop ? "bg-amber-300/35" : isSecond ? "bg-cyan-300/25" : "bg-sky-400/20"}`}
                            style={{ width: `${item.barPercent}%` }}
                          />
                          {/* BoxPlot on top */}
                          <div className="absolute inset-0 flex items-center px-1">
                            <div className="relative w-full h-[10px]">
                              {/* Whisker Line */}
                              <div
                                className="absolute top-1/2 h-[2px] -translate-y-1/2 bg-sky-400/50"
                                style={{
                                  left: `${item.boxplot.min}%`,
                                  right: `${100 - item.boxplot.max}%`
                                }}
                              />
                              {/* Left Whisker Cap */}
                              <div
                                className="absolute top-1/2 w-[1px] h-[6px] -translate-y-1/2 bg-sky-400/70"
                                style={{ left: `${item.boxplot.min}%` }}
                              />
                              {/* Right Whisker Cap */}
                              <div
                                className="absolute top-1/2 w-[1px] h-[6px] -translate-y-1/2 bg-sky-400/70"
                                style={{ left: `${item.boxplot.max}%` }}
                              />
                              {/* Box */}
                              <div
                                className={`absolute top-0 h-full border border-sky-400/80 ${isTop ? "bg-amber-300/40" : isSecond ? "bg-cyan-300/35" : "bg-sky-400/30"} rounded-sm`}
                                style={{
                                  left: `${item.boxplot.q1}%`,
                                  width: `${item.boxplot.q3 - item.boxplot.q1}%`
                                }}
                              />
                              {/* Median Line */}
                              <div
                                className="absolute top-0 w-[2px] h-full bg-white"
                                style={{ left: `${item.boxplot.median}%` }}
                              />
                              {/* Outliers */}
                              {item.boxplot.outliers.map((outlierPercent, idx) => (
                                <div
                                  key={idx}
                                  className="absolute top-1/2 w-[6px] h-[6px] rounded-full border border-sky-400 bg-slate-950"
                                  style={{
                                    left: `${outlierPercent}%`,
                                    transform: "translate(-50%, -50%)"
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div
                          className={`absolute inset-y-0 left-0 rounded ${isTop ? "bg-amber-300/80" : isSecond ? "bg-cyan-300/70" : "bg-sky-400/55"}`}
                          style={{ width: `${item.barPercent}%` }}
                        />
                      )}
                    </div>
                    <div
                      className={`truncate pr-2 text-right tabular-nums ${isTop ? "font-extrabold text-amber-100" : isSecond ? "font-bold text-slate-100 underline decoration-slate-400 underline-offset-2" : "font-semibold text-slate-300"}`}
                      title={item.displayValue}
                    >
                      {displayValue}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-slate-600/30 bg-slate-900/45 px-3 py-2 text-xs text-slate-400">
            No numeric values
          </div>
        )}
      </div>
    </div>
  );
}
