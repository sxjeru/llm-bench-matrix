"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";
import {
  createPublicDashboardSnapshotEtag,
  getPublicDashboardSnapshotCacheKey,
  type PublicDashboardSnapshot
} from "@/lib/dashboard-snapshot-cache";

const SNAPSHOT_CACHE_KEY = getPublicDashboardSnapshotCacheKey();

type DashboardSnapshotContextValue = {
  snapshot: PublicDashboardSnapshot | null;
  isLoading: boolean;
  error: string | null;
};

const DashboardSnapshotContext = createContext<DashboardSnapshotContextValue | null>(null);

function readCachedSnapshot(): PublicDashboardSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(SNAPSHOT_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PublicDashboardSnapshot;
  } catch {
    return null;
  }
}

function writeCachedSnapshot(snapshot: PublicDashboardSnapshot) {
  try {
    window.localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota or private-mode failures should not block rendering.
  }
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PublicDashboardSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = readCachedSnapshot();
    if (cached) {
      setSnapshot(cached);
      setIsLoading(false);
    }

    const controller = new AbortController();

    async function loadSnapshot() {
      try {
        const headers = new Headers();
        if (cached?.versions) {
          headers.set("If-None-Match", createPublicDashboardSnapshotEtag(cached.versions));
        }

        const response = await fetch("/api/public/dashboard", {
          headers,
          signal: controller.signal
        });

        if (response.status === 304 && cached) {
          setError(null);
          setIsLoading(false);
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to load dashboard snapshot: ${response.status}`);
        }

        const nextSnapshot = await response.json() as PublicDashboardSnapshot;
        writeCachedSnapshot(nextSnapshot);
        setSnapshot(nextSnapshot);
        setError(null);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        if (!cached) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard snapshot");
        }
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

export function useDashboardSnapshot(): PublicDashboardSnapshot {
  const value = useContext(DashboardSnapshotContext);
  if (!value) {
    throw new Error("useDashboardSnapshot must be used within DashboardProvider");
  }
  if (!value.snapshot) {
    throw new Error("Dashboard snapshot is not ready");
  }

  return value.snapshot;
}

export function useOptionalDashboardSnapshot(): DashboardSnapshotContextValue {
  const value = useContext(DashboardSnapshotContext);
  if (!value) {
    throw new Error("useOptionalDashboardSnapshot must be used within DashboardProvider");
  }

  return value;
}
