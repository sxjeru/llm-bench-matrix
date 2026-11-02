import { NextResponse } from "next/server";
import { createRateLimiter, getRateLimitKey } from "@/lib/rate-limit";
import { ifNoneMatchMatches } from "@/lib/http-etag";
import {
  createPublicDashboardPreviewEtag,
  buildPublicDashboardPreviewWire
} from "@/lib/dashboard-preview";
import {
  decodePublicDashboardSnapshot,
  type PublicDashboardSnapshotVersions
} from "@/lib/dashboard-snapshot-cache";
import { getPublicDashboardSnapshotVersions } from "@/lib/dashboard-snapshot";
import { getOrBuildPublicDashboardSnapshotRecord } from "@/lib/dashboard-snapshot-store";
import {
  PUBLIC_CACHE_CONTROL_BROWSER,
  PUBLIC_CACHE_CONTROL_CDN,
  PUBLIC_CACHE_CONTROL_VERCEL,
  PUBLIC_NO_STORE_CACHE_CONTROL
} from "../../cache-headers";

const limiter = createRateLimiter(60, 60_000);

/**
 * 预览载荷由完整快照裁剪而来，裁剪 + 重新字典编码约 300–400 ms。
 * 按完整快照的 ETag 缓存：版本不变就一直复用，版本一变旧条目自然失效。
 */
let cachedPreview: { etag: string; payloadJson: string } | null = null;
let inFlightPreview: { etag: string; promise: Promise<string> } | null = null;

async function getPreviewPayload(versions: PublicDashboardSnapshotVersions): Promise<string> {
  const record = await getOrBuildPublicDashboardSnapshotRecord(versions);
  const cacheKey = record.etag;

  if (cachedPreview?.etag === cacheKey) {
    return cachedPreview.payloadJson;
  }
  if (inFlightPreview?.etag === cacheKey) {
    return inFlightPreview.promise;
  }

  const promise = (async () => {
    const snapshot = decodePublicDashboardSnapshot(JSON.parse(record.payloadJson));
    const payloadJson = JSON.stringify(buildPublicDashboardPreviewWire(snapshot));
    cachedPreview = { etag: cacheKey, payloadJson };
    return payloadJson;
  })();

  inFlightPreview = { etag: cacheKey, promise };
  try {
    return await promise;
  } finally {
    if (inFlightPreview?.promise === promise) {
      inFlightPreview = null;
    }
  }
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
  const etag = createPublicDashboardPreviewEtag(versions);
  const headers = {
    "Cache-Control": PUBLIC_CACHE_CONTROL_BROWSER,
    "CDN-Cache-Control": PUBLIC_CACHE_CONTROL_CDN,
    "Vercel-CDN-Cache-Control": PUBLIC_CACHE_CONTROL_VERCEL,
    "X-Dashboard-Preview": "1",
    ETag: etag,
    "X-RateLimit-Remaining": String(rateLimit.remaining)
  };

  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }

  const payloadJson = await getPreviewPayload(versions);
  return new Response(payloadJson, {
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
