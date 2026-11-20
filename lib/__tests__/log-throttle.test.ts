import { describe, expect, test } from "vitest";

import { createWarningThrottle } from "@/lib/log-throttle";

describe("createWarningThrottle", () => {
  test("limits repeated fallback warnings to one per cooldown window", () => {
    const shouldLog = createWarningThrottle(30_000);

    expect(shouldLog("upstream.fallback", "empty", 100_000)).toBe(true);
    expect(shouldLog("upstream.fallback", "empty", 100_001)).toBe(false);
    expect(shouldLog("upstream.fallback", "empty", 129_999)).toBe(false);
    expect(shouldLog("upstream.fallback", "empty", 130_000)).toBe(true);
  });

  test("logs a fallback-source transition immediately and throttles sources independently", () => {
    const shouldLog = createWarningThrottle(30_000);

    expect(shouldLog("upstream.fallback", "empty", 100)).toBe(true);
    expect(shouldLog("upstream.fallback", "last_known", 101)).toBe(true);
    expect(shouldLog("upstream.fallback", "last_known", 102)).toBe(false);
    expect(shouldLog("other.fallback", "empty", 102)).toBe(true);
  });
});
