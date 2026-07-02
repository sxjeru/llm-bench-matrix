"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatLocalDateLabel } from "./benchmark-matrix/formatters";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { calculateBoxPlotStats, type BoxPlotStats } from "@/lib/boxplot-stats";
import { CustomBoxPlotLayer } from "./custom-boxplot-layer";

type Row = {
  benchmarkName: string;
  modelName: string;
  benchTime: string;
  valueNum: number | null;
};

type ChartSize = {
  width: number;
  height: number;
};

function ChartPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-base-300/70 bg-base-100/20 text-sm text-slate-400">
      图表正在稳定布局…
    </div>
  );
}

function ChartPanel({
  title,
  children
}: {
  title: string;
  children: (size: ChartSize) => ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;

    const measure = () => {
      const nextWidth = Math.floor(node.getBoundingClientRect().width);
      setWidth((current) => (current === nextWidth ? current : nextWidth));
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

  return (
    <section className="card legacy-col-6">
      <h3>{title}</h3>
      <div ref={hostRef} style={{ width: "100%", height: 320, minWidth: 0 }}>
        {width > 0 ? children({ width, height: 320 }) : <ChartPlaceholder />}
      </div>
    </section>
  );
}

export function DashboardCharts({ rows }: { rows: Row[] }) {
  // 收集每个 benchmark+model 组合的所有数值
  const benchmarkModelDistribution = useMemo(() => {
    const distribution = new Map<string, { values: number[]; benchmarkName: string; modelName: string }>();

    rows.forEach((row) => {
      if (row.valueNum === null) return;
      const key = `${row.benchmarkName}::${row.modelName}`;
      const current = distribution.get(key) || { values: [], benchmarkName: row.benchmarkName, modelName: row.modelName };
      current.values.push(row.valueNum);
      distribution.set(key, current);
    });

    // 只保留有多个值的组合（至少2个值才有意义绘制箱线图）
    const boxplotData: BoxPlotStats[] = Array.from(distribution.entries())
      .filter(([, data]) => data.values.length >= 2)
      .map(([, data]) => ({
        benchmark: `${data.benchmarkName} - ${data.modelName}`,
        benchmarkName: data.benchmarkName,
        modelName: data.modelName,
        ...calculateBoxPlotStats(data.values)
      }))
      .sort((a, b) => b.median - a.median) // 按中位数排序
      .slice(0, 12);

    return boxplotData;
  }, [rows]);

  const yDomain = useMemo(() => {
    if (benchmarkModelDistribution.length === 0) return [0, 100];
    let minVal = Infinity;
    let maxVal = -Infinity;
    benchmarkModelDistribution.forEach((item) => {
      const allVals = [item.min, item.q1, item.median, item.q3, item.max, ...item.outliers];
      minVal = Math.min(minVal, ...allVals);
      maxVal = Math.max(maxVal, ...allVals);
    });
    const padding = (maxVal - minVal) * 0.05 || 1;
    return [minVal >= 0 ? Math.max(0, minVal - padding) : minVal - padding, maxVal + padding];
  }, [benchmarkModelDistribution]);

  const trendData = useMemo(() => {
    return rows
      .filter((row) => row.valueNum !== null)
      .map((row) => ({
        time: formatLocalDateLabel(row.benchTime),
        timestamp: new Date(row.benchTime).getTime(),
        score: Number(row.valueNum),
        label: `${row.modelName} · ${row.benchmarkName}`
      }))
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-48);
  }, [rows]);

  return (
    <div className="legacy-grid">
      <ChartPanel title="Benchmark 分布（Top 12，箱线图）">
        {({ width, height }) => (
          <BarChart width={width} height={height} data={benchmarkModelDistribution} margin={{ top: 12, right: 16, bottom: 24, left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#24314f" />
            <XAxis dataKey="benchmark" angle={-25} textAnchor="end" interval={0} height={90} tick={{ fontSize: 11 }} />
            <YAxis domain={yDomain} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload[0]) return null;
                const data = payload[0].payload as BoxPlotStats & { benchmarkName: string; modelName: string };
                return (
                  <div className="rounded-lg border border-base-300 bg-base-100/95 p-3 shadow-lg backdrop-blur-sm">
                    <p className="mb-1 font-semibold text-slate-200">{data.benchmarkName}</p>
                    <p className="mb-2 text-xs text-slate-400">{data.modelName}</p>
                    <div className="space-y-1 text-xs text-slate-300">
                      <p>最大值: {data.max.toFixed(2)}</p>
                      <p>Q3 (75%): {data.q3.toFixed(2)}</p>
                      <p className="font-semibold">中位数: {data.median.toFixed(2)}</p>
                      <p>Q1 (25%): {data.q1.toFixed(2)}</p>
                      <p>最小值: {data.min.toFixed(2)}</p>
                      {data.outliers.length > 0 && (
                        <p className="text-amber-400">异常值: {data.outliers.length} 个</p>
                      )}
                      <p className="pt-1 text-slate-400">样本数: {data.count}</p>
                    </div>
                  </div>
                );
              }}
            />
            <Legend
              content={() => (
                <div className="text-center text-xs text-slate-400">
                  箱体显示 Q1-Q3 范围，白线为中位数，须线延伸至 1.5×IQR，圆点为异常值
                </div>
              )}
            />
            <Bar dataKey="median" fill="transparent" />
            <CustomBoxPlotLayer data={benchmarkModelDistribution} />
          </BarChart>
        )}
      </ChartPanel>

      <ChartPanel title="最近记录趋势">
        {({ width, height }) => (
          <LineChart width={width} height={height} data={trendData} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#24314f" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="score" stroke="#65d48f" dot={false} name="分值" />
          </LineChart>
        )}
      </ChartPanel>
    </div>
  );
}
