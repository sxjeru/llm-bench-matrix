import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getDashboardRows } from "@/lib/db/queries";
import { createRateLimiter, getRateLimitKey } from "@/lib/rate-limit";

// 60 requests per IP per 60-second window
const limiter = createRateLimiter(60, 60_000);
const CACHE_CONTROL_BROWSER = "public, max-age=0, must-revalidate";
const CACHE_CONTROL_CDN = "public, s-maxage=10, stale-while-revalidate=60";
const CACHE_CONTROL_VERCEL = "public, s-maxage=30, stale-while-revalidate=120";

function normalizeRequestedLimit(value: string | null) {
  const limitRaw = Number.parseInt(value || "300", 10);
  return Number.isNaN(limitRaw) ? 300 : Math.max(1, Math.min(1000, limitRaw));
}

function normalizeCachedLimit(requestedLimit: number) {
  if (requestedLimit <= 100) return 100;
  if (requestedLimit <= 300) return 300;
  return 1000;
}

function createRecordsEtag(rows: Awaited<ReturnType<typeof getDashboardRows>>, requestedLimit: number, cachedLimit: number) {
  const hash = createHash("sha1")
    .update(JSON.stringify(rows))
    .digest("hex")
    .slice(0, 16);

  return `"records:${requestedLimit}:${cachedLimit}:${hash}"`;
}

function normalizeEtagToken(token: string) {
  return token.trim().replace(/^W\//, "");
}

function ifNoneMatchMatches(ifNoneMatchHeader: string | null, etag: string) {
  if (!ifNoneMatchHeader) return false;

  const trimmedHeader = ifNoneMatchHeader.trim();
  if (trimmedHeader === "*") return true;

  const normalizedEtag = normalizeEtagToken(etag);
  const tokens = trimmedHeader.match(/(?:W\/)?"[^\"]*"|\*/g) ?? [];

  return tokens.some((token) => {
    if (token === "*") return true;
    return normalizeEtagToken(token) === normalizedEtag;
  });
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
          "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)),
          "X-RateLimit-Remaining": "0"
        }
      }
    );
  }

  const url = new URL(request.url);
  const limit = normalizeRequestedLimit(url.searchParams.get("limit"));
  const cachedLimit = normalizeCachedLimit(limit);

  const cachedRows = await getDashboardRows(cachedLimit);
  const rows = cachedRows.slice(0, limit);
  const etag = createRecordsEtag(rows, limit, cachedLimit);
  const headers = {
    "Cache-Control": CACHE_CONTROL_BROWSER,
    "CDN-Cache-Control": CACHE_CONTROL_CDN,
    "Vercel-CDN-Cache-Control": CACHE_CONTROL_VERCEL,
    ETag: etag,
    "X-RateLimit-Remaining": String(rateLimit.remaining)
  };

  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers
    });
  }

  return NextResponse.json(
    { rows },
    { headers }
  );
}
