/* eslint-disable react-hooks/set-state-in-effect */
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { formatTooltipTime } from "./formatters";
import { getMatrixCellDisplayValue } from "./scoring";
import type { MatrixCellEntry, OverallModelSummary } from "./types";

export type CellTooltip = {
  x: number;
  y: number;
  entries: MatrixCellEntry[];
  note: string | null;
  targetHeight?: number;
};

export type OverallTooltip = {
  x: number;
  y: number;
  modelName: string;
  summary: OverallModelSummary;
  targetHeight?: number;
};

type MatrixCellTooltipProps = {
  tooltip: CellTooltip | null;
  onHoverChange?: (hovered: boolean) => void;
  onScrollableChange?: (scrollable: boolean) => void;
};

type OverallScoreTooltipProps = {
  tooltip: OverallTooltip | null;
};

const TOOLTIP_VIEWPORT_MARGIN = 8;

function clampTooltipTop(preferredTop: number, height: number, viewportHeight: number): number {
  const maxTop = Math.max(TOOLTIP_VIEWPORT_MARGIN, viewportHeight - height - TOOLTIP_VIEWPORT_MARGIN);
  return Math.min(Math.max(preferredTop, TOOLTIP_VIEWPORT_MARGIN), maxTop);
}

function getTooltipListMaxHeight(viewportHeight: number): number {
  return Math.max(96, viewportHeight - TOOLTIP_VIEWPORT_MARGIN * 2 - 48);
}

export function MatrixCellTooltip({ tooltip, onHoverChange, onScrollableChange }: MatrixCellTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLSpanElement>(null);
  const [adjustedTop, setAdjustedTop] = useState<number | null>(null);
  const [listMaxHeight, setListMaxHeight] = useState<number | null>(null);
  const [isListScrollable, setIsListScrollable] = useState(false);

  useLayoutEffect(() => {
    if (!tooltip) {
      setAdjustedTop(null);
      setListMaxHeight(null);
      setIsListScrollable(false);
      onScrollableChange?.(false);
      return;
    }

    const viewportHeight = window.innerHeight;
    const nextListMaxHeight = getTooltipListMaxHeight(viewportHeight);
    setListMaxHeight(nextListMaxHeight);

    if (listRef.current) {
      listRef.current.style.maxHeight = `${nextListMaxHeight}px`;
    }

    if (ref.current) {
      const height = Math.min(ref.current.offsetHeight, viewportHeight - TOOLTIP_VIEWPORT_MARGIN * 2);
      const spaceAbove = tooltip.y - TOOLTIP_VIEWPORT_MARGIN;
      const preferredTop = spaceAbove >= height
        ? tooltip.y - height
        : tooltip.y + 12 + (tooltip.targetHeight ?? 24);
      setAdjustedTop(clampTooltipTop(preferredTop, height, viewportHeight));
    }

    const list = listRef.current;
    const scrollable = Boolean(list && list.scrollHeight > list.clientHeight + 1);
    setIsListScrollable(scrollable);
    onScrollableChange?.(scrollable);
  }, [onScrollableChange, tooltip]);

  if (!tooltip) return null;

  return (
    <div
      ref={ref}
      data-cell-tooltip="1"
      data-cell-tooltip-scrollable={isListScrollable ? "1" : "0"}
      className={`${isListScrollable ? "pointer-events-auto" : "pointer-events-none"} fixed z-[2600] w-[320px] max-w-[320px] rounded-xl border border-white/20 bg-slate-900/80 p-2 text-left text-[11px] font-medium text-slate-100 shadow-2xl backdrop-blur-lg`}
      style={{
        left: tooltip.x,
        top: adjustedTop !== null ? adjustedTop : tooltip.y,
        maxHeight: `calc(100vh - ${TOOLTIP_VIEWPORT_MARGIN * 2}px)`
      }}
      onMouseEnter={() => {
        if (isListScrollable) onHoverChange?.(true);
      }}
      onMouseLeave={() => {
        if (isListScrollable) onHoverChange?.(false);
      }}
    >
      {tooltip.entries.length > 1 ? (
        <span className="mb-1 block text-[10px] text-slate-300">存在多条记录</span>
      ) : null}

      {tooltip.note ? (
        <span className="mb-1 block rounded-md bg-amber-400/10 px-2 py-1 text-[10px] text-amber-200">
          注释：{tooltip.note}
        </span>
      ) : null}

      <span
        ref={listRef}
        className="block space-y-1 overflow-auto"
        style={listMaxHeight !== null ? { maxHeight: listMaxHeight } : { maxHeight: "65vh" }}
      >
        {tooltip.entries.map((entry) => {
          const formattedTime = entry.benchTime ? formatTooltipTime(entry.benchTime) : null;

          return (
            <span
              key={`${entry.valueRaw}-${entry.valueNote ?? ""}-${entry.source ?? "-"}-${entry.benchTime ?? "no-time"}`}
              className="block rounded-md bg-white/5 px-2 py-1 leading-4"
            >
              {getMatrixCellDisplayValue(entry.valueNum, entry.valueNum2, entry.valueRaw, entry.valueNote)}
              {entry.valueNote ? <span className="opacity-80"> · note: {entry.valueNote}</span> : null}
              <span className="opacity-80">
                · {entry.source ?? "unknown-source"}
                {formattedTime ? ` · ${formattedTime}` : null}
              </span>
            </span>
          );
        })}
      </span>
    </div>
  );
}

export function OverallScoreTooltip({ tooltip }: OverallScoreTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [adjustedTop, setAdjustedTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!tooltip) {
      setAdjustedTop(null);
      return;
    }

    if (ref.current) {
      const height = ref.current.offsetHeight;
      const viewportHeight = window.innerHeight;
      const spaceAbove = tooltip.y - TOOLTIP_VIEWPORT_MARGIN;
      const preferredTop = spaceAbove >= height
        ? tooltip.y - height
        : tooltip.y + 12 + (tooltip.targetHeight ?? 24);
      setAdjustedTop(clampTooltipTop(preferredTop, height, viewportHeight));
    }
  }, [tooltip]);

  if (!tooltip) return null;

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed z-[2600] w-[320px] max-w-[320px] rounded-xl border border-white/20 bg-slate-900/80 p-2 text-left text-[11px] font-medium text-slate-100 shadow-2xl backdrop-blur-lg"
      style={{
        left: tooltip.x,
        top: adjustedTop !== null ? adjustedTop : tooltip.y,
        maxHeight: `calc(100vh - ${TOOLTIP_VIEWPORT_MARGIN * 2}px)`
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

export type CellTooltipHandle = {
  show: (tooltip: CellTooltip) => void;
  hide: () => void;
};

export type OverallTooltipHandle = {
  show: (tooltip: OverallTooltip) => void;
  hide: () => void;
};

type MatrixCellTooltipHostProps = {
  handleRef: RefObject<CellTooltipHandle | null>;
  onHoverChange?: (hovered: boolean) => void;
  onScrollableChange?: (scrollable: boolean) => void;
};

/**
 * 把 tooltip 的可见态关在自己的组件里。
 * 矩阵表格有上万个单元格，如果 hover 态存在父组件上，
 * 每次移动鼠标都会让整张表重新走一遍 render；这里只重渲染 tooltip 自身。
 */
export function MatrixCellTooltipHost({
  handleRef,
  onHoverChange,
  onScrollableChange
}: MatrixCellTooltipHostProps) {
  const [tooltip, setTooltip] = useState<CellTooltip | null>(null);

  useLayoutEffect(() => {
    handleRef.current = {
      show: (next) => setTooltip(next),
      hide: () => setTooltip(null)
    };

    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  return (
    <MatrixCellTooltip
      tooltip={tooltip}
      onHoverChange={onHoverChange}
      onScrollableChange={onScrollableChange}
    />
  );
}

type OverallScoreTooltipHostProps = {
  handleRef: RefObject<OverallTooltipHandle | null>;
};

/** 与 MatrixCellTooltipHost 同理：总评列 hover 不该牵动整张表 */
export function OverallScoreTooltipHost({ handleRef }: OverallScoreTooltipHostProps) {
  const [tooltip, setTooltip] = useState<OverallTooltip | null>(null);

  useLayoutEffect(() => {
    handleRef.current = {
      show: (next) => setTooltip(next),
      hide: () => setTooltip(null)
    };

    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  return <OverallScoreTooltip tooltip={tooltip} />;
}
