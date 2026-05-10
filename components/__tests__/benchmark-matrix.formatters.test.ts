import { describe, expect, test } from "vitest";

import {
  formatDateTimeLocalInputValue,
  formatLocalDateLabel,
  formatTooltipTime
} from "@/components/benchmark-matrix/formatters";

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

describe("benchmark matrix 时间格式化", () => {
  test("tooltip 时间按本地时区格式化", () => {
    const input = "2026-04-06T12:43:00.000Z";
    const date = new Date(input);

    expect(formatTooltipTime(input)).toBe(
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  });

  test("图表日期按本地时区格式化", () => {
    const input = "2026-04-06T00:30:00.000Z";
    const date = new Date(input);

    expect(formatLocalDateLabel(input)).toBe(
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    );
  });

  test("datetime-local 默认值按本地时间生成", () => {
    const date = new Date("2026-04-06T12:43:59.000Z");

    expect(formatDateTimeLocalInputValue(date)).toBe(
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  });
});