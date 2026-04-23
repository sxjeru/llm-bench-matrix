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

function normalizeSingleTailToNote(tail: string): string | null {
  const normalized = tail.trim();
  if (!normalized) return null;

  if (normalized === "*") {
    return null;
  }

  if (normalized.startsWith("*://")) {
    const note = normalized.slice(4).trim();
    return note.length > 0 ? note : null;
  }

  if (normalized.startsWith("*")) {
    const note = normalized.slice(1).trim();
    return note.length > 0 ? note : null;
  }

  return normalized;
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

  const pairMatch = raw.match(
    /^((?:[#＃]\s*)?(?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*\/\s*((?:[#＃]\s*)?(?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/
  );
  if (pairMatch) {
    const [, first, second, tail] = pairMatch;
    const note = tail.trim();

    return {
      valueRaw: raw,
      valueNum: toNumber(first),
      valueNum2: toNumber(second),
      valueNote: note || null
    };
  }

  const singleMatch = raw.match(/^((?:[#＃]\s*)?(?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/);
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
