export function parseBenchmarkNameAndDirection(rawBenchmarkName: string): {
  benchmarkName: string;
  higherIsBetter: boolean;
  hadDirectionMarker: boolean;
} {
  const trimmed = rawBenchmarkName.trim();
  const removedDown = trimmed.replace(/\s*[↓⬇️]+$/u, "").trim();
  if (removedDown !== trimmed) {
    return {
      benchmarkName: removedDown,
      higherIsBetter: false,
      hadDirectionMarker: true
    };
  }

  const removedUp = trimmed.replace(/\s*[↑⬆️]+$/u, "").trim();
  if (removedUp !== trimmed) {
    return {
      benchmarkName: removedUp,
      higherIsBetter: true,
      hadDirectionMarker: true
    };
  }

  return {
    benchmarkName: trimmed,
    higherIsBetter: true,
    hadDirectionMarker: false
  };
}
