function normalizeEtagToken(token: string) {
  return token.trim().replace(/^W\//, "");
}

export function ifNoneMatchMatches(ifNoneMatchHeader: string | null, etag: string) {
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
