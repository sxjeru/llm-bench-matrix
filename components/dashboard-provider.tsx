"use client";

import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";
import {
  buildAllRowsIndex,
  buildRowsBySource,
  buildRowsWithSourceMeta,
  type AllRowsIndex
} from "@/components/benchmark-matrix/selectors";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";
import type { MatrixLoadStage } from "@/components/matrix-loading-status";
import {
  decodePublicDashboardSnapshot,
  type PublicDashboardSnapshot,
  type PublicDashboardSnapshotWire,
  type PublicDashboardStats
} from "@/lib/dashboard-snapshot-cache";

/** All 默认视图下两页共用的索引；不包含 prune / matrixRows（散点 alwaysKeep 与矩阵不同）。 */
export type SharedDashboardDerived = {
  rowsBySource: Map<string, MatrixInputRow[]>;
  mergedAllRowsIndex: AllRowsIndex;
  getAllRowsWithSourceMeta: () => MatrixInputRow[];
};

type DashboardSnapshotContextValue = {
  snapshot: PublicDashboardSnapshot | null;
  /** 指标卡用的 4 个统计数字：快照未到时先由轻量端点供给 */
  stats: PublicDashboardStats | null;
  isLoading: boolean;
  error: string | null;
  derived: SharedDashboardDerived | null;
  /** 加载进度：供占位进度条展示当前卡在哪一步 */
  stage: MatrixLoadStage;
};

/**
 * 等到浏览器完成一次绘制再继续。
 *
 * 解码与派生索引都是同步重活，若不先让进度条画出来就直接开算，
 * 用户只会看到加载文案冻结在原地，看不出「走到第几步」。
 * 双 rAF 保证上一帧已经上屏。
 *
 * 后台标签页不绘制也不跑 rAF，等待只会白白推迟首屏，直接放行；
 * 兜底定时器只留两帧量级，纯粹防止 rAF 被节流后卡死。
 * 传入 signal 是为了组件卸载时立刻收掉 rAF 与定时器，而不是等它们自然结束。
 */
function waitForNextPaint(signal: AbortSignal): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.resolve();
  if (signal.aborted || document.visibilityState === "hidden") return Promise.resolve();
  if (typeof window.requestAnimationFrame !== "function") {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  return new Promise((resolve) => {
    let settled = false;
    let frame = 0;
    let timer = 0;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      signal.removeEventListener("abort", finish);
      resolve();
    };

    timer = window.setTimeout(finish, 32);
    signal.addEventListener("abort", finish, { once: true });
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(finish);
    });
  });
}

const DashboardSnapshotContext = createContext<DashboardSnapshotContextValue | null>(null);

function buildSharedDashboardDerived(rows: MatrixInputRow[]): SharedDashboardDerived {
  const rowsBySource = buildRowsBySource(rows);
  const mergedAllRowsIndex = buildAllRowsIndex(rows, false);
  let projected: MatrixInputRow[] | null = null;

  return {
    rowsBySource,
    mergedAllRowsIndex,
    getAllRowsWithSourceMeta: () => {
      projected ??= buildRowsWithSourceMeta(rows);
      return projected;
    }
  };
}

declare global {
  interface Window {
    __PRELOADED_FAST_STATS__?: Promise<Response>;
    __PRELOADED_SNAPSHOT__?: Promise<Response>;
  }
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PublicDashboardSnapshot | null>(null);
  const [derived, setDerived] = useState<SharedDashboardDerived | null>(null);
  const [fastStats, setFastStats] = useState<PublicDashboardStats | null>(null);
  const [stage, setStage] = useState<MatrixLoadStage>("fetching");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Provider 挂在 (public)/layout 上，矩阵页与散点图页互相切换时不会重挂，
  // 因此整个会话只取一次快照；重访由浏览器 HTTP 缓存按 ETag 复用。
  useEffect(() => {
    const controller = new AbortController();

    // 快照一旦到达就以它为权威源，此时轻量统计的 setState 不会改变 stats 的取值，
    // 只会让已挂载的矩阵白白重渲染一次，所以直接跳过。
    let snapshotArrived = false;

    async function loadStats() {
      try {
        const preloaded = typeof window !== "undefined" ? window.__PRELOADED_FAST_STATS__ : undefined;
        if (typeof window !== "undefined") {
          delete window.__PRELOADED_FAST_STATS__;
        }

        const response = await (preloaded ?? fetch("/api/public/dashboard/stats", { signal: controller.signal }));
        if (!response.ok) return;

        const payload = await response.json() as { stats: PublicDashboardStats };
        if (snapshotArrived) return;
        setFastStats(payload.stats);
      } catch {
        // 指标卡是附属信息，失败就留在占位符上等完整快照兜底；
        // 这里绝不写 error —— 那是矩阵的加载态出口。
      }
    }

    async function loadSnapshot() {
      try {
        const preloaded = typeof window !== "undefined" ? window.__PRELOADED_SNAPSHOT__ : undefined;
        if (typeof window !== "undefined") {
          delete window.__PRELOADED_SNAPSHOT__;
        }

        // 不手动带 If-None-Match：交给浏览器自己按 ETag revalidate，
        // 命中 304 时它会直接复用磁盘上的压缩副本并以 200 交回完整 body。
        // 首屏若已由 HTML head 预加载则优先复用，消灭串行等待。
        const response = await (preloaded ?? fetch("/api/public/dashboard", { signal: controller.signal }));
        if (!response.ok) {
          throw new Error(`Failed to load dashboard snapshot: ${response.status}`);
        }

        // 每个阶段都先让进度条画出来再做这一段的重活，否则几段计算会挤在同一帧里，
        // 用户只能看到最后一步的文案。
        setStage("decoding");
        await waitForNextPaint(controller.signal);
        if (controller.signal.aborted) return;

        const wire = await response.json() as PublicDashboardSnapshotWire;
        const nextSnapshot = decodePublicDashboardSnapshot(wire);

        setStage("indexing");
        await waitForNextPaint(controller.signal);
        if (controller.signal.aborted) return;

        const nextDerived = buildSharedDashboardDerived(nextSnapshot.rows);

        setStage("rendering");
        await waitForNextPaint(controller.signal);
        if (controller.signal.aborted) return;

        snapshotArrived = true;
        setSnapshot(nextSnapshot);
        setError(null);
        startTransition(() => setDerived(nextDerived));
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard snapshot");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadStats();
    void loadSnapshot();
    return () => controller.abort();
  }, []);

  return (
    <DashboardSnapshotContext.Provider
      value={{ snapshot, stats: snapshot?.stats ?? fastStats, isLoading, error, derived, stage }}
    >
      {children}
    </DashboardSnapshotContext.Provider>
  );
}

export function useDashboardSnapshot(): DashboardSnapshotContextValue {
  const value = useContext(DashboardSnapshotContext);
  if (!value) {
    throw new Error("useDashboardSnapshot must be used within DashboardProvider");
  }

  return value;
}

/**
 * 首页矩阵/散点传入的就是 snapshot.rows 时复用 Provider 里算好的分桶与 All 索引。
 * 单测直接挂 BenchmarkMatrix / ModelScatter（无 Provider）时返回 null，走组件本地计算。
 */
export function useSharedMatrixDerived(
  rows: MatrixInputRow[],
  allRows: MatrixInputRow[]
): SharedDashboardDerived | null {
  const value = useContext(DashboardSnapshotContext);
  if (!value?.derived || !value.snapshot) return null;
  if (value.snapshot.rows !== rows || rows !== allRows) return null;
  return value.derived;
}
