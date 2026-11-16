import {
  parseActiveVisitorsCount,
  resolveUmamiActiveApiUrl,
  withActiveFetchTimeout
} from "@/lib/umami-active";

interface UmamiActiveConfig {
  websiteId: string;
  token: string;
}

/** 读取服务端凭据；未配置时返回 null，供路由判断是否启用活跃人数统计 */
export function getUmamiActiveConfig(): UmamiActiveConfig | null {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim();
  const token = process.env.UMAMI_API_TOKEN?.trim() || process.env.UMAMI_API_KEY?.trim();

  if (!websiteId || !token) return null;
  return { websiteId, token };
}

export async function fetchUmamiActiveVisitors(signal?: AbortSignal): Promise<number | null> {
  const config = getUmamiActiveConfig();
  if (!config) return null;

  const apiUrl = resolveUmamiActiveApiUrl({
    scriptUrl: process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL?.trim(),
    customApiUrl: process.env.UMAMI_API_URL?.trim(),
    websiteId: config.websiteId
  });

  if (!apiUrl) return null;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "llm-bench-matrix",
    Authorization: `Bearer ${config.token}`,
    // v2 自建版只认这个头，v3 与 Umami Cloud 走 Authorization；同时携带以兼容两类部署
    "x-umami-api-key": config.token
  };

  try {
    const response = await fetch(apiUrl, {
      headers,
      signal: withActiveFetchTimeout(signal)
    });

    if (!response.ok) return null;
    return parseActiveVisitorsCount(await response.json());
  } catch {
    return null;
  }
}
