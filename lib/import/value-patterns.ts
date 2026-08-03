const IMPORT_VALUE_NUMERIC_TOKEN_PATTERN =
  "(?:[#＃]\\s*)?(?:[$¥€£]\\s*)?[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const IMPORT_VALUE_ATTACHED_MARKER_PATTERN = "(?:[*∗﹡✱✳✻](?!://)|\\^)(?:[0-9A-Za-z]*)?";

/** 整格空值与双值段空占位的统一集合（含空字符串）。 */
export const IMPORT_VALUE_EMPTY_MARKERS = new Set([
  "",
  "-",
  "--",
  "—",
  "–",
  "n/a",
  "na",
  "null",
  "none"
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 由 Set 生成；按长度降序，避免 `--` 被短标记 `-` 抢先匹配
const IMPORT_VALUE_EMPTY_SEGMENT_PATTERN = `(?:${[...IMPORT_VALUE_EMPTY_MARKERS]
  .filter((marker) => marker.length > 0)
  .sort((left, right) => right.length - left.length || left.localeCompare(right))
  .map(escapeRegExp)
  .join("|")})`;

const IMPORT_VALUE_PAIR_SEGMENT_PATTERN =
  `(?:${IMPORT_VALUE_NUMERIC_TOKEN_PATTERN}(?:${IMPORT_VALUE_ATTACHED_MARKER_PATTERN})?|${IMPORT_VALUE_EMPTY_SEGMENT_PATTERN})`;

export const IMPORT_VALUE_PAIR_REGEX =
  new RegExp(`^(${IMPORT_VALUE_PAIR_SEGMENT_PATTERN})\\s*\\/\\s*(${IMPORT_VALUE_PAIR_SEGMENT_PATTERN})(.*)$`, "i");

export const IMPORT_VALUE_SINGLE_REGEX =
  /^((?:[#＃]\s*)?(?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/;

export const IMPORT_VALUE_RANK_PREFIX_REGEX = /^[#＃]/;

export function isImportValueEmptyMarker(value: string): boolean {
  return IMPORT_VALUE_EMPTY_MARKERS.has(value.trim().toLowerCase());
}

export function isImportValueEmptySegment(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return isImportValueEmptyMarker(trimmed);
}
