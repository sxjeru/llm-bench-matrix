export function parseMergeEntityId(
  rawInput: string,
  options: Array<{ id: number; label: string }>
): number | null {
  const normalized = rawInput.trim();
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const matchedId = normalized.match(/\[(\d+)\]\s*$/);
  if (matchedId) {
    return Number(matchedId[1]);
  }

  const exact = options.find((option) => option.label === normalized);
  return exact?.id ?? null;
}

export function parseExplicitMergeEntityId(rawInput: string): number | null {
  const normalized = rawInput.trim();
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const matchedId = normalized.match(/\[(\d+)\]\s*$/);
  if (matchedId) {
    return Number(matchedId[1]);
  }

  return null;
}
