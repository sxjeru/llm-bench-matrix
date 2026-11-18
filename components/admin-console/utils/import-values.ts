import { composeImportPairValueRaw, parseImportPairValue } from "@/lib/import/pair-value";
import { hasMagnitudeSuffix } from "@/lib/import/scaled-amount";

export function formatPreviewNumericValue(
  rawValue: string,
  numericValue: number | null,
  position: "first" | "second" = "first"
): string {
  if (numericValue === null) {
    return "-";
  }

  const normalizedRaw = rawValue.trim();
  const pair = parsePairRawValue(normalizedRaw);
  const targetPart = pair
    ? (position === "second" ? pair.second : pair.first)
    : normalizedRaw;

  const currencyMatch = targetPart.match(/^([$¥€£])/);
  if (!currencyMatch) {
    return String(numericValue);
  }

  // 带量级后缀的值在导入预览中展示换算后的实际入库数值，尾数小数位不再沿用到换算结果上
  const fractionDigits = hasMagnitudeSuffix(targetPart)
    ? 0
    : (targetPart.match(/\.(\d+)/)?.[1]?.length ?? 0);
  const formatted = numericValue.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: Math.max(fractionDigits, 6)
  });

  return `${currencyMatch[1]}${formatted}`;
}

export function parsePairRawValue(rawValue: string): { first: string; second: string; note: string | null } | null {
  const pairValue = parseImportPairValue(rawValue);
  if (!pairValue) return null;

  return {
    first: pairValue.first,
    second: pairValue.second,
    note: pairValue.valueNote
  };
}

export function composePairRawValue(first: string, second: string, note?: string | null): string {
  const normalizedNote = note?.trim();
  const rawValue = composeImportPairValueRaw({ first, second });
  return normalizedNote ? `${rawValue} ${normalizedNote}` : rawValue;
}

export function parseSingleRawValue(rawValue: string): { value: string; tail: string } | null {
  if (parsePairRawValue(rawValue)) return null;

  const normalized = rawValue.trim();
  const singleMatch = normalized.match(
    /^((?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[kKMBT](?![A-Za-z]))?)(.*)$/
  );
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

export {
  normalizeNameParenthesisSpacing,
  buildDuplicateNameSlotKey,
  normalizeImportSourceKey,
  isSameImportSource
} from "@/lib/import/slot-key";
