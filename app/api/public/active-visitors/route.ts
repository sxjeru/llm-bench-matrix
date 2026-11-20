import { NextResponse } from "next/server";
import { logApiEvent, withApiLogging } from "@/lib/api-logging";
import { createWarningThrottle } from "@/lib/log-throttle";
import { fetchUmamiActiveVisitors, getUmamiActiveConfig } from "@/lib/umami-active-server";

export const dynamic = "force-dynamic";

let lastKnownActiveCount: number | null = null;
const shouldLogFallbackWarning = createWarningThrottle();

export const ACTIVE_VISITORS_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
  "CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
  "Vercel-CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=60"
};

export const DISABLED_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
  "CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
  "Vercel-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400"
};

export function _resetLastKnownActiveCountForTest(): void {
  lastKnownActiveCount = null;
}

export function GET(request: Request) {
  return withApiLogging(request, "api.public.active_visitors", () => handleActiveVisitorsRequest(request));
}

async function handleActiveVisitorsRequest(request: Request) {
  // If env not provided, return null without errors
  if (!getUmamiActiveConfig()) {
    return NextResponse.json(
      { active: null, enabled: false },
      { headers: DISABLED_CACHE_HEADERS }
    );
  }

  const count = await fetchUmamiActiveVisitors(request.signal);

  if (count !== null) {
    lastKnownActiveCount = count;
    return NextResponse.json(
      { active: count, enabled: true },
      { headers: ACTIVE_VISITORS_CACHE_HEADERS }
    );
  }

  // Graceful fallback to last known count if transient failure
  const fallbackSource = lastKnownActiveCount !== null ? "last_known" : "empty";
  if (shouldLogFallbackWarning("api.public.active_visitors.upstream_fallback", fallbackSource)) {
    logApiEvent(request, "warn", "api.public.active_visitors.upstream_fallback", {
      fallbackUsed: true,
      fallbackSource
    });
  }
  if (lastKnownActiveCount !== null) {
    return NextResponse.json(
      { active: lastKnownActiveCount, enabled: true },
      { headers: ACTIVE_VISITORS_CACHE_HEADERS }
    );
  }

  return NextResponse.json(
    { active: null, enabled: true },
    {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=15, stale-while-revalidate=30"
      }
    }
  );
}
