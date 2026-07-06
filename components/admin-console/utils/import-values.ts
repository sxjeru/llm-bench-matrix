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

const IMPORT_DRAFT_NUMERIC_TOKEN_PATTERN =
  "(?:[#＃]\\s*)?(?:[$¥€£]\\s*)?[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const IMPORT_DRAFT_ATTACHED_MARKER_PATTERN = "[*∗﹡✱✳✻](?!://)(?:[0-9A-Za-z]*)?";
const IMPORT_DRAFT_PAIR_SEGMENT_PATTERN =
  `${IMPORT_DRAFT_NUMERIC_TOKEN_PATTERN}(?:${IMPORT_DRAFT_ATTACHED_MARKER_PATTERN})?`;
const IMPORT_DRAFT_PAIR_REGEX = new RegExp(
  `^(${IMPORT_DRAFT_PAIR_SEGMENT_PATTERN})\\s*\\/\\s*(${IMPORT_DRAFT_PAIR_SEGMENT_PATTERN})(.*)$`
);

function isStarMarkerOnly(input: string): boolean {
  return /^[*∗﹡✱✳✻]+$/.test(input.trim());
}

function startsWithStarMarker(input: string): boolean {
  return /^[*∗﹡✱✳✻]/.test(input.trim());
}

function normalizePairTailToNote(tail: string): string | null {
  const normalized = tail.trim();
  if (!normalized) return null;

  if (isStarMarkerOnly(normalized)) {
    return null;
  }

  if (/^[*∗﹡✱✳✻]:\/\//.test(normalized)) {
    const note = normalized.slice(4).trim();
    return note.length > 0 ? note : null;
  }

  if (/^[*∗﹡✱✳✻]/.test(normalized)) {
    const note = normalized.slice(1).trim();
    return note.length > 0 ? note : null;
  }

  return normalized;
}

function appendSpacedStarMarker(segment: string, tail: string): string {
  if (!startsWithStarMarker(tail)) return segment;
  if (/[*∗﹡✱✳✻](?:[0-9A-Za-z]*)?$/.test(segment.trim())) return segment;
  return `${segment}*`;
}

export function parsePairRawValue(rawValue: string): { first: string; second: string; note: string | null } | null {
  const normalized = rawValue.trim();
  const pairMatch = normalized.match(IMPORT_DRAFT_PAIR_REGEX);

  if (!pairMatch) return null;

  const [, first, second, tail] = pairMatch;
  const note = normalizePairTailToNote(tail);

  return {
    first: first.trim(),
    second: appendSpacedStarMarker(second.trim(), tail),
    note
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
