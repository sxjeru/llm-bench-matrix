import { describe, expect, test } from "vitest";
import { localDateTimeToIso, toLocalDateTime } from "@/components/admin-console/utils/datetime-local";

describe("datetime-local helpers", () => {
  test("ISO 与 datetime-local 按本地时区往返", () => {
    const iso = "2026-04-01T00:00:00.000Z";
    expect(localDateTimeToIso(toLocalDateTime(iso))).toBe(iso);
  });

  test("datetime-local 按本地墙钟解析，而不是 Date 字符串猜测", () => {
    const local = "2026-04-01T08:15:09";
    expect(localDateTimeToIso(local)).toBe(new Date(2026, 3, 1, 8, 15, 9).toISOString());
  });

  test("缺少秒时按 0 秒解析", () => {
    expect(localDateTimeToIso("2026-04-01T08:15")).toBe(new Date(2026, 3, 1, 8, 15, 0).toISOString());
  });

  test("无效时间抛出明确错误", () => {
    expect(() => localDateTimeToIso("not-a-date")).toThrow("无效的测试时间");
  });
});
