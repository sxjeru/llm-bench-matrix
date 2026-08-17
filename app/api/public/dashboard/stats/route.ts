import { NextResponse } from "next/server";
import { getDashboardStats } from "@/lib/db/queries";
import { createRateLimiter, getRateLimitKey } from "@/lib/rate-limit";
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
 * 这 4 个整数原本随完整快照一起下发，于是必须等 1.4 MB、两万余行的矩阵下载并
 * 解码完才有值。单独成一个约 90 字节的响应后卡片就能抢先出数。
 *
 * 这里刻意不自己探测缓存版本：那会引入一次远程 settings 查询（实测约 100ms，
 * 正好是本端点从前的全部延迟）。交给 getDashboardStats 按它自己的 5 秒版本探测
 * TTL 决定何时回源，命中进程内缓存时整个请求零数据库往返；ETag 则直接由这 4 个
 * 数字的取值构成。
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

  const stats = await getDashboardStats();
  const etag = createPublicDashboardStatsEtag(stats);

  const headers = {
    "Cache-Control": PUBLIC_CACHE_CONTROL_BROWSER,
    "CDN-Cache-Control": PUBLIC_CACHE_CONTROL_CDN,
    "Vercel-CDN-Cache-Control": PUBLIC_CACHE_CONTROL_VERCEL,
    ETag: etag,
    "X-RateLimit-Remaining": String(rateLimit.remaining)
  };

  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers
    });
  }

  return NextResponse.json({ stats }, { headers });
}
