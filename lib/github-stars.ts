export const GITHUB_REPO_OWNER = "sxjeru";
export const GITHUB_REPO_NAME = "llm-bench-matrix";
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;
export const GITHUB_REPO_API_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;
export const PUBLIC_GITHUB_STARS_API_URL = "/api/public/github-stars";

const STAR_FETCH_TIMEOUT_MS = 3000;

export function formatStarCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "0";

  const value = Math.floor(count);
  if (value < 1000) return value.toString();

  const formatCompact = (divisor: number, suffix: string) => {
    const compact = value / divisor;
    const rounded = compact >= 10 ? Math.round(compact) : Math.round(compact * 10) / 10;
    return `${rounded}${suffix}`;
  };

  if (value < 1_000_000) return formatCompact(1000, "k");
  return formatCompact(1_000_000, "M");
}

export function parseStargazersCount(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;

  const count = (payload as { stargazers_count?: unknown }).stargazers_count;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;

  return Math.floor(count);
}

export async function fetchGithubStarCount(signal?: AbortSignal): Promise<number | null> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "llm-bench-matrix",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  try {
    // Must not set next.revalidate / cache here: a cached fetch in the root layout
    // becomes the `/` document ISR TTL on Vercel and triggers background regen.
    const response = await fetch(GITHUB_REPO_API_URL, {
      headers,
      signal: signal ?? AbortSignal.timeout(STAR_FETCH_TIMEOUT_MS)
    });

    if (!response.ok) return null;
    return parseStargazersCount(await response.json());
  } catch {
    return null;
  }
}

export async function fetchClientGithubStarCount(signal?: AbortSignal): Promise<number | null> {
  try {
    const response = await fetch(PUBLIC_GITHUB_STARS_API_URL, {
      signal: signal ?? AbortSignal.timeout(STAR_FETCH_TIMEOUT_MS)
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { count?: unknown; stargazers_count?: unknown };
    if (typeof data.count === "number" && Number.isFinite(data.count) && data.count >= 0) {
      return Math.floor(data.count);
    }
    return parseStargazersCount(data);
  } catch {
    return null;
  }
}
