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
          "error-callback"?: (errorCode?: string) => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
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
    const [loadAttempt, setLoadAttempt] = useState(0);

    // 使用 Ref 固化外部回调函数，避免父组件重新渲染（如输入密码）导致组件被重复销毁与重置
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
        setScriptLoaded(false);
        setLoadAttempt((prev) => prev + 1);
        onExpireRef.current?.();
      }
    }));

    // 加载 Turnstile 外部脚本
    useEffect(() => {
      if (!siteKey || typeof window === "undefined") return;

      if (window.turnstile) {
        setScriptLoaded(true);
        return;
      }

      // 如果已有挂载失败的同名脚本标签，先移除以便重试
      const existingScript = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_URL}"]`);
      if (existingScript) {
        existingScript.remove();
      }

      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;

      script.onload = () => {
        if (window.turnstile) {
          setScriptLoaded(true);
        } else {
          // 部分浏览器下 script.onload 触发时全局变量稍有延迟，进行轻量轮询确认
          const interval = window.setInterval(() => {
            if (window.turnstile) {
              clearInterval(interval);
              setScriptLoaded(true);
            }
          }, 50);
          window.setTimeout(() => clearInterval(interval), 3000);
        }
      };

      script.onerror = () => {
        onErrorRef.current?.("SCRIPT_LOAD_FAILED");
      };

      document.head.appendChild(script);
    }, [siteKey, loadAttempt]);

    // 渲染 Turnstile 控件（仅依赖 scriptLoaded, siteKey, theme，与父组件 state 彻底解耦）
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
          callback: (token: string) => {
            onVerifyRef.current?.(token);
          },
          "expired-callback": () => {
            onExpireRef.current?.();
          },
          "error-callback": (errorCode?: string) => {
            onErrorRef.current?.(errorCode || "CHALLENGE_FAILED");
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
    }, [scriptLoaded, siteKey, theme]);

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
