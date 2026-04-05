"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  const benchmarkAverage = useMemo(() => {
    const aggregate = new Map<string, { sum: number; count: number }>();

    rows.forEach((row) => {
      if (row.valueNum === null) return;
      const current = aggregate.get(row.benchmarkName) || { sum: 0, count: 0 };
      current.sum += row.valueNum;
      current.count += 1;
      aggregate.set(row.benchmarkName, current);
    });

    return Array.from(aggregate.entries())
      .map(([benchmark, agg]) => ({
        benchmark,
        avg: Number((agg.sum / agg.count).toFixed(4))
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 12);
  }, [rows]);

  const trendData = useMemo(() => {
    return rows
      .filter((row) => row.valueNum !== null)
      .map((row) => ({
        time: new Date(row.benchTime).toISOString().slice(0, 10),
        score: Number(row.valueNum),
        label: `${row.modelName} · ${row.benchmarkName}`
      }))
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
      .slice(-48);
  }, [rows]);

  return (
    <div className="legacy-grid">
      <ChartPanel title="Benchmark 均值（Top 12）">
        {({ width, height }) => (
          <BarChart width={width} height={height} data={benchmarkAverage} margin={{ top: 12, right: 16, bottom: 24, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#24314f" />
            <XAxis dataKey="benchmark" angle={-25} textAnchor="end" interval={0} height={70} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="avg" fill="#5da7ff" name="平均分" radius={[6, 6, 0, 0]} />
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
