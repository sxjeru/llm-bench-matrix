import { describe, expect, test } from "vitest";

import { parseBenchmarkValue } from "@/lib/db/parse-value";

describe("parseBenchmarkValue currency", () => {
  test("支持 $4,432.12 单值格式", () => {
    const parsed = parseBenchmarkValue("$4,432.12");

    expect(parsed.valueRaw).toBe("$4,432.12");
    expect(parsed.valueNum).toBeCloseTo(4432.12);
    expect(parsed.valueNum2).toBeNull();
    expect(parsed.valueNote).toBeNull();
  });

  test("支持 $4,432.12 / $2,376.82 双值格式", () => {
    const parsed = parseBenchmarkValue("$4,432.12 / $2,376.82");

    expect(parsed.valueRaw).toBe("$4,432.12 / $2,376.82");
    expect(parsed.valueNum).toBeCloseTo(4432.12);
    expect(parsed.valueNum2).toBeCloseTo(2376.82);
    expect(parsed.valueNote).toBeNull();
  });

  test("支持 56.2 / 60.7* 这类双值+星号格式", () => {
    const parsed = parseBenchmarkValue("56.2 / 60.7*");

    expect(parsed.valueRaw).toBe("56.2 / 60.7*");
    expect(parsed.valueNum).toBeCloseTo(56.2);
    expect(parsed.valueNum2).toBeCloseTo(60.7);
    expect(parsed.valueNote).toBe("*");
  });

  test("支持 #3.4 这类名次值", () => {
    const parsed = parseBenchmarkValue("#3.4");

    expect(parsed.valueRaw).toBe("#3.4");
    expect(parsed.valueNum).toBeCloseTo(3.4);
    expect(parsed.valueNum2).toBeNull();
    expect(parsed.valueNote).toBeNull();
  });
});
