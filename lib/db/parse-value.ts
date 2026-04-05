export type ParsedBenchmarkValue = {
  valueRaw: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
};

function toNumber(input: string): number | null {
  const parsed = Number.parseFloat(input.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
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
    /^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*\/\s*([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/
  );
  if (pairMatch) {
    const [, first, second, tail] = pairMatch;
    const note = tail.trim();

    return {
      valueRaw: raw,
      valueNum: toNumber(first),
      valueNum2: toNumber(second),
      valueNote: note || "/"
    };
  }

  const singleMatch = raw.match(/^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/);
  if (singleMatch) {
    const [, value, tail] = singleMatch;
    const note = tail.trim();

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
