export function formatPreviewNumericValue(
  rawValue: string,
  numericValue: number | null,
  position: "first" | "second" = "first"
): string {
  if (numericValue === null) {
    return "-";
  }

  const normalizedRaw = rawValue.trim();
  const targetPart = position === "second"
    ? (normalizedRaw.split("/")[1] ?? "").trim()
    : (normalizedRaw.split("/")[0] ?? "").trim();

  const currencyMatch = targetPart.match(/^([$¥€£])/);
  if (!currencyMatch) {
    return String(numericValue);
  }

  const fractionDigits = targetPart.match(/\.(\d+)/)?.[1]?.length ?? 0;
  const formatted = numericValue.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: Math.max(fractionDigits, 6)
  });

  return `${currencyMatch[1]}${formatted}`;
}

export function parsePairRawValue(rawValue: string): { first: string; second: string; note: string | null } | null {
  const normalized = rawValue.trim();
  const pairMatch = normalized.match(
    /^((?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*\/\s*((?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/
  );

  if (!pairMatch) return null;

  const [, first, second, tail] = pairMatch;
  const note = tail.trim();

  return {
    first: first.trim(),
    second: second.trim(),
    note: note.length > 0 ? note : null
  };
}

export function composePairRawValue(first: string, second: string, note?: string | null): string {
  const normalizedNote = note?.trim();
  return normalizedNote ? `${first} / ${second} ${normalizedNote}` : `${first} / ${second}`;
}

export function parseSingleRawValue(rawValue: string): { value: string; tail: string } | null {
  if (parsePairRawValue(rawValue)) return null;

  const normalized = rawValue.trim();
  const singleMatch = normalized.match(/^((?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/);
  if (!singleMatch) return null;

  return {
    value: singleMatch[1].trim(),
    tail: singleMatch[2].trim()
  };
}

export function parseStarSingleRawValue(rawValue: string): { value: string; note: string | null } | null {
  const parsedSingle = parseSingleRawValue(rawValue);
  if (!parsedSingle) return null;

  const tail = parsedSingle.tail.trim();
  if (!tail.startsWith("*")) return null;

  const afterStar = tail.slice(1).trim();
  const note = afterStar.startsWith("://") ? afterStar.slice(3).trim() : afterStar;

  return {
    value: parsedSingle.value,
    note: note.length > 0 ? note : null
  };
}

export function composeStarRawValue(value: string, note?: string | null): string {
  const normalized = note?.trim();
  return normalized ? `${value}* ${normalized}` : `${value}*`;
}
