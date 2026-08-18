"use client";

import { HomeBenchmarkMatrix } from "@/components/home-benchmark-matrix";
import { HomeModelScatter } from "@/components/home-model-scatter";
import { isHomePath, isScatterPath } from "@/lib/public-routes";
import { usePathname } from "next/navigation";
import { Activity, Suspense, useState, type ReactNode } from "react";

/**
 * 矩阵与散点挂在公开 layout 上，用 Activity 按路由显隐，切页不卸载。
 * 未访问过的那一页等到第一次导航再挂载，避免首页首屏同时算两套 derived。
 *
 * 两页各自判定自己的路由（而不是「非散点即矩阵」），
 * 这样将来 (public) 下再加别的路由时，两块都不会跟着渲染或改写地址栏。
 */
export function PublicDashboardKeepAlive({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const matrixActive = isHomePath(pathname);
  const scatterActive = isScatterPath(pathname);

  // 单向置位的「访问过」闩锁。当前活跃那一侧本轮渲染就已经是 true，
  // 所以只需在渲染期把结果并回 state，不必用 effect 触发级联渲染。
  const [visited, setVisited] = useState({ matrix: matrixActive, scatter: scatterActive });
  const matrixVisited = visited.matrix || matrixActive;
  const scatterVisited = visited.scatter || scatterActive;
  if (matrixVisited !== visited.matrix || scatterVisited !== visited.scatter) {
    setVisited({ matrix: matrixVisited, scatter: scatterVisited });
  }

  return (
    <>
      {children}
      {matrixVisited ? (
        <Activity mode={matrixActive ? "visible" : "hidden"}>
          <Suspense fallback={null}>
            <HomeBenchmarkMatrix urlSyncEnabled={matrixActive} />
          </Suspense>
        </Activity>
      ) : null}
      {scatterVisited ? (
        <Activity mode={scatterActive ? "visible" : "hidden"}>
          <Suspense fallback={null}>
            <HomeModelScatter urlSyncEnabled={scatterActive} />
          </Suspense>
        </Activity>
      ) : null}
    </>
  );
}
