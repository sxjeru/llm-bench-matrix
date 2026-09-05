"use client";

import { useEffect, useRef, useState } from "react";
import { X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
  type XAxisTickContentProps
} from "recharts";
import { calculateVisibleTickIndices, type CellTrendData } from "./cell-trend";
import { formatComparisonDeltaValue, formatLocalDateLabel, formatValueNumForDisplay } from "./formatters";

export type CellTrendPanelProps = {
  trend: CellTrendData;
  placement: "above" | "below";
  onClose: () => void;
};

export function CellTrendPanel({ trend, placement, onClose }: CellTrendPanelProps) {
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  // 监听 ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // 容器尺寸测量（与现有 charts.tsx 一致的 ResizeObserver 显式尺寸模式）
  useEffect(() => {
    const node = chartHostRef.current;
    if (!node) return;

    const measure = () => {
      const nextWidth = Math.floor(node.getBoundingClientRect().width);
      setChartWidth((curr) => (curr === nextWidth ? curr : nextWidth));
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // 检查是否跨年份
  const firstYear = new Date(trend.firstPoint.timestamp).getFullYear();
  const lastYear = new Date(trend.latestPoint.timestamp).getFullYear();
  const spansMultipleYears = firstYear !== lastYear;

  const chartData = trend.points.map((point, index) => {
    const prev = index > 0 ? trend.points[index - 1] : null;
    const deltaFromPrev = prev ? point.score - prev.score : null;

    // 纯日期展示：同一年展示 MM-DD（仅5字符，占位极小，彻底避免重叠）；跨年展示 YY-MM-DD
    const rawDate = point.dateLabel ?? formatLocalDateLabel(new Date(point.timestamp).toISOString());
    let displayDate = rawDate;
    if (!spansMultipleYears && rawDate.length >= 10) {
      displayDate = rawDate.slice(5);
    } else if (rawDate.length >= 10) {
      displayDate = rawDate.slice(2);
    }

    return {
      index,
      xId: index,
      date: displayDate,
      fullDate: rawDate,
      time: point.timeLabel,
      fullTime: point.fullTime,
      score: point.score,
      raw: point.raw,
      note: point.note,
      deltaFromPrev
    };
  });

  // Y 轴范围动态计算：优先取整显示轴标签
  const scoreSpan = trend.maxScore - trend.minScore;
  const padding = scoreSpan > 0 ? scoreSpan * 0.15 : (trend.minScore !== 0 ? Math.abs(trend.minScore) * 0.1 : 1);
  const rawMin = trend.minScore >= 0 ? Math.max(0, trend.minScore - padding) : trend.minScore - padding;
  const rawMax = trend.maxScore + padding;

  // 当数值或跨度适合整型显示时，取整上下限并关闭小数刻度
  const isIntegerScale = scoreSpan >= 1 || trend.maxScore >= 5;
  const yMin = isIntegerScale ? Math.floor(rawMin) : Number(rawMin.toFixed(2));
  const calculatedYMax = isIntegerScale ? Math.ceil(rawMax) : Number(rawMax.toFixed(2));
  const yMax = calculatedYMax > yMin ? calculatedYMax : yMin + (isIntegerScale ? 1 : 0.01);

  // 涨跌判断
  const isPositiveDelta = trend.scoreDelta > 0.0001;
  const isNegativeDelta = trend.scoreDelta < -0.0001;
  const isGoodChange = trend.higherIsBetter ? isPositiveDelta : isNegativeDelta;
  const isBadChange = trend.higherIsBetter ? isNegativeDelta : isPositiveDelta;

  const deltaColorClass = isGoodChange
    ? "text-emerald-400"
    : isBadChange
      ? "text-rose-400"
      : "text-slate-400";

  const effectiveWidth = chartWidth > 0 ? chartWidth : 440;
  // 折线图绘图区宽度 = effectiveWidth - 左轴宽度(28) - 右边距(18)
  const plotWidth = Math.max(120, effectiveWidth - 46);
  const visibleTickIndices = calculateVisibleTickIndices(
    chartData.length,
    plotWidth,
    spansMultipleYears
  );

  return (
    <div
      data-cell-trend-panel={trend.benchmark}
      data-trend-model={trend.modelName}
      className="w-full"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="flex max-h-[min(78vh,720px)] w-full flex-col gap-2.5 rounded-lg border border-slate-500/35 bg-slate-950/95 p-3.5 shadow-2xl backdrop-blur"
        data-placement={placement}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-start justify-between gap-2 border-b border-slate-800/80 pb-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-bold text-slate-100" title={trend.benchmark}>
                {trend.benchmark}
              </span>
              <span className="text-slate-500">·</span>
              <span className="truncate text-sm font-semibold text-sky-200" title={trend.modelName}>
                {trend.modelName}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
              <span>分类: {trend.category}</span>
              <span className="text-slate-600">·</span>
              {trend.higherIsBetter ? (
                <span className="inline-flex items-center text-[11px] font-medium text-slate-400" title="Higher is better">
                  ↑ 越高越好
                </span>
              ) : (
                <span className="inline-flex items-center text-[11px] font-medium text-sky-400" title="Lower is better">
                  ↓ 越低越好
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            className="cell-trend-button ranking-popover-button inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-600/50 bg-slate-900/80 text-slate-300 transition hover:bg-slate-800 hover:text-slate-50"
            onClick={onClose}
            aria-label="关闭趋势浮窗"
          >
            <X size={15} />
          </button>
        </div>

        {/* 统计概览卡片 */}
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="flex flex-col justify-between rounded-md border border-slate-800 bg-slate-900/60 p-2">
            <div>
              <div className="text-[10px] text-slate-400">起始记录</div>
              <div className="truncate text-[10px] text-slate-500" title={trend.firstPoint.fullTime}>
                {trend.firstPoint.timeLabel}
              </div>
            </div>
            <div className="mt-1 text-sm font-bold text-slate-200">{trend.firstPoint.raw}</div>
          </div>
          <div className="flex flex-col justify-between rounded-md border border-slate-800 bg-slate-900/60 p-2">
            <div>
              <div className="text-[10px] text-slate-400">最新记录</div>
              <div className="truncate text-[10px] text-slate-500" title={trend.latestPoint.fullTime}>
                {trend.latestPoint.timeLabel}
              </div>
            </div>
            <div className="mt-1 text-sm font-bold text-slate-200">{trend.latestPoint.raw}</div>
          </div>
          <div className="flex flex-col justify-between rounded-md border border-slate-800 bg-slate-900/60 p-2">
            <div>
              <div className="text-[10px] text-slate-400">总变化量 (Δ)</div>
              <div className="truncate text-[10px] text-slate-500">
                共 {trend.points.length} 条记录
              </div>
            </div>
            <div className={`mt-1 flex items-center gap-1 text-sm font-bold ${deltaColorClass}`}>
              {isPositiveDelta ? (
                <TrendingUp size={14} />
              ) : isNegativeDelta ? (
                <TrendingDown size={14} />
              ) : (
                <Minus size={14} />
              )}
              <span>
                {isPositiveDelta ? "+" : isNegativeDelta ? "-" : ""}
                {formatComparisonDeltaValue(trend.scoreDelta)}
              </span>
            </div>
          </div>
          <div className="flex flex-col justify-between rounded-md border border-slate-800 bg-slate-900/60 p-2">
            <div>
              <div className="text-[10px] text-slate-400">历史极值区间</div>
              <div className="truncate text-[10px] text-slate-500">min ~ max</div>
            </div>
            <div className="mt-1 text-sm font-bold text-slate-200">
              {formatValueNumForDisplay(trend.minScore) ?? trend.minScore} ~ {formatValueNumForDisplay(trend.maxScore) ?? trend.maxScore}
            </div>
          </div>
        </div>

        {/* 折线图区域 */}
        <div className="cell-trend-chart-surface rounded-md border border-slate-800/80 bg-slate-900/40 px-2.5 pt-2 pb-1.5 [&_:focus]:outline-none">
          <div ref={chartHostRef} className="h-[205px] w-full min-w-0">
            <LineChart
              width={effectiveWidth}
              height={205}
              data={chartData}
              margin={{ top: 8, right: 18, bottom: 2, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="xId"
                ticks={visibleTickIndices}
                interval={0}
                stroke="#64748b"
                fontSize={10}
                tickLine={false}
                height={20}
                tick={(props: XAxisTickContentProps) => {
                  const { x, y, payload } = props;
                  const pointIndex = typeof payload?.value === "number" ? payload.value : (payload?.index ?? 0);
                  const point = chartData[pointIndex];
                  const dateText = point ? point.date : String(payload?.value ?? "");

                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text
                        x={0}
                        y={0}
                        dy={8}
                        textAnchor="middle"
                        fill="#64748b"
                        fontSize={10}
                      >
                        {dateText}
                      </text>
                    </g>
                  );
                }}
              />
              <YAxis
                domain={[yMin, yMax]}
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
                dx={-2}
                width={28}
                allowDecimals={!isIntegerScale}
                tickFormatter={(value: number) => {
                  if (isIntegerScale) {
                    return Math.round(value).toString();
                  }
                  return Number(value.toFixed(2)).toString();
                }}
              />
              <Tooltip
                cursor={{ stroke: "#475569", strokeWidth: 1, strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const point = payload[0]?.payload as (typeof chartData)[number] | undefined;
                  if (!point) return null;
                  return (
                    <div className="rounded-lg border border-slate-700 bg-slate-900/95 p-2.5 text-xs text-slate-100 shadow-xl backdrop-blur">
                      <div className="font-semibold text-sky-200">{point.fullTime}</div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-slate-400">分值:</span>
                        <span className="font-bold text-white text-sm">{point.raw}</span>
                        {point.deltaFromPrev !== null ? (
                          <span
                            className={`text-[10px] font-semibold ${
                              point.deltaFromPrev > 0
                                ? trend.higherIsBetter ? "text-emerald-400" : "text-rose-400"
                                : point.deltaFromPrev < 0
                                  ? trend.higherIsBetter ? "text-rose-400" : "text-emerald-400"
                                  : "text-slate-400"
                            }`}
                          >
                            ({point.deltaFromPrev > 0 ? "+" : point.deltaFromPrev < 0 ? "-" : ""}
                            {formatComparisonDeltaValue(point.deltaFromPrev)})
                          </span>
                        ) : null}
                      </div>
                      {point.note ? (
                        <div className="mt-1 max-w-[220px] break-words rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-200">
                          备注: {point.note}
                        </div>
                      ) : null}
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#38bdf8"
                strokeWidth={2.5}
                dot={{
                  r: 4,
                  fill: "#0284c7",
                  stroke: "#e0f2fe",
                  strokeWidth: 1.5
                }}
                activeDot={{
                  r: 6,
                  fill: "#38bdf8",
                  stroke: "#ffffff",
                  strokeWidth: 2
                }}
                animationDuration={400}
              />
            </LineChart>
          </div>
        </div>
      </div>
    </div>
  );
}

