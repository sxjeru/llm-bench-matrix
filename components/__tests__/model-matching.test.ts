import { describe, expect, test } from "vitest";
import {
  extractModelVariantToken,
  compareModelVariantPriority,
  compareSourceTabKeysByVersion,
  compareModelNameByColumnOrder,
  extractModelTierToken,
  getModelFamilyMatchKey
} from "../benchmark-matrix/model-matching";

describe("model-matching variant sorting", () => {
  test("extractModelVariantToken should extract ultra and super", () => {
    expect(extractModelVariantToken("Nemotron 3 Ultra")).toEqual({
      familyKey: "nemotron 3",
      variant: "ultra"
    });
    expect(extractModelVariantToken("Nemotron 3 Super")).toEqual({
      familyKey: "nemotron 3",
      variant: "super"
    });
    expect(extractModelVariantToken("Nemotron 3 Nano")).toEqual({
      familyKey: "nemotron 3",
      variant: "nano"
    });
  });

  test("compareModelVariantPriority should sort ultra > super > nano", () => {
    // A negative number means left is higher priority and comes first.
    expect(compareModelVariantPriority("ultra", "super")).toBeLessThan(0);
    expect(compareModelVariantPriority("super", "nano")).toBeLessThan(0);
    expect(compareModelVariantPriority("ultra", "nano")).toBeLessThan(0);
  });

  test("compareSourceTabKeysByVersion should sort ultra > super > nano", () => {
    // Nemotron 3 Ultra should come before Nemotron 3 Super
    expect(compareSourceTabKeysByVersion("text:Nemotron 3 Ultra", "text:Nemotron 3 Super")).toBeLessThan(0);
    // Nemotron 3 Super should come before Nemotron 3 Nano
    expect(compareSourceTabKeysByVersion("text:Nemotron 3 Super", "text:Nemotron 3 Nano")).toBeLessThan(0);
  });

  test("comparators should sort same-version xxB models by larger size first", () => {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

    expect(compareSourceTabKeysByVersion("text:Ornith-1.0-27B", "text:Ornith-1.0-9B")).toBeLessThan(0);
    expect(compareSourceTabKeysByVersion("text:Ornith-1.0-9B", "text:Ornith-1.0-27B")).toBeGreaterThan(0);
    expect(compareModelNameByColumnOrder("Ornith-1.0-27B", "Ornith-1.0-9B", collator)).toBeLessThan(0);
  });

  test("compareModelNameByColumnOrder should sort ultra > super > nano", () => {
    const collator = new Intl.Collator("en");

    // Nemotron 3 Ultra should come before Nemotron 3 Super
    expect(compareModelNameByColumnOrder("Nemotron 3 Ultra", "Nemotron 3 Super", collator)).toBeLessThan(0);
    // Nemotron 3 Super should come before Nemotron 3 Nano
    expect(compareModelNameByColumnOrder("Nemotron 3 Super", "Nemotron 3 Nano", collator)).toBeLessThan(0);
  });

  test("compareModelNameByColumnOrder should sort Claude tier models by version before tier", () => {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

    // Version is primary, so Claude Sonnet 5 should come before Claude Opus 4.8.
    expect(compareModelNameByColumnOrder("Claude Sonnet 5", "Claude Opus 4.8", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Opus 4.8", "Claude Sonnet 5", collator)).toBeGreaterThan(0);

    // Within the same version, tier priority is mythos > fable > opus > sonnet > haiku.
    expect(compareModelNameByColumnOrder("Claude Mythos 5", "Claude Fable 5", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Fable 5", "Claude Opus 5", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Opus 5", "Claude Sonnet 5", collator)).toBeLessThan(0);
    expect(compareModelNameByColumnOrder("Claude Sonnet 5", "Claude Haiku 5", collator)).toBeLessThan(0);

    // Versioned tier models should sort before preview names without an explicit version.
    expect(compareModelNameByColumnOrder("Claude Fable 5", "Claude Mythos Preview", collator)).toBeLessThan(0);

    // Alternate Claude name order should still be grouped under the same tier family.
    expect(extractModelTierToken("Claude 5 Sonnet")).toEqual({
      familyKey: "claude",
      tier: "sonnet"
    });

    expect(compareModelNameByColumnOrder("Claude Fable 5", "Claude Opus 4.8", collator)).toBeLessThan(0);

    // And they should be grouped together under the same family check.
    expect(getModelFamilyMatchKey("Claude Mythos 5")).toBe("claude");
    expect(getModelFamilyMatchKey("Claude Mythos Preview")).toBe("claude");
    expect(getModelFamilyMatchKey("Claude Fable 5")).toBe("claude");
    expect(getModelFamilyMatchKey("Claude Opus 4.8")).toBe("claude");
    expect(getModelFamilyMatchKey("Claude 5 Sonnet")).toBe("claude");
  });
});
