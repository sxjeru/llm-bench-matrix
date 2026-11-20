import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { toMatrixInputRow } from "@/components/benchmark-matrix/map-row";
import { getDashboardRows } from "@/lib/db/queries";
import { createRateLimiter, getRateLimitKey } from "@/lib/rate-limit";
import { getCacheVersions } from "@/lib/cache-versions";
import { CacheVersionChangedError } from "@/lib/cache-version-changed";
import { ifNoneMatchMatches } from "@/lib/http-etag";
import {
  PUBLIC_CACHE_CONTROL_BROWSER,
  PUBLIC_CACHE_CONTROL_CDN,
  PUBLIC_CACHE_CONTROL_VERCEL,
  PUBLIC_NO_STORE_CACHE_CONTROL
} from "../cache-headers";

// 60 requests per IP per 60-second window
const limiter = createRateLimiter(60, 60_000);

function normalizeRequestedLimit(value: string | null) {
  const limitRaw = Number.parseInt(value || "300", 10);
  return Number.isNaN(limitRaw) ? 300 : Math.max(1, Math.min(1000, limitRaw));
}

function normalizeCachedLimit(requestedLimit: number) {
  if (requestedLimit <= 100) return 100;
  if (requestedLimit <= 300) return 300;
  return 1000;
}

function createRecordsEtag(dashboardVersion: string, pricingVersion: string, requestedLimit: number) {
  const hash = createHash("sha1")
    .update(`records:${dashboardVersion}:${pricingVersion}:limit:${requestedLimit}`)
    .digest("hex")
    .slice(0, 16);

  return `"records:${dashboardVersion}:${pricingVersion}:limit:${requestedLimit}:${hash}"`;
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

  const url = new URL(request.url);
  const limit = normalizeRequestedLimit(url.searchParams.get("limit"));
  const cachedLimit = normalizeCachedLimit(limit);

  // Retrieve lightweight cache versions before loading rows.
  let { dashboard: dashboardVersion, pricing: pricingVersion } = await getCacheVersions();
  let etag = createRecordsEtag(dashboardVersion, pricingVersion, limit);

  const headers = {
    "Cache-Control": PUBLIC_CACHE_CONTROL_BROWSER,
    "CDN-Cache-Control": PUBLIC_CACHE_CONTROL_CDN,
    "Vercel-CDN-Cache-Control": PUBLIC_CACHE_CONTROL_VERCEL,
    "X-Dashboard-Version": dashboardVersion,
    "X-Pricing-Version": pricingVersion,
    ETag: etag,
    "X-RateLimit-Remaining": String(rateLimit.remaining)
  };

  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers
    });
  }

  let cachedRows: Awaited<ReturnType<typeof getDashboardRows>>;
  for (let attempt = 0; ; attempt += 1) {
    try {
      // Only live row loads validate against the database. A cache hit already
      // holds rows validated for its version, including an allowed older one.
      cachedRows = await getDashboardRows(cachedLimit, null, dashboardVersion);
      break;
    } catch (error) {
      if (!(error instanceof CacheVersionChangedError) || attempt >= 2) throw error;
      dashboardVersion = error.versions.dashboard;
      pricingVersion = error.versions.pricing;
    }
  }
  etag = createRecordsEtag(dashboardVersion, pricingVersion, limit);
  headers.ETag = etag;
  headers["X-Dashboard-Version"] = dashboardVersion;
  headers["X-Pricing-Version"] = pricingVersion;
  const rows = cachedRows.slice(0, limit).map(toMatrixInputRow);

  return NextResponse.json(
    { rows },
    { headers }
  );
}
