import { NextResponse } from "next/server";
import { getDashboardStats } from "@/lib/db/queries";
import { createRateLimiter, getRateLimitKey } from "@/lib/rate-limit";
import { getCacheVersion } from "@/lib/cache-versions";
import { ifNoneMatchMatches } from "@/lib/http-etag";
import { createPublicDashboardStatsEtag } from "@/lib/dashboard-snapshot-cache";
import {
  PUBLIC_CACHE_CONTROL_BROWSER,
  PUBLIC_CACHE_CONTROL_CDN,
  PUBLIC_CACHE_CONTROL_VERCEL,
  PUBLIC_NO_STORE_CACHE_CONTROL
} from "../../cache-headers";

/**
 * 首页 4 张指标卡的专用端点。
 *
 * 这 4 个整数原本随完整快照一起下发，于是必须等两万余行矩阵下载并解码完才有值。
 * 单独成一个约 100 字节的响应后，卡片一次 RTT 就能出数，与 /api/public/dashboard
 * 并行拉取、互不阻塞。服务端侧同样便宜：getDashboardStats 是独立的聚合查询，
 * 有自己的版本化缓存，不会顺带把 rows 拉起来。
 */

// 60 requests per IP per 60-second window
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

  const dashboardVersion = await getCacheVersion("dashboard");
  const etag = createPublicDashboardStatsEtag(dashboardVersion);

  const headers = {
    "Cache-Control": PUBLIC_CACHE_CONTROL_BROWSER,
    "CDN-Cache-Control": PUBLIC_CACHE_CONTROL_CDN,
    "Vercel-CDN-Cache-Control": PUBLIC_CACHE_CONTROL_VERCEL,
    "X-Dashboard-Version": dashboardVersion,
    ETag: etag,
    "X-RateLimit-Remaining": String(rateLimit.remaining)
  };

  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers
    });
  }

  const stats = await getDashboardStats(null, dashboardVersion);
  return NextResponse.json({ stats }, { headers });
}
