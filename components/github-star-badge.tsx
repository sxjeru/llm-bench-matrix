import { Star } from "lucide-react";
import { fetchGithubStarCount, formatStarCount, GITHUB_REPO_URL } from "@/lib/github-stars";

export function GithubStarBadgeView({ count }: { count: number }) {
  return (
    <a
      className="github-star-badge"
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={`在 GitHub 上查看项目，当前 ${count} 个 star`}
    >
      <Star size={12} fill="currentColor" strokeWidth={1.6} aria-hidden="true" />
      <span>{formatStarCount(count)}</span>
    </a>
  );
}

export async function GithubStarBadge() {
  const count = await fetchGithubStarCount();
  if (count === null) return null;
  return <GithubStarBadgeView count={count} />;
}
