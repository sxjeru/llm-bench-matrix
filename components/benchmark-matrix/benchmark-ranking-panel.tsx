import type { BenchmarkRankingData } from "./types";

type BenchmarkRankingPanelProps = {
  ranking: BenchmarkRankingData;
};

export function BenchmarkRankingPanel({ ranking }: BenchmarkRankingPanelProps) {
  const hasItems = ranking.items.length > 0;

  return (
    <div
      data-benchmark-ranking-panel={ranking.rowKey}
      className="w-full"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex min-w-[560px] flex-col gap-2 rounded-lg border border-slate-500/25 bg-slate-950/45 px-3 py-2 shadow-inner">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-100">
                {ranking.isPriceRow ? "Price ranking" : "Benchmark ranking"}
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
              {ranking.category} / {ranking.benchmark}
            </div>
          </div>
          <div className="shrink-0 text-xs font-medium text-slate-300">
            {ranking.rankedModelCount} ranked
            {ranking.missingModelCount > 0 ? (
              <span className="text-slate-500"> / {ranking.missingModelCount} missing</span>
            ) : null}
          </div>
        </div>

        {hasItems ? (
          <div className="max-h-[360px] overflow-y-auto pr-1">
            <div className="grid gap-1.5">
              {ranking.items.map((item) => {
                const isTop = item.rank === 1;
                const isSecond = item.rank === 2;

                return (
                  <div
                    key={`${ranking.rowKey}::ranking::${item.modelName}`}
                    data-ranking-model={item.modelName}
                    className="grid min-h-8 items-center gap-2 text-xs"
                    style={{
                      gridTemplateColumns: "42px minmax(150px, 260px) minmax(56px, 88px) minmax(180px, 1fr)"
                    }}
                  >
                    <div
                      className={`text-right tabular-nums ${isTop ? "font-extrabold text-amber-100" : "font-semibold text-slate-400"}`}
                    >
                      #{item.rank}
                    </div>
                    <div
                      className={`truncate ${isTop ? "font-extrabold text-slate-50" : item.isVisibleColumn ? "font-semibold text-slate-200" : "font-medium text-slate-500"}`}
                      title={item.modelName}
                    >
                      {item.modelName}
                    </div>
                    <div
                      className={`truncate text-right tabular-nums ${isTop ? "font-extrabold text-amber-100" : isSecond ? "font-bold text-slate-100 underline decoration-slate-400 underline-offset-2" : "font-semibold text-slate-300"}`}
                      title={item.displayValue}
                    >
                      {item.displayValue}
                    </div>
                    <div className="relative h-5 min-w-0 overflow-hidden rounded-md bg-slate-800/80">
                      <div
                        className={`absolute inset-y-0 left-0 rounded-md ${isTop ? "bg-amber-300/80" : isSecond ? "bg-cyan-300/70" : "bg-sky-400/55"}`}
                        style={{ width: `${item.barPercent}%` }}
                      />
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
