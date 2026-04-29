export function formatTooltipTime(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  return date.toISOString().slice(0, 16).replace("T", " ");
}

export function formatValueNumForDisplay(valueNum: number | null): string | null {
  if (valueNum === null || !Number.isFinite(valueNum)) return null;
  return Number(valueNum.toFixed(6)).toString();
}

export function formatComparisonDeltaValue(value: number): string {
  const absValue = Math.abs(value);
  if (!Number.isFinite(absValue)) return "0";

  if (absValue >= 100) return Number(absValue.toFixed(1)).toString();
  if (absValue >= 10) return Number(absValue.toFixed(2)).toString();
  if (absValue >= 1) return Number(absValue.toFixed(2)).toString();
  return Number(absValue.toFixed(3)).toString();
}
