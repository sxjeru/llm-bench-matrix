export type VercountCounterData = {
  site_pv: number;
  page_pv: number;
  site_uv: number;
};

const COUNTER_IDS = ["site_pv", "page_pv", "site_uv"] as const;
const REQUEST_TIMEOUT_MS = 5000;
const CACHE_KEY = "visitorCountData";

export function resolveVercountApiUrl(scriptUrl: string): string | null {
  try {
    return `${new URL(scriptUrl).origin}/api/v2/log`;
  } catch {
    return null;
  }
}

export function extractVercountCounterData(response: unknown): VercountCounterData | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const payload = response as {
    status?: unknown;
    data?: unknown;
    site_pv?: unknown;
    page_pv?: unknown;
    site_uv?: unknown;
  };

  const source =
    payload.status === "success" || payload.status === "error"
      ? payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : null
      : payload;

  if (!source) {
    return null;
  }

  return {
    site_pv: Number(source.site_pv ?? 0),
    page_pv: Number(source.page_pv ?? 0),
    site_uv: Number(source.site_uv ?? 0)
  };
}

export function applyVercountCounterData(data: VercountCounterData): void {
  for (const id of COUNTER_IDS) {
    const value = String(data[id] ?? 0);
    const vercountEl = document.getElementById(`vercount_value_${id}`);
    const busuanziEl = document.getElementById(`busuanzi_value_${id}`);
    if (vercountEl) vercountEl.textContent = value;
    if (busuanziEl) busuanziEl.textContent = value;
  }
}

function cacheVercountCounterData(data: VercountCounterData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // localStorage may be unavailable
  }
}

export async function reportVercountPageview(options: {
  apiUrl: string;
  pageUrl: string;
  signal?: AbortSignal;
}): Promise<VercountCounterData | null> {
  if (!options.pageUrl.startsWith("http")) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(options.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url: options.pageUrl }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = extractVercountCounterData(await response.json());
    if (data) {
      applyVercountCounterData(data);
      cacheVercountCounterData(data);
    }
    return data;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
