import {
  IMPORT_VALUE_PAIR_REGEX,
  IMPORT_VALUE_SINGLE_REGEX,
  isImportValueEmptySegment
} from "@/lib/import/value-patterns";

export type ParsedImportPairValue = {
  first: string;
  second: string;
  valueNote: string | null;
};

type NormalizedPairSegment = {
  value: string;
  note: string | null;
};

const ATTACHED_MARKER_REGEX = /(?:[*∗﹡✱✳✻](?!:\/\/)|\^)(?:[0-9]+|[A-Za-z])?$/;

function normalizeMarker(marker: string): "*" | "^" {
  return marker === "^" ? "^" : "*";
}

function mergeImportNotes(primaryNote: string | null | undefined, secondaryNote: string | null | undefined): string | null {
  const primary = primaryNote?.trim() ?? "";
  const secondary = secondaryNote?.trim() ?? "";

  if (primary && secondary) {
    return primary === secondary ? primary : `${primary}; ${secondary}`;
  }

  if (primary) return primary;
  if (secondary) return secondary;
  return null;
}

function normalizeMarkerSuffix(markerRaw: string, suffixRaw: string): {
  markerSuffix: string;
  note: string | null;
} {
  const marker = normalizeMarker(markerRaw);
  const suffix = suffixRaw.trim();

  if (!suffix) {
    return {
      markerSuffix: marker,
      note: null
    };
  }

  if (marker === "*" && suffix.startsWith("://")) {
    const note = suffix.slice(3).trim();
    return {
      markerSuffix: marker,
      note: note.length > 0 ? note : null
    };
  }

  if (/^[0-9]+$/.test(suffix) || /^[A-Za-z]$/.test(suffix)) {
    return {
      markerSuffix: `${marker}${suffix}`,
      note: null
    };
  }

  if (/^[A-Za-z]{2,}$/.test(suffix)) {
    return {
      markerSuffix: marker,
      note: suffix
    };
  }

  return {
    markerSuffix: `${marker}${suffix}`,
    note: null
  };
}

function normalizePairSegment(rawSegment: string): NormalizedPairSegment | null {
  const trimmed = rawSegment.trim();
  if (isImportValueEmptySegment(trimmed)) {
    return {
      value: trimmed,
      note: null
    };
  }

  const singleMatch = trimmed.match(IMPORT_VALUE_SINGLE_REGEX);
  if (!singleMatch) return null;

  const [, numericPart, tailRaw] = singleMatch;
  const tail = tailRaw.trim();

  if (!tail) {
    return {
      value: numericPart.trim(),
      note: null
    };
  }

  const markerMatch = tail.match(/^([*∗﹡✱✳✻^])(.*)$/);
  if (!markerMatch) {
    return {
      value: `${numericPart.trim()}${tail}`,
      note: null
    };
  }

  const [, markerRaw, suffixRaw] = markerMatch;
  const normalizedSuffix = normalizeMarkerSuffix(markerRaw, suffixRaw);

  return {
    value: `${numericPart.trim()}${normalizedSuffix.markerSuffix}`,
    note: normalizedSuffix.note
  };
}

function normalizePairTail(tailRaw: string): NormalizedPairSegment {
  const tail = tailRaw.trim();
  if (!tail) {
    return {
      value: "",
      note: null
    };
  }

  const markerMatch = tail.match(/^([*∗﹡✱✳✻^])(.*)$/);
  if (!markerMatch) {
    return {
      value: "",
      note: tail
    };
  }

  const [, markerRaw, suffixRaw] = markerMatch;
  const normalizedSuffix = normalizeMarkerSuffix(markerRaw, suffixRaw);

  return {
    value: normalizedSuffix.markerSuffix,
    note: normalizedSuffix.note
  };
}

function appendTailMarker(segment: string, markerSuffix: string): string {
  if (!markerSuffix) return segment;
  if (ATTACHED_MARKER_REGEX.test(segment.trim())) return segment;
  return `${segment}${markerSuffix}`;
}

export function parseImportPairValue(rawInput: string): ParsedImportPairValue | null {
  const pairMatch = rawInput.trim().match(IMPORT_VALUE_PAIR_REGEX);
  if (!pairMatch) return null;

  const [, firstRaw, secondRaw, tailRaw] = pairMatch;
  const first = normalizePairSegment(firstRaw);
  const second = normalizePairSegment(secondRaw);
  if (!first || !second) return null;

  const tail = normalizePairTail(tailRaw);
  const valueNote = mergeImportNotes(mergeImportNotes(first.note, second.note), tail.note);

  return {
    first: first.value,
    second: appendTailMarker(second.value, tail.value),
    valueNote
  };
}

export function composeImportPairValueRaw(pair: Pick<ParsedImportPairValue, "first" | "second">): string {
  return `${pair.first} / ${pair.second}`;
}

export function isStarMarkerOnly(input: string): boolean {
  return /^[*∗﹡✱✳✻]+$/.test(input.trim());
}
