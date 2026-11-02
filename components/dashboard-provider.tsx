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
  /** 当前用于渲染的快照：优先完整快照，其次首屏预览 */
  snapshot: PublicDashboardSnapshot | null;
  /** 指标卡用的 4 个统计数字：快照未到时先由轻量端点供给 */
  stats: PublicDashboardStats | null;
  /** 当前 snapshot 是否为服务端预裁剪的预览（客户端需跳过二次裁剪） */
  isPreview: boolean;
  isLoading: boolean;
  error: string | null;
  derived: SharedDashboardDerived | null;
};

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
    __PRELOADED_PREVIEW__?: Promise<Response>;
    __PRELOADED_SNAPSHOT__?: Promise<Response>;
  }
}

/**
 * 首屏走「预览 → 全量」两段式：预览是服务端按默认视图裁剪好的 1/4 体积快照，
 * 先出图；完整快照到达后不在关键路径上应用，而是等浏览器空闲再切换，
 * 避免那 200 ms 的索引/建矩阵计算卡在用户刚看到表格的那一刻。
 * 网络仍是并行下载——两个请求都在 HTML 里预取，只是应用时机不同。
 */
function runWhenIdle(callback: () => void) {
  if (typeof window === "undefined") {
    callback();
    return;
  }

  const idle = window.requestIdleCallback;
  if (typeof idle === "function") {
    idle(() => callback(), { timeout: 1500 });
    return;
  }

  window.setTimeout(callback, 200);
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PublicDashboardSnapshot | null>(null);
  const [derived, setDerived] = useState<SharedDashboardDerived | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [fastStats, setFastStats] = useState<PublicDashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Provider 挂在 (public)/layout 上，矩阵页与散点图页互相切换时不会重挂，
  // 因此整个会话只取一次快照；重访由浏览器 HTTP 缓存按 ETag 复用。
  useEffect(() => {
    const controller = new AbortController();

    // 快照一旦到达就以它为权威源，此时轻量统计的 setState 不会改变 stats 的取值，
    // 只会让已挂载的矩阵白白重渲染一次，所以直接跳过。
    let snapshotArrived = false;
    // 预览已上屏后，完整快照要等空闲再应用；两个标志避免「全量先到」时又被预览覆盖。
    let previewApplied = false;
    let fullApplied = false;

    function applySnapshot(next: PublicDashboardSnapshot, preview: boolean) {
      if (controller.signal.aborted) return;
      if (preview) {
        if (fullApplied) return;
        previewApplied = true;
      } else {
        fullApplied = true;
      }

      setSnapshot(next);
      setIsPreview(preview);
      setError(null);
      setIsLoading(false);
      startTransition(() => {
        if (controller.signal.aborted) return;
        setDerived(buildSharedDashboardDerived(next.rows));
      });
    }

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

    async function loadPreview() {
      try {
        const preloaded = typeof window !== "undefined" ? window.__PRELOADED_PREVIEW__ : undefined;
        if (typeof window !== "undefined") {
          delete window.__PRELOADED_PREVIEW__;
        }

        const response = await (preloaded ?? fetch("/api/public/dashboard/preview", { signal: controller.signal }));
        if (!response.ok) return;

        const wire = await response.json() as PublicDashboardSnapshotWire;
        applySnapshot(decodePublicDashboardSnapshot(wire), true);
      } catch {
        // 预览只是加速手段：失败就退回等完整快照，不写 error。
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
        const response = await (preloaded ?? fetch("/api/public/dashboard", { signal: controller.signal }));
        if (!response.ok) {
          throw new Error(`Failed to load dashboard snapshot: ${response.status}`);
        }

        const wire = await response.json() as PublicDashboardSnapshotWire;
        const nextSnapshot = decodePublicDashboardSnapshot(wire);
        if (controller.signal.aborted) return;
        snapshotArrived = true;

        if (!previewApplied) {
          applySnapshot(nextSnapshot, false);
          return;
        }

        // 预览已经上屏，把这次重算挪到空闲时段，别卡住用户刚看到表格的瞬间。
        runWhenIdle(() => applySnapshot(nextSnapshot, false));
      } catch (loadError) {
        if (controller.signal.aborted) return;
        // 预览可用时不要把它顶掉：这条错误只在连预览都没有时才让位给错误态。
        if (previewApplied) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard snapshot");
        setIsLoading(false);
      }
    }

    void loadStats();
    void loadPreview();
    void loadSnapshot();
    return () => controller.abort();
  }, []);

  return (
    <DashboardSnapshotContext.Provider
      value={{
        snapshot,
        stats: snapshot?.stats ?? fastStats,
        isPreview,
        isLoading,
        error,
        derived
      }}
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
