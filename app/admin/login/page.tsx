"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loginStatus, setLoginStatus] = useState<"idle" | "submitting" | "redirecting">("idle");

  const [showChangeDialog, setShowChangeDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const router = useRouter();

  function sanitizeRedirectTarget(rawTarget: string | null): string {
    if (!rawTarget) return "/admin";

    const target = rawTarget.trim();
    if (!target.startsWith("/")) return "/admin";
    if (target.startsWith("//")) return "/admin";

    try {
      const resolved = new URL(target, window.location.origin);
      if (resolved.origin !== window.location.origin) return "/admin";
      if (!resolved.pathname.startsWith("/admin")) return "/admin";
      return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    } catch {
      return "/admin";
    }
  }

  function getRedirectTarget() {
    if (typeof window === "undefined") return "/admin";

    return sanitizeRedirectTarget(new URLSearchParams(window.location.search).get("from"));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoginStatus("submitting");

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password })
      });

      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "登录失败");
        setLoginStatus("idle");
        return;
      }

      if (result.mustChangePassword) {
        setShowChangeDialog(true);
        setLoginStatus("idle");
        return;
      }

      setLoginStatus("redirecting");
      router.push(getRedirectTarget());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
      setLoginStatus("idle");
    }
  }

  async function onChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (newPassword.length < 8) {
      setError("新密码至少 8 位");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    setChangingPassword(true);
    setError("");

    try {
      const response = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          oldPassword: password,
          newPassword
        })
      });

      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "修改密码失败");
        return;
      }

      setShowChangeDialog(false);
      router.push(getRedirectTarget());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "修改密码失败");
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <>
      {showChangeDialog ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "grid",
            placeItems: "center",
            zIndex: 1000,
            padding: 20
          }}
        >
          <section className="card" style={{ maxWidth: 520, width: "100%", margin: 0 }}>
            <h2>请立即修改初始密码</h2>
            <p className="subtitle">检测到你正在使用默认密码 `change-me`，继续前必须先完成改密。</p>
            <form onSubmit={onChangePassword}>
              <div className="form-row">
                <div className="span-12">
                  <input
                    type="password"
                    placeholder="请输入新密码（至少8位）"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="span-12">
                  <input
                    type="password"
                    placeholder="再次输入新密码"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="span-12">
                  <button type="submit" disabled={changingPassword}>
                    {changingPassword ? "修改中..." : "保存新密码并进入后台"}
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <section className="card" style={{ maxWidth: 460, margin: "36px auto" }}>
        <h1>后台登录</h1>
        <p className="subtitle"> </p>

        {error ? <div className="notice error">{error}</div> : null}

        <form onSubmit={onSubmit}>
          <div className="form-row">
            <div className="span-12">
              <input
                type="password"
                placeholder="请输入后台密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="span-12">
              <button type="submit" disabled={loginStatus !== "idle"}>
                {loginStatus === "redirecting" ? "正在进入后台..." : loginStatus === "submitting" ? "登录中..." : "登录后台"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </>
  );
}
