"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isHomePath } from "@/lib/public-routes";
import { reportVercountPageview, resolveVercountApiUrl } from "@/lib/vercount-client";

const HOME_BASELINE_KEY = "bench-matrix:home-pageview-baseline";

function readCount(key: string): number | null {
  try {
    const value = localStorage.getItem(key);
    if (value === null || !/^\d+$/.test(value)) return null;
    const count = Number(value);
    return Number.isSafeInteger(count) ? count : null;
  } catch {
    return null;
  }
}

function writeCount(key: string, count: number) {
  try {
    localStorage.setItem(key, String(count));
  } catch {
    // The total still works when storage is disabled.
  }
}

function PageviewCounter({ scriptUrl, isHome }: { scriptUrl: string; isHome: boolean }) {
  const totalRef = useRef<HTMLSpanElement>(null);
  const increaseRef = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState<number | null>(null);
  // Only a live result can create or acknowledge a delta.
  const [sample, setSample] = useState<{ count: number; baseline: number; canReset: boolean } | null>(null);

  useEffect(() => {
    const pageUrl = isHome ? new URL("/", window.location.href).href : window.location.href;
    const apiUrl = resolveVercountApiUrl(scriptUrl, pageUrl);
    if (!apiUrl) return;

    let active = true;
    const page = new URL(pageUrl);
    const cacheKey = `bench-matrix:pageview:${apiUrl}:${page.pathname}${page.search}`;
    const loadCount = async () => {
      if (!active) return;
      const baselineBeforeRequest = isHome ? readCount(HOME_BASELINE_KEY) : null;
      const data = await reportVercountPageview({ apiUrl, pageUrl });
      if (!active) return;
      if (!data) {
        setCount(readCount(cacheKey) ?? (isHome ? readCount(HOME_BASELINE_KEY) : null));
        return;
      }

      const count = data.page_pv;
      writeCount(cacheKey, count);
      setCount(count);
      if (isHome) {
        const baseline = readCount(HOME_BASELINE_KEY);
        if (baseline === null) writeCount(HOME_BASELINE_KEY, count);
        else setSample({ count, baseline, canReset: baseline === baselineBeforeRequest });
      }
    };

    // Let Strict Mode discard its first effect before sending a pageview.
    queueMicrotask(() => void loadCount());
    // Ignore late results after unmount, but let an already-started pageview finish.
    return () => {
      active = false;
    };
  }, [isHome, scriptUrl]);

  useEffect(() => {
    if (!sample || sample.count === sample.baseline || typeof IntersectionObserver === "undefined") return;
    const item = sample.count > sample.baseline ? increaseRef.current : totalRef.current;
    if (!item) return;

    const visibilityThreshold = 0.99;
    let observing = true;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (!observing || !item.isConnected || !entry?.isIntersecting ||
          entry.intersectionRatio < visibilityThreshold || document.visibilityState !== "visible") return;

      const stored = readCount(HOME_BASELINE_KEY);
      // Allow a reset when the provider total drops, without undoing a newer baseline from another tab.
      if (stored === null || stored < sample.count || (sample.canReset && stored === sample.baseline)) {
        writeCount(HOME_BASELINE_KEY, sample.count);
      }
      stopObserving();
    }, { threshold: visibilityThreshold });
    const observeWhenVisible = () => {
      observer.unobserve(item);
      observer.takeRecords();
      if (document.visibilityState === "visible") observer.observe(item);
    };
    const stopObserving = () => {
      observing = false;
      observer.disconnect();
      document.removeEventListener("visibilitychange", observeWhenVisible);
    };

    observeWhenVisible();
    document.addEventListener("visibilitychange", observeWhenVisible);
    return stopObserving;
  }, [sample]);

  const increase = sample ? sample.count - sample.baseline : 0;

  return (
    <>
      <span className="site-footnote-item site-footnote-traffic">
        <span className="site-footnote-label">本页总访问量</span>
        <span className="site-footnote-count">
          <span ref={totalRef} className="site-footnote-total">
            <span className="site-footnote-value">{count ?? "—"}</span>{" "}次
          </span>
          {increase > 0 && <span ref={increaseRef} className="site-footnote-increase">(+{increase})</span>}
        </span>
      </span>
      <span className="site-footnote-divider" aria-hidden="true" />
    </>
  );
}

export function VercountPageview() {
  const pathname = usePathname();
  const scriptUrl = process.env.NEXT_PUBLIC_VERCOUNT_SCRIPT_URL;
  if (!pathname || !scriptUrl) return null;

  return <PageviewCounter key={pathname} scriptUrl={scriptUrl} isHome={isHomePath(pathname)} />;
}
