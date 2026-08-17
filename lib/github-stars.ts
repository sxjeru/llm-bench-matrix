export const GITHUB_REPO_OWNER = "sxjeru";
export const GITHUB_REPO_NAME = "llm-bench-matrix";
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;
export const GITHUB_REPO_API_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;

const STAR_FETCH_TIMEOUT_MS = 3000;
const STAR_REVALIDATE_SECONDS = 3600;

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

export async function fetchGithubStarCount(): Promise<number | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "llm-bench-matrix",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(GITHUB_REPO_API_URL, {
      headers,
      signal: AbortSignal.timeout(STAR_FETCH_TIMEOUT_MS),
      next: { revalidate: STAR_REVALIDATE_SECONDS }
    });

    if (!response.ok) return null;
    return parseStargazersCount(await response.json());
  } catch {
    return null;
  }
}
