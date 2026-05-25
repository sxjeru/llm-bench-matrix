import { formatTooltipTime } from "./formatters";
import { getMatrixCellDisplayValue } from "./scoring";
import type { MatrixCellEntry, OverallModelSummary } from "./types";

type CellTooltip = {
  x: number;
  y: number;
  entries: MatrixCellEntry[];
  note: string | null;
};

type OverallTooltip = {
  x: number;
  y: number;
  modelName: string;
  summary: OverallModelSummary;
};

type MatrixCellTooltipProps = {
  tooltip: CellTooltip | null;
};

type OverallScoreTooltipProps = {
  tooltip: OverallTooltip | null;
};

export function MatrixCellTooltip({ tooltip }: MatrixCellTooltipProps) {
  if (!tooltip) return null;

  return (
    <div
      className="pointer-events-none fixed z-[2600] w-[320px] max-w-[320px] rounded-xl border border-white/20 bg-slate-900/96 p-2 text-left text-[11px] font-medium text-slate-100 shadow-2xl backdrop-blur-lg"
      style={{
        left: tooltip.x,
        top: tooltip.y,
        transform: "translate(-50%, -100%)"
      }}
    >
      {tooltip.entries.length > 1 ? (
        <span className="mb-1 block text-[10px] text-slate-300">该单元格存在多条记录</span>
      ) : null}

      {tooltip.note ? (
        <span className="mb-1 block rounded-md bg-amber-400/10 px-2 py-1 text-[10px] text-amber-200">
          注释：{tooltip.note}
        </span>
      ) : null}

      <span className="block max-h-[65vh] space-y-1 overflow-auto">
        {tooltip.entries.map((entry) => (
          <span
            key={`${entry.valueRaw}-${entry.valueNote ?? ""}-${entry.source ?? "-"}-${entry.benchTime}`}
            className="block rounded-md bg-white/5 px-2 py-1 leading-4"
          >
            {getMatrixCellDisplayValue(entry.valueNum, entry.valueNum2, entry.valueRaw, entry.valueNote)}
            {entry.valueNote ? <span className="opacity-80"> · note: {entry.valueNote}</span> : null}
            <span className="opacity-80"> · {entry.source ?? "unknown-source"} · {formatTooltipTime(entry.benchTime)}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

export function OverallScoreTooltip({ tooltip }: OverallScoreTooltipProps) {
  if (!tooltip) return null;

  return (
    <div
      className="pointer-events-none fixed z-[2600] w-[320px] max-w-[320px] rounded-xl border border-white/20 bg-slate-900/96 p-2 text-left text-[11px] font-medium text-slate-100 shadow-2xl backdrop-blur-lg"
      style={{
        left: tooltip.x,
        top: tooltip.y,
        transform: "translate(-50%, -100%)"
      }}
    >
      <span className="mb-1 block text-[10px] text-slate-300">{tooltip.modelName} · 总评细节</span>

      <span className="block rounded-md bg-white/5 px-2 py-1 leading-4">
        原始总评分：{tooltip.summary.rawScore !== null ? `${tooltip.summary.rawScore.toFixed(1)}%` : "--"}
      </span>
      <span className="mt-1 block rounded-md bg-white/5 px-2 py-1 leading-4">
        原始名次：{tooltip.summary.rawRank !== null ? `No.${tooltip.summary.rawRank}` : "--"}
      </span>
      <span className="mt-1 block rounded-md bg-white/5 px-2 py-1 leading-4">
        覆盖率：{(tooltip.summary.coverage * 100).toFixed(1)}%
        （{tooltip.summary.coveredRows}/{tooltip.summary.totalRows}）
      </span>
      <span className="mt-1 block rounded-md bg-white/5 px-2 py-1 leading-4">
        修正后总评：{tooltip.summary.correctedScore !== null ? `${tooltip.summary.correctedScore.toFixed(1)}%` : "--"}
        （系数 {tooltip.summary.correctionFactor.toFixed(3)}）
      </span>
      <span className="mt-1 block rounded-md bg-white/5 px-2 py-1 leading-4">
        修正后名次：{tooltip.summary.correctedRank !== null ? `No.${tooltip.summary.correctedRank}` : "--"}
      </span>

      <span className="mt-1 block text-[10px] text-slate-300">注：表格主展示名次按原始总评分计算</span>
    </div>
  );
}
