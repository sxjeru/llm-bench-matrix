export type VercountCounterData = {
  site_pv: number;
  page_pv: number;
  site_uv: number;
};

const REQUEST_TIMEOUT_MS = 5000;

export function resolveVercountApiUrl(scriptUrl: string, pageUrl?: string): string | null {
  try {
    const url = new URL(scriptUrl, pageUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? `${url.origin}/api/v2/log` : null;
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

  const rawPagePv = source.page_pv;
  const pagePv = typeof rawPagePv === "number" || (typeof rawPagePv === "string" && /^\d+$/.test(rawPagePv))
    ? Number(rawPagePv)
    : NaN;
  if (!Number.isSafeInteger(pagePv) || pagePv < 0) return null;

  return {
    site_pv: Number(source.site_pv ?? 0),
    page_pv: pagePv,
    site_uv: Number(source.site_uv ?? 0)
  };
}

export async function reportVercountPageview(options: {
  apiUrl: string;
  pageUrl: string;
  signal?: AbortSignal;
}): Promise<VercountCounterData | null> {
  if (!options.pageUrl.startsWith("http") || options.signal?.aborted) {
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

    return extractVercountCounterData(await response.json());
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
