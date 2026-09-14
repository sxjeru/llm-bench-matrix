import { NextResponse } from "next/server";
import { fetchGithubStarCount } from "@/lib/github-stars";

export const dynamic = "force-dynamic";

let lastKnownStarCount: number | null = null;

export const GITHUB_STARS_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
  "CDN-Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400",
  "Vercel-CDN-Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400"
};

export function _resetLastKnownStarCountForTest(): void {
  lastKnownStarCount = null;
}

export function _setLastKnownStarCountForTest(count: number | null): void {
  lastKnownStarCount = count;
}

export async function GET(request: Request) {
  const count = await fetchGithubStarCount(request.signal);

  if (count !== null) {
    lastKnownStarCount = count;
    return NextResponse.json(
      { count, stargazers_count: count },
      { headers: GITHUB_STARS_CACHE_HEADERS }
    );
  }

  // Graceful fallback to last known star count if GitHub rate limits or fails
  if (lastKnownStarCount !== null) {
    return NextResponse.json(
      { count: lastKnownStarCount, stargazers_count: lastKnownStarCount },
      { headers: GITHUB_STARS_CACHE_HEADERS }
    );
  }

  return NextResponse.json(
    { count: null, stargazers_count: null },
    {
      status: 503,
      headers: {
        "Cache-Control": "public, max-age=30, stale-while-revalidate=60"
      }
    }
  );
}

