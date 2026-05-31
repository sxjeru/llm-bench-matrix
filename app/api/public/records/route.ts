import { NextResponse } from "next/server";
import { getDashboardRows } from "@/lib/db/queries";
import { createRateLimiter, getRateLimitKey } from "@/lib/rate-limit";

// 60 requests per IP per 60-second window
const limiter = createRateLimiter(60, 60_000);
const CACHE_CONTROL = "public, s-maxage=10, stale-while-revalidate=60";

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
  const latestRow = rows.reduce<{ id: number; updatedAt: string } | null>((latest, row) => {
    if (!latest) return { id: row.id, updatedAt: row.updatedAt };
    if (row.updatedAt > latest.updatedAt) return { id: row.id, updatedAt: row.updatedAt };
    if (row.updatedAt === latest.updatedAt && row.id > latest.id) return { id: row.id, updatedAt: row.updatedAt };
    return latest;
  }, null);

  return `"records:${requestedLimit}:${cachedLimit}:${rows.length}:${latestRow?.id ?? 0}:${latestRow?.updatedAt ?? "empty"}"`;
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
    "Cache-Control": CACHE_CONTROL,
    ETag: etag,
    "X-RateLimit-Remaining": String(rateLimit.remaining)
  };

  const ifNoneMatch = request.headers.get("if-none-match")?.replace(/^W\//, "") ?? "";
  if (ifNoneMatch === etag) {
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
