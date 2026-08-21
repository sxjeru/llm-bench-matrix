import { DashboardProvider } from "@/components/dashboard-provider";
import { PublicDashboardKeepAlive } from "@/components/public-dashboard-keep-alive";
import type { ReactNode } from "react";

export const dynamic = "force-static";
export const revalidate = false;

export default function PublicDashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardProvider>
      <PublicDashboardKeepAlive>{children}</PublicDashboardKeepAlive>
    </DashboardProvider>
  );
}
