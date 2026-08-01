function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatLocalDateParts(date: Date): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} {
  return {
    year: date.getFullYear().toString(),
    month: padDatePart(date.getMonth() + 1),
    day: padDatePart(date.getDate()),
    hour: padDatePart(date.getHours()),
    minute: padDatePart(date.getMinutes())
  };
}

export function formatTooltipTime(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  const { year, month, day, hour, minute } = formatLocalDateParts(date);
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function formatLocalDateLabel(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  const { year, month, day } = formatLocalDateParts(date);
  return `${year}-${month}-${day}`;
}

export function formatDateTimeLocalInputValue(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const { year, month, day, hour, minute } = formatLocalDateParts(date);
  return `${year}-${month}-${day}T${hour}:${minute}`;
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

/**
 * 每百万 token 的美元价格。
 *
 * 高价位保 2 位小数、低价位保 3 位，再去掉尾随零，
 * 让 `$12` 与 `$0.075` 都不出现无意义的补零。
 */
export function formatPricePerMillion(value: number): string {
  const fixed = value.toFixed(value >= 10 ? 2 : 3);
  return `$${fixed.replace(/0+$/, "").replace(/\.$/, "")}`;
}

/** 参数量（单位 B），最多 3 位小数且不补零。 */
export function formatParamsBillions(value: number): string {
  return `${Number(value.toFixed(3)).toString()}B`;
}
