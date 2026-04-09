/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Designed for serverless / single-instance deployments.
 * For multi-instance deployments behind a load balancer, consider
 * using a shared store like Redis (e.g. @upstash/ratelimit).
 */

type RateLimitEntry = {
  count: number;
  windowStart: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export type RateLimiter = {
  check: (key: string) => RateLimitResult;
};

/**
 * Create a rate limiter with a fixed window.
 *
 * @param limit   Maximum number of requests allowed in `windowMs`.
 * @param windowMs  Window duration in milliseconds.
 */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const store = new Map<string, RateLimitEntry>();
  let lastCleanup = Date.now();

  function cleanup() {
    const now = Date.now();
    // Only run cleanup at most once every 60 seconds
    if (now - lastCleanup < 60_000) return;
    lastCleanup = now;

    for (const [key, entry] of store.entries()) {
      if (now - entry.windowStart >= windowMs * 2) {
        store.delete(key);
      }
    }
  }

  return {
    check(key: string): RateLimitResult {
      cleanup();

      const now = Date.now();
      const entry = store.get(key);

      // No entry or window expired – start fresh
      if (!entry || now - entry.windowStart >= windowMs) {
        store.set(key, { count: 1, windowStart: now });
        return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
      }

      // Within window and under limit
      if (entry.count < limit) {
        entry.count += 1;
        return { allowed: true, remaining: limit - entry.count, retryAfterMs: 0 };
      }

      // Over limit
      const retryAfterMs = Math.max(0, windowMs - (now - entry.windowStart));
      return { allowed: false, remaining: 0, retryAfterMs };
    }
  };
}

/**
 * Extract a client identifier from request headers for rate limiting.
 * Falls back to "global" if no identifiable IP is present.
 */
export function getRateLimitKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const realIp = request.headers.get("x-real-ip") || "";

  const forwardedIp = forwarded.split(",")[0]?.trim();
  const raw = forwardedIp || realIp || "global";

  return raw.slice(0, 128);
}
