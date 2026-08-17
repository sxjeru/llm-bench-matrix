"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PublicDashboardSnapshot } from "@/lib/dashboard-snapshot";

const DashboardSnapshotContext = createContext<PublicDashboardSnapshot | null>(null);

export function DashboardProvider({
  snapshot,
  children
}: {
  snapshot: PublicDashboardSnapshot;
  children: ReactNode;
}) {
  return (
    <DashboardSnapshotContext.Provider value={snapshot}>
      {children}
    </DashboardSnapshotContext.Provider>
  );
}

export function useDashboardSnapshot(): PublicDashboardSnapshot {
  const snapshot = useContext(DashboardSnapshotContext);
  if (!snapshot) {
    throw new Error("useDashboardSnapshot must be used within DashboardProvider");
  }

  return snapshot;
}
