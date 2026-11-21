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
  const [isLoading, setIsLoading] = useState(true);
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
        setIsLoading(false);
        return;
      }

      const count = data.page_pv;
      writeCount(cacheKey, count);
      setCount(count);
      setIsLoading(false);
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
    if (!sample || sample.count === sample.baseline) return;
    const item = sample.count > sample.baseline ? increaseRef.current : totalRef.current;
    if (!item) return;

    let lastScrollY = Math.max(0, window.scrollY);
    const acknowledgeOnScroll = () => {
      const scrollY = Math.max(0, window.scrollY);
      const scrollingDown = scrollY > lastScrollY;
      lastScrollY = scrollY;
      if (!scrollingDown || !item.isConnected || document.visibilityState !== "visible") return;

      const root = document.scrollingElement ?? document.documentElement;
      if (scrollY + window.innerHeight < root.scrollHeight - 2) return;

      // Loading can bring the footer into view; only scrolling down to it acknowledges the delta.
      const bounds = item.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || bounds.top < 0 || bounds.left < 0 ||
          bounds.bottom > window.innerHeight || bounds.right > window.innerWidth) return;

      const stored = readCount(HOME_BASELINE_KEY);
      // Allow a reset when the provider total drops, without undoing a newer baseline from another tab.
      if (stored === null || stored < sample.count || (sample.canReset && stored === sample.baseline)) {
        writeCount(HOME_BASELINE_KEY, sample.count);
      }
      window.removeEventListener("scroll", acknowledgeOnScroll);
    };

    window.addEventListener("scroll", acknowledgeOnScroll, { passive: true });
    return () => window.removeEventListener("scroll", acknowledgeOnScroll);
  }, [sample]);

  const increase = sample ? sample.count - sample.baseline : 0;

  return (
    <>
      <span className="site-footnote-item site-footnote-traffic">
        <span className="site-footnote-label">本页总访问量</span>
        <span className="site-footnote-count">
          <span ref={totalRef} className="site-footnote-total">
            {count === null ? (
              <span className="site-footnote-value">{isLoading ? "Loading" : "—"}</span>
            ) : (
              <>
                <span className="site-footnote-value">{count}</span>
                <span className="site-footnote-unit">次</span>
              </>
            )}
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
