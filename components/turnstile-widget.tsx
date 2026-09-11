"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";

export interface TurnstileWidgetRef {
  reset: () => void;
  retry: () => void;
}

export interface TurnstileWidgetProps {
  siteKey?: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: (errorCode?: string) => void;
  theme?: "light" | "dark" | "auto";
  className?: string;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: (errorCode?: string) => boolean | void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          retry?: "auto" | "never";
          [key: string]: unknown;
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const TurnstileWidget = forwardRef<TurnstileWidgetRef, TurnstileWidgetProps>(
  function TurnstileWidget(
    {
      siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      onVerify,
      onExpire,
      onError,
      theme = "auto",
      className
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [scriptLoaded, setScriptLoaded] = useState(false);
    const [renderTrigger, setRenderTrigger] = useState(0);

    // 使用 Ref 固化外部回调函数，避免父组件 re-render 触发死循环
    const onVerifyRef = useRef(onVerify);
    const onExpireRef = useRef(onExpire);
    const onErrorRef = useRef(onError);

    useEffect(() => {
      onVerifyRef.current = onVerify;
      onExpireRef.current = onExpire;
      onErrorRef.current = onError;
    });

    // 暴露 reset 与 retry 接口
    useImperativeHandle(ref, () => ({
      reset: () => {
        if (typeof window !== "undefined" && window.turnstile && widgetIdRef.current) {
          try {
            window.turnstile.reset(widgetIdRef.current);
          } catch {
            // 忽略重置异常
          }
        }
        onExpireRef.current?.();
      },
      retry: () => {
        if (typeof window === "undefined") return;

        // 如果 window.turnstile 已经存在，无需重新拉取脚本，直接重新触发 render
        if (window.turnstile) {
          if (widgetIdRef.current) {
            try {
              window.turnstile.remove(widgetIdRef.current);
            } catch {
              // ignore
            }
            widgetIdRef.current = null;
          }
          setScriptLoaded(true);
          setRenderTrigger((prev) => prev + 1);
        } else {
          // 脚本加载失败时的重试：清理原有失效标签并重新请求
          const existingScript = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_URL}"]`);
          if (existingScript) {
            existingScript.remove();
          }
          setScriptLoaded(false);
          setRenderTrigger((prev) => prev + 1);
        }
        onExpireRef.current?.();
      }
    }));

    // 脚本加载 Effect（具备完整的卸载取消与定时器清理，防 StrictMode 竞态与内存泄漏）
    useEffect(() => {
      if (!siteKey || typeof window === "undefined") return;

      if (window.turnstile) {
        setScriptLoaded(true);
        return;
      }

      let isCancelled = false;
      let pollInterval: ReturnType<typeof setInterval> | null = null;
      let pollTimeout: ReturnType<typeof setTimeout> | null = null;

      const markReady = () => {
        if (isCancelled) return;
        setScriptLoaded(true);
      };

      const handleScriptLoad = () => {
        if (isCancelled) return;
        if (window.turnstile) {
          markReady();
        } else {
          pollInterval = setInterval(() => {
            if (isCancelled) {
              if (pollInterval) clearInterval(pollInterval);
              return;
            }
            if (window.turnstile) {
              if (pollInterval) clearInterval(pollInterval);
              if (pollTimeout) clearTimeout(pollTimeout);
              markReady();
            }
          }, 50);

          pollTimeout = setTimeout(() => {
            if (pollInterval) clearInterval(pollInterval);
          }, 4000);
        }
      };

      const handleScriptError = () => {
        if (isCancelled) return;
        onErrorRef.current?.("SCRIPT_LOAD_FAILED");
      };

      let script = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_URL}"]`);
      if (!script) {
        script = document.createElement("script");
        script.src = SCRIPT_URL;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }

      script.addEventListener("load", handleScriptLoad);
      script.addEventListener("error", handleScriptError);

      return () => {
        isCancelled = true;
        if (pollInterval) clearInterval(pollInterval);
        if (pollTimeout) clearTimeout(pollTimeout);
        if (script) {
          script.removeEventListener("load", handleScriptLoad);
          script.removeEventListener("error", handleScriptError);
        }
      };
    }, [siteKey, renderTrigger]);

    // 渲染 Turnstile 控件
    useEffect(() => {
      if (!scriptLoaded || !siteKey || !containerRef.current || !window.turnstile) {
        return;
      }

      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
        widgetIdRef.current = null;
      }

      try {
        const id = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          retry: "never", // 关闭 SDK 内部自动重试，由页面宿主 UI 接管重试交互
          callback: (token: string) => {
            onVerifyRef.current?.(token);
          },
          "expired-callback": () => {
            onExpireRef.current?.();
          },
          "error-callback": (errorCode?: string) => {
            onErrorRef.current?.(errorCode || "CHALLENGE_FAILED");
            return true; // 返回 true 阻止 Cloudflare 内部默认重试逻辑，防止与页面重试按钮冲突
          }
        });
        widgetIdRef.current = id;
      } catch {
        onErrorRef.current?.("RENDER_FAILED");
      }

      return () => {
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            // ignore
          }
          widgetIdRef.current = null;
        }
      };
    }, [scriptLoaded, siteKey, theme, renderTrigger]);

    // 未配置 siteKey 时不渲染任何 DOM
    if (!siteKey) {
      return null;
    }

    return (
      <div
        className={className || "flex justify-center my-2 min-h-[65px]"}
        ref={containerRef}
      />
    );
  }
);
