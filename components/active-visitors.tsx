"use client";

import { useEffect, useState } from "react";
import { fetchClientActiveVisitors } from "@/lib/umami-active";

const POLL_INTERVAL_MS = 45000;

export function ActiveVisitorsBadgeView({ count }: { count: number }) {
  const displayCount = Math.max(1, Math.floor(count));

  return (
    <>
      <span className="site-footnote-item">
        <span className="site-footnote-label">当前</span>
        <span className="site-footnote-value">{displayCount}</span> 人在看
      </span>
      <span className="site-footnote-divider" aria-hidden="true" />
    </>
  );
}

export function ActiveVisitors() {
  const [activeCount, setActiveCount] = useState<number | null>(null);

  useEffect(() => {
    // If NEXT_PUBLIC_UMAMI_WEBSITE_ID is not configured, do not poll
    if (!process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID) {
      return;
    }

    let activeController: AbortController | null = null;
    let intervalId: number | null = null;
    let stopped = false;

    const stopPolling = () => {
      stopped = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const fetchLatest = async () => {
      if (stopped || document.visibilityState === "hidden") return;

      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;

      const result = await fetchClientActiveVisitors(controller.signal);
      if (controller.signal.aborted) return;

      setActiveCount(result.count);
      // 服务端未配置 Umami 凭据时停止轮询，避免无效请求
      if (!result.enabled) stopPolling();
    };

    void fetchLatest();

    intervalId = window.setInterval(() => {
      void fetchLatest();
    }, POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchLatest();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopPolling();
      activeController?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  if (activeCount === null || !process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID) {
    return null;
  }

  return <ActiveVisitorsBadgeView count={activeCount} />;
}
