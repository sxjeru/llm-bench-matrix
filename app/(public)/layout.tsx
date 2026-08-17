import { DashboardProvider } from "@/components/dashboard-provider";
import { loadPublicDashboardSnapshot } from "@/lib/dashboard-snapshot";
import type { ReactNode } from "react";

export const revalidate = false;

export default async function PublicDashboardLayout({ children }: { children: ReactNode }) {
  const snapshot = await loadPublicDashboardSnapshot();

  return <DashboardProvider snapshot={snapshot}>{children}</DashboardProvider>;
}
