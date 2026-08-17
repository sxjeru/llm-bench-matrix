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
  type PublicDashboardSnapshotWire
} from "@/lib/dashboard-snapshot-cache";

type DashboardSnapshotContextValue = {
  snapshot: PublicDashboardSnapshot | null;
  isLoading: boolean;
  error: string | null;
};

const DashboardSnapshotContext = createContext<DashboardSnapshotContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PublicDashboardSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Provider 挂在 (public)/layout 上，矩阵页与散点图页互相切换时不会重挂，
  // 因此整个会话只取一次快照；重访由浏览器 HTTP 缓存按 ETag 复用。
  useEffect(() => {
    const controller = new AbortController();

    async function loadSnapshot() {
      try {
        // 不手动带 If-None-Match：交给浏览器自己按 ETag revalidate，
        // 命中 304 时它会直接复用磁盘上的压缩副本并以 200 交回完整 body。
        const response = await fetch("/api/public/dashboard", { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to load dashboard snapshot: ${response.status}`);
        }

        const wire = await response.json() as PublicDashboardSnapshotWire;
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

    void loadSnapshot();
    return () => controller.abort();
  }, []);

  return (
    <DashboardSnapshotContext.Provider value={{ snapshot, isLoading, error }}>
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
