"use client";

import { useOptionalDashboardSnapshot } from "@/components/dashboard-provider";

export function HomeMetrics() {
  const { snapshot } = useOptionalDashboardSnapshot();
  const stats = snapshot?.stats;

  return (
    <section className="home-metrics-grid">
      <article className="home-metric-card tone-gold">
        <div className="home-metric-title">Providers</div>
        <div className="home-metric-value">{stats?.providerCount ?? "—"}</div>
      </article>

      <article className="home-metric-card tone-emerald">
        <div className="home-metric-title">Models</div>
        <div className="home-metric-value">{stats?.modelCount ?? "—"}</div>
      </article>

      <article className="home-metric-card tone-blue">
        <div className="home-metric-title">Benchmarks</div>
        <div className="home-metric-value">{stats?.benchmarkCount ?? "—"}</div>
      </article>

      <article className="home-metric-card tone-purple">
        <div className="home-metric-title">总记录</div>
        <div className="home-metric-value">{stats?.totalRecords ?? "—"}</div>
      </article>
    </section>
  );
}
