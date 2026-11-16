import { NextResponse } from "next/server";
import { fetchUmamiActiveVisitors, getUmamiActiveConfig } from "@/lib/umami-active-server";

export const dynamic = "force-dynamic";

let lastKnownActiveCount: number | null = null;

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

export async function GET(request: Request) {
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
