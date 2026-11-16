export const PUBLIC_ACTIVE_VISITORS_API_URL = "/api/public/active-visitors";
export const ACTIVE_FETCH_TIMEOUT_MS = 3000;

export interface ActiveVisitorsResult {
  /** 活跃人数；上游失败或未配置时为 null */
  count: number | null;
  /** 服务端是否已配置 Umami 凭据；为 false 时客户端应停止轮询 */
  enabled: boolean;
}

export function resolveUmamiActiveApiUrl(options: {
  scriptUrl?: string | null;
  customApiUrl?: string | null;
  websiteId?: string | null;
}): string | null {
  const websiteId = options.websiteId?.trim();
  if (!websiteId) return null;

  const customApiUrl = options.customApiUrl?.trim();
  if (customApiUrl) {
    const cleaned = customApiUrl.replace(/\/+$/, "");
    if (cleaned.endsWith("/active")) return cleaned;
    if (cleaned.endsWith("/websites")) return `${cleaned}/${encodeURIComponent(websiteId)}/active`;
    if (cleaned.endsWith("/api") || cleaned.endsWith("/v1")) {
      return `${cleaned}/websites/${encodeURIComponent(websiteId)}/active`;
    }
    return `${cleaned}/api/websites/${encodeURIComponent(websiteId)}/active`;
  }

  const scriptUrl = options.scriptUrl?.trim();
  if (!scriptUrl) return null;

  try {
    const origin = new URL(scriptUrl).origin;
    return `${origin}/api/websites/${encodeURIComponent(websiteId)}/active`;
  } catch {
    return null;
  }
}

export function parseActiveVisitorsCount(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;

  const source = payload as Record<string, unknown>;
  const raw =
    typeof source.visitors === "object" && source.visitors !== null
      ? (source.visitors as Record<string, unknown>).value
      : source.visitors ?? source.x ?? source.value ?? source.active;

  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  if (typeof raw === "string") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }

  return null;
}

/**
 * 把调用方的 signal 与超时 signal 组合，避免传入 signal 后超时彻底失效。
 * 缺少 `AbortSignal.any` 的旧浏览器退回调用方 signal（只失去超时，不抛错）。
 */
export function withActiveFetchTimeout(
  signal?: AbortSignal,
  timeoutMs: number = ACTIVE_FETCH_TIMEOUT_MS
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal;
}

export async function fetchClientActiveVisitors(signal?: AbortSignal): Promise<ActiveVisitorsResult> {
  try {
    const response = await fetch(PUBLIC_ACTIVE_VISITORS_API_URL, {
      signal: withActiveFetchTimeout(signal)
    });

    // 非 2xx 多为瞬时故障，保留轮询以便自愈
    if (!response.ok) return { count: null, enabled: true };

    const data = (await response.json()) as { enabled?: unknown };
    return {
      count: parseActiveVisitorsCount(data),
      enabled: data.enabled !== false
    };
  } catch {
    return { count: null, enabled: true };
  }
}
