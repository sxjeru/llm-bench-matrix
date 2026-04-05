"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
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
    <div className="grid">
      <section className="card col-6">
        <h3>Benchmark 均值（Top 12）</h3>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={benchmarkAverage} margin={{ top: 12, right: 16, bottom: 24, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#24314f" />
              <XAxis dataKey="benchmark" angle={-25} textAnchor="end" interval={0} height={70} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="avg" fill="#5da7ff" name="平均分" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card col-6">
        <h3>最近记录趋势</h3>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={trendData} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#24314f" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="score" stroke="#65d48f" dot={false} name="分值" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
