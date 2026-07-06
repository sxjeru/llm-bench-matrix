import { composeImportPairValueRaw, isStarMarkerOnly, parseImportPairValue } from "@/lib/import/pair-value";
import { IMPORT_VALUE_SINGLE_REGEX } from "@/lib/import/value-patterns";

export type ParsedBenchmarkValue = {
  valueRaw: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
};

function toNumber(input: string): number | null {
  const parsed = Number.parseFloat(input.replace(/[$¥€£,#＃\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStarPrefixedNote(tail: string): string | null {
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

function normalizeSingleTailToNote(tail: string): string | null {
  return normalizeStarPrefixedNote(tail);
}

export function parseBenchmarkValue(rawInput: string): ParsedBenchmarkValue {
  const raw = rawInput.trim();

  if (!raw) {
    return {
      valueRaw: "",
      valueNum: null,
      valueNum2: null,
      valueNote: null
    };
  }

  const pairValue = parseImportPairValue(raw);
  if (pairValue) {
    return {
      valueRaw: composeImportPairValueRaw(pairValue),
      valueNum: toNumber(pairValue.first),
      valueNum2: toNumber(pairValue.second),
      valueNote: pairValue.valueNote
    };
  }

  const singleMatch = raw.match(IMPORT_VALUE_SINGLE_REGEX);
  if (singleMatch) {
    const [, value, tail] = singleMatch;
    const note = normalizeSingleTailToNote(tail);

    return {
      valueRaw: raw,
      valueNum: toNumber(value),
      valueNum2: null,
      valueNote: note || null
    };
  }

  return {
    valueRaw: raw,
    valueNum: null,
    valueNum2: null,
    valueNote: "non-numeric"
  };
}
