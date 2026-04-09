"use client";

import Link from "next/link";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "50vh",
        padding: "2rem",
        textAlign: "center"
      }}
    >
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>页面加载出错</h1>
      <p style={{ color: "var(--color-text-secondary, #94a3b8)", marginBottom: "1.5rem", maxWidth: "40ch" }}>
        {error.message || "当前页面遇到了一个错误，请稍后重试。"}
      </p>
      {error.digest && (
        <p style={{ color: "var(--color-text-tertiary, #64748b)", fontSize: "0.75rem", marginBottom: "1rem" }}>
          Error ID: {error.digest}
        </p>
      )}
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "0.5rem 1.5rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-border, #334155)",
            background: "var(--color-surface, #1e293b)",
            color: "var(--color-text, #e2e8f0)",
            cursor: "pointer",
            fontSize: "0.875rem"
          }}
        >
          重试
        </button>
        <Link
          href="/"
          style={{
            padding: "0.5rem 1.5rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-border, #334155)",
            background: "transparent",
            color: "var(--color-text, #e2e8f0)",
            textDecoration: "none",
            fontSize: "0.875rem"
          }}
        >
          返回首页
        </Link>
      </div>
    </section>
  );
}
