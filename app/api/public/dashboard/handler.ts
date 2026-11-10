import { NextResponse } from "next/server";
import { createRateLimiter, getRateLimitKey } from "@/lib/rate-limit";
import { ifNoneMatchMatches } from "@/lib/http-etag";
import type { PublicDashboardSnapshotVersions } from "@/lib/dashboard-snapshot-cache";
import { createPublicDashboardSnapshotEtag } from "@/lib/dashboard-snapshot-cache";
import { getPublicDashboardSnapshotVersions } from "@/lib/dashboard-snapshot";
import { getOrBuildPublicDashboardSnapshotRecord } from "@/lib/dashboard-snapshot-store";
import {
  PUBLIC_CACHE_CONTROL_BROWSER,
  PUBLIC_CACHE_CONTROL_CDN,
  PUBLIC_CACHE_CONTROL_VERCEL,
  PUBLIC_NO_STORE_CACHE_CONTROL,
  PUBLIC_PLAIN_CACHE_CONTROL
} from "../cache-headers";

/**
 * 公开快照端点的共享实现。
 *
 * 数据库只存 Brotli 压缩的 wire JSON（出站 ~400 KB），这里按需解压后以明文下发；
 * HTTP 层的压缩完全交给平台按 Accept-Encoding 做一次。
 *
 * 早先直接把 payload_br 当 body 并声明 Content-Encoding: br，线上被 Vercel/EdgeOne
 * 又压了一层，浏览器只解一层后拿到的仍是 Brotli 字节，response.json() 直接抛错；
 * no-transform 与关闭 EdgeOne 智能压缩都无法阻止这层压缩。
 *
 * 明文端点用独立路径而非 `?plain=1`：路径必然进缓存键，查询串常被各层 CDN 忽略。
 */
const limiter = createRateLimiter(60, 60_000);

export async function handleDashboardRequest(
  request: Request,
  options: { plain?: boolean } = {}
): Promise<Response> {
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

  const wantsPlain = options.plain === true;
  const versions = await getPublicDashboardSnapshotVersions();
  // 统一用 identity 变体：与线上旧的 br 副本 ETag 不同，避免条件请求复用二进制副本
  const etag = createPublicDashboardSnapshotEtag(versions, "identity");
  const headers: Record<string, string> = {
    ...buildHeaders({
      versions,
      etag,
      wantsPlain,
      remaining: rateLimit.remaining
    }),
    "Content-Type": "application/json; charset=utf-8",
    "X-Payload-Encoding": "identity"
  };

  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }

  const record = await getOrBuildPublicDashboardSnapshotRecord(versions);
  // payloadJson 是惰性 getter：同一进程内只解压一次，DB 出站始终只有 payloadBr
  return new Response(record.payloadJson, { headers });
}

function buildHeaders(input: {
  versions: PublicDashboardSnapshotVersions;
  etag: string;
  wantsPlain: boolean;
  remaining: number;
}): Record<string, string> {
  const { versions, etag, wantsPlain, remaining } = input;
  const headers: Record<string, string> = {
    ETag: etag,
    "X-Dashboard-Version": versions.dashboard,
    "X-Pricing-Version": versions.pricing,
    "X-Settings-Version": versions.settings,
    "X-RateLimit-Remaining": String(remaining)
  };

  if (wantsPlain) {
    headers["Cache-Control"] = PUBLIC_PLAIN_CACHE_CONTROL;
    return headers;
  }

  headers["Cache-Control"] = PUBLIC_CACHE_CONTROL_BROWSER;
  headers["CDN-Cache-Control"] = PUBLIC_CACHE_CONTROL_CDN;
  headers["Vercel-CDN-Cache-Control"] = PUBLIC_CACHE_CONTROL_VERCEL;
  // 平台按 Accept-Encoding 压缩同一份明文，缓存必须按该头分变体
  headers.Vary = "Accept-Encoding";

  return headers;
}
