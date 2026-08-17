import { DashboardProvider } from "@/components/dashboard-provider";
import type { ReactNode } from "react";

export const revalidate = false;

export default function PublicDashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardProvider>{children}</DashboardProvider>;
}
