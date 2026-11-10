import { NextResponse } from "next/server";
import { createRateLimiter, getRateLimitKey } from "@/lib/rate-limit";
import { ifNoneMatchMatches } from "@/lib/http-etag";
import type { PublicDashboardSnapshotVersions } from "@/lib/dashboard-snapshot-cache";
import { createPublicDashboardSnapshotEtag } from "@/lib/dashboard-snapshot-cache";
import { getPublicDashboardSnapshotVersions } from "@/lib/dashboard-snapshot";
import { getOrBuildPublicDashboardSnapshotRecord } from "@/lib/dashboard-snapshot-store";
import {
  PUBLIC_BROTLI_CACHE_CONTROL_BROWSER,
  PUBLIC_BROTLI_CACHE_CONTROL_CDN,
  PUBLIC_BROTLI_CACHE_CONTROL_VERCEL,
  PUBLIC_CACHE_CONTROL_BROWSER,
  PUBLIC_CACHE_CONTROL_CDN,
  PUBLIC_CACHE_CONTROL_VERCEL,
  PUBLIC_NO_STORE_CACHE_CONTROL,
  PUBLIC_PLAIN_CACHE_CONTROL
} from "../cache-headers";

/**
 * 公开快照端点的共享实现。
 *
 * 两个入口：
 * - `/api/public/dashboard`：预压缩 br，走边缘缓存；
 * - `/api/public/dashboard/plain`：明文 JSON，给解不了 br 的脚本兜底。
 *
 * 编码用独立路径而不是 `?plain=1`：路径必然进缓存键，而查询串是各层 CDN
 * 常见的「忽略参数」优化对象；且任意 query 都会各自生成一份缓存条目。
 */
const limiter = createRateLimiter(60, 60_000);

/**
 * Vercel 会在转发前改写/移除入站 `Accept-Encoding`（压缩协商由它的边缘完成），
 * 函数内拿到的值不可信：线上实测浏览器明确接受 br，函数里却读不到 br。
 *
 * 之所以做成函数而不是模块常量：测试需要在同一进程里切换该环境变量。
 */
function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

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
  // Vercel 上恒发 br（编码由 URL 决定）；其它环境仍按请求头协商。
  const useBrotli = !wantsPlain && shouldSendBrotli(request.headers.get("accept-encoding"));

  const versions = await getPublicDashboardSnapshotVersions();
  const etag = createPublicDashboardSnapshotEtag(versions, useBrotli ? "br" : "identity");
  // 304 也要带上与 200 一致的表示元数据，否则浏览器/边缘复用缓存副本时
  // 可能丢掉 Content-Encoding，把 br 字节当明文交给 response.json()。
  const headers: Record<string, string> = {
    ...buildHeaders({
      versions,
      etag,
      wantsPlain,
      encoded: useBrotli,
      remaining: rateLimit.remaining
    }),
    "Content-Type": "application/json; charset=utf-8",
    "X-Payload-Encoding": useBrotli ? "br" : "identity",
    ...(useBrotli ? { "Content-Encoding": "br" } : {})
  };

  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers
    });
  }

  const record = await getOrBuildPublicDashboardSnapshotRecord(versions);

  if (useBrotli) {
    // 数据库出站仍是 ~400 KB 预压缩字节；no-transform 阻止边缘再压一层，
    // 否则响应只标一层编码，浏览器解压后仍是 br 字节。
    return new Response(record.payloadBr, {
      headers: {
        ...headers,
        "Content-Length": String(record.payloadBr.byteLength)
      }
    });
  }

  // 明文分支：no-transform 防止上游再压一次导致调用方拿不到可直接解析的 JSON。
  return new Response(record.payloadJson, { headers });
}

function buildHeaders(input: {
  versions: PublicDashboardSnapshotVersions;
  etag: string;
  wantsPlain: boolean;
  encoded: boolean;
  remaining: number;
}): Record<string, string> {
  const { versions, etag, wantsPlain, encoded, remaining } = input;
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

  headers["Cache-Control"] = encoded ? PUBLIC_BROTLI_CACHE_CONTROL_BROWSER : PUBLIC_CACHE_CONTROL_BROWSER;
  headers["CDN-Cache-Control"] = encoded ? PUBLIC_BROTLI_CACHE_CONTROL_CDN : PUBLIC_CACHE_CONTROL_CDN;
  headers["Vercel-CDN-Cache-Control"] = encoded
    ? PUBLIC_BROTLI_CACHE_CONTROL_VERCEL
    : PUBLIC_CACHE_CONTROL_VERCEL;

  // 编码随客户端 Accept-Encoding 变化，Vercel 也可能改写入站头。不声明 Vary 时
  // 各层 CDN 会把压缩副本与非压缩副本混在同一缓存键下，导致请求方拿到编码不匹配的 body。
  headers.Vary = "Accept-Encoding";

  return headers;
}

/**
 * 是否下发预压缩字节。
 *
 * Vercel 上直接发 br，由边缘处理与客户端的编码协商；
 * 其它部署环境（自托管、本地 dev）按请求头正常判断。
 */
function shouldSendBrotli(acceptEncoding: string | null): boolean {
  if (isVercel()) return true;
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
