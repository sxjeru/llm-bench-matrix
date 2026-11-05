import { NextResponse } from "next/server";
import { createRateLimiter, getRateLimitKey } from "@/lib/rate-limit";
import { ifNoneMatchMatches } from "@/lib/http-etag";
import { createPublicDashboardSnapshotEtag } from "@/lib/dashboard-snapshot-cache";
import { getPublicDashboardSnapshotVersions } from "@/lib/dashboard-snapshot";
import { getOrBuildPublicDashboardSnapshotRecord } from "@/lib/dashboard-snapshot-store";
import {
  PUBLIC_CACHE_CONTROL_BROWSER,
  PUBLIC_CACHE_CONTROL_CDN,
  PUBLIC_CACHE_CONTROL_VERCEL,
  PUBLIC_NO_STORE_CACHE_CONTROL
} from "../cache-headers";

const limiter = createRateLimiter(60, 60_000);

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
  const etag = createPublicDashboardSnapshotEtag(versions);
  const headers = {
    "Cache-Control": PUBLIC_CACHE_CONTROL_BROWSER,
    "CDN-Cache-Control": PUBLIC_CACHE_CONTROL_CDN,
    "Vercel-CDN-Cache-Control": PUBLIC_CACHE_CONTROL_VERCEL,
    "X-Dashboard-Version": versions.dashboard,
    "X-Pricing-Version": versions.pricing,
    "X-Settings-Version": versions.settings,
    ETag: etag,
    // 压缩与未压缩是两份不同表示，缓存必须按它分键。
    Vary: "Accept-Encoding",
    "X-RateLimit-Remaining": String(rateLimit.remaining)
  };

  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers
    });
  }

  const record = await getOrBuildPublicDashboardSnapshotRecord(versions);

  // 自己压好再下发：函数返回的 3.5 MB 文本交给 Vercel 动态压缩只能到 ~475 KB，
  // 而预压缩的 brotli 是 ~350 KB，且边缘缓存的就是这份字节，无需二次压缩。
  if (acceptsBrotli(request.headers.get("accept-encoding"))) {
    return new Response(record.payloadBr, {
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "br",
        "Content-Length": String(record.payloadBr.byteLength)
      }
    });
  }

  // 不支持 br 的客户端（脚本、老爬虫）退回未压缩 JSON，交给上游按需 gzip。
  return new Response(record.payloadJson, {
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function acceptsBrotli(acceptEncoding: string | null): boolean {
  if (!acceptEncoding) return false;
  return acceptEncoding
    .split(",")
    .some((part) => {
      const [coding, ...params] = part.trim().toLowerCase().split(";");
      if (coding !== "br") return false;
      // q=0 表示明确拒绝该编码
      return !params.some((param) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(param));
    });
}
