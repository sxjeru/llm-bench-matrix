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
    expect(parsed.valueNote).toBeNull();
  });

  test("支持首个双值段带星号格式", () => {
    const parsed = parseBenchmarkValue("91*/83");

    expect(parsed.valueRaw).toBe("91* / 83");
    expect(parsed.valueNum).toBeCloseTo(91);
    expect(parsed.valueNum2).toBeCloseTo(83);
    expect(parsed.valueNote).toBeNull();
  });

  test("双值星号后的紧贴明确文本会作为注释", () => {
    const parsed = parseBenchmarkValue("81/77.3*paper");

    expect(parsed.valueRaw).toBe("81 / 77.3*");
    expect(parsed.valueNum).toBeCloseTo(81);
    expect(parsed.valueNum2).toBeCloseTo(77.3);
    expect(parsed.valueNote).toBe("paper");
  });

  test("双值星号 URL 语法仍可作为显式注释", () => {
    const parsed = parseBenchmarkValue("81/77.3*://https://paper.example");

    expect(parsed.valueRaw).toBe("81 / 77.3*");
    expect(parsed.valueNum).toBeCloseTo(81);
    expect(parsed.valueNum2).toBeCloseTo(77.3);
    expect(parsed.valueNote).toBe("https://paper.example");
  });

  test("双值短脚注标记不作为注释", () => {
    const starNumber = parseBenchmarkValue("81/77.3*1");
    const starLetter = parseBenchmarkValue("81/77.3*a");
    const caretNumber = parseBenchmarkValue("81/77.3^2");

    expect(starNumber.valueRaw).toBe("81 / 77.3*1");
    expect(starNumber.valueNote).toBeNull();
    expect(starLetter.valueRaw).toBe("81 / 77.3*a");
    expect(starLetter.valueNote).toBeNull();
    expect(caretNumber.valueRaw).toBe("81 / 77.3^2");
    expect(caretNumber.valueNote).toBeNull();
  });

  test("支持 #3.4 这类名次值", () => {
    const parsed = parseBenchmarkValue("#3.4");

    expect(parsed.valueRaw).toBe("#3.4");
    expect(parsed.valueNum).toBeCloseTo(3.4);
    expect(parsed.valueNum2).toBeNull();
    expect(parsed.valueNote).toBeNull();
  });
});
