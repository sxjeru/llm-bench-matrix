"use client";

import { FormEvent, useRef, useState } from "react";
import { sanitizeAdminRedirectTarget } from "@/lib/admin-redirect";
import { TurnstileWidget, TurnstileWidgetRef } from "@/components/turnstile-widget";

const HAS_TURNSTILE = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

export function AdminLoginForm() {
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState("");
  const [error, setError] = useState("");
  const [loginStatus, setLoginStatus] = useState<"idle" | "submitting" | "redirecting">("idle");
  const turnstileRef = useRef<TurnstileWidgetRef>(null);

  const [showChangeDialog, setShowChangeDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  function getRedirectTarget() {
    if (typeof window === "undefined") return "/admin";

    return sanitizeAdminRedirectTarget(
      new URLSearchParams(window.location.search).get("from"),
      window.location.origin
    );
  }

  function enterAdmin() {
    setLoginStatus("redirecting");
    // Full navigation so the next /admin request always carries the new session cookie.
    window.location.assign(getRedirectTarget());
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (HAS_TURNSTILE && !turnstileToken) {
      setError(turnstileError || "请先完成人机验证");
      return;
    }

    setLoginStatus("submitting");

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          password,
          turnstileToken: turnstileToken || undefined
        })
      });

      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "登录失败");
        setLoginStatus("idle");
        // 登录失败后重置人机验证 Token，防止复用已失效的验证凭证
        turnstileRef.current?.reset();
        setTurnstileToken("");
        return;
      }

      if (result.mustChangePassword) {
        setShowChangeDialog(true);
        setLoginStatus("idle");
        return;
      }

      enterAdmin();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
      setLoginStatus("idle");
      turnstileRef.current?.reset();
      setTurnstileToken("");
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
      enterAdmin();
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
              <div className="flex flex-col gap-3">
                <div>
                  <input
                    type="password"
                    className="input input-bordered w-full"
                    placeholder="请输入新密码（至少8位）"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <input
                    type="password"
                    className="input input-bordered w-full"
                    placeholder="再次输入新密码"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    className="btn btn-primary w-full"
                    disabled={changingPassword || loginStatus === "redirecting"}
                  >
                    {changingPassword || loginStatus === "redirecting"
                      ? "正在进入后台..."
                      : "保存新密码并进入后台"}
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
          <div className="flex flex-col gap-3">
            <div>
              <input
                type="password"
                className="input input-bordered w-full"
                placeholder="请输入后台密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <TurnstileWidget
              ref={turnstileRef}
              onVerify={(token) => {
                setTurnstileToken(token);
                setTurnstileError("");
                setError((prev) => (prev.includes("人机验证") ? "" : prev));
              }}
              onExpire={() => {
                setTurnstileToken("");
              }}
              onError={(code) => {
                setTurnstileToken("");
                if (code === "SCRIPT_LOAD_FAILED") {
                  setTurnstileError("人机验证组件加载失败，请检查网络连接或关闭广告拦截插件后重试");
                } else {
                  setTurnstileError("人机验证服务遇到问题，请重试或刷新页面");
                }
              }}
            />

            {turnstileError ? (
              <div className="flex flex-col items-center gap-1.5 p-2 rounded bg-error/10 text-error text-xs text-center border border-error/20">
                <span>{turnstileError}</span>
                <button
                  type="button"
                  className="btn btn-xs btn-outline btn-error"
                  onClick={() => {
                    setTurnstileError("");
                    turnstileRef.current?.retry();
                  }}
                >
                  重试加载验证码
                </button>
              </div>
            ) : null}

            <div>
              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={
                  loginStatus !== "idle" ||
                  (HAS_TURNSTILE && !turnstileToken)
                }
              >
                {loginStatus === "redirecting"
                  ? "正在进入后台..."
                  : loginStatus === "submitting"
                    ? "登录中..."
                    : "登录后台"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </>
  );
}
