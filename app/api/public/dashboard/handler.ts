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
  const headers = buildHeaders({
    versions,
    etag,
    wantsPlain,
    remaining: rateLimit.remaining
  });

  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers
    });
  }

  const record = await getOrBuildPublicDashboardSnapshotRecord(versions);

  if (useBrotli) {
    // 自己压好再下发：函数返回的 3.6 MB 文本交给平台动态压缩只能到 ~475 KB，
    // 而预压缩的 brotli 是 ~400 KB，且边缘缓存的就是这份字节，无需二次压缩。
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

  // 明文分支：不开公共缓存（3.6 MB 明文没必要在边缘滞留），
  // no-transform 防止上游再压一次导致调用方拿不到可直接解析的 JSON。
  return new Response(record.payloadJson, {
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "X-Payload-Encoding": "identity"
    }
  });
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

  // Vercel 上编码由 URL 决定，响应不随 Accept-Encoding 变化，Vary 只会把缓存
  // 按不同的 AE 字符串切成多份；自托管仍按 AE 协商，才需要 Vary。
  if (!isVercel()) {
    headers.Vary = "Accept-Encoding";
  }

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
