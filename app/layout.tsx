import Link from "next/link";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Bench Matrix",
  description: "Lightweight benchmark dashboard with admin gate and Drizzle-backed storage"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="topbar">
          <div className="container topbar-inner">
            <Link href="/" className="brand">
              LLM Bench Matrix
            </Link>
            <nav className="nav">
              <Link href="/">看板</Link>
              <Link href="/admin">后台</Link>
            </nav>
          </div>
        </header>
        <main className="page">
          <div className="container">{children}</div>
        </main>
      </body>
    </html>
  );
}
