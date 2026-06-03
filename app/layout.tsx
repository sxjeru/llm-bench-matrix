import Link from "next/link";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { TopbarActions } from "@/components/topbar-actions";
import { UmamiAnalytics } from "@/components/umami-analytics";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Bench Matrix",
  description: "Multi-source LLM benchmark matrix with heatmap visualization, model comparison and image export",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="dark">
      <body>
        <header className="topbar">
          <div className="container topbar-inner">
            <Link href="/" className="brand" suppressHydrationWarning>
              LLM Bench Matrix
            </Link>
            <TopbarActions />
          </div>
        </header>
        <main className="page">
          <div className="container">{children}</div>
        </main>

        <footer className="site-footnote">
          <div className="container">
            <div className="site-footnote-card">
              {process.env.NEXT_PUBLIC_VERCOUNT_SCRIPT_URL && (
                <>
                  <span className="site-footnote-item">
                    <span className="site-footnote-label">本页总访问量</span>
                    <span className="site-footnote-value">
                      <span id="vercount_value_page_pv" suppressHydrationWarning>Loading</span>
                    </span> 次
                  </span>

                  <span className="site-footnote-divider" aria-hidden="true" />
                </>
              )}

              <span className="site-footnote-item">
                Crafted with <span className="footnote-heart">♥</span> by {" "}
                <a
                  className="site-footnote-link"
                  href="https://github.com/sxjeru/llm-bench-matrix"
                  target="_blank"
                  rel="noreferrer"
                  suppressHydrationWarning
                >
                  sxjeru
                </a>
              </span>
            </div>
          </div>
        </footer>

        {process.env.NEXT_PUBLIC_VERCOUNT_SCRIPT_URL && (
          <script defer src={process.env.NEXT_PUBLIC_VERCOUNT_SCRIPT_URL} />
        )}
        <Analytics />
        <UmamiAnalytics />
      </body>
    </html>
  );
}
