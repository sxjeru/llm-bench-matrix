"use client";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN" data-theme="dark">
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "2rem",
            fontFamily: "system-ui, -apple-system, sans-serif",
            color: "#e2e8f0",
            background: "#0f172a"
          }}
        >
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>出现了意外错误</h1>
          <p style={{ color: "#94a3b8", marginBottom: "1.5rem", maxWidth: "40ch", textAlign: "center" }}>
            {error.message || "应用遇到了一个未预期的错误，请稍后重试。"}
          </p>
          {error.digest && (
            <p style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: "1rem" }}>
              Error ID: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "0.5rem 1.5rem",
              borderRadius: "0.375rem",
              border: "1px solid #334155",
              background: "#1e293b",
              color: "#e2e8f0",
              cursor: "pointer",
              fontSize: "0.875rem"
            }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
