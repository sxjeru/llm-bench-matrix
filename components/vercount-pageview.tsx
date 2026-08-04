"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { reportVercountPageview, resolveVercountApiUrl } from "@/lib/vercount-client";

/**
 * 首屏仍由 layout 中的 vercount script 计数；
 * 这里只补 Next 客户端路由（矩阵 ↔ 散点图）切换时的 pageview。
 */
export function VercountPageview() {
  const pathname = usePathname();
  const scriptUrl = process.env.NEXT_PUBLIC_VERCOUNT_SCRIPT_URL;
  const previousPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    if (!scriptUrl) return;

    if (previousPathnameRef.current === null) {
      previousPathnameRef.current = pathname;
      return;
    }

    if (previousPathnameRef.current === pathname) {
      return;
    }

    previousPathnameRef.current = pathname;

    const apiUrl = resolveVercountApiUrl(scriptUrl);
    if (!apiUrl) return;

    const controller = new AbortController();
    void reportVercountPageview({
      apiUrl,
      pageUrl: window.location.href,
      signal: controller.signal
    });

    return () => controller.abort();
  }, [pathname, scriptUrl]);

  return null;
}
