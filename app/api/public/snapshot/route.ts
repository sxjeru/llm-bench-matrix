import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  PUBLIC_CACHE_CONTROL_BROWSER,
  PUBLIC_CACHE_CONTROL_CDN,
  PUBLIC_CACHE_CONTROL_VERCEL,
  PUBLIC_NO_STORE_CACHE_CONTROL
} from "../cache-headers";
import {
  getPublicDashboardSnapshotVersions,
  loadPublicDashboardSnapshot
} from "@/lib/dashboard-snapshot";
import { ifNoneMatchMatches } from "@/lib/http-etag";
import { createRateLimiter, getRateLimitKey } from "@/lib/rate-limit";

const limiter = createRateLimiter(60, 60_000);

function createSnapshotEtag(dashboardVersion: string, pricingVersion: string, settingsVersion: string) {
  const hash = createHash("sha1")
    .update(`snapshot:${dashboardVersion}:${pricingVersion}:${settingsVersion}`)
    .digest("hex")
    .slice(0, 16);

  return `"snapshot:${dashboardVersion}:${pricingVersion}:${settingsVersion}:${hash}"`;
}

export async function GET(request: Request) {
  const clientKey = getRateLimitKey(request);
  const rateLimit = limiter.check(clientKey);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Cache-Control": PUBLIC_NO_STORE_CACHE_CONTROL,
          "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)),
          "X-RateLimit-Remaining": "0"
        }
      }
    );
  }

  const versions = await getPublicDashboardSnapshotVersions();
  const etag = createSnapshotEtag(versions.dashboard, versions.pricing, versions.settings);
  const headers = {
    "Cache-Control": PUBLIC_CACHE_CONTROL_BROWSER,
    "CDN-Cache-Control": PUBLIC_CACHE_CONTROL_CDN,
    "Vercel-CDN-Cache-Control": PUBLIC_CACHE_CONTROL_VERCEL,
    "X-Dashboard-Version": versions.dashboard,
    "X-Pricing-Version": versions.pricing,
    "X-Settings-Version": versions.settings,
    ETag: etag,
    "X-RateLimit-Remaining": String(rateLimit.remaining)
  };

  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers
    });
  }

  const snapshot = await loadPublicDashboardSnapshot(versions);
  return NextResponse.json(snapshot, { headers });
}
