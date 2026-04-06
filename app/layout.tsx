import Link from "next/link";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { TopbarActions } from "@/components/topbar-actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Bench Matrix",
  description: "Lightweight benchmark dashboard with admin gate and Drizzle-backed storage"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="dark">
      <body>
        <header className="topbar">
          <div className="container topbar-inner">
            <Link href="/" className="brand">
              LLM Bench Matrix
            </Link>
            <TopbarActions />
          </div>
        </header>
        <main className="page">
          <div className="container">{children}</div>
        </main>
        <Analytics />
      </body>
    </html>
  );
}
