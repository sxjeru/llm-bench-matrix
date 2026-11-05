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
  const useBrotli = shouldSendBrotli(request.headers.get("accept-encoding"));

  // 自己压好再下发：函数返回的 3.6 MB 文本交给平台动态压缩只能到 ~475 KB，
  // 而预压缩的 brotli 是 ~400 KB，且边缘缓存的就是这份字节，无需二次压缩。
  if (useBrotli) {
    return new Response(record.payloadBr, {
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "br",
        "Content-Length": String(record.payloadBr.byteLength),
        "X-Payload-Encoding": "br"
      }
    });
  }

  // 明确不支持 br 的客户端（脚本、老爬虫）退回未压缩 JSON，交给上游按需 gzip。
  return new Response(record.payloadJson, {
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "X-Payload-Encoding": "identity"
    }
  });
}

/**
 * 是否下发预压缩字节。
 *
 * Vercel 会在转发前改写/移除入站 `Accept-Encoding`（压缩协商由它的边缘完成），
 * 函数内拿到的值不可信：线上实测浏览器明确接受 br，函数里却读不到 br，
 * 于是一直走未压缩分支、再被平台动态压缩成 485 KB（预压缩只有 400 KB）。
 * 因此 Vercel 上直接下发 br，由边缘按客户端的真实 AE 决定透传或转码；
 * 其它部署环境（自托管、本地 dev）仍按请求头正常协商。
 */
function shouldSendBrotli(acceptEncoding: string | null): boolean {
  if (process.env.VERCEL === "1") return true;
  return acceptsBrotli(acceptEncoding);
}

function acceptsBrotli(acceptEncoding: string | null): boolean {
  // 缺失表示客户端没做限制，按接受处理
  if (!acceptEncoding) return true;
  return acceptEncoding
    .split(",")
    .some((part) => {
      const [coding, ...params] = part.trim().toLowerCase().split(";");
      if (coding !== "br") return false;
      // q=0 表示明确拒绝该编码
      return !params.some((param) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(param));
    });
}
