"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";
import {
  decodePublicDashboardSnapshot,
  type PublicDashboardSnapshot,
  type PublicDashboardSnapshotWire,
  type PublicDashboardStats
} from "@/lib/dashboard-snapshot-cache";

type DashboardSnapshotContextValue = {
  snapshot: PublicDashboardSnapshot | null;
  /** 指标卡用的 4 个统计数字：快照未到时先由轻量端点供给 */
  stats: PublicDashboardStats | null;
  isLoading: boolean;
  error: string | null;
};

const DashboardSnapshotContext = createContext<DashboardSnapshotContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PublicDashboardSnapshot | null>(null);
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

    async function loadStats() {
      try {
        const response = await fetch("/api/public/dashboard/stats", { signal: controller.signal });
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
        // 不手动带 If-None-Match：交给浏览器自己按 ETag revalidate，
        // 命中 304 时它会直接复用磁盘上的压缩副本并以 200 交回完整 body。
        const response = await fetch("/api/public/dashboard", { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to load dashboard snapshot: ${response.status}`);
        }

        const wire = await response.json() as PublicDashboardSnapshotWire;
        snapshotArrived = true;
        setSnapshot(decodePublicDashboardSnapshot(wire));
        setError(null);
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
      value={{ snapshot, stats: snapshot?.stats ?? fastStats, isLoading, error }}
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
